// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { ExchangePoolStorage } from "./ExchangePoolStorage.sol";
import { IExchangePool } from "./IExchangePool.sol";
import { SignatureVerificator } from "./utils/SignatureVerificator.sol";

contract ExchangePool is Initializable, AccessControlUpgradeable, SignatureVerificator, ExchangePoolStorage {
    
    //TODO decide the naming Swap/Exchange
    //TODO clarify the roles usage

    using SafeERC20Upgradeable for IERC20Upgradeable;

    error TokenNotSupported();

    error UnverifiedSender();

    error ExchangeAlreadyDeclined();

    error ExchangeAlreadyExecuted();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        address sender,
        address receiver,
        bytes memory sig
    ) external returns (uint256 swapId) {
        if (!_supportedIn[tokenIn] || !_supportedOut[tokenOut]) {
            revert TokenNotSupported();
        }
        bytes32 messageData = keccak256(abi.encode(tokenIn, tokenOut, amountIn, amountOut, sender, receiver));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageData));

        if (recoverSigner(messageHash, sig) != receiver) {
            revert UnverifiedSender();
        }

        _usedSignatures[sig] = true;

        _exchanges.push(
            Exchange({
                buyAddress: tokenIn,
                sellAddress: tokenOut,
                fee: fee,
                amountIn: amountIn,
                amountOut: amountOut,
                sender: sender,
                receiver: receiver,
                status: ExchangeStatus.PENDING
            })
        );
        swapId = _exchanges.length - 1;
        emit SwapCreated(swapId);
        return swapId;
    }

    function declineExchange(uint256 id) external {
        Exchange storage selectedExchange = _exchanges[id];

        if (selectedExchange.status == ExchangeStatus.DECLINED) {
            revert ExchangeAlreadyDeclined();
        }
        selectedExchange.status = ExchangeStatus.DECLINED;
        emit SwapDeclined(id);
    }

    function finalizeSwap(uint256 id) external {
        Exchange storage selectedExchange = _exchanges[id];

        if (selectedExchange.status == ExchangeStatus.DECLINED) {
            revert ExchangeAlreadyDeclined();
        }

        if (selectedExchange.status == ExchangeStatus.EXECUTED) {
            revert ExchangeAlreadyExecuted();
        }

        selectedExchange.status = ExchangeStatus.EXECUTED;

        //collect fees
        IERC20Upgradeable(_feeToken).safeTransferFrom(selectedExchange.sender, address(this), selectedExchange.fee);

        //transfer tokens
        //receive tokens that the contract bought
        IERC20Upgradeable(selectedExchange.buyAddress).safeTransferFrom(
            selectedExchange.sender,
            address(this),
            selectedExchange.amountIn
        );
        //send tokens that the contract sold
        IERC20Upgradeable(selectedExchange.sellAddress).safeTransferFrom(
            address(this),
            selectedExchange.receiver,
            selectedExchange.amountOut
        );

        emit SwapFinalized(id);
    }

    function changeFeeToken(address newFeeToken) external {
        _feeToken = newFeeToken;
        emit NewFeeToken(newFeeToken);
    }

    function configureBuyToken(address tokenIn, bool status) external {
        _supportedIn[tokenIn] = status;
    }

    function configureSellToken(address tokenOut, bool status) external {
        _supportedOut[tokenOut] = status;
    }

    function getExchange(uint256 id) external view returns (Exchange memory) {
        return _exchanges[id];
    }

    function getExchanges(uint256 id, uint256 limit) external view returns (Exchange[] memory exchanges) {
        uint256 len = _exchanges.length;
        if (len <= id || limit == 0) {
            exchanges = new Exchange[](0);
        } else {
            len -= id;
            if (len > limit) {
                len = limit;
            }
            exchanges = new Exchange[](len);
            for (uint256 i = 0; i < len; i++) {
                exchanges[i] = _exchanges[id];
                id++;
            }
        }
    }

    function getExchangesCount() external view returns (uint256 result) {
        return _exchanges.length;
    }
}
