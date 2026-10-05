// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title LodestarToken
 * @notice Fixed-supply ERC-20 (LODE) for the Lodestar Oracle system.
 *
 *        Entire supply is minted once at deployment to a treasury multisig.
 *        There are no mint functions, no roles, no upgrade paths — the
 *        supply is immutable after construction. This is intentional: a
 *        fixed, auditable supply that cannot be inflated by any key or
 *        governance mechanism.
 */
contract LodestarToken is ERC20 {
    uint256 public immutable MAX_SUPPLY;
    address public immutable treasury;

    event Deployed(address indexed treasury, uint256 supply);

    constructor(
        address _treasury,
        uint256 _maxSupply
    ) ERC20("Lodestar", "LODE") {
        require(_treasury != address(0), "LODE: zero treasury");
        require(_maxSupply > 0, "LODE: zero supply");

        treasury = _treasury;
        MAX_SUPPLY = _maxSupply;

        _mint(_treasury, _maxSupply);
        emit Deployed(_treasury, _maxSupply);
    }

    /**
     * @notice Explicitly disable receiving native token — LODE is an ERC-20
     *         only, never use it to receive ETH/BOT.
     */
    receive() external payable {
        revert("LODE: no native");
    }
}