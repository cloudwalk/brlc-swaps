// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import { SignatureChecker } from "./base/SignatureChecker.sol";
import { BlacklistControlUpgradeable } from "./base/BlacklistControlUpgradeable.sol";
import { PauseControlUpgradeable } from "./base/PauseControlUpgradeable.sol";
import { RescueControlUpgradeable } from "./base/RescueControlUpgradeable.sol";
import { StoragePlaceholder200 } from "./base/StoragePlaceholder.sol";
import { SwapPoolStorage } from "./SwapPoolStorage.sol";
import { ISwapPool } from "./ISwapPool.sol";

contract SwapPool is
    Initializable,
    AccessControlUpgradeable,
    BlacklistControlUpgradeable,
    PauseControlUpgradeable,
    RescueControlUpgradeable,
    SignatureChecker,
    StoragePlaceholder200,
    SwapPoolStorage,
    ISwapPool
{
    /// @dev Used to prevent unseccessfull token transfers.
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @dev Hash of the manager role.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @dev Hash of the admin role.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev Hash of the owner role.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev Token is not supported by the contract.
    error TokenNotSupported();

    /// @dev Swap with selected id is already declined.
    error SwapAlreadyDeclined();

    /// @dev Swap with selected id is already finalized.
    error SwapAlreadyFinalized();

    /// @dev Swap with selected id does not exist.
    error SwapNotExist();

    /// @dev Zero address was passed as a parameter.
    error ZeroTokenAddress();

    /// @dev Selected token already has passed status.
    error TokenAlreadyConfigured();

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     */
    function initialize() external initializer {
        __SwapPool_init();
    }

    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See {SwapPool-initialize}.
     */
    function __SwapPool_init() internal {
        __AccessControl_init_unchained();
        __SwapPool_init_unchained();
        __PauseControl_init_unchained(OWNER_ROLE);
        __RescueControl_init_unchained(OWNER_ROLE);
        __BlacklistControl_init_unchained(OWNER_ROLE);
    }

    /**
     * @dev The unchained internal initializer of the upgradable contract.
     *
     * See {SwapPool-initialize}.
     */
    function __SwapPool_init_unchained() internal {
        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, msg.sender);
    }

    /**
     * @dev See {ISwapPool-createSwap}.
     *
     * Requirements:
     *
     * - The caller must have MANAGER_ROLE.
     * - The contract should not be paused.
     * - The sender should not be blacklisted.
     * - The receiver should not be blacklisted.
     * - The sender must be a message signer.
     * - Tokens should be supported.
     */
    function createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes calldata sig
    ) external onlyRole(MANAGER_ROLE) notBlacklisted(sender) notBlacklisted(receiver) whenNotPaused {
        _verifySignature(tokenIn, tokenOut, amountIn, amountOut, sender, receiver, sig, id);
        _createSwap(tokenIn, tokenOut, amountIn, amountOut, sender, receiver);
    }

    /**
     * @dev See {ISwapPool-createAndFinalizeSwap}.
     *
     * Requirements:
     *
     * - The caller must have MANAGER_ROLE.
     * - The contract should not be paused.
     * - The sender should not be blacklisted.
     * - The receiver should not be blacklisted.
     * - The sender must be a message signer.
     * - Tokens should be supported.
     */
    function createAndFinalizeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes calldata sig
    ) external onlyRole(MANAGER_ROLE) notBlacklisted(sender) notBlacklisted(receiver) whenNotPaused {
        _verifySignature(tokenIn, tokenOut, amountIn, amountOut, sender, receiver, sig, id);
        uint256 newSwapId = _createSwap(tokenIn, tokenOut, amountIn, amountOut, sender, receiver);
        _finalizeSwap(newSwapId);
    }

    /**
     * @dev See {ISwapPool-declineSwap}.
     *
     * Requirements:
     *
     * - The caller must have MANAGER_ROLE.
     * - The contract should not be paused.
     * - The swap with selected id should exist.
     * - The swap with selected id should not be finalized.
     * - The swap with selected id should not be declined.
     */
    function declineSwap(uint256 id) external onlyRole(MANAGER_ROLE) whenNotPaused {
        if (id >= _swaps.length) {
            revert SwapNotExist();
        }

        Swap storage selectedSwap = _swaps[id];

        if (selectedSwap.status == SwapStatus.Declined) {
            revert SwapAlreadyDeclined();
        }

        if (selectedSwap.status == SwapStatus.Finalized) {
            revert SwapAlreadyFinalized();
        }

        selectedSwap.status = SwapStatus.Declined;

        IERC20Upgradeable(selectedSwap.tokenIn).safeTransfer(selectedSwap.sender, selectedSwap.amountIn);
        emit SwapDeclined(id);
    }

    /**
     * @dev See {ISwapPool-finalizeSwap}.
     *
     * Requirements:
     *
     * - The caller must have MANAGER_ROLE.
     * - The contract should not be paused.
     * - The swap with selected id should exist.
     * - The swap with selected id should not be finalized.
     * - The swap with selected id should not be declined.
     */
    function finalizeSwap(uint256 id) external onlyRole(MANAGER_ROLE) whenNotPaused {
        _finalizeSwap(id);
    }

    /**
     * @dev See {ISwapPool-configureTokenIn}.
     *
     * Requirements:
     *
     * - The caller must have ADMIN_ROLE.
     * - The selected token should not be zero address.
     * - The selected token should not already have {status}.
     */
    function configureTokenIn(address token, bool supported) external onlyRole(ADMIN_ROLE) whenNotPaused {
        if (token == address(0)) {
            revert ZeroTokenAddress();
        }
        if (_supportedIn[token] == supported) {
            revert TokenAlreadyConfigured();
        }
        _supportedIn[token] = supported;
        emit TokenInConfigured(token, supported);
    }

    /**
     * @dev See {ISwapPool-configureTokenOut}.
     *
     * Requirements:
     *
     * - The caller must have ADMIN_ROLE.
     * - The selected token should not be zero address.
     * - The selected token should not already have {status}.
     */
    function configureTokenOut(address token, bool supported) external onlyRole(ADMIN_ROLE) whenNotPaused {
        if (token == address(0)) {
            revert ZeroTokenAddress();
        }
        if (_supportedOut[token] == supported) {
            revert TokenAlreadyConfigured();
        }
        _supportedOut[token] = supported;
        emit TokenOutConfigured(token, supported);
    }

    /**
     * @dev See {ISwapPool-withdrawTokens}.
     *
     * Requirements:
     *
     * - The caller must have the ADMIN_ROLE
     */
    function withdrawTokens(
        address token,
        uint256 amount,
        address receiver
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        IERC20Upgradeable(token).safeTransfer(receiver, amount);
        emit TokensWithdrawal(receiver, token, amount);
    }

    /**
     * @dev See {ISwapPool-getSwap}.
     */
    function getSwap(uint256 id) external view returns (Swap memory) {
        return _swaps[id];
    }

    /**
     * @dev See {ISwapPool-getSwaps}.
     */
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

    /**
     * @dev See {ISwapPool-swapsCount}.
     */
    function swapsCount() external view returns (uint256 result) {
        return _swaps.length;
    }

    /**
     * @dev See {ISwapPool-isTokenInSupported}.
     */
    function isTokenInSupported(address token) external view returns (bool) {
        return _supportedIn[token];
    }

    /**
     * @dev See {ISwapPool-isTokenOutSupported}.
     */
    function isTokenOutSupported(address token) external view returns (bool) {
        return _supportedOut[token];
    }

    /**
     * @dev See {SwapPool-createSwap}.
     */
    function _createSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver
    ) internal returns (uint256) {
        if (!_supportedIn[tokenIn] || !_supportedOut[tokenOut]) {
            revert TokenNotSupported();
        }

        _swaps.push(
            Swap({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                amountOut: amountOut,
                sender: sender,
                receiver: receiver,
                status: SwapStatus.Pending
            })
        );

        IERC20Upgradeable(tokenIn).safeTransferFrom(sender, address(this), amountIn);

        uint256 currentId = id;
        emit SwapCreated(id);
        id = currentId + 1;
        return currentId;
    }

    /**
     * @dev See {SwapPool-finalizeSwap}.
     */
    function _finalizeSwap(uint256 id) internal {
        if (id >= _swaps.length) {
            revert SwapNotExist();
        }

        Swap storage selectedSwap = _swaps[id];

        if (selectedSwap.status == SwapStatus.Declined) {
            revert SwapAlreadyDeclined();
        }

        if (selectedSwap.status == SwapStatus.Finalized) {
            revert SwapAlreadyFinalized();
        }

        selectedSwap.status = SwapStatus.Finalized;

        IERC20Upgradeable(selectedSwap.tokenOut).safeTransfer(selectedSwap.receiver, selectedSwap.amountOut);

        emit SwapFinalized(id);
    }

    function _verifySignature(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address sender,
        address receiver,
        bytes calldata sig,
        uint id
    ) internal pure {
        bytes32 messageData = keccak256(abi.encode(tokenIn, tokenOut, amountIn, amountOut, receiver, id));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageData));

        if (_recoverSigner(messageHash, sig) != sender) {
            revert UnverifiedSender();
        }
    }
}
