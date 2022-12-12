// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { SignatureChecker } from "./utils/SignatureChecker.sol";
import { BlacklistControlUpgradeable } from "./utils/BlacklistControlUpgradeable.sol";
import { PauseControlUpgradeable } from "./utils/PauseControlUpgradeable.sol";
import { RescueControlUpgradeable } from "./utils/RescueControlUpgradeable.sol";
import { SwapPoolStorage } from "./SwapPoolStorage.sol";
import { ISwapPool } from "./ISwapPool.sol";

contract SwapPool is
    Initializable,
    AccessControlUpgradeable,
    BlacklistControlUpgradeable,
    PauseControlUpgradeable,
    RescueControlUpgradeable,
    SignatureChecker,
    SwapPoolStorage
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    error TokenNotSupported();

    error SwapAlreadyDeclined();

    error SwapAlreadyExecuted();

    error SignatureUsed();

    error SwapNotExist();

    error ZeroAddressSupportedToken();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address[] memory buyTokens, address[] memory sellTokens) public initializer {
        __SwapPool_init(buyTokens, sellTokens);
    }

    function __SwapPool_init(address[] memory buyTokens, address[] memory sellTokens) internal {
        __AccessControl_init_unchained();
        __SwapPool_init_unchained(buyTokens, sellTokens);
        __PauseControl_init_unchained(OWNER_ROLE);
        __RescueControl_init_unchained(OWNER_ROLE);
        __BlacklistControl_init_unchained(OWNER_ROLE);
    }

    function __SwapPool_init_unchained(address[] memory buyTokens, address[] memory sellTokens) internal {
        _grantRole(OWNER_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);

        for (uint256 i = 0; i < buyTokens.length; i++) {
            if (buyTokens[i] == address(0)) {
                revert ZeroAddressSupportedToken();
            }
            _supportedIn[buyTokens[i]] = true;
        }

        for (uint256 i = 0; i < sellTokens.length; i++) {
            if (sellTokens[i] == address(0)) {
                revert ZeroAddressSupportedToken();
            }
            _supportedOut[buyTokens[i]] = true;
        }
    }

    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address signer,
        address receiver,
        bytes calldata sig
    ) external onlyRole(MANAGER_ROLE) notBlacklisted(signer) notBlacklisted(receiver) whenNotPaused {
        _verifySignature(tokenIn, tokenOut, amountIn, amountOut, signer, receiver, sig, id);
        _createSwap(tokenIn, tokenOut, amountIn, amountOut, signer, receiver);
    }

    function createAndFinalizeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address signer,
        address receiver,
        bytes calldata sig
    ) external onlyRole(MANAGER_ROLE) notBlacklisted(signer) notBlacklisted(receiver) whenNotPaused {
        _verifySignature(tokenIn, tokenOut, amountIn, amountOut, signer, receiver, sig, id);
        _createSwap(tokenIn, tokenOut, amountIn, amountOut, signer, receiver);
        _finalizeSwap(id - 1);
    }

    function declineSwap(uint256 id) external onlyRole(MANAGER_ROLE) whenNotPaused {
        if (id >= _swaps.length) {
            revert SwapNotExist();
        }

        Swap storage selectedSwap = _swaps[id];

        if (selectedSwap.status == SwapStatus.Declined) {
            revert SwapAlreadyDeclined();
        }

        if (selectedSwap.status == SwapStatus.Executed) {
            revert SwapAlreadyExecuted();
        }

        selectedSwap.status = SwapStatus.Declined;
        emit SwapDeclined(id);
    }

    function finalizeSwap(uint256 id) external onlyRole(MANAGER_ROLE) whenNotPaused {
        _finalizeSwap(id);
    }

    function configureBuyToken(address tokenIn, bool status) external onlyRole(MANAGER_ROLE) {
        if (tokenIn == address(0)) {
            revert ZeroAddressSupportedToken();
        }
        _supportedIn[tokenIn] = status;
        emit BuyTokenConfigured(tokenIn, status);
    }

    function configureSellToken(address tokenOut, bool status) external onlyRole(MANAGER_ROLE) {
        if (tokenOut == address(0)) {
            revert ZeroAddressSupportedToken();
        }
        _supportedOut[tokenOut] = status;
        emit SellTokenConfigured(tokenOut, status);
    }

    function withdrawTokens(address token, uint256 amount, address receiver) external onlyRole(ADMIN_ROLE) {
        IERC20Upgradeable(token).safeTransfer(receiver, amount);
        emit TokensWithdrawal(receiver, token, amount);
    }

    function getSwap(uint256 id) external view returns (Swap memory) {
        return _swaps[id];
    }

    function getSwaps(uint256 id, uint256 limit) external view returns (Swap[] memory swaps) {
        uint256 len = _swaps.length;
        if (len <= id || limit == 0) {
            swaps = new Swap[](0);
        } else {
            len -= id;
            if (len > limit) {
                len = limit;
            }
            swaps = new Swap[](len);
            for (uint256 i = 0; i < len; i++) {
                swaps[i] = _swaps[id];
                id++;
            }
        }
    }

    function swapsCount() external view returns (uint256 result) {
        return _swaps.length;
    }

    function getBuyTokenStatus(address token) external view returns (bool) {
        return _supportedIn[token];
    }

    function getSellTokenStatus(address token) external view returns (bool) {
        return _supportedOut[token];
    }

    function _createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address signer,
        address receiver
    ) internal {
        if (!_supportedIn[tokenIn] || !_supportedOut[tokenOut]) {
            revert TokenNotSupported();
        }

        _swaps.push(
            Swap({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                amountOut: amountOut,
                sender: signer,
                receiver: receiver,
                status: SwapStatus.Pending
            })
        );
        emit SwapCreated(id);
        id++;
    }

    function _finalizeSwap(uint256 id) internal {
        if (id >= _swaps.length) {
            revert SwapNotExist();
        }

        Swap storage selectedSwap = _swaps[id];

        if (selectedSwap.status == SwapStatus.Declined) {
            revert SwapAlreadyDeclined();
        }

        if (selectedSwap.status == SwapStatus.Executed) {
            revert SwapAlreadyExecuted();
        }

        selectedSwap.status = SwapStatus.Executed;

        //transfer tokens
        //receive tokens that the contract bought
        IERC20Upgradeable(selectedSwap.tokenIn).safeTransferFrom(
            selectedSwap.sender,
            address(this),
            selectedSwap.amountIn
        );
        //send tokens that the contract sold
        IERC20Upgradeable(selectedSwap.tokenOut).safeTransfer(selectedSwap.receiver, selectedSwap.amountOut);

        emit SwapFinalized(id);
    }
}