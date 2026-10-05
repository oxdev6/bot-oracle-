// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {PriceFeed} from "../PriceFeed.sol";

/**
 * @title ExampleConsumer
 * @notice Minimal consumer contract demonstrating how to read Lodestar
 *         Oracle feeds using Chainlink's AggregatorV3Interface.
 *
 *  Any DEX, lending protocol, or other BOT Chain app can deploy this
 *  pattern: point at the PriceFeed address and call latestRoundData().
 *
 *  Two patterns are shown:
 *    - `getPrice()`  — the zero-change Chainlink read. Works with any
 *      AggregatorV3Interface, including real Chainlink feeds.
 *    - `getPriceOrRevert()` — the pattern we recommend: it additionally
 *      refuses to return a price when the feed is circuit-broken or stale,
 *      so a consumer can never transact against a number the oracle network
 *      itself is not standing behind.
 */
contract ExampleConsumer {
    AggregatorV3Interface public immutable priceFeed;

    constructor(address _priceFeed) {
        require(_priceFeed != address(0), "EC: zero feed");
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function getPrice()
        external
        view
        returns (int256 price, uint8 decimals, uint80 roundId, uint256 updatedAt)
    {
        (
            uint80 _roundId,
            int256 _answer,
            ,   // startedAt unused
            uint256 _updatedAt,
            // answeredInRound unused
        ) = priceFeed.latestRoundData();

        return (_answer, priceFeed.decimals(), _roundId, _updatedAt);
    }

    /**
     * @notice Same read, but fails loudly instead of returning a stale or
     *         paused price. Uses the Lodestar-specific extras on PriceFeed;
     *         a pure Chainlink feed would use `updatedAt` + its own timeout.
     */
    function getPriceOrRevert()
        public
        view
        returns (int256 price, uint8 decimals)
    {
        PriceFeed feed = PriceFeed(address(priceFeed));
        require(!feed.isPaused(), "EC: feed paused");
        require(!feed.isStale(), "EC: feed stale");

        (, int256 answer,,,) = priceFeed.latestRoundData();
        require(answer > 0, "EC: no answer");
        return (answer, priceFeed.decimals());
    }

    /// @notice Price scaled to 18 decimals, for direct use in token math.
    function getPrice18() external view returns (uint256) {
        (int256 answer, uint8 dec) = getPriceOrRevert();
        require(answer > 0, "EC: no answer");
        if (dec == 18) return uint256(answer);
        if (dec < 18) return uint256(answer) * (10 ** (18 - dec));
        return uint256(answer) / (10 ** (dec - 18));
    }
}
