const { ethers, upgrades } = require("hardhat");

async function main() {
  const SwapPool = await ethers.getContractFactory("SwapPool");
  const swapPool = await upgrades.deployProxy(SwapPool);
  await swapPool.deployed();
  console.log("SwapPool deployed to:", swapPool.address);
}

main();
