// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

interface IExchangePoolTypes {
    enum ExchangeStatus {
        PENDING,
        EXECUTED,
        DECLINED
    }

    struct Exchange {
        address buyAddress; // what to sell
        address sellAddress; // what to buy
        uint256 fee; // fee rate in BRLC
        uint256 amountIn; // amount to receive
        uint256 amountOut; // amount to send
        address sender; // address that will pay fee
        address receiver; // address that receives coins
        ExchangeStatus status;
    }
}

interface IExchangePool is IExchangePoolTypes {

    event SwapCreated(uint256 id);

    event SwapFinalized(uint256 id);

    event SwapDeclined(uint256 id);

    event NewFeeToken(address newFeeToken);

    // create a swap and add to pending
    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 fee,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes memory sig
    ) external returns (uint256 id);

    // finalize the swap, receive and send the tokens
    function finalizeSwap(uint256 id) external;

    // decline exchange
    function declineExchange(uint256 id) external;

    // change the token that contract receives as fee
    function changeFeeToken(address newFeeToken) external;

    function configureBuyToken(address newTokenIn, bool status) external;

    function configureSellToken(address newTokenOut, bool status) external ;

    // get exchange by id
    function getExchange(uint256 id) external returns (Exchange memory);

    // get all exchanges 
    function getExchanges(uint256 id, uint256 limit) external returns (Exchange[] memory);

    // get number of exchanges
    function exchangesCount() external returns (uint256 result);

    function getBuyTokenStatus(address token) external returns (bool);

    function getSellTokenStatus(address token) external returns (bool);
}