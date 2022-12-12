// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

interface ISwapPoolTypes {
    enum SwapStatus {
        Pending,
        Executed,
        Declined
    }

    struct Swap {
        address tokenIn; // what to sell
        address tokenOut; // what to buy
        uint256 amountIn; // amount to receive
        uint256 amountOut; // amount to send
        address sender; // address that will pay fee
        address receiver; // address that receives coins
        SwapStatus status;
    }
}

interface ISwapPool is ISwapPoolTypes {
    event SwapCreated(uint256 id);

    event SwapFinalized(uint256 id);

    event SwapDeclined(uint256 id);

    event TokensWithdrawal(address receiver, address token, uint amount);

    event BuyTokenConfigured(address token, bool status);

    event SellTokenConfigured(address token, bool status);

    // create a swap and add to pending
    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes memory sig
    ) external;

    // finalize the swap, receive and send the tokens
    function finalizeSwap(uint256 id) external;

    // decline swap
    function declineSwap(uint256 id) external;

    function configureBuyToken(address newTokenIn, bool status) external;

    function configureSellToken(address newTokenOut, bool status) external;

    // get swap by id
    function getSwap(uint256 id) external returns (Swap memory);

    // get all swaps
    function getSwaps(uint256 id, uint256 limit) external returns (Swap[] memory);

    // get number of swaps
    function swapsCount() external returns (uint256 result);

    function getBuyTokenStatus(address token) external returns (bool);

    function getSellTokenStatus(address token) external returns (bool);
}
