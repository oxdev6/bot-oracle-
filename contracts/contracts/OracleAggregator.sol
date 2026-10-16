// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SlashReason} from "./libraries/SlashReason.sol";

interface IStakingVault {
    function isEligibleOperator(address operator) external view returns (bool);
    function effectiveStake(address operator) external view returns (uint256);
    function distributeRewards(address[] calldata operators, uint256[] calldata amounts) external;
    function slash(address operator, uint256 amount, bytes32 reason) external;
    function minStake() external view returns (uint256);
}

/**
 * @title OracleAggregator
 * @notice Core aggregation logic for Lodestar Oracle.
 *
 *  Round lifecycle (per asset):
 *    1. `submitPrice()` — staked operators submit prices each round.
 *    2. `closeRound()`  — anyone may call; computes the median, rejects
 *       outliers, punishes provable violations, distributes rewards, and
 *       checks the circuit breaker.
 *    3. The new price is published and available via `getLatestPrice()`.
 *
 *  Quorum:
 *    A round only publishes a price when it collected at least
 *    `minSubmissions` submissions.  Below quorum the round is rolled without
 *    publishing, so the feed goes stale instead of being set by one operator.
 *    This is the single most important safety property of the contract: a
 *    median of one submission is not a median.
 *
 *  Outlier rejection (two levels):
 *    - At submit: hard-reject if deviation from the *last published price*
 *      exceeds `deviationThresholdBps` (300 = 3%).  The reference can only
 *      veto while it is fresh (<= `staleAfterSeconds`), otherwise a volatile
 *      market could never be reported.
 *    - At close: compute the raw median over accepted submissions, discard
 *      anything deviating more than `deviationThresholdBps` from it, and take
 *      the median of the survivors.
 *
 *  Circuit breaker (per feed, not per contract):
 *    - If the round-over-round move exceeds `breakerThresholdBps` (2000 =
 *      20%) the *feed* pauses.  Other pairs keep running.  Only the timelock
 *      owner can `resumeFeed(assetId)`.
 *
 *  Slashing (automatic, aggregator-only):
 *    Two objective, on-chain-provable violations are punished at round close:
 *      - LIVENESS  — a tracked operator missed `livenessMissLimit` rounds in
 *                    a row on this feed.
 *      - ACCURACY  — a submission was vetoed as an outlier *and* sat more
 *                    than `accuracySlashDeviationBps` (900 = 9%) from the
 *                    round median, i.e. far outside any honest CEX/DEX spread.
 *    Slashing is skipped for rounds that fail quorum (too little evidence)
 *    and for rounds that trip the circuit breaker (a market-wide move is not
 *    an operator's fault).  `slashingEnabled` is a timelocked kill switch.
 *
 *  Reward distribution:
 *    - `emissionPerRound` LODE is split equally among operators whose
 *      submissions survived outlier rejection.  The call into the vault is
 *      isolated: an under-funded reward pool can never block price
 *      publication, it only skips that round's payout.
 */
contract OracleAggregator is Ownable, ReentrancyGuard {
    using SlashReason for bytes32;

    // ── types ──────────────────────────────────────────────────────────

    struct FeedState {
        uint8  decimals;
        uint80 roundId;
        int256 lastAnswer;
        uint256 lastUpdate;
        uint256 roundStart;
        uint256 lastRoundSubmissions;
        string  description;
        bool    exists;
        bool    paused;
        uint256 lastRoundVetoed;
        uint256 totalRounds;
    }

    struct PriceSubmission {
        address operator;
        int256  price;
        uint256 timestamp;
    }

    struct OperatorStats {
        bool     tracked;
        uint256  roundsSeen;
        uint256  submissions;
        uint256  accuracyVetoes;
        uint256  consecutiveMisses;
        uint256  slashCount;
        uint256  slashedAmount;
        uint256  lastSubmissionRound;
    }

    /// @notice A single published round (see `rounds`). Written only when a
    ///         round actually published a price.
    struct RoundRecord {
        int256  answer;
        uint256 updatedAt;
        uint256 inThreshold;
        uint256 vetoed;
        bool    published;
    }

    // ── state ──────────────────────────────────────────────────────────
    IStakingVault public immutable vault;

    uint256 public roundInterval;
    uint256 public deviationThresholdBps;   // 300 = 3 %
    uint256 public breakerThresholdBps;     // 2000 = 20 %
    uint256 public staleAfterSeconds;
    uint256 public emissionPerRound;

    /// @notice Minimum accepted submissions required for a round to publish.
    uint256 public minSubmissions;
    /// @notice Rejects submissions whose quoted source timestamp is older.
    uint256 public maxSourceAgeSeconds;
    /// @notice Consecutive missed rounds before a liveness slash.
    uint256 public livenessMissLimit;
    /// @notice Liveness slash, in bps of the operator's effective stake.
    uint256 public livenessSlashBps;
    /// @notice Accuracy slash, in bps of the operator's effective stake.
    uint256 public accuracySlashBps;
    /// @notice Deviation from the round median above which a veto is "gross".
    uint256 public accuracySlashDeviationBps;
    /// @notice Timelocked kill switch for automatic slashing.
    bool    public slashingEnabled;

    mapping(bytes32 => FeedState) public feeds;
    bytes32[] public feedIds;

    mapping(bytes32 => mapping(uint256 => PriceSubmission[])) private _subs;
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public hasSubmitted;

    mapping(bytes32 => mapping(address => OperatorStats)) public operatorStats;
    mapping(bytes32 => address[]) private _operatorList;

    /// @notice Published history per asset and round. Written at round close
    ///         only when a price was actually published (round reached quorum
    ///         and did not trip the circuit breaker). This is what lets
    ///         `PriceFeed.getRoundData(uint80)` return real history instead of
    ///         echoing "today's" value.
    mapping(bytes32 => mapping(uint80 => RoundRecord)) public rounds;

    /// @notice Owner kill-switch per asset. A deactivated asset rejects new
    ///         submissions but keeps its published history readable, so a
    ///         deprecated pair can never write another price while consumers
    ///         can still audit what it last said. Append-only storage; an
    ///         unset entry means "active".
    mapping(bytes32 => bool) public assetDeactivated;

    // ── events ─────────────────────────────────────────────────────────
    event PriceSubmitted(bytes32 indexed assetId, address indexed operator, int256 price, uint256 roundId);
    event RoundClosed(bytes32 indexed assetId, uint80 roundId, int256 price, uint256 inThresholdSubmissions, uint256 vetoedSubmissions);
    event RoundClosedNoData(bytes32 indexed assetId, uint80 roundId, uint256 submissions, uint256 required, uint8 reason);
    event FeedPaused(bytes32 indexed assetId, int256 oldPrice, int256 newPrice, uint256 deviationBps);
    event FeedResumed(bytes32 indexed assetId);
    event FeedPausedByOwner(bytes32 indexed assetId);
    event AssetRegistered(bytes32 indexed assetId, uint8 decimals, string description);
    event EmissionPerRoundChanged(uint256 oldEmission, uint256 newEmission);
    event RoundIntervalChanged(uint256 oldInterval, uint256 newInterval);
    event MinSubmissionsChanged(uint256 oldValue, uint256 newValue);
    event DeviationThresholdChanged(uint256 oldValue, uint256 newValue);
    event BreakerThresholdChanged(uint256 oldValue, uint256 newValue);
    event StaleAfterChanged(uint256 oldValue, uint256 newValue);
    event MaxSourceAgeChanged(uint256 oldValue, uint256 newValue);
    event SlashingParamsChanged(
        uint256 livenessMissLimit,
        uint256 livenessSlashBps,
        uint256 accuracySlashBps,
        uint256 accuracySlashDeviationBps,
        bool slashingEnabled
    );
    event OperatorSlashed(bytes32 indexed assetId, address indexed operator, uint256 amount, bytes32 reason);
    event RewardsSkipped(bytes32 indexed assetId, uint256 roundId, uint256 amount);
    event AssetDeactivated(bytes32 indexed assetId);
    event AssetActivated(bytes32 indexed assetId);
    /// @notice Emitted by the permissionless keeper after a batch close attempt.
    event RoundsProcessed(uint256 requested, uint256 closed);

    /// @dev Reason codes for `RoundClosedNoData`.
    uint8 public constant NO_SUBMISSIONS = 0;
    uint8 public constant BELOW_QUORUM = 1;

    // ── constructor ────────────────────────────────────────────────────

    constructor(
        address _vault,
        address _owner,
        uint256 _roundInterval,
        uint256 _deviationBps,
        uint256 _breakerBps,
        uint256 _staleAfter,
        uint256 _emissionPerRound
    ) Ownable(_owner) {
        require(_vault != address(0), "OA: zero vault");
        vault = IStakingVault(_vault);
        roundInterval = _roundInterval;
        deviationThresholdBps = _deviationBps;
        breakerThresholdBps = _breakerBps;
        staleAfterSeconds = _staleAfter;
        emissionPerRound = _emissionPerRound;

        minSubmissions = 3;
        maxSourceAgeSeconds = _staleAfter == 0 ? 3600 : _staleAfter;
        livenessMissLimit = 3;
        livenessSlashBps = 100;                  // 1 %
        accuracySlashBps = 500;                  // 5 %
        accuracySlashDeviationBps = 900;         // 9 %
        slashingEnabled = true;
    }

    // ─────────────────── asset management ──────────────────────────────

    function registerAsset(
        bytes32 assetId,
        uint8 decimals,
        string calldata description
    ) external onlyOwner {
        require(!feeds[assetId].exists, "OA: already registered");
        feeds[assetId] = FeedState({
            decimals: decimals,
            roundId: 0,
            lastAnswer: 0,
            lastUpdate: 0,
            roundStart: 0,
            lastRoundSubmissions: 0,
            description: description,
            exists: true,
            paused: false,
            lastRoundVetoed: 0,
            totalRounds: 0
        });
        feedIds.push(assetId);
        emit AssetRegistered(assetId, decimals, description);
    }

    function getFeedCount() external view returns (uint256) {
        return feedIds.length;
    }

    /// @notice All registered asset ids, in registration order.
    function getRegisteredAssets() external view returns (bytes32[] memory) {
        return feedIds;
    }

    /// @notice Symbol / description for an asset id (e.g. "BOT/USDT").
    function feedSymbols(bytes32 assetId) external view returns (string memory) {
        return feeds[assetId].description;
    }

    /// @notice On-chain answer decimals for an asset id.
    function feedDecimals(bytes32 assetId) external view returns (uint8) {
        return feeds[assetId].decimals;
    }

    /// @notice Per-feed circuit-breaker state (a move on one pair never
    ///         halts another).
    function isFeedPaused(bytes32 assetId) external view returns (bool) {
        return feeds[assetId].paused;
    }

    /// @notice True when the asset accepts new submissions (registered, not
    ///         circuit-broken and not administratively deactivated).
    function isAssetActive(bytes32 assetId) external view returns (bool) {
        FeedState storage feed = feeds[assetId];
        return feed.exists && !feed.paused && !assetDeactivated[assetId];
    }

    /// @notice Published round record for an asset. `published == false` means
    ///         that round id produced no price (below quorum or breaker).
    function getRoundData(bytes32 assetId, uint80 roundId)
        external
        view
        returns (RoundRecord memory)
    {
        return rounds[assetId][roundId];
    }

    // ─────────────────── submissions ───────────────────────────────────

    /**
     * @param sourceTimestamp Unix seconds reported by the operator's price
     *        sources.  Rejected when it is in the future or older than
     *        `maxSourceAgeSeconds`, so a stale cached quote cannot be
     *        republished as if it were live.
     */
    function submitPrice(
        bytes32 assetId,
        int256 price,
        uint64 sourceTimestamp
    ) external nonReentrant {
        FeedState storage feed = feeds[assetId];
        require(feed.exists, "OA: unknown asset");
        require(!feed.paused, "OA: feed paused");
        require(!assetDeactivated[assetId], "OA: asset deactivated");
        require(price > 0, "OA: price must be positive");
        require(vault.isEligibleOperator(msg.sender), "OA: not eligible");
        require(uint256(sourceTimestamp) <= block.timestamp + 60, "OA: future timestamp");
        require(block.timestamp - uint256(sourceTimestamp) <= maxSourceAgeSeconds, "OA: stale source");

        // auto-set roundStart on very first submission
        if (feed.roundStart == 0) {
            feed.roundStart = block.timestamp;
        }

        // close previous round if elapsed (permissionless trigger)
        if (feed.lastUpdate > 0 && block.timestamp >= feed.roundStart + roundInterval) {
            _closeRound(assetId);
        }

        uint256 openRound = _openRoundId(feed);

        require(!hasSubmitted[assetId][openRound][msg.sender], "OA: already submitted");
        hasSubmitted[assetId][openRound][msg.sender] = true;

        // hard outlier check against last published price
        if (feed.lastUpdate > 0) {
            uint256 staleness = block.timestamp - feed.lastUpdate;
            if (staleness <= staleAfterSeconds) {
                uint256 dev = _absDevBps(
                    _absInt(feed.lastAnswer),
                    _absInt(price)
                );
                require(dev <= deviationThresholdBps, "OA: outlier rejected");
            }
        }

        _subs[assetId][openRound].push(
            PriceSubmission({operator: msg.sender, price: price, timestamp: block.timestamp})
        );

        _trackSubmission(assetId, msg.sender, openRound);

        emit PriceSubmitted(assetId, msg.sender, price, openRound);
    }

    // ─────────────────── round close ───────────────────────────────────

    function closeRound(bytes32 assetId) external nonReentrant {
        FeedState storage feed = feeds[assetId];
        require(feed.exists, "OA: unknown asset");
        require(!feed.paused, "OA: feed paused");
        require(block.timestamp >= feed.roundStart + roundInterval, "OA: round active");
        _closeRound(assetId);
    }

    /**
     * @notice Permissionless batch round-closer for keepers/relayers.
     *
     *  A round is normally closed by the next submission or an explicit
     *  `closeRound`. If a feed goes quiet (an RSS/source outage, all operators
     *  offline) nobody triggers that, and the feed stalls without advancing its
     *  round counter — which also means liveness misses are never accounted.
     *  This entrypoint lets any third party (a bot, a dashboard cron, an
     *  operator) close every due feed in one transaction.
     *
     *  Entries that are unknown, paused, deactivated, never started
     *  (`roundStart == 0`) or still inside their window are skipped rather than
     *  reverting, so a keeper can safely fire the whole registry atomically.
     */
    function closeRounds(bytes32[] calldata assetIds) external nonReentrant {
        uint256 closed;
        for (uint256 i; i < assetIds.length; ++i) {
            bytes32 assetId = assetIds[i];
            FeedState storage feed = feeds[assetId];
            if (!feed.exists || feed.paused) continue;
            if (feed.roundStart == 0) continue;
            if (block.timestamp < feed.roundStart + roundInterval) continue;
            _closeRound(assetId);
            unchecked { ++closed; }
        }
        emit RoundsProcessed(assetIds.length, closed);
    }

    function _closeRound(bytes32 assetId) internal {
        FeedState storage feed = feeds[assetId];
        uint256 closingRound = _openRoundId(feed);
        PriceSubmission[] storage subs = _subs[assetId][closingRound];
        uint256 subCount = subs.length;

        // start new round regardless
        uint80 newRoundId = uint80(closingRound);
        feed.roundId = newRoundId;
        feed.roundStart = block.timestamp;
        feed.totalRounds += 1;
        feed.lastRoundSubmissions = subCount;
        feed.lastRoundVetoed = 0;

        if (subCount < minSubmissions) {
            emit RoundClosedNoData(
                assetId,
                newRoundId,
                subCount,
                minSubmissions,
                subCount == 0 ? NO_SUBMISSIONS : BELOW_QUORUM
            );
            // A missed round is a missed round regardless of quorum: nobody
            // submitted, so the liveness accounting still runs.  Accuracy
            // judgements are impossible with this little evidence, so they are
            // skipped — and so is the liveness *punishment*, because a feed
            // that cannot reach quorum is usually a network-wide problem
            // (RPC outage, chain halt, coordinated client bug) and slashing
            // every honest operator at once is not a proportionate response.
            _settleLiveness(assetId, closingRound, false);
            delete _subs[assetId][closingRound];
            return;
        }

        // 1. raw median over everything submitted this round
        int256[] memory prices = new int256[](subCount);
        for (uint256 i; i < subCount; ++i) prices[i] = subs[i].price;
        _sort(prices);
        int256 rawMedian = _median(prices);

        // 2. drop outliers relative to the round's own centre
        uint256 inThreshold = 0;
        for (uint256 i; i < subCount; ++i) {
            if (_devFrom(rawMedian, subs[i].price) <= deviationThresholdBps) inThreshold++;
        }

        int256[] memory filtered = new int256[](inThreshold);
        address[] memory eligibleOps = new address[](inThreshold);
        uint256[] memory eligibleAmts = new uint256[](inThreshold);
        uint256 vetoed = subCount - inThreshold;
        {
            uint256 fi;
            for (uint256 i; i < subCount; ++i) {
                if (_devFrom(rawMedian, subs[i].price) <= deviationThresholdBps) {
                    filtered[fi] = subs[i].price;
                    eligibleOps[fi] = subs[i].operator;
                    fi++;
                }
            }
            _sort(filtered);
        }

        int256 finalMedian = _median(filtered);
        feed.lastRoundVetoed = vetoed;

        // 3. circuit breaker — before any punishment, because a market-wide
        //    move is not an individual operator's fault.
        if (feed.lastUpdate > 0 && feed.lastAnswer != 0) {
            uint256 deviation = _absDevBps(_absInt(feed.lastAnswer), _absInt(finalMedian));
            if (deviation > breakerThresholdBps) {
                feed.paused = true;
                // the round is spent either way: drop its submissions so they
                // cannot be read back via getSubmission() after the pause
                delete _subs[assetId][closingRound];
                emit FeedPaused(assetId, feed.lastAnswer, finalMedian, deviation);
                return;
            }
        }

        // 4. publish
        feed.lastAnswer = finalMedian;
        feed.lastUpdate = block.timestamp;
        feed.lastRoundSubmissions = inThreshold;
        rounds[assetId][newRoundId] = RoundRecord({
            answer: finalMedian,
            updatedAt: block.timestamp,
            inThreshold: inThreshold,
            vetoed: vetoed,
            published: true
        });

        // 5. punish provable violations
        _settleLiveness(assetId, closingRound, true);
        if (slashingEnabled) {
            _settleAccuracy(assetId, subs, subCount, finalMedian);
        }

        // 6. rewards — isolated so an under-funded pool never blocks pricing
        if (emissionPerRound > 0 && inThreshold > 0) {
            uint256 perOp = emissionPerRound / inThreshold;
            for (uint256 i; i < inThreshold; ++i) eligibleAmts[i] = perOp;
            uint256 payout = perOp * inThreshold;
            try vault.distributeRewards(eligibleOps, eligibleAmts) {
                // paid
            } catch {
                emit RewardsSkipped(assetId, newRoundId, payout);
            }
        }

        emit RoundClosed(assetId, newRoundId, finalMedian, inThreshold, vetoed);

        // cleanup
        delete _subs[assetId][closingRound];
    }

    // ─────────────────── violation settlement ──────────────────────────

    function _trackSubmission(bytes32 assetId, address operator, uint256 roundId) internal {
        OperatorStats storage st = operatorStats[assetId][operator];
        if (!st.tracked) {
            st.tracked = true;
            _operatorList[assetId].push(operator);
        }
        st.submissions += 1;
        st.lastSubmissionRound = roundId;
    }

    /**
     * @notice Count missed rounds for every tracked operator and slash the
     *         ones that crossed `livenessMissLimit`.
     *
     *         @param maySlash false when the round failed quorum: misses are
     *         still recorded (so uptime stays honest) but nobody is punished.
     */
    function _settleLiveness(bytes32 assetId, uint256 roundId, bool maySlash) internal {
        address[] storage list = _operatorList[assetId];
        uint256 len = list.length;
        for (uint256 i; i < len; ++i) {
            address op = list[i];
            OperatorStats storage st = operatorStats[assetId][op];
            st.roundsSeen += 1;

            if (hasSubmitted[assetId][roundId][op]) {
                st.consecutiveMisses = 0;
                continue;
            }

            st.consecutiveMisses += 1;
            if (
                maySlash &&
                slashingEnabled &&
                st.consecutiveMisses >= livenessMissLimit &&
                livenessSlashBps > 0
            ) {
                uint256 amount = _slashAmount(op, livenessSlashBps);
                st.consecutiveMisses = 0;
                if (amount > 0) {
                    _slash(assetId, op, amount, SlashReason.LIVENESS);
                }
            }
        }
    }

    /**
     * @notice Slash submissions vetoed as outliers whose deviation from the
     *         round median exceeds `accuracySlashDeviationBps`.  Ordinary
     *         thin-pool spread (a few %) is never punished — only a value far
     *         outside anything an honest source could report.
     */
    function _settleAccuracy(
        bytes32 assetId,
        PriceSubmission[] storage subs,
        uint256 subCount,
        int256 finalMedian
    ) internal {
        if (accuracySlashBps == 0) return;
        for (uint256 i; i < subCount; ++i) {
            uint256 dev = _devFrom(finalMedian, subs[i].price);
            if (dev <= deviationThresholdBps) continue;

            OperatorStats storage st = operatorStats[assetId][subs[i].operator];
            st.accuracyVetoes += 1;

            if (dev <= accuracySlashDeviationBps) continue;
            uint256 amount = _slashAmount(subs[i].operator, accuracySlashBps);
            if (amount > 0) {
                _slash(assetId, subs[i].operator, amount, SlashReason.ACCURACY);
            }
        }
    }

    function _slashAmount(address operator, uint256 bps) internal view returns (uint256) {
        uint256 eff = vault.effectiveStake(operator);
        if (eff == 0) return 0;
        uint256 amount = (eff * bps) / 10_000;
        return amount;
    }

    function _slash(bytes32 assetId, address operator, uint256 amount, bytes32 reason) internal {
        vault.slash(operator, amount, reason);
        OperatorStats storage st = operatorStats[assetId][operator];
        st.slashCount += 1;
        st.slashedAmount += amount;
        emit OperatorSlashed(assetId, operator, amount, reason);
    }

    // ─────────────────── views ─────────────────────────────────────────

    struct LatestPrice {
        int256  price;
        uint256 updatedAt;
        uint80  roundId;
        uint8   decimals;
        bool    isPaused;
    }

    function getLatestPrice(bytes32 assetId) external view returns (LatestPrice memory) {
        FeedState storage feed = feeds[assetId];
        return LatestPrice({
            price: feed.lastAnswer,
            updatedAt: feed.lastUpdate,
            roundId: feed.roundId,
            decimals: feed.decimals,
            isPaused: feed.paused
        });
    }

    struct FeedHealth {
        bool    isPaused;
        bool    isStale;
        bool    hasPrice;
        uint256 lastUpdate;
        uint256 lastRoundSubmissions;
        uint256 lastRoundVetoed;
        uint256 roundStart;
        uint256 nextRoundAt;
        uint256 currentRound;
        uint256 openRoundSubmissions;
    }

    function getFeedHealth(bytes32 assetId) external view returns (FeedHealth memory) {
        FeedState storage feed = feeds[assetId];
        bool stale = feed.lastUpdate > 0 && block.timestamp - feed.lastUpdate > staleAfterSeconds;
        uint256 openRound = _openRoundId(feed);
        return FeedHealth({
            isPaused: feed.paused,
            isStale: stale,
            hasPrice: feed.lastUpdate > 0,
            lastUpdate: feed.lastUpdate,
            lastRoundSubmissions: feed.lastRoundSubmissions,
            lastRoundVetoed: feed.lastRoundVetoed,
            roundStart: feed.roundStart,
            nextRoundAt: feed.roundStart == 0 ? 0 : feed.roundStart + roundInterval,
            currentRound: feed.roundId,
            openRoundSubmissions: _subs[assetId][openRound].length
        });
    }

    function getSubmissionCount(bytes32 assetId) external view returns (uint256) {
        FeedState storage feed = feeds[assetId];
        return _subs[assetId][_openRoundId(feed)].length;
    }

    function getSubmission(
        bytes32 assetId,
        uint256 roundId,
        uint256 index
    ) external view returns (address operator, int256 price, uint256 timestamp) {
        PriceSubmission storage s = _subs[assetId][roundId][index];
        return (s.operator, s.price, s.timestamp);
    }

    /// @notice Full submission list of a (still open) round — used by the
    ///         dashboard to show who is in the current round.
    function getRoundSubmissions(bytes32 assetId, uint256 roundId, uint256 max)
        external
        view
        returns (address[] memory operators, int256[] memory prices, uint256[] memory timestamps)
    {
        PriceSubmission[] storage subs = _subs[assetId][roundId];
        uint256 n = subs.length;
        if (max > 0 && n > max) n = max;
        operators = new address[](n);
        prices = new int256[](n);
        timestamps = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            operators[i] = subs[i].operator;
            prices[i] = subs[i].price;
            timestamps[i] = subs[i].timestamp;
        }
    }

    function getOperatorCount(bytes32 assetId) external view returns (uint256) {
        return _operatorList[assetId].length;
    }

    function getOperators(bytes32 assetId, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        address[] storage list = _operatorList[assetId];
        uint256 total = list.length;
        if (offset >= total) return new address[](0);
        uint256 n = total - offset;
        if (limit > 0 && n > limit) n = limit;
        address[] memory out = new address[](n);
        for (uint256 i; i < n; ++i) out[i] = list[offset + i];
        return out;
    }

    /// @notice Share of closed rounds this operator actually submitted, in bps.
    function getOperatorUptimeBps(bytes32 assetId, address operator) external view returns (uint256) {
        OperatorStats storage st = operatorStats[assetId][operator];
        if (st.roundsSeen == 0) return 0;
        return (st.submissions * 10_000) / st.roundsSeen;
    }

    /// @notice Human label for a slash reason hash.
    function slashReasonLabel(bytes32 reason) external pure returns (string memory) {
        return reason.label();
    }

    // ─────────────────── owner actions ─────────────────────────────────

    /// @notice Resume a single paused feed (timelock only).
    function resumeFeed(bytes32 assetId) external onlyOwner {
        FeedState storage feed = feeds[assetId];
        require(feed.paused, "OA: not paused");
        feed.paused = false;
        emit FeedResumed(assetId);
    }

    /// @notice Emergency manual pause of a single feed (timelock only).
    function pauseFeed(bytes32 assetId) external onlyOwner {
        FeedState storage feed = feeds[assetId];
        require(feed.exists, "OA: unknown asset");
        require(!feed.paused, "OA: already paused");
        feed.paused = true;
        emit FeedPausedByOwner(assetId);
    }

    /**
     * @notice Permanently (until re-activated) stop new submissions for an
     *         asset without deleting its history. Prefer this over `pauseFeed`
     *         for a pair that is being retired: the feed is not "paused
     *         pending review", it is decommissioned.
     */
    function deactivateAsset(bytes32 assetId) external onlyOwner {
        require(feeds[assetId].exists, "OA: unknown asset");
        require(!assetDeactivated[assetId], "OA: already deactivated");
        assetDeactivated[assetId] = true;
        emit AssetDeactivated(assetId);
    }

    /// @notice Re-enable submissions for a previously deactivated asset.
    function activateAsset(bytes32 assetId) external onlyOwner {
        require(feeds[assetId].exists, "OA: unknown asset");
        require(assetDeactivated[assetId], "OA: already active");
        assetDeactivated[assetId] = false;
        emit AssetActivated(assetId);
    }

    function setRoundInterval(uint256 newInterval) external onlyOwner {
        require(newInterval >= 10, "OA: interval too short");
        emit RoundIntervalChanged(roundInterval, newInterval);
        roundInterval = newInterval;
    }

    function setDeviationThresholdBps(uint256 newBps) external onlyOwner {
        require(newBps <= 5000, "OA: threshold too high");
        emit DeviationThresholdChanged(deviationThresholdBps, newBps);
        deviationThresholdBps = newBps;
    }

    function setBreakerThresholdBps(uint256 newBps) external onlyOwner {
        require(newBps <= 5000, "OA: breaker too high");
        emit BreakerThresholdChanged(breakerThresholdBps, newBps);
        breakerThresholdBps = newBps;
    }

    function setStaleAfterSeconds(uint256 newStale) external onlyOwner {
        emit StaleAfterChanged(staleAfterSeconds, newStale);
        staleAfterSeconds = newStale;
    }

    function setEmissionPerRound(uint256 newEmission) external onlyOwner {
        emit EmissionPerRoundChanged(emissionPerRound, newEmission);
        emissionPerRound = newEmission;
    }

    function setMinSubmissions(uint256 newMin) external onlyOwner {
        require(newMin >= 1, "OA: quorum at least 1");
        emit MinSubmissionsChanged(minSubmissions, newMin);
        minSubmissions = newMin;
    }

    function setMaxSourceAgeSeconds(uint256 newAge) external onlyOwner {
        require(newAge >= 30, "OA: too strict");
        emit MaxSourceAgeChanged(maxSourceAgeSeconds, newAge);
        maxSourceAgeSeconds = newAge;
    }

    function setSlashingParams(
        uint256 missLimit,
        uint256 livenessBps,
        uint256 accuracyBps,
        uint256 accuracyDeviationBps,
        bool enabled
    ) external onlyOwner {
        require(missLimit >= 2, "OA: miss limit too low");
        require(livenessBps <= 2000, "OA: liveness slash too high");
        require(accuracyBps <= 2000, "OA: accuracy slash too high");
        require(accuracyDeviationBps > deviationThresholdBps, "OA: accuracy band below outlier band");
        livenessMissLimit = missLimit;
        livenessSlashBps = livenessBps;
        accuracySlashBps = accuracyBps;
        accuracySlashDeviationBps = accuracyDeviationBps;
        slashingEnabled = enabled;
        emit SlashingParamsChanged(missLimit, livenessBps, accuracyBps, accuracyDeviationBps, enabled);
    }

    // ─────────────────── internal ──────────────────────────────────────

    function _openRoundId(FeedState storage feed) internal view returns (uint256) {
        return uint256(feed.roundId) + 1;
    }

    function _absInt(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function _devFrom(int256 ref, int256 value) internal pure returns (uint256) {
        return _absDevBps(_absInt(ref), _absInt(value));
    }

    function _absDevBps(uint256 a, uint256 b) internal pure returns (uint256) {
        // deviation of `b` relative to reference `a`, in basis points
        if (a == 0) return 0;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * 10_000) / a;
    }

    function _median(int256[] memory arr) internal pure returns (int256) {
        uint256 n = arr.length;
        if (n == 0) return 0;
        if (n % 2 == 1) return arr[n / 2];
        return (arr[n / 2 - 1] + arr[n / 2]) / 2;
    }

    function _sort(int256[] memory arr) internal pure {
        uint256 n = arr.length;
        for (uint256 i = 1; i < n; ++i) {
            int256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                --j;
            }
            arr[j] = key;
        }
    }
}
