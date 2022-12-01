// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {IExchangePool} from "./IExchangePool.sol";

abstract contract ExchangePoolStorage is IExchangePool {
    mapping (bytes => bool) internal _usedSignatures;

    Exchange[] internal _exchanges;

    mapping (address => bool) internal _supportedIn;

    mapping (address => bool) internal _supportedOut;

    address internal _feeToken;

    bytes32 constant public MANAGER_ROLE = keccak256("MANAGER_ROLE");

    bytes32 constant public OWNER_ROLE = keccak256("OWNER_ROLE");
} 