// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {IExchangePool} from "./IExchangePool.sol";

abstract contract ExchangePoolStorage is IExchangePool {
    mapping (bytes => bool) _usedSignatures;

    Exchange[] _exchanges;

    mapping (address => bool) _supportedIn;

    mapping (address => bool) _supportedOut;

    address _feeToken;
} 