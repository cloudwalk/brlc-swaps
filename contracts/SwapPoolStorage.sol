// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ISwapPool} from "./ISwapPool.sol";

abstract contract SwapPoolStorage is ISwapPool {
    uint256 id;

    Swap[] internal _swaps;

    mapping (address => bool) internal _supportedIn;

    mapping (address => bool) internal _supportedOut;
} 
