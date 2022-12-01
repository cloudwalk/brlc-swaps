// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock2 is ERC20 {
    constructor() ERC20("ERC20Mock2", "MOCK") {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}