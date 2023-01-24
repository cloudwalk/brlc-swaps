import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";
import { createRevertMessageDueToMissingRole } from "../test-utils/misc";
import { TransactionResponse } from "@ethersproject/abstract-provider";

enum SwapStatus {
  Nonexistent = 0,
  Pending = 1,
  Finalized = 2,
  Declined = 3,
}

interface ISwap {
  tokenIn: Contract;
  tokenOut: Contract;
  amountIn: number;
  amountOut: number;
  sender: SignerWithAddress;
  receiver: SignerWithAddress;
  id: number;
  signature: string;
  status: SwapStatus;
}

function makeMessageAboutSwapWrongField(fieldName: string, swapIndex?: number): string {
  if (!swapIndex) {
    return `swap.${fieldName} is wrong`;
  } else {
    return `swap[${fieldName}].${fieldName} is wrong`;
  }
}

function checkEquality(
  actualOnChainSwap: any,
  expectedSwap: ISwap,
  index?: number
) {
  expect(actualOnChainSwap.tokenIn).to.eq(
    expectedSwap.tokenIn.address,
    makeMessageAboutSwapWrongField("tokenIn", index)
  );
  expect(actualOnChainSwap.tokenOut).to.eq(
    expectedSwap.tokenOut.address,
    makeMessageAboutSwapWrongField("tokenOut", index)
  );
  expect(actualOnChainSwap.amountIn).to.eq(
    expectedSwap.amountIn,
    makeMessageAboutSwapWrongField("amountIn", index)
  );
  expect(actualOnChainSwap.amountOut).to.eq(
    expectedSwap.amountOut,
    makeMessageAboutSwapWrongField("amountOut", index)
  );
  expect(actualOnChainSwap.sender).to.eq(
    expectedSwap.sender.address,
    makeMessageAboutSwapWrongField("sender", index)
  );
  expect(actualOnChainSwap.receiver).to.eq(
    expectedSwap.receiver.address,
    makeMessageAboutSwapWrongField("receiver", index)
  );
  expect(actualOnChainSwap.status).to.eq(
    expectedSwap.status,
    makeMessageAboutSwapWrongField("status", index)
  );
}

function checkArrayEquality(
  actualOnChainSwaps: any[],
  expectedSwaps: ISwap[],
) {
  expect(actualOnChainSwaps.length).to.eq(
    expectedSwaps.length,
    "the swap arrays have different length"
  );
  for (let i = 0; i < expectedSwaps.length; i++) {
    checkEquality(actualOnChainSwaps[i], expectedSwaps[i], i);
  }
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'SwapPool'", async () => {
  const TOKEN_AMOUNT_IN = 200;
  const TOKEN_AMOUNT_OUT = 100;
  const ZERO_ADDRESS = ethers.constants.AddressZero;
  const FAKE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001";

  // Contract events
  const EVENT_NAME_SWAP_CREATED = "SwapCreated";
  const EVENT_NAME_SWAP_FINALIZED = "SwapFinalized";
  const EVENT_NAME_SWAP_DECLINED = "SwapDeclined";
  const EVENT_NAME_TOKENS_WITHDRAW = "TokensWithdrawal";
  const EVENT_NAME_TOKEN_IN_CONFIGURED = "TokenInConfigured";
  const EVENT_NAME_TOKEN_OUT_CONFIGURED = "TokenOutConfigured";

  // Contract error messages
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";

  // Contract custom errors
  const REVERT_ERROR_IF_TOKEN_NOT_SUPPORTED = "TokenNotSupported";
  const REVERT_ERROR_IF_ZERO_TOKEN_ADDRESS = "ZeroTokenAddress";
  const REVERT_ERROR_IF_WRONG_SWAP_SIGNATURE = "WrongSwapSignature";
  const REVERT_ERROR_IF_SWAP_ALREADY_DECLINED = "SwapAlreadyDeclined";
  const REVERT_ERROR_IF_SWAP_ALREADY_FINALIZED = "SwapAlreadyFinalized";
  const REVERT_ERROR_IF_SWAP_NOT_EXIST = "SwapNotExist";
  const REVERT_ERROR_IF_TOKEN_ALREADY_CONFIGURED = "TokenAlreadyConfigured";
  const REVERT_ERROR_IF_BLACKLISTED_ACCOUNT = "BlacklistedAccount";

  // Role hashes
  const ADMIN_ROLE_HASH = ethers.utils.id("ADMIN_ROLE");
  const BLACKLISTER_ROLE_HASH = ethers.utils.id("BLACKLISTER_ROLE");
  const MANAGER_ROLE_HASH = ethers.utils.id("MANAGER_ROLE");
  const OWNER_ROLE_HASH = ethers.utils.id("OWNER_ROLE");
  const PAUSER_ROLE_HASH = ethers.utils.id("PAUSER_ROLE");
  const RESCUER_ROLE_HASH = ethers.utils.id("RESCUER_ROLE");

  let tokenMockFactory: ContractFactory;
  let swapPoolFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let manager: SignerWithAddress;
  let admin: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, manager, admin, user] = await ethers.getSigners();
    tokenMockFactory = await ethers.getContractFactory("ERC20Mock");
    swapPoolFactory = await ethers.getContractFactory("SwapPool");
  });

  async function createSignature(swap: ISwap): Promise<string> {
    const messageData = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint", "uint", "address", "uint"],
      [
        swap.tokenIn.address,
        swap.tokenOut.address,
        swap.amountIn,
        swap.amountOut,
        swap.receiver.address,
        swap.id,
      ]
    );
    const messageHash = ethers.utils.keccak256(messageData);
    const binaryMessageHash = ethers.utils.arrayify(messageHash);
    return swap.sender.signMessage(binaryMessageHash);
  }

  async function createSwap(pool: Contract, swap: ISwap) {
    await proveTx(
      pool.connect(manager).createSwap(
        swap.tokenIn.address,
        swap.tokenOut.address,
        swap.amountIn,
        swap.amountOut,
        swap.sender.address,
        swap.receiver.address,
        swap.signature
      )
    );

    swap.status = SwapStatus.Pending;
  }

  async function deployTokenMocks(): Promise<{
    tokenMock1: Contract;
    tokenMock2: Contract;
  }> {
    const tokenMock1 = await tokenMockFactory.deploy("ERC20Mock", "MOCK1");
    await tokenMock1.deployed();
    const tokenMock2 = await tokenMockFactory.deploy("ERC20Mock", "MOCK2");
    await tokenMock2.deployed();
    return {
      tokenMock1,
      tokenMock2,
    };
  }

  async function deployPool(): Promise<{ pool: Contract }> {
    const pool = await upgrades.deployProxy(swapPoolFactory, []);
    await pool.deployed();

    return { pool };
  }

  async function deployAndConfigurePool(): Promise<{ pool: Contract }> {
    const { pool } = await deployPool();

    await pool.grantRole(ADMIN_ROLE_HASH, admin.address);
    await pool.grantRole(BLACKLISTER_ROLE_HASH, deployer.address);
    await pool.grantRole(MANAGER_ROLE_HASH, manager.address);
    await pool.grantRole(PAUSER_ROLE_HASH, deployer.address);

    return { pool };
  }

  async function deployAndConfigureAllContracts(): Promise<{
    pool: Contract;
    tokenMock1: Contract;
    tokenMock2: Contract;
    defaultSwap: ISwap;
  }> {
    const { pool } = await deployAndConfigurePool();
    const { tokenMock1, tokenMock2 } = await deployTokenMocks();

    await proveTx(tokenMock1.approve(pool.address, ethers.constants.MaxUint256));
    await proveTx(tokenMock2.approve(pool.address, ethers.constants.MaxUint256));

    await proveTx(tokenMock1.mint(deployer.address, ethers.constants.MaxUint256.div(BigNumber.from(2))));
    await proveTx(tokenMock2.mint(pool.address, ethers.constants.MaxUint256.div(BigNumber.from(2))));

    await proveTx(pool.connect(admin).configureTokenIn(tokenMock1.address, true));
    await proveTx(pool.connect(admin).configureTokenOut(tokenMock2.address, true));

    const defaultSwap: ISwap = {
      tokenIn: tokenMock1,
      tokenOut: tokenMock2,
      amountIn: TOKEN_AMOUNT_IN,
      amountOut: TOKEN_AMOUNT_OUT,
      sender: deployer,
      receiver: user,
      id: 0,
      signature: "",
      status: SwapStatus.Nonexistent
    };

    defaultSwap.signature = await createSignature(defaultSwap);

    return {
      pool,
      tokenMock1,
      tokenMock2,
      defaultSwap,
    };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { pool } = await setUpFixture(deployPool);

      // Rolse
      expect(await pool.OWNER_ROLE()).to.eq(OWNER_ROLE_HASH);
      expect(await pool.ADMIN_ROLE()).to.eq(ADMIN_ROLE_HASH);
      expect(await pool.BLACKLISTER_ROLE()).to.eq(BLACKLISTER_ROLE_HASH);
      expect(await pool.MANAGER_ROLE()).to.eq(MANAGER_ROLE_HASH);
      expect(await pool.PAUSER_ROLE()).to.eq(PAUSER_ROLE_HASH);
      expect(await pool.RESCUER_ROLE()).to.eq(RESCUER_ROLE_HASH);

      // The admins of roles
      expect(await pool.getRoleAdmin(OWNER_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);
      expect(await pool.getRoleAdmin(ADMIN_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);
      expect(await pool.getRoleAdmin(BLACKLISTER_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);
      expect(await pool.getRoleAdmin(MANAGER_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);
      expect(await pool.getRoleAdmin(PAUSER_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);
      expect(await pool.getRoleAdmin(RESCUER_ROLE_HASH)).to.eq(OWNER_ROLE_HASH);

      // The deployer roles
      expect(await pool.hasRole(OWNER_ROLE_HASH, deployer.address)).to.eq(true);
      expect(await pool.hasRole(ADMIN_ROLE_HASH, deployer.address)).to.eq(false);
      expect(await pool.hasRole(BLACKLISTER_ROLE_HASH, deployer.address)).to.eq(false);
      expect(await pool.hasRole(MANAGER_ROLE_HASH, deployer.address)).to.eq(false);
      expect(await pool.hasRole(PAUSER_ROLE_HASH, deployer.address)).to.eq(false);
      expect(await pool.hasRole(RESCUER_ROLE_HASH, deployer.address)).to.eq(false);

      // The initial contract state is unpaused
      expect(await pool.paused()).to.eq(false);

      // The initial values
      expect(await pool.swapsCount()).to.eq(0);
    });

    it("Is reverted if it is called a second time", async () => {
      const { pool } = await setUpFixture(deployPool);
      await expect(pool.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const brlcTokenImplementation: Contract = await swapPoolFactory.deploy();
      await brlcTokenImplementation.deployed();

      await expect(
        brlcTokenImplementation.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'configureTokenIn()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      let tokenSupportingState = true;
      expect(await pool.isTokenInSupported(FAKE_TOKEN_ADDRESS)).to.eq(false);

      await expect(
        pool.connect(admin).configureTokenIn(FAKE_TOKEN_ADDRESS, tokenSupportingState)
      ).to.emit(
        pool,
        EVENT_NAME_TOKEN_IN_CONFIGURED
      ).withArgs(FAKE_TOKEN_ADDRESS, tokenSupportingState);
      expect(await pool.isTokenInSupported(FAKE_TOKEN_ADDRESS)).to.eq(tokenSupportingState);

      tokenSupportingState = false;

      await expect(
        pool.connect(admin).configureTokenIn(FAKE_TOKEN_ADDRESS, tokenSupportingState)
      ).to.emit(
        pool,
        EVENT_NAME_TOKEN_IN_CONFIGURED
      ).withArgs(FAKE_TOKEN_ADDRESS, tokenSupportingState);
      expect(await pool.isTokenInSupported(FAKE_TOKEN_ADDRESS)).to.eq(tokenSupportingState);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await expect(
        pool.configureTokenIn(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, ADMIN_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await proveTx(pool.pause());

      await expect(
        pool.connect(admin).configureTokenIn(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the passed token address is zero", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await expect(
        pool.connect(admin).configureTokenIn(ZERO_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_TOKEN_ADDRESS
      );
    });

    it("Is reverted if the token is already configured", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await proveTx(pool.connect(admin).configureTokenIn(FAKE_TOKEN_ADDRESS, true));

      await expect(
        pool.connect(admin).configureTokenIn(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_TOKEN_ALREADY_CONFIGURED
      );
    });
  });

  describe("Function 'configureTokenOut()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);

      let tokenSupportingState = true;
      expect(await pool.isTokenOutSupported(FAKE_TOKEN_ADDRESS)).to.eq(false);

      await expect(
        pool.connect(admin).configureTokenOut(FAKE_TOKEN_ADDRESS, tokenSupportingState)
      ).to.emit(
        pool,
        EVENT_NAME_TOKEN_OUT_CONFIGURED
      ).withArgs(FAKE_TOKEN_ADDRESS, tokenSupportingState);
      expect(await pool.isTokenOutSupported(FAKE_TOKEN_ADDRESS)).to.eq(tokenSupportingState);

      tokenSupportingState = false;

      await expect(
        pool.connect(admin).configureTokenOut(FAKE_TOKEN_ADDRESS, tokenSupportingState)
      ).to.emit(
        pool,
        EVENT_NAME_TOKEN_OUT_CONFIGURED
      ).withArgs(FAKE_TOKEN_ADDRESS, tokenSupportingState);
      expect(await pool.isTokenOutSupported(FAKE_TOKEN_ADDRESS)).to.eq(tokenSupportingState);
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await expect(
        pool.configureTokenOut(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, ADMIN_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await proveTx(pool.pause());

      await expect(
        pool.connect(admin).configureTokenOut(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the passed token address is zero", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await expect(
        pool.connect(admin).configureTokenOut(ZERO_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_ZERO_TOKEN_ADDRESS
      );
    });

    it("Is reverted if the token is already configured", async () => {
      const { pool } = await setUpFixture(deployAndConfigurePool);
      await proveTx(pool.connect(admin).configureTokenOut(FAKE_TOKEN_ADDRESS, true));

      await expect(
        pool.connect(admin).configureTokenOut(FAKE_TOKEN_ADDRESS, true)
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_TOKEN_ALREADY_CONFIGURED
      );
    });
  });

  describe("Function 'withdrawTokens()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(tokenMock1.mint(pool.address, TOKEN_AMOUNT_IN));

      await expect(
        pool.connect(admin).withdrawTokens(
          tokenMock1.address,
          TOKEN_AMOUNT_IN,
          user.address
        )
      ).to.changeTokenBalances(
        tokenMock1,
        [pool, user, admin],
        [-TOKEN_AMOUNT_IN, +TOKEN_AMOUNT_IN, 0]
      ).to.emit(
        pool,
        EVENT_NAME_TOKENS_WITHDRAW
      ).withArgs(
        user.address,
        tokenMock1.address,
        TOKEN_AMOUNT_IN
      );
    });

    it("Is reverted if the caller is not an admin", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.withdrawTokens(
          tokenMock1.address,
          TOKEN_AMOUNT_IN,
          user.address
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, ADMIN_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool, tokenMock1 } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.pause());

      await expect(
        pool.connect(admin).withdrawTokens(
          tokenMock1.address,
          TOKEN_AMOUNT_IN,
          user.address
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'createSwap()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.changeTokenBalances(
        swap.tokenIn,
        [swap.sender, pool, swap.receiver],
        [-swap.amountIn, +swap.amountIn, 0]
      ).to.emit(
        pool,
        EVENT_NAME_SWAP_CREATED
      ).withArgs(swap.id);

      swap.status = SwapStatus.Pending;
      const actualSwap = await pool.getSwap(swap.id);
      checkEquality(actualSwap, swap);
    });

    it("Is reverted if the caller is not a manager", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, MANAGER_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.pause());

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the swap sender is blacklisted", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.blacklist(swap.sender.address));

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_BLACKLISTED_ACCOUNT
      ).withArgs(swap.sender.address);
    });

    it("Is reverted if the swap receiver is blacklisted", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.blacklist(swap.receiver.address));

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_BLACKLISTED_ACCOUNT
      ).withArgs(swap.receiver.address);
    });

    it("Is reverted if the signature is wrong", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      swap.signature = "0x";

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_WRONG_SWAP_SIGNATURE
      );
    });

    it("Is reverted if the input token is unsupported", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      swap.tokenIn = tokenMockFactory.attach(FAKE_TOKEN_ADDRESS);
      swap.signature = await createSignature(swap);

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_TOKEN_NOT_SUPPORTED
      );
    });

    it("Is reverted if the output token is unsupported", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      swap.tokenOut = tokenMockFactory.attach(FAKE_TOKEN_ADDRESS);
      swap.signature = await createSignature(swap);

      await expect(
        pool.connect(manager).createSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_TOKEN_NOT_SUPPORTED
      );
    });
  });

  describe("Function 'finalizeSwap()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);

      await expect(
        pool.connect(manager).finalizeSwap(swap.id)
      ).to.changeTokenBalances(
        swap.tokenOut,
        [pool, swap.receiver, swap.sender],
        [-swap.amountOut, +swap.amountOut, 0]
      ).to.emit(
        pool,
        EVENT_NAME_SWAP_FINALIZED
      ).withArgs(swap.id);
      swap.status = SwapStatus.Finalized;

      const actualSwap = await pool.getSwap(swap.id);
      checkEquality(actualSwap, swap);
    });

    it("Is reverted if the caller is not a manager", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.finalizeSwap(swap.id)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, MANAGER_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.pause());

      await expect(
        pool.connect(manager).finalizeSwap(swap.id)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the swap with the provided id does not exist", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.connect(manager).finalizeSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_NOT_EXIST);
    });

    it("Is reverted if the swap with the provided id is declined", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);
      await proveTx(pool.connect(manager).declineSwap(swap.id));

      await expect(
        pool.connect(manager).finalizeSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_ALREADY_DECLINED);
    });

    it("Is reverted if the swap with the provided id is already finalized", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);
      await proveTx(pool.connect(manager).finalizeSwap(swap.id));

      await expect(
        pool.connect(manager).finalizeSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_ALREADY_FINALIZED);
    });
  });

  describe("Function 'createAndFinalizeSwap()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure

      const tx: TransactionResponse = await pool.connect(manager).createAndFinalizeSwap(
        swap.tokenIn.address,
        swap.tokenOut.address,
        swap.amountIn,
        swap.amountOut,
        swap.sender.address,
        swap.receiver.address,
        swap.signature
      );

      await expect(tx).to.changeTokenBalances(
        swap.tokenIn,
        [swap.sender, pool, swap.receiver],
        [-swap.amountIn, +swap.amountIn, 0]
      );
      await expect(tx).to.changeTokenBalances(
        swap.tokenOut,
        [pool, swap.receiver, swap.sender],
        [-swap.amountOut, +swap.amountOut, 0]
      );
      await expect(tx).to.emit(
        pool,
        EVENT_NAME_SWAP_CREATED
      ).withArgs(swap.id);
      await expect(tx).to.emit(
        pool,
        EVENT_NAME_SWAP_FINALIZED
      ).withArgs(swap.id);

      swap.status = SwapStatus.Finalized;
      const actualSwap = await pool.getSwap(swap.id);
      checkEquality(actualSwap, swap);
    });

    it("Is reverted if the caller is not a manager", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.createAndFinalizeSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, MANAGER_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.pause());

      await expect(
        pool.connect(manager).createAndFinalizeSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the swap sender is blacklisted", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.blacklist(swap.sender.address));

      await expect(
        pool.connect(manager).createAndFinalizeSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_BLACKLISTED_ACCOUNT
      ).withArgs(swap.sender.address);
    });

    it("Is reverted if the swap receiver is blacklisted", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.blacklist(swap.receiver.address));

      await expect(
        pool.connect(manager).createAndFinalizeSwap(
          swap.tokenIn.address,
          swap.tokenOut.address,
          swap.amountIn,
          swap.amountOut,
          swap.sender.address,
          swap.receiver.address,
          swap.signature
        )
      ).to.be.revertedWithCustomError(
        pool,
        REVERT_ERROR_IF_BLACKLISTED_ACCOUNT
      ).withArgs(swap.receiver.address);
    });
  });

  describe("Function 'declineSwap()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);

      await expect(
        pool.connect(manager).declineSwap(swap.id)
      ).to.changeTokenBalances(
        swap.tokenIn,
        [pool, swap.sender, swap.receiver],
        [-swap.amountIn, +swap.amountIn, 0]
      ).to.emit(
        pool,
        EVENT_NAME_SWAP_DECLINED
      ).withArgs(swap.id);
      swap.status = SwapStatus.Declined;

      const actualSwap = await pool.getSwap(swap.id);
      checkEquality(actualSwap, swap);
    });

    it("Is reverted if the caller is not a manager", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.declineSwap(swap.id)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, MANAGER_ROLE_HASH));
    });

    it("Is reverted if the contract is paused", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await proveTx(pool.pause());

      await expect(
        pool.connect(manager).declineSwap(swap.id)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the swap with the provided id does not exist", async () => {
      const { pool, defaultSwap: swap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.connect(manager).declineSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_NOT_EXIST);
    });

    it("Is reverted if the swap with the provided id is already declined", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);
      await proveTx(pool.connect(manager).declineSwap(swap.id));

      await expect(
        pool.connect(manager).declineSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_ALREADY_DECLINED);
    });

    it("Is reverted if the swap with the provided id is finalized", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const swap: ISwap = { ...defaultSwap }; // It is needed because we will change a field of the structure
      await createSwap(pool, swap);
      await proveTx(pool.connect(manager).finalizeSwap(swap.id));

      await expect(
        pool.connect(manager).declineSwap(swap.id)
      ).to.be.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_ALREADY_FINALIZED);
    });
  });

  describe("Function 'getSwap()'", async () => {
    it("Is reverted if a swap with the provided id does not exist", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        pool.getSwap(defaultSwap.id)
      ).to.revertedWithCustomError(pool, REVERT_ERROR_IF_SWAP_NOT_EXIST);
    });
  });

  describe("Function 'getSwaps()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { pool, defaultSwap } = await setUpFixture(deployAndConfigureAllContracts);
      const expectedSwaps: ISwap[] = [0, 1, 2].map((id: number) => {
        const swap: ISwap = { ...defaultSwap };
        swap.id = id;
        swap.amountIn += id * 10;
        swap.amountOut += id * 10;
        return swap;
      });
      for (let swap of expectedSwaps) {
        swap.signature = await createSignature(swap);
        await createSwap(pool, swap);
      }

      let actualSwaps: any[];

      actualSwaps = await pool.getSwaps(0, 50);
      checkArrayEquality(actualSwaps, expectedSwaps);

      actualSwaps = await pool.getSwaps(0, 2);
      checkArrayEquality(actualSwaps, [expectedSwaps[0], expectedSwaps[1]]);

      actualSwaps = await pool.getSwaps(1, 2);
      checkArrayEquality(actualSwaps, [expectedSwaps[1], expectedSwaps[2]]);

      actualSwaps = await pool.getSwaps(1, 1);
      checkArrayEquality(actualSwaps, [expectedSwaps[1]]);

      actualSwaps = await pool.getSwaps(1, 50);
      checkArrayEquality(actualSwaps, [expectedSwaps[1], expectedSwaps[2]]);

      actualSwaps = await pool.getSwaps(3, 50);
      checkArrayEquality(actualSwaps, []);

      actualSwaps = await pool.getSwaps(1, 0);
      checkArrayEquality(actualSwaps, []);
    });
  });
});
