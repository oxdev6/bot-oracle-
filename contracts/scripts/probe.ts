import { ethers } from "hardhat";

async function main() {
  const b0 = (await ethers.provider.getBlock("latest"))!.timestamp;
  console.log("before:", b0);
  await ethers.provider.send("evm_increaseTime", [180]);
  await ethers.provider.send("evm_mine", []);
  const b1 = (await ethers.provider.getBlock("latest"))!.timestamp;
  console.log("after +180:", b1, "delta:", b1 - b0);
  await ethers.provider.send("evm_increaseTime", [3600]);
  await ethers.provider.send("evm_mine", []);
  const b2 = (await ethers.provider.getBlock("latest"))!.timestamp;
  console.log("after +3600:", b2, "delta:", b2 - b1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });

export {};