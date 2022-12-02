// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { SignatureChecker } from "./utils/SignatureChecker.sol";
import { ExchangePoolStorage } from "./ExchangePoolStorage.sol";
import { IExchangePool } from "./IExchangePool.sol";

contract ExchangePool is Initializable, AccessControlUpgradeable, SignatureChecker, ExchangePoolStorage {
    //TODO decide the naming Swap/Exchange
    //TODO clarify the roles usage

    using SafeERC20Upgradeable for IERC20Upgradeable;

    error TokenNotSupported();

    error UnverifiedSender();

    error ExchangeAlreadyDeclined();

    error ExchangeAlreadyExecuted();

    error SignatureUsed();

    error ExchangeNotExist();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address feeToken, address[] memory buyTokens, address[] memory sellTokens) public initializer {
        __AccessControl_init();

        _grantRole(OWNER_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);

        for (uint256 i = 0; i < buyTokens.length; i++) {
            _supportedIn[buyTokens[i]] = true;
        }

        for (uint256 i = 0; i < sellTokens.length; i++) {
            _supportedOut[buyTokens[i]] = true;
        }

        _feeToken = feeToken;
    }

    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 fee,
        uint256 amountIn,
        uint256 amountOut,
        address signer,
        address receiver,
        bytes calldata sig
    ) external onlyRole(MANAGER_ROLE) returns (uint256 swapId) {
        if (!_supportedIn[tokenIn] || !_supportedOut[tokenOut]) {
            revert TokenNotSupported();
        }
        
        bytes32 messageData = keccak256(abi.encode(tokenIn, tokenOut, fee, amountIn, amountOut, receiver, id));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageData));
        
        if(recoverSigner(messageHash, sig) != signer) {
            revert UnverifiedSender();
        }

        _exchanges.push(
            Exchange({
                buyAddress: tokenIn,
                sellAddress: tokenOut,
                fee: fee,
                amountIn: amountIn,
                amountOut: amountOut,
                sender: signer,
                receiver: receiver,
                status: ExchangeStatus.PENDING
            })
        );
        swapId = id;
        id++;
        emit SwapCreated(swapId);
        return swapId;
    }

    function declineExchange(uint256 id) onlyRole(MANAGER_ROLE) external {
        if (_exchanges.length < id) {
            revert ExchangeNotExist();
        }

        Exchange storage selectedExchange = _exchanges[id];

        if (selectedExchange.status == ExchangeStatus.DECLINED) {
            revert ExchangeAlreadyDeclined();
        }

        if (selectedExchange.status == ExchangeStatus.EXECUTED) {
            revert ExchangeAlreadyExecuted();
        }

        selectedExchange.status = ExchangeStatus.DECLINED;
        emit SwapDeclined(id);
    }

    function finalizeSwap(uint256 id) onlyRole(MANAGER_ROLE) external {
        if (_exchanges.length < id) {
            revert ExchangeNotExist();
        }

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
        IERC20Upgradeable(selectedExchange.sellAddress).safeTransfer(
            selectedExchange.receiver,
            selectedExchange.amountOut
        );

        emit SwapFinalized(id);
    }

    function changeFeeToken(address newFeeToken) onlyRole(OWNER_ROLE) external {
        _feeToken = newFeeToken;
        emit NewFeeToken(newFeeToken);
    }

    function configureBuyToken(address tokenIn, bool status) onlyRole(MANAGER_ROLE) external {
        _supportedIn[tokenIn] = status;
    }

    function configureSellToken(address tokenOut, bool status) onlyRole(MANAGER_ROLE) external {
        _supportedOut[tokenOut] = status;
    }

    function withdrawTokens(address token, uint256 amount, address receiver) onlyRole(OWNER_ROLE) external {
        IERC20Upgradeable(token).safeTransferFrom(address(this), receiver, amount);
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

    function exchangesCount() external view returns (uint256 result) {
        return _exchanges.length;
    }

    function feeTokenAddress() external view returns (address) {
        return _feeToken;
    }

    function getBuyTokenStatus(address token) external view returns (bool) {
        return _supportedIn[token];
    }

    function getSellTokenStatus(address token) external view returns (bool) {
        return _supportedOut[token];
    }

    function getExchangeStatus(uint256 id) external view returns (ExchangeStatus) {
        return _exchanges[id].status;
    }
}
