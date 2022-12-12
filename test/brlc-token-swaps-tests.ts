import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

interface ISwap {
  tokenIn: Contract;
  tokenOut: Contract;
  amountIn: Number;
  amountOut: Number;
  receiver: SignerWithAddress;
  id: Number;
  signer: SignerWithAddress;
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'SwapPool'", () => {
  const PENDING = 0;
  const EXECUTED = 1;
  const DECLINED = 2;

  const TEST_AMOUNT_IN = 200;
  const TEST_AMOUNT_OUT = 100;

  const ZERO_ADDRESS = ethers.constants.AddressZero;

  let lastId: number = 0;

  // contract events
  const EVENT_NAME_NEW_SWAP = "SwapCreated";
  const EVENT_NAME_SWAP_FINALIZED = "SwapFinalized";
  const EVENT_NAME_SWAP_DECLINED = "SwapDeclined";
  const EVENT_NAME_TOKENS_WITHDRAW = "TokensWithdrawal";
  const EVENT_NAME_BUY_TOKEN_CONFIG = "BuyTokenConfigured";
  const EVENT_NAME_SELL_TOKEN_CONFIG = "SellTokenConfigured";

  // contract custom errors
  const REVERT_ERROR_IF_UNSUPPORTED_TOKEN = "TokenNotSupported";
  const REVERT_ERROR_IF_ZERO_ADDRESS_SUPPORTED_TOKEN =
    "ZeroAddressSupportedToken";
  const REVERT_ERROR_IF_UNVERIFIED_SENDER = "UnverifiedSender";
  const REVERT_ERROR_IF_SWAP_DECLINED = "SwapAlreadyDeclined";
  const REVERT_ERROR_IF_SWAP_EXECUTED = "SwapAlreadyExecuted";
  const REVERT_ERROR_IF_SWAP_NOT_EXIST = "SwapNotExist";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";

  const MANAGER_ROLE_HASH =
    "0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08";
  const OWNER_ROLE_HASH =
    "0xb19546dff01e856fb3f010c267a7b1c60363cf8a4664e21cc89c26224620214e";
  const ADMIN_ROLE_HASH =
    "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";

  let token1Factory: ContractFactory;
  let token2Factory: ContractFactory;
  let swapPoolFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let manager: SignerWithAddress;
  let admin: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, manager, admin, user] = await ethers.getSigners();
    token1Factory = await ethers.getContractFactory("ERC20Mock");
    token2Factory = await ethers.getContractFactory("ERC20Mock2");
    swapPoolFactory = await ethers.getContractFactory("SwapPool");
  });

  async function deployMocks(): Promise<{
    tokenMock1: Contract;
    tokenMock2: Contract;
  }> {
    const tokenMock1 = await token1Factory.deploy();
    await tokenMock1.deployed();
    const tokenMock2 = await token2Factory.deploy();
    await tokenMock2.deployed();
    return {
      tokenMock1,
      tokenMock2,
    };
  }

  async function deployAllContracts(): Promise<{
    pool: Contract;
    tokenMock1: Contract;
    tokenMock2: Contract;
  }> {
    const { tokenMock1, tokenMock2 } = await deployMocks();
    const pool = await upgrades.deployProxy(swapPoolFactory, [
      [tokenMock1.address, tokenMock2.address],
      [tokenMock1.address, tokenMock2.address],
    ]);
    await pool.deployed();

    await tokenMock1.increaseAllowance(
      pool.address,
      ethers.utils.parseEther("1")
    );
    await tokenMock2.increaseAllowance(
      pool.address,
      ethers.utils.parseEther("1")
    );

    return {
      pool,
      tokenMock1,
      tokenMock2,
    };
  }

  async function createSignature(
    tokenIn: Contract,
    tokenOut: Contract,
    amountIn: Number,
    amountOut: Number,
    receiver: SignerWithAddress,
    id: Number,
    signer: SignerWithAddress
  ) {
    const swapData: ISwap = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      amountIn: amountIn,
      amountOut: amountOut,
      receiver: receiver,
      id: id,
      signer: signer,
    };
    const messageData = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint", "uint", "address", "uint"],
      [
        swapData.tokenIn.address,
        swapData.tokenOut.address,
        amountIn,
        amountOut,
        swapData.receiver.address,
        id,
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

  describe("function 'initialize()'", () => {
    it("Configures a contract as expected", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      // check that deployer received the OWNER_ROLE
      expect(await pool.hasRole(OWNER_ROLE_HASH, deployer.address)).to.eq(true);
      // check that deployer received the MANAGER_ROLE
      expect(await pool.hasRole(MANAGER_ROLE_HASH, deployer.address)).to.eq(
        true
      );
      // check that deployer received ADMIN_ROLE
      expect(await pool.hasRole(ADMIN_ROLE_HASH, deployer.address)).to.eq(true);
      // check that buy and sell tokens are configured
      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(true);
    });

    it("Is reverted if contract is initialized", async () => {
      const { pool } = await setUpFixture(deployAllContracts);
      // check that contract will revert second initialization
      await expect(pool.initialize([], [])).to.be.revertedWith(
        REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if zero address passed as a supported token", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      // check that initialization is reverted if zero address in first array
      await expect(
        upgrades.deployProxy(swapPoolFactory, [[ZERO_ADDRESS], []])
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_ADDRESS_SUPPORTED_TOKEN
      );

      // check that initialization is reverted if zero address in second array
      await expect(
        upgrades.deployProxy(swapPoolFactory, [[], [ZERO_ADDRESS]])
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_ADDRESS_SUPPORTED_TOKEN
      );
    });
  });

  describe("functions 'createSwap()' and 'createAndFinalizeSwap()'", () => {
    it("Creates new swap with given parameters", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        deployer.address,
        signature
      );

      const createdSwap = await pool.getSwap(lastId);

      // check all the swap paremeters
      await expect(createdSwap[0]).to.eq(tokenMock1.address);
      await expect(createdSwap[1]).to.eq(tokenMock2.address);
      await expect(createdSwap[2]).to.eq(TEST_AMOUNT_IN);
      await expect(createdSwap[3]).to.eq(TEST_AMOUNT_OUT);
      await expect(createdSwap[4]).to.eq(deployer.address);
      await expect(createdSwap[5]).to.eq(deployer.address);
      await expect(createdSwap[6]).to.eq(PENDING);
    });

    it("Emits a 'SwapCreated()' event", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      expect(
        await pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer.address,
          deployer.address,
          signature
        )
      )
        .to.emit(pool, EVENT_NAME_NEW_SWAP)
        .withArgs(lastId);
    });

    it("Is reverted if signature is corrupted", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      // check that function is reverted if wrong signer is passed
      await expect(
        pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          user.address,
          user.address,
          signature
        )
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_UNVERIFIED_SENDER);
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await expect(
        pool
          .connect(user)
          .createSwap(
            tokenMock1.address,
            tokenMock2.address,
            TEST_AMOUNT_IN,
            TEST_AMOUNT_OUT,
            deployer.address,
            deployer.address,
            signature
          )
      ).to.be.reverted;
    });

    it("Is reverted if token is not supported", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      await pool.configureSellToken(tokenMock2.address, false);

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await expect(
        pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer.address,
          deployer.address,
          signature
        )
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_UNSUPPORTED_TOKEN);

      await pool.configureSellToken(tokenMock2.address, true);
      await pool.configureBuyToken(tokenMock1.address, false);

      await expect(
        pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer.address,
          deployer.address,
          signature
        )
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_UNSUPPORTED_TOKEN);
    });
  });

  describe("function 'finalizeSwap()'", async () => {
    it("Finalizes the selected swap", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await tokenMock2.transfer(pool.address, TEST_AMOUNT_OUT);
      await pool.finalizeSwap(lastId);

      const createdSwap = await pool.getSwap(lastId);
      await expect(createdSwap[6]).to.eq(EXECUTED);
      await expect(await tokenMock1.balanceOf(pool.address)).to.eq(
        TEST_AMOUNT_IN
      );
      await expect(await tokenMock2.balanceOf(user.address)).to.eq(
        TEST_AMOUNT_OUT
      );
    });

    it("Emits a 'SwapFinalized()' event", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        deployer.address,
        signature
      );

      await tokenMock2.transfer(pool.address, TEST_AMOUNT_OUT);
      expect(await pool.finalizeSwap(lastId))
        .to.emit(pool, EVENT_NAME_SWAP_FINALIZED)
        .withArgs(lastId);
    });

    it("Is reverted if swap does not exist", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      await expect(pool.finalizeSwap(lastId + 1)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_NOT_EXIST
      );
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await expect(pool.connect(user).finalizeSwap(lastId)).to.be.reverted;
    });

    it("Is reverted if swap is declined", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await pool.declineSwap(lastId);
      await expect(pool.finalizeSwap(lastId)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_DECLINED
      );
    });

    it("Is reverted if swap is executed", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await tokenMock2.transfer(pool.address, TEST_AMOUNT_OUT);
      await pool.finalizeSwap(lastId);
      await expect(pool.finalizeSwap(lastId)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_EXECUTED
      );
    });

    it("Creates and finalizes swap", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await tokenMock2.transfer(pool.address, TEST_AMOUNT_OUT);

      await pool.createAndFinalizeSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      const createdSwap = await pool.getSwap(lastId);

      expect(createdSwap[6]).to.eq(EXECUTED);
      expect(await tokenMock2.balanceOf(user.address)).to.eq(TEST_AMOUNT_OUT);
    });
  });

  describe("function 'declineSwap()'", () => {
    it("Declines the selected swap", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await pool.declineSwap(lastId);
      const createdSwap = await pool.getSwap(lastId);

      await expect(createdSwap[6]).to.eq(DECLINED);
    });

    it("Emits a 'SwapFinalized()' event", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        deployer.address,
        signature
      );

      expect(await pool.declineSwap(lastId))
        .to.emit(pool, EVENT_NAME_SWAP_DECLINED)
        .withArgs(lastId);
    });

    it("Is reverted if swap does not exist", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      await expect(pool.declineSwap(lastId + 1)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_NOT_EXIST
      );
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await expect(pool.connect(user).declineSwap(lastId)).to.be.reverted;
    });

    it("Is reverted if swap is declined", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await pool.declineSwap(lastId);
      await expect(pool.declineSwap(lastId)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_DECLINED
      );
    });

    it("Is reverted if swap is executed", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        user,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        user.address,
        signature
      );

      await tokenMock2.transfer(pool.address, TEST_AMOUNT_OUT);
      await pool.finalizeSwap(lastId);
      await expect(pool.declineSwap(lastId)).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_SWAP_EXECUTED
      );
    });
  });

  describe("function 'configureBuyToken()'", async () => {
    it("Changes buy token status", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(true);

      await pool.configureBuyToken(tokenMock1.address, false);
      await pool.configureBuyToken(tokenMock2.address, false);

      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(false);
      expect(await pool.getBuyTokenStatus(tokenMock2.address)).to.eq(false);
    });

    it("Emits a 'BuyTokenConfigured()' event", async () => {
      const { pool, tokenMock1 } = await setUpFixture(
        deployAllContracts
      );

      expect(await pool.configureBuyToken(tokenMock1.address, false))
        .to.emit(pool, EVENT_NAME_BUY_TOKEN_CONFIG)
        .withArgs(tokenMock1.address, false);
    });

    it("Is reverted if zero address is passed as an argument", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      await expect(
        pool.configureBuyToken(ZERO_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_ADDRESS_SUPPORTED_TOKEN
      );
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      await expect(
        pool.connect(user).configureBuyToken(tokenMock1.address, false)
      ).to.be.reverted;
    });
  });

  describe("function 'configureSellToken()'", async () => {
    it("Changes sell token status", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(true);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(true);

      await pool.configureSellToken(tokenMock1.address, false);
      await pool.configureSellToken(tokenMock2.address, false);

      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(false);
      expect(await pool.getSellTokenStatus(tokenMock2.address)).to.eq(false);
    });

    it("Emits a 'SellTokenConfigured()' event", async () => {
      const { pool, tokenMock1 } = await setUpFixture(
        deployAllContracts
      );

      expect(await pool.configureBuyToken(tokenMock1.address, false))
        .to.emit(pool, EVENT_NAME_SELL_TOKEN_CONFIG)
        .withArgs(tokenMock1.address, false);
    });

    it("Is reverted if zero address is passed as an argument", async () => {
      const { pool } = await setUpFixture(deployAllContracts);

      await expect(
        pool.configureSellToken(ZERO_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_ADDRESS_SUPPORTED_TOKEN
      );
    });

    it("Is reverted if caller is not a manager", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      await expect(
        pool.connect(user).configureSellToken(tokenMock1.address, false)
      ).to.be.reverted;
    });
  });

  describe("function 'withdrawTokens()'", async () => {
    it("Withdraws tokens and sends them to the selected address", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      await tokenMock1.transfer(pool.address, TEST_AMOUNT_IN);
      await pool.withdrawTokens(
        tokenMock1.address,
        TEST_AMOUNT_IN,
        user.address
      );

      expect(await tokenMock1.balanceOf(user.address)).to.eq(TEST_AMOUNT_IN);
    });

    it("Emits a 'TokensWithdrawal()' event", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      await tokenMock1.transfer(pool.address, TEST_AMOUNT_IN);
      expect(
        await pool.withdrawTokens(
          tokenMock1.address,
          TEST_AMOUNT_IN,
          user.address
        )
      )
        .to.emit(pool, EVENT_NAME_TOKENS_WITHDRAW)
        .withArgs(user.address, tokenMock1.address, TEST_AMOUNT_IN);
    });

    it("Is reverted if caller is not an admin", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      await tokenMock1.transfer(pool.address, TEST_AMOUNT_IN);
      expect(
        pool
          .connect(user)
          .withdrawTokens(tokenMock1.address, TEST_AMOUNT_IN, user.address)
      ).to.be.reverted;
    });
  });

  describe("View functions", async () => {
    it("function 'getSwap()'", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );

      const { signature } = await createSignature(
        tokenMock1,
        tokenMock2,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer,
        lastId,
        deployer
      );

      await pool.createSwap(
        tokenMock1.address,
        tokenMock2.address,
        TEST_AMOUNT_IN,
        TEST_AMOUNT_OUT,
        deployer.address,
        deployer.address,
        signature
      );

      const createdSwap = await pool.getSwap(lastId);

      // check all the swap paremeters
      await expect(createdSwap[0]).to.eq(tokenMock1.address);
      await expect(createdSwap[1]).to.eq(tokenMock2.address);
      await expect(createdSwap[2]).to.eq(TEST_AMOUNT_IN);
      await expect(createdSwap[3]).to.eq(TEST_AMOUNT_OUT);
      await expect(createdSwap[4]).to.eq(deployer.address);
      await expect(createdSwap[5]).to.eq(deployer.address);
      await expect(createdSwap[6]).to.eq(PENDING);
    });

    it("function 'getSwaps()'", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      for (let i = 0; i < 10; i++) {
        const { signature } = await createSignature(
          tokenMock1,
          tokenMock2,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer,
          lastId,
          deployer
        );
        lastId++;
        await pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer.address,
          deployer.address,
          signature
        );
      }
      lastId = 0;

      let swaps = await pool.getSwaps(5, 2);
      let selectedSwap = swaps[1];

      await expect(selectedSwap[0]).to.eq(tokenMock1.address);
      await expect(selectedSwap[1]).to.eq(tokenMock2.address);
      await expect(selectedSwap[2]).to.eq(TEST_AMOUNT_IN);
      await expect(selectedSwap[3]).to.eq(TEST_AMOUNT_OUT);
      await expect(selectedSwap[4]).to.eq(deployer.address);
      await expect(selectedSwap[5]).to.eq(deployer.address);
      await expect(selectedSwap[6]).to.eq(PENDING);

      swaps = await pool.getSwaps(6, 0);
      expect(swaps.length == 0);

      swaps = await pool.getSwaps(1, 16);
      selectedSwap = swaps[1];

      await expect(selectedSwap[0]).to.eq(tokenMock1.address);
      await expect(selectedSwap[1]).to.eq(tokenMock2.address);
      await expect(selectedSwap[2]).to.eq(TEST_AMOUNT_IN);
      await expect(selectedSwap[3]).to.eq(TEST_AMOUNT_OUT);
      await expect(selectedSwap[4]).to.eq(deployer.address);
      await expect(selectedSwap[5]).to.eq(deployer.address);
      await expect(selectedSwap[6]).to.eq(PENDING);
    });

    it("function 'swapsCount()'", async () => {
      const { pool, tokenMock1, tokenMock2 } = await setUpFixture(
        deployAllContracts
      );
      for (let i = 0; i < 10; i++) {
        const { signature } = await createSignature(
          tokenMock1,
          tokenMock2,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer,
          lastId,
          deployer
        );
        lastId++;
        await pool.createSwap(
          tokenMock1.address,
          tokenMock2.address,
          TEST_AMOUNT_IN,
          TEST_AMOUNT_OUT,
          deployer.address,
          deployer.address,
          signature
        );
      }
      lastId = 0;

      expect(await pool.swapsCount()).to.eq(10);
    });

    it("function 'getBuyTokenStatus()'", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      expect(await pool.getBuyTokenStatus(tokenMock1.address)).to.eq(true);
    });

    it("function 'getSellTokenStatus()'", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAllContracts);

      expect(await pool.getSellTokenStatus(tokenMock1.address)).to.eq(true);
    });
  });
});
