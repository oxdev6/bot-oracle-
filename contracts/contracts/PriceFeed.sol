// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {OracleAggregator} from "./OracleAggregator.sol";

/**
 * @title PriceFeed
 * @notice Chainlink-compatible read wrapper around OracleAggregator.
 *
 *  Any contract that reads Chainlink's AggregatorV3Interface can point at
 *  this wrapper with zero code changes:
 *
 *      AggregatorV3Interface feed = AggregatorV3Interface(priceFeedAddress);
 *      (, int256 answer,,,) = feed.latestRoundData();
 *
 *  Extras beyond the Chainlink surface (safe to ignore, they make the wrapper
 *  usable as a self-describing feed):
 *    - `getAssetId()` — the aggregator key this feed is bound to.
 *    - `isStale()` / `isPaused()` / `staleness()` — the three conditions a
 *      consumer must check before trusting `answer`. Chainlink consumers are
 *      not required to call them, which is exactly why the aggregator pauses
 *      instead of publishing a value it cannot stand behind.
 *
 *  Limitations (documented):
 *    - getRoundData() returns latestRoundData — no on-chain history.
 *    - startedAt equals updatedAt (aggregator tracks only last update).
 *    - Round ids restart from the aggregator's own numbering; they are not
 *      Chainlink's global round ids.
 */
contract PriceFeed is AggregatorV3Interface {
    OracleAggregator public immutable aggregator;
    bytes32 public immutable assetId;
    uint8 public immutable decimals_;
    string public description_;

    constructor(
        address _aggregator,
        bytes32 _assetId,
        uint8 _decimals,
        string memory _description
    ) {
        require(_aggregator != address(0), "PF: zero aggregator");
        aggregator = OracleAggregator(payable(_aggregator));
        assetId = _assetId;
        decimals_ = _decimals;
        description_ = _description;
    }

    function decimals() external view override returns (uint8) {
        return decimals_;
    }

    function description() external view override returns (string memory) {
        return description_;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return _readLatest();
    }

    function getRoundData(
        uint80 /* _roundId */
    )
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return _readLatest();
    }

    // ─────────────────── Lodestar extras ───────────────────────────────

    function getAssetId() external view returns (bytes32) {
        return assetId;
    }

    /// @notice True when the underlying feed is circuit-broken.
    function isPaused() external view returns (bool) {
        return aggregator.isFeedPaused(assetId);
    }

    /// @notice True when the last published answer is older than the
    ///         aggregator's staleness cutoff.
    function isStale() external view returns (bool) {
        return aggregator.getFeedHealth(assetId).isStale;
    }

    /// @notice Seconds since the last published answer (0 if never updated).
    function staleness() external view returns (uint256) {
        OracleAggregator.LatestPrice memory p = aggregator.getLatestPrice(assetId);
        if (p.updatedAt == 0) return 0;
        return block.timestamp - p.updatedAt;
    }

    function _readLatest()
        internal
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        OracleAggregator.LatestPrice memory p = aggregator.getLatestPrice(assetId);
        return (
            uint80(p.roundId),
            p.price,
            p.updatedAt,
            p.updatedAt,
            uint80(p.roundId)
        );
    }
}
