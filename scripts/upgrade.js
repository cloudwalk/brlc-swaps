const { ethers, upgrades } = require("hardhat");

async function main() {
  const PROXY_ADDRESS = "";
  const SwapPool = await ethers.getContractFactory("SwapPool");
  const swapPool = await upgrades.upgradeProxy(BOX_ADDRESS, SwapPool);
  console.log("SwapPool upgraded");
}

main();
