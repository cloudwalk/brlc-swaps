// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ISwapPoolTypes } from "./ISwapPool.sol";

/**
 * @title  SwapPoll storage version 1
 * @author CloudWalk Inc.
 */
abstract contract SwapPoolStorageV1 is ISwapPoolTypes {
    /// @dev The id of each created signature.
    uint256 id;

    /// @dev The array of created swaps.
    Swap[] internal _swaps;

    /// @dev The mapping of supported to buy tokens.
    mapping(address => bool) internal _supportedIn;

    /// @dev The mapping of supported to sell tokens.
    mapping(address => bool) internal _supportedOut;
}

/**
 * @title SwapPool storage
 *
 * We are following Compound's approach of upgrading new contract implementations.
 * See https://github.com/compound-finance/compound-protocol.
 * When we need to add new storage variables, we create a new version of SwapPool
 * e.g. SwapPool<versionNumber>, so finally it would look like
 * "contract SwapPoolStorage is SwapPoolStorageV1, SwapPoolStorageV2".
 */
abstract contract SwapPoolStorage is SwapPoolStorageV1 {

}
