require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Ако нема интернет пристап до binaries.soliditylang.org, постави SOLC_OFFLINE=1
// и Hardhat ќе го користи локалниот solcjs од npm пакетот "solc".
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (process.env.SOLC_OFFLINE === "1" && args.solcVersion === "0.8.24") {
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: require("solc").version(),
    };
  }
  return runSuper();
});

const { AMOY_RPC_URL, FUJI_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(AMOY_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { amoy: { url: AMOY_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 80002 } }
      : {}),
    ...(DEPLOYER_PRIVATE_KEY
      ? {
          fuji: {
            url: FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
            accounts: [DEPLOYER_PRIVATE_KEY],
            chainId: 43113,
          },
        }
      : {}),
  },
};