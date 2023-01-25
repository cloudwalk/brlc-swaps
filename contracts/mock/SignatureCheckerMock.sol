//SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { SignatureChecker } from "../base/SignatureChecker.sol";

/**
 * @title PausableExtUpgradeableMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {SignatureChecker} base contract for test purposes.
 */
contract SignatureCheckerMock is SignatureChecker {
    /// @dev Calls the appropriate function of the base contract
    function splitSignature(bytes memory sig) external pure returns (uint8, bytes32, bytes32) {
        return _splitSignature(sig);
    }

    /// @dev Calls the appropriate function of the base contract
    function recoverSigner(bytes32 message, bytes memory sig) external pure returns (address) {
        return _recoverSigner(message, sig);
    }
}
