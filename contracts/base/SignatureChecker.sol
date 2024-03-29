//SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title SignatureChecker contract
 * @author CloudWalk Inc.
 */
abstract contract SignatureChecker {
    /**
     * @dev Splits given signature to r, s and v in assembly.
     * @param sig Signature to split.
     * @return uint8, bytes32, bytes32 The split bytes from the signature.
     */
    function _splitSignature(bytes memory sig) internal pure returns (uint8, bytes32, bytes32) {
        require(sig.length == 65);

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            // first 32 bytes, after the length prefix
            r := mload(add(sig, 32))
            // second 32 bytes
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes)
            v := byte(0, mload(add(sig, 96)))
        }
        return (v, r, s);
    }

    /**
     * @dev Returns the address that signed a {message} with signature {sig}.
     * @param message The hash of a message to check the signer of.
     * @param sig The signature used to sign a {message}.
     * @return Address that signed a {message}.
     */
    function _recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) {
            return (address(0));
        }

        uint8 v;
        bytes32 r;
        bytes32 s;

        (v, r, s) = _splitSignature(sig);

        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return (address(0));
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return (address(0));
        }

        message = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));

        return ecrecover(message, v, r, s);
    }
}
