import { ethers, network, upgrades } from "hardhat";
import { expect, use } from "chai";
import { Contract, ContractFactory } from "ethers";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

interface Swap {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  sender: string;
  receiver: string;
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ExchangePool'", () => {
  const PENDING = 0;
  const EXECUTED = 1;
  const DECLINED = 2;

  const TEST_FEE = 20;
  const TEST_AMOUNT_IN = 200;
  const TEST_AMOUNT_OUT = 100;

  // contract events
  const EVENT_NAME_NEW_SWAP = "SwapCreated";
  const EVENT_NAME_SWAP_FINALIZED = "SwapFinalized";
  const EVENT_NAME_SWAP_DECLINED = "SwapDeclined";
  const EVENT_NAME_NEW_FEE_TOKEN = "NewFeeToken";

  // contract custom errors
  const REVERT_ERROR_IF_UNSUPPORTED_TOKEN = "TokenNotSupported";
  const REVERT_ERROR_IF_UNVERIFIED_SENDER = "UnverifiedSender";
  const REVERT_ERROR_IF_EXCHANGE_DECLINED = "ExchangeAlreadyDeclined";
  const REVERT_ERROR_IF_EXCHANGE_EXECUTED = "ExchangeAlreadyExecuted";
  const REVERT_ERROR_IF_SINATURE_ALREADY_USED = "SignatureUsed";
  const REVERT_ERROR_IF_EXCHANGE_NOT_EXIST = "ExchangeNotExist";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";

  const MANAGER_ROLE_HASH =
    "0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08";
  const OWNER_ROLE_HASH =
    "0xb19546dff01e856fb3f010c267a7b1c60363cf8a4664e21cc89c26224620214e";

  let token1Factory: ContractFactory;
  let token2Factory: ContractFactory;
  let swapPoolFactory: ContractFactory;
  let feeTokenFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let manager: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, manager, user] = await ethers.getSigners();
    token1Factory = await ethers.getContractFactory("ERC20Mock");
    token2Factory = await ethers.getContractFactory("ERC20Mock2");
    feeTokenFactory = await ethers.getContractFactory("ERC20FeeMock");
    swapPoolFactory = await ethers.getContractFactory("ExchangePool");
  });

  async function deployMocks(): Promise<{
    tokenMock1: Contract;
    tokenMock2: Contract;
    feeToken: Contract;
  }> {
    const tokenMock1 = await token1Factory.deploy();
    await tokenMock1.deployed();
    const tokenMock2 = await token2Factory.deploy();
    await tokenMock2.deployed();
    const feeToken = await feeTokenFactory.deploy();
    await feeToken.deployed();

    return {
      tokenMock1,
      tokenMock2,
      feeToken,
    };
  }

  async function deployAllContracts(): Promise<{
    pool: Contract;
    tokenMock1: Contract;
    tokenMock2: Contract;
    feeToken: Contract;
  }> {
    const { tokenMock1, tokenMock2, feeToken } = await deployMocks();
    const pool = await upgrades.deployProxy(swapPoolFactory, [
      feeToken.address,
      [tokenMock1.address, tokenMock2.address],
      [tokenMock1.address, tokenMock2.address],
    ]);
    await pool.deployed();

    return {
      pool,
      tokenMock1,
      tokenMock2,
      feeToken,
    };
  }

  async function createSignature(
    tokenIn: String,
    tokenOut: String,
    fee: Number,
    amountIn: Number,
    amountOut: Number,
    signer: SignerWithAddress
  ) {
    const swapData: (Number | String | SignerWithAddress)[] = [
      tokenIn,
      tokenOut,
      fee,
      amountIn,
      amountOut,
      signer.address,
    ];
    const messageData = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint", "uint", "uint", "address"],
      [
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
      ]
    );
    const messageHash = ethers.utils.keccak256(messageData);
    const binaryMessageHash = ethers.utils.arrayify(messageHash);
    const signature = await signer.signMessage(binaryMessageHash);

    return {
      signature,
      swapData,
    };
  }

  describe("function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { pool, tokenMock1, tokenMock2, feeToken } = await setUpFixture(
        deployAllContracts
      );
      // check that deployer received the OWNER_ROLE
      expect(await pool.hasRole(OWNER_ROLE_HASH, deployer.address)).to.eq(true);
      // check that deployer received the MANAGER_ROLE
      expect(await pool.hasRole(MANAGER_ROLE_HASH, deployer.address)).to.eq(
        true
      );
      // check that fee token address is set correctly
      expect(await pool.feeTokenAddress()).to.eq(feeToken.address);

      // check that buy and sell tokens are configured
      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(true);
    });

    it("Is reverted if called a second time", async () => {
      const { pool, feeToken } = await setUpFixture(deployAllContracts);
      // check that second initialization will be reverted
      await expect(
        pool.initialize(feeToken.address, [], [])
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("functions 'configureBuyToken()' and 'configureSellToken()'", async () => {
    it("Adds new addresses as buying and selling tokens", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      // check that tokens were configured in the initializer
      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(true);

      await pool.configureBuyToken(tokenMock1.address, false);
      await pool.configureBuyToken(tokenMock2.address, false);
      await pool.configureSellToken(tokenMock1.address, false);
      await pool.configureSellToken(tokenMock2.address, false);

      // check that token support status changed
      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(false);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(false);
      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(false);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(false);
    });
  });

  describe("function 'createSwap()'", async () => {
    it("Creates new swap with passed parameters", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      const exchange = await pool.getExchange(0);

      // check that all the values were set correctly
      expect(exchange[0]).to.eq(swapData[0]);
      expect(exchange[1]).to.eq(swapData[1]);
      expect(exchange[2]).to.eq(swapData[2]);
      expect(exchange[3]).to.eq(swapData[3]);
      expect(exchange[4]).to.eq(swapData[4]);
      expect(exchange[5]).to.eq(deployer.address);
      expect(exchange[6]).to.eq(deployer.address);
      expect(exchange[7]).to.eq(PENDING);
    });

    it("Is reverted if swap creation if caller is not a manager", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user
      );

      const attackerWallet = await pool.connect(user);

      await expect(
        attackerWallet.createSwap(
          swapData[0],
          swapData[1],
          swapData[2],
          swapData[3],
          swapData[4],
          swapData[5],
          user.address,
          signature
        )
      ).to.be.reverted;
    });

    it("Is reverted if signer is not verified", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        manager
      );

      await expect(
        pool.createSwap(
          swapData[0],
          swapData[1],
          swapData[2],
          swapData[3],
          swapData[4],
          swapData[5],
          user.address,
          signature
        )
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_UNVERIFIED_SENDER);
    });

    it("Is reverted if signature is allready used", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      await expect(
        pool.createSwap(
          swapData[0],
          swapData[1],
          swapData[2],
          swapData[3],
          swapData[4],
          swapData[5],
          deployer.address,
          signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SINATURE_ALREADY_USED
      );
    });

    it("Is reverted if token is unsupported", async () => {
      const { pool, tokenMock1, tokenMock2, feeToken } = await setUpFixture(
        deployAllContracts
      );
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await expect(
        pool.createSwap(
          feeToken.address,
          swapData[1],
          swapData[2],
          swapData[3],
          swapData[4],
          swapData[5],
          deployer.address,
          signature
        )
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_UNSUPPORTED_TOKEN);
    });
  });

  describe("function 'declineExchange()'", async () => {
    it("Changes status of pending swap to declined", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      await pool.declineExchange(0);
      expect(await pool.getExchangeStatus(0)).to.eq(DECLINED);
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      await expect(pool.connect(user).declineExchange(0)).to.be.reverted;
    });

    it("Is reverted if exchange with given id does not exist", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      await expect(pool.declineExchange(3)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_EXCHANGE_NOT_EXIST
      );
    });

    it("Is reverted if exchange with given id is allready declined", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      await pool.declineExchange(0);
      await expect(pool.declineExchange(0)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_EXCHANGE_DECLINED
      );
    });
  });

  describe("function 'finalizeSwap()'", async () => {
    it("Executes pending swap", async () => {
      const { pool, tokenMock1, tokenMock2, feeToken } = await setUpFixture(
        deployAllContracts
      );
      await feeToken.increaseAllowance(pool.address, ethers.utils.parseEther("1"))
      await tokenMock1.increaseAllowance(pool.address, ethers.utils.parseEther("1"))
      await tokenMock2.increaseAllowance(pool.address, ethers.utils.parseEther("1"))
      await tokenMock2.transfer(pool.address, TEST_AMOUNT_IN);
      const { signature, swapData } = await createSignature(
        tokenMock1.address,
        tokenMock2.address,
        TEST_FEE,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer
      );

      await pool.createSwap(
        swapData[0],
        swapData[1],
        swapData[2],
        swapData[3],
        swapData[4],
        swapData[5],
        deployer.address,
        signature
      );

      await pool.finalizeSwap(0);
      await expect(await tokenMock1.balanceOf(pool.address)).to.eq(
        TEST_AMOUNT_IN
      );
      await expect(await feeToken.balanceOf(pool.address)).to.eq(
        TEST_FEE
      );
    });
  });
});
