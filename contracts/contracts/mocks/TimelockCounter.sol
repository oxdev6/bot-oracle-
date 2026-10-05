// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TimelockCounter
 * @notice Throwaway target used by the timelock tests: a payable counter that
 *         can also revert on demand, so `execute` success and failure paths
 *         are both exercised against a real contract.
 */
contract TimelockCounter {
    uint256 public value;
    uint256 public received;

    function increment() external payable returns (uint256) {
        value += 1;
        received += msg.value;
        return value;
    }

    function explode() external pure {
        revert("boom");
    }

    function noop() external pure {}
}
