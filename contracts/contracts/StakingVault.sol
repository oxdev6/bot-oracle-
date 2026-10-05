// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StakingVault
 * @notice Stake/unstake LODE, slashing, and per-round reward distribution.
 *
 *  Roles:
 *    - owner (timelock): parameter setters, setAggregator, setSlashingTreasury,
 *      rescue any non-LODE token accidentally sent here
 *    - aggregator: slash() and distributeRewards()
 *    - operators: stake / requestWithdrawal / claimWithdrawal
 *
 *  Design invariants:
 *    1. slash() can never be dodged by an operator draining stake via
 *       pending withdrawals — pending amounts are canceled first.
 *    2. A slash can never exceed the operator's bonded stake; asking for more
 *       slashes everything available instead of reverting, so a mis-sized
 *       punishment cannot brick round settlement.
 *    3. Pending withdrawals always claim LODE from the vault's own ERC-20
 *       balance — no new minting is involved.
 *    4. isEligibleOperator() is a pure read of effective stake against
 *       minStake — the aggregator gates every submission on this, so an
 *       operator mid-withdrawal stops earning and stops being counted.
 */
contract StakingVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── constants ──────────────────────────────────────────────────────
    uint256 public constant WITHDRAWAL_DELAY = 7 days;

    // ── state ──────────────────────────────────────────────────────────
    IERC20 public immutable LODE;
    address public slashingTreasury;
    address public aggregator;
    uint256 public minStake;

    struct WithdrawalRequest {
        uint256 amount;
        uint256 availableAt;
    }

    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public totalPendingWithdrawals;
    mapping(address => WithdrawalRequest[]) public withdrawalRequests;

    /// @dev Maintained list of every address that has ever staked, for simple
    ///      enumeration views (e.g. totalStake). Never shrinks on withdraw.
    address[] public stakers;
    mapping(address => bool) private _isStaker;

    // ── events ─────────────────────────────────────────────────────────
    event Staked(address indexed operator, uint256 amount);
    event WithdrawalRequested(address indexed operator, uint256 amount, uint256 unlockAt);
    event WithdrawalClaimed(address indexed operator, uint256 amount);
    event Slash(address indexed operator, uint256 amount, uint256 pendingCanceled, bytes32 reason);
    event RewardDistributed(address indexed operator, uint256 amount);
    event RewardsDistributed(uint256 operators, uint256 total);
    event MinStakeChanged(uint256 oldMin, uint256 newMin);
    event AggregatorChanged(address oldAgg, address newAgg);
    event SlashingTreasuryChanged(address oldTreasury, address newTreasury);
    event RewardsFunded(address indexed from, uint256 amount);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);

    modifier onlyAggregator() {
        require(msg.sender == aggregator, "SV: not aggregator");
        _;
    }

    constructor(
        address _owner,
        address _lode,
        address _slashingTreasury,
        uint256 _minStake
    ) Ownable(_owner) {
        require(_lode != address(0), "SV: zero LODE");
        require(_slashingTreasury != address(0), "SV: zero treasury");
        LODE = IERC20(_lode);
        slashingTreasury = _slashingTreasury;
        minStake = _minStake;
    }

    // ─────────────────── operator actions ──────────────────────────────

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "SV: zero amount");
        LODE.safeTransferFrom(msg.sender, address(this), amount);
        if (!_isStaker[msg.sender]) {
            _isStaker[msg.sender] = true;
            stakers.push(msg.sender);
        }
        stakeOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    function requestWithdrawal(uint256 amount) external nonReentrant {
        require(amount > 0, "SV: zero amount");
        uint256 eff = effectiveStake(msg.sender);
        require(amount <= eff, "SV: exceeds effective stake");

        totalPendingWithdrawals[msg.sender] += amount;
        withdrawalRequests[msg.sender].push(
            WithdrawalRequest({amount: amount, availableAt: block.timestamp + WITHDRAWAL_DELAY})
        );

        emit WithdrawalRequested(msg.sender, amount, block.timestamp + WITHDRAWAL_DELAY);
    }

    function claimWithdrawal(uint256 requestIndex) external nonReentrant {
        WithdrawalRequest[] storage reqs = withdrawalRequests[msg.sender];
        require(requestIndex < reqs.length, "SV: invalid index");

        WithdrawalRequest storage r = reqs[requestIndex];
        require(r.amount > 0, "SV: already claimed");
        require(block.timestamp >= r.availableAt, "SV: delay active");

        uint256 claimable = r.amount;
        // Cap claimable against remaining live stake in case of slash
        uint256 live = stakeOf[msg.sender];
        if (claimable > live) claimable = live;

        r.amount = 0;
        totalPendingWithdrawals[msg.sender] -= claimable;
        stakeOf[msg.sender] -= claimable;

        LODE.safeTransfer(msg.sender, claimable);
        emit WithdrawalClaimed(msg.sender, claimable);
    }

    // ─────────────────── aggregator actions ────────────────────────────

    /**
     * @notice Slash an operator.  Canceled pending withdrawals first
     *         (operator cannot escape slashing by requesting withdrawal),
     *         then deducts from live stake.  The total slashed amount is
     *         transferred to `slashingTreasury`.
     *
     *         `amount` is treated as a target: if the operator has less than
     *         that bonded (in live stake plus queued withdrawals), everything
     *         available is taken rather than reverting.
     */
    function slash(
        address operator,
        uint256 amount,
        bytes32 reason
    ) external onlyAggregator nonReentrant {
        require(stakeOf[operator] > 0, "SV: no stake");
        uint256 available = stakeOf[operator];
        if (amount > available) amount = available;

        uint256 remaining = amount;
        uint256 pendingCanceled = 0;

        // cancel pending withdrawal requests newest-first
        WithdrawalRequest[] storage reqs = withdrawalRequests[operator];
        int256 i = int256(reqs.length) - 1;
        while (i >= 0 && remaining > 0) {
            uint256 idx = uint256(i);
            WithdrawalRequest storage r = reqs[idx];
            if (r.amount > 0) {
                if (r.amount <= remaining) {
                    remaining -= r.amount;
                    pendingCanceled += r.amount;
                    r.amount = 0;
                } else {
                    pendingCanceled += remaining;
                    r.amount -= remaining;
                    remaining = 0;
                }
            }
            unchecked { --i; }
        }

        uint256 fromLive = remaining;
        uint256 totalSlashed = fromLive + pendingCanceled;
        if (totalSlashed > 0) {
            stakeOf[operator] -= totalSlashed;
            totalPendingWithdrawals[operator] -= pendingCanceled;
            LODE.safeTransfer(slashingTreasury, totalSlashed);
        }

        emit Slash(operator, totalSlashed, pendingCanceled, reason);
    }

    function distributeRewards(
        address[] calldata operators,
        uint256[] calldata amounts
    ) external onlyAggregator nonReentrant {
        require(operators.length == amounts.length, "SV: length mismatch");
        uint256 totalRewards;
        for (uint256 i; i < operators.length; ++i) {
            totalRewards += amounts[i];
        }
        require(IERC20(address(LODE)).balanceOf(address(this)) >= totalRewards, "SV: insufficient funds");

        for (uint256 i; i < operators.length; ++i) {
            if (amounts[i] == 0) continue;
            LODE.safeTransfer(operators[i], amounts[i]);
            emit RewardDistributed(operators[i], amounts[i]);
        }
        emit RewardsDistributed(operators.length, totalRewards);
    }

    // ─────────────────── views ─────────────────────────────────────────

    function effectiveStake(address operator) public view returns (uint256) {
        uint256 s = stakeOf[operator];
        uint256 p = totalPendingWithdrawals[operator];
        return s > p ? s - p : 0;
    }

    function isEligibleOperator(address operator) external view returns (bool) {
        return effectiveStake(operator) >= minStake;
    }

    /// @notice Count of addresses ever staked (for listing UIs).
    function getStakerCount() external view returns (uint256) {
        return stakers.length;
    }

    /// @notice Paged view over the staker registry so a UI never has to
    ///         issue one call per operator.
    function getStakers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addresses, uint256[] memory stakes, uint256[] memory pendings)
    {
        uint256 total = stakers.length;
        if (offset >= total) return (new address[](0), new uint256[](0), new uint256[](0));
        uint256 n = total - offset;
        if (limit > 0 && n > limit) n = limit;

        addresses = new address[](n);
        stakes = new uint256[](n);
        pendings = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            address a = stakers[offset + i];
            addresses[i] = a;
            stakes[i] = stakeOf[a];
            pendings[i] = totalPendingWithdrawals[a];
        }
    }

    /// @notice Number of queued withdrawal requests for an operator.
    function getWithdrawalRequestCount(address operator) external view returns (uint256) {
        return withdrawalRequests[operator].length;
    }

    /// @notice Sum of all operators' live (non-withdrawing) stake.
    function totalStake() external view returns (uint256) {
        uint256 sum;
        // mapping isn't enumerable; iterate a maintained registry
        for (uint256 i; i < stakers.length; ++i) {
            sum += effectiveStake(stakers[i]);
        }
        return sum;
    }

    /// @notice LODE held by the vault that is not backing operator stakes
    ///         (i.e. the reward pool + slash proceeds in transit).
    function rewardPoolBalance() external view returns (uint256) {
        uint256 bonded;
        for (uint256 i; i < stakers.length; ++i) {
            bonded += stakeOf[stakers[i]];
        }
        uint256 bal = LODE.balanceOf(address(this));
        return bal > bonded ? bal - bonded : 0;
    }

    // ─────────────────── owner actions ─────────────────────────────────

    function setAggregator(address newAgg) external onlyOwner {
        require(newAgg != address(0), "SV: zero aggregator");
        emit AggregatorChanged(aggregator, newAgg);
        aggregator = newAgg;
    }

    function setMinStake(uint256 newMin) external onlyOwner {
        emit MinStakeChanged(minStake, newMin);
        minStake = newMin;
    }

    /// @notice Move the destination of slash proceeds (timelock only).
    function setSlashingTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "SV: zero treasury");
        emit SlashingTreasuryChanged(slashingTreasury, newTreasury);
        slashingTreasury = newTreasury;
    }

    function fundRewards(uint256 amount) external nonReentrant {
        require(amount > 0, "SV: zero amount");
        LODE.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsFunded(msg.sender, amount);
    }

    /**
     * @notice Rescue any ERC-20 accidentally sent here. LODE is intentionally
     *         NOT recoverable — it is either bonded stake or reward money and
     *         must leave only through the documented paths.
     */
    function recoverToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(LODE), "SV: cannot recover LODE");
        require(to != address(0), "SV: zero recipient");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRecovered(token, to, amount);
    }
}
