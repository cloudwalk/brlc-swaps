import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'SignatureChecker'", async () => {
  const ZERO_ADDRESS = ethers.constants.AddressZero;

  let signatureCheckerMockFactory: ContractFactory;
  let deployer: SignerWithAddress;

  before(async () => {
    [deployer] = await ethers.getSigners();
    signatureCheckerMockFactory = await ethers.getContractFactory("SignatureCheckerMock");
  });

  async function createSignature(signer: SignerWithAddress, messageHash: string): Promise<string> {
    const messageHashLength = messageHash.length;
    if (messageHashLength !== 66) {
      throw new Error(`The message hash string has incorrect length. Expected: 66. Actual: ${messageHashLength}`);
    }
    const binaryMessageHash = ethers.utils.arrayify(messageHash);
    return signer.signMessage(binaryMessageHash);
  }

  function inverseSignature(signature: string): string {
    const signatureLength = signature.length;
    if (signatureLength !== 132) {
      throw new Error(`The signature has incorrect length. Expected: 132. Actual: ${signatureLength}`);
    }

    const vHex = signature.substring(130);
    let inverseVHex;
    if (vHex === "1c") {
      inverseVHex = "1b";
    } else if (vHex === "1b") {
      inverseVHex = "1c";
    } else {
      throw new Error(`The signature has incorrect v part. Expected: 0x1b (27) or 0x1c (28). Actual: 0x${vHex}`);
    }

    const sHex = signature.substring(66, 130);
    const secp256k1n = BigNumber.from("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const s = BigNumber.from("0x" + sHex);
    const inverseS = secp256k1n.sub(s);
    const inverseSHex = inverseS.toHexString().substring(2);

    return signature.substring(0, 66) + inverseSHex + inverseVHex;
  }

  function decreaseSignatureVPart(signature: string, by: number): string {
    const signatureLength = signature.length;
    if (signatureLength !== 132) {
      throw new Error(`The signature has incorrect length. Expected: 132. Actual: ${signatureLength}`);
    }

    const vHex = signature.substring(130);
    const v = parseInt(vHex, 16);
    let newV = v - (Math.floor(by) % 256);
    if (newV < 0) {
      newV += 256;
    }
    let newVHex = newV.toString(16);
    if (newVHex.length < 2) {
      newVHex = "0" + newVHex;
    }
    return signature.substring(0, 130) + newVHex;
  }

  async function deploySignatureCheckerMock(): Promise<{ checker: Contract }> {
    const checker: Contract = await signatureCheckerMockFactory.deploy();
    await checker.deployed();

    return { checker };
  }

  describe("Function '_splitSignature()'", async () => {
    it("Executes as expected", async () => {
      const { checker } = await setUpFixture(deploySignatureCheckerMock);
      const expectedRPartHex = "0123456712345678234567893456789a456789ab56789abc6789abcd789abcde";
      const expectedSPartHex = "edcba987dcba9876cba98765ba987654a9876543987654328765432176543210";
      const expectedVPartHex = "ef";
      const signature = "0x" + expectedRPartHex + expectedSPartHex + expectedVPartHex;

      const actualParts = await checker.splitSignature(signature);

      expect(actualParts[0]).to.eq(parseInt(expectedVPartHex, 16));
      expect(actualParts[1]).to.eq("0x" + expectedRPartHex);
      expect(actualParts[2]).to.eq("0x" + expectedSPartHex);
    });

    it("Is reverted if the length of the signature is not 65 bytes", async () => {
      const { checker } = await setUpFixture(deploySignatureCheckerMock);
      const signature64Bytes = "0x" + "1".repeat(64 * 2);
      const signature66Bytes = "0x" + "1".repeat(66 * 2);

      await expect(
        checker.splitSignature(signature64Bytes)
      ).to.reverted;

      await expect(
        checker.splitSignature(signature66Bytes)
      ).to.reverted;
    });
  });

  describe("Function '_recoverSigner()'", async () => {
    const messageHash = "0x0123456712345678234567893456789a456789ab56789abc6789abcd789abcde";

    describe("Returns the signer address if", async () => {
      it("The signature is correct and unchanged", async () => {
        const { checker } = await setUpFixture(deploySignatureCheckerMock);
        const signature = await createSignature(deployer, messageHash);

        const actualSignerAddress = await checker.recoverSigner(messageHash, signature);
        expect(actualSignerAddress).to.eq(deployer.address);
      });

      it("The signature is correct and its v part is decreased by 27", async () => {
        const { checker } = await setUpFixture(deploySignatureCheckerMock);
        const signature = await createSignature(deployer, messageHash);
        const changedSignature = decreaseSignatureVPart(signature, 27);

        const actualSignerAddress = await checker.recoverSigner(messageHash, changedSignature);
        expect(actualSignerAddress).to.eq(deployer.address);
      });
    });

    describe("Returns the zero address if", async () => {
      it("The length of the signature is not 65 bytes", async () => {
        const { checker } = await setUpFixture(deploySignatureCheckerMock);
        const signature64Bytes = "0x" + "1".repeat(64 * 2);
        const signature66Bytes = "0x" + "1".repeat(66 * 2);

        let actualSignerAddress = await checker.recoverSigner(messageHash, signature64Bytes);
        expect(actualSignerAddress).to.eq(ZERO_ADDRESS);
        actualSignerAddress = await checker.recoverSigner(messageHash, signature66Bytes);
        expect(actualSignerAddress).to.eq(ZERO_ADDRESS);
      });

      it("The signature is inversed", async () => {
        const { checker } = await setUpFixture(deploySignatureCheckerMock);
        const signature = await createSignature(deployer, messageHash);
        const inversedSignature = inverseSignature(signature);

        const actualSignerAddress = await checker.recoverSigner(messageHash, inversedSignature);
        expect(actualSignerAddress).to.eq(ZERO_ADDRESS);
      });

      it("The signature v part is incorrect", async () => {
        const { checker } = await setUpFixture(deploySignatureCheckerMock);
        const signature = await createSignature(deployer, messageHash);
        const changedSignature = decreaseSignatureVPart(signature, 25);
        const actualSignerAddress = await checker.recoverSigner(messageHash, changedSignature);
        expect(actualSignerAddress).to.eq(ZERO_ADDRESS);
      });
    });
  });
});
