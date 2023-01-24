// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title SwapPool types interface
 * @author CloudWalk Inc.
 */
interface ISwapPoolTypes {
    /// @dev The enumeration of swap statuses.
    enum SwapStatus {
        Nonexistent, // 0 The relocation does not exist.
        Pending,     // 1 The status just after swap creation.
        Finalized,   // 2 The status of a successfully finalized swap.
        Declined     // 3 The status of a declined swap.
    }

    /// @dev The structure with data of a single swap operation.
    struct Swap {
        address tokenIn;    // The token to buy by the contract.
        address tokenOut;   // The token to sell by the contract.
        uint256 amountIn;   // The amount to receive by the contract.
        uint256 amountOut;  // The amount to send from the contract.
        address sender;     // The address that sends tokens to the contract.
        address receiver;   // The address that receives tokens from the contract.
        SwapStatus status;  // The current status of the swap.
    }
}

/**
 * @title SwapPool interface
 * @author CloudWalk Inc.
 * @dev The interface of the SwapPool contract.
 */
interface ISwapPool is ISwapPoolTypes {
    /**
     * @dev Emitted when a new swap was created.
     * @param id The id of the created swap.
     */
    event SwapCreated(uint256 id);

   /**
     * @dev Emitted when a swap was finalized.
     * @param id The id of the finalized swap.
     */
    event SwapFinalized(uint256 id);

    /**
     * @dev Emitted when a swap was declined.
     * @param id The id of the declined swap.
     */
    event SwapDeclined(uint256 id);

    /**
     * @dev Emitted when tokens are withdrawn from the contract.
     * @param receiver The address that receives tokens.
     * @param token The address of the token contract.
     * @param amount The amount of tokens that is withdrawn.
     */
    event TokensWithdrawal(address receiver, address token, uint amount);

    /**
     * @dev Emitted when the status of a token to buy is updated.
     * @param token The address of the configured token.
     * @param status The new buy status of the token.
     */
    event TokenInConfigured(address token, bool status);

    /**
     * @dev Emitted when the status of token to sell is updated.
     * @param token The address of the configured token.
     * @param status The new sell status of a token.
     */
    event TokenOutConfigured(address token, bool status);

    /**
     * @dev Creates a new swap.
     *
     * This function can be called by a limited number of accounts that are allowed to execute swap pool operations.
     *
     * Emits a {SwapCreated} event.
     *
     * @param tokenIn The address a token to buy by the contract.
     * @param tokenOut The address of a token to sell by the contract.
     * @param amountIn The amount of tokens to receive by the contract.
     * @param amountOut The amount of tokens to send by the contract.
     * @param sender The address of the account that sends tokens and signs the swap message.
     * @param receiver The address of the account that will receive tokens.
     * @param sig The signature of the swap message, signed by sender.
     *        The swap message contains all the params above and the id of the created swap, except the sender.
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
     * @dev Creates and finalizes a new swap.
     *
     * Emits a {SwapCreated} event.
     * Emits a {SwapFinalized} event.
     *
     * @param tokenIn The address a token to buy by the contract.
     * @param tokenOut The address of a token to sell by the contract.
     * @param amountIn The amount of tokens to receive by the contract.
     * @param amountOut The amount of tokens to send by the contract.
     * @param sender The address of the account that sends tokens and signs the swap message.
     * @param receiver The address of the account that will receive tokens.
     * @param sig The signature of the swap message, signed by sender.
     *        The swap message contains all the params above and the id of the created swap, except the sender.
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
     * @dev Finalizes a selected swap.
     *
     * Emits a {SwapFinalized} event.
     *
     * @param id The id of the swap to be finalized.
     */
    function finalizeSwap(uint256 id) external;

    /**
     * @dev Declines a selected swap.
     *
     * Emits a {SwapDeclined} event.
     *
     * @param id The id of the swap to be declined.
     */
    function declineSwap(uint256 id) external;

    /**
     * @dev Configures the status of a token to buy.
     *
     * Emits a {TokenInConfigured} event.
     *
     * @param token The address of the token to configure.
     * @param supported The new status of the token.
     */
    function configureTokenIn(address token, bool supported) external;

    /**
     * @dev Configures the status of a token to sell.
     *
     * Emits a {TokenOutConfigured} event.
     *
     * @param token The address of the token to configure.
     * @param supported The new status of the token.
     */
    function configureTokenOut(address token, bool supported) external;

   /**
     * @dev Withdraws tokens from the contract.
     *
     * Emits a {TokensWithdrawal} event.
     *
     * @param token The address of the token to be withdrawn.
     * @param amount The amount of tokens to be withdrawn.
     * @param receiver The receiver of the tokens.
     */
    function withdrawTokens(address token, uint256 amount, address receiver) external;

    /**
     * @dev Returns the swap for a given id.
     * @param id The id of the swap to return.
     */
    function getSwap(uint256 id) external returns (Swap memory);

    /**
     * @dev Returns an array of swaps for a range of ids.
     * @param id The id of the first swap in the range to return.
     * @param limit The maximum number of swaps in the range to return.
     */
    function getSwaps(uint256 id, uint256 limit) external returns (Swap[] memory);

    /**
     * @dev Returns the length of the swaps array.
     */
    function swapsCount() external returns (uint256 result);

    /**
     * @dev Returns the status of a token to buy.
     * @param token The address of the token to return the status.
     */
    function isTokenInSupported(address token) external returns (bool);

    /**
     * @dev Returns the status of a token to sell.
     * @param token The address of the token to return the status.
     */
    function isTokenOutSupported(address token) external returns (bool);
}
