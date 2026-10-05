import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import dotenv from "dotenv";

dotenv.config({ path: __dirname + "/.env" });

const PRIVATE_KEY = process.env.DEPLOY_KEY ?? process.env.PRIVATE_KEY ?? "";
const RPC_TESTNET = process.env.BOT_TESTNET_RPC ?? "https://rpc.bohr.life";
const RPC_MAINNET = process.env.BOT_MAINNET_RPC ?? "https://rpc.botchain.ai";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  // viaIR + optimizer makes the first contract deployment of a cold run slow
  // enough to blow mocha's default budget; the whole suite still runs in
  // ~1 min on a warm cache.
  mocha: {
    timeout: 180_000,
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // `npx hardhat node` + `--network localhost`, so the demo can run against
    // a persistent chain the dashboard can then read.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    botTestnet: {
      url: RPC_TESTNET,
      chainId: 968,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    botMainnet: {
      url: RPC_MAINNET,
      chainId: 677,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    customChains: [
      {
        network: "botTestnet",
        chainId: 968,
        urls: {
          apiURL: "https://scan.bohr.life/api",
          browserURL: "https://scan.bohr.life",
        },
      },
      {
        network: "botMainnet",
        chainId: 677,
        urls: {
          apiURL: "https://scan.botchain.ai/api",
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;