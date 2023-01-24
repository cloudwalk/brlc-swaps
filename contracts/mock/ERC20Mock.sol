// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ERC20Mock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the OpenZeppelin's {ERC20} contract for test purposes.
 */
contract ERC20Mock is ERC20 {
    /// @dev Just calls the base contract constructor
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
