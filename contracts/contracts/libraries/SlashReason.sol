// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SlashReason
 * @notice Canonical `bytes32` reasons emitted by OracleAggregator when it
 *         slashes an operator.  Keeping them in one library means the
 *         aggregator, the tests and the dashboard all agree on the exact hash
 *         a given violation produces (`keccak256` of the label).
 *
 * Decoding: the dashboard compares against these hashes and renders the label
 * below, so a raw 32-byte blob is never shown to a user.
 */
library SlashReason {
    /// @dev Operator missed `livenessMissLimit` consecutive rounds on a feed.
    bytes32 internal constant LIVENESS = keccak256("LODESTAR_LIVENESS");

    /// @dev Operator's submission deviated far beyond the outlier band from
    ///      the round median and was vetoed.
    bytes32 internal constant ACCURACY = keccak256("LODESTAR_ACCURACY");

    function label(bytes32 reason) internal pure returns (string memory) {
        if (reason == LIVENESS) return "liveness: missed consecutive rounds";
        if (reason == ACCURACY) return "accuracy: submission vetoed as gross outlier";
        return "unspecified";
    }
}
