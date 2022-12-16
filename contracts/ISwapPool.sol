// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

/**
 * @title SwapPool types interface
 * @author CloudWalk Inc.
 */
interface ISwapPoolTypes {
    /// @dev enum for describing current status of a swap
    enum SwapStatus {
        Pending,
        Finalized,
        Declined
    }

    struct Swap {
        address tokenIn;    // token to buy
        address tokenOut;   // token to sell
        uint256 amountIn;   // amount to receive
        uint256 amountOut;  // amount to send
        address sender;     // address that will send tokens
        address receiver;   // address that will receive tokens
        SwapStatus status;  // current status of the swap
    }
}

/**
 * @title SwapPool interface
 * @author CloudWalk Inc.
 * @dev The interface of the SwapPool contrats.
 */
interface ISwapPool is ISwapPoolTypes {
    /**
     * @dev Emitted when new swap was created.
     * @param id The id of the created swap.
     */
    event SwapCreated(uint256 id);

    /**
     * @dev Emitted when swap was finalized.
     * @param id The id of the finalized swap.
     */
    event SwapFinalized(uint256 id);

    /**
     * @dev Emitted when swap was declined.
     * @param id The id of the declined swap.
     */
    event SwapDeclined(uint256 id);

    /**
     * @dev Emitted when tokens were witdrawed from a contract.
     * @param receiver The address that received tokens.
     * @param token The address of a withdrawed token.
     * @param amount The amount of tokens that were witdrawed.
     */
    event TokensWithdrawal(address receiver, address token, uint amount);

    /**
     * @dev Emitted when token to buy status was updated.
     * @param token The address of the configured token.
     * @param status The new buy status of a token.
     */
    event TokenInConfigured(address token, bool status);

    /**
     * @dev Emitted when token to sell status was updated.
     * @param token The address of the configured token.
     * @param status The new sell status of a token.
     */
    event TokenOutConfigured(address token, bool status);

    /**
     * @dev Creates new swap.
     *
     * Emits a {SwapCreated} event.
     *
     * @param tokenIn The address a token to be bought.
     * @param tokenOut The address of a token to be sold.
     * @param amountIn The amount of tokens to be received.
     * @param amountOut The amount of tokens to be sent.
     * @param sender The address of the account to send sign the message and send tokens.
     * @param receiver The address of the account that will tokens.
     * @param sig The signature of the message, signed by sender.
     */
    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes memory sig
    ) external;

    /**
     * @dev Creates and finalizes new swap.
     *
     * Emits a {SwapCreated} event.
     * Emits a {SwapFinalized} event.
     *
     * @param tokenIn The address a token to be bought.
     * @param tokenOut The address of a token to be sold.
     * @param amountIn The amount of tokens to be received.
     * @param amountOut The amount of tokens to be sent.
     * @param sender The address of the account to send sign the message and send tokens.
     * @param receiver The address of the account that will tokens.
     * @param sig The signature of the message, signed by sender.
     */
    function createAndFinalizeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes calldata sig
    ) external;

    /**
     * @dev Finalizes the selected swap.
     *
     * Emits a {SwapFinalized} event.
     *
     * @param id The id of the swap to be finalized.
     */
    function finalizeSwap(uint256 id) external;

    /**
     * @dev Declines the selected swap.
     *
     * Emits a {SwapDeclined} event.
     *
     * @param id The id of the swap to be declined.
     */
    function declineSwap(uint256 id) external;

    /**
     * @dev Changes the buy status of the token.
     *
     * Emits a {TokenInConfigured} event.
     *
     * @param token The address of the token to change buy status of.
     * @param supported The new status of the token.
     */
    function configureTokenIn(address token, bool supported) external;

    /**
     * @dev Changes the sell status of the token.
     *
     * Emits a {TokenOutConfigured} event.
     *
     * @param token The address of the token to change sell status of.
     * @param supported The new status of the token.
     */
    function configureTokenOut(address token, bool supported) external;

    /**
     * @dev Withdraws tokens from the contract.
     *
     * Emits a {TokensWithdrawal} event.
     *
     * @param token The address of the token to be withdrawed.
     * @param amount The amount of tokens to be withdrawed.
     * @param receiver The receiver of the tokens.
     */
    function withdrawTokens(address token, uint256 amount, address receiver) external;

    /**
     * @dev Returns selected swap.
     * @param id The id of a swap to return.
     */
    function getSwap(uint256 id) external returns (Swap memory);

    /**
     * @dev Returns an array of swaps.
     * @param id The id of the first swap in the range to return.
     * @param limit The maximum number of swaps in the range to return.
     */
    function getSwaps(uint256 id, uint256 limit) external returns (Swap[] memory);

    /**
     * @dev Returns the length of the swaps array.
     */
    function swapsCount() external returns (uint256 result);

    /**
     * @dev Returns the buy status of the selected token.
     * @param token The address of a selected token
     */
    function isTokenInSupported(address token) external returns (bool);

    /**
     * @dev Returns the sell status of the selected token.
     * @param token The address of a selected token
     */
    function isTokenOutSupported(address token) external returns (bool);
}
