// Го деплојува FrostShield и ги запишува адресата и ABI-то за backend-от и frontend-от.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer, defaultOracle] = await hre.ethers.getSigners();
  const oracle = process.env.ORACLE_ADDRESS || (defaultOracle ? defaultOracle.address : deployer.address);

  console.log(`Мрежа: ${hre.network.name}`);
  console.log(`Деплојер: ${deployer.address}`);
  console.log(`Оракул:   ${oracle}`);

  const Factory = await hre.ethers.getContractFactory("FrostShield");
  const contract = await Factory.deploy(oracle);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`FrostShield: ${address}`);

  // Почетен базен за демо (само на локална мрежа)
  const seed = process.env.SEED_POOL_ETH || (hre.network.name === "localhost" || hre.network.name === "hardhat" ? "50" : "0");
  if (Number(seed) > 0) {
    const tx = await contract.fundPool({ value: hre.ethers.parseEther(seed) });
    await tx.wait();
    console.log(`Базенот е наполнет со ${seed} ETH`);
  }
  // Период на чекање во часови (стандардно 72). За демо на testnet: WAITING_PERIOD_HOURS=0
  if (process.env.WAITING_PERIOD_HOURS !== undefined) {
    const secs = Number(process.env.WAITING_PERIOD_HOURS) * 3600;
    await (await contract.setWaitingPeriod(secs)).wait();
    console.log(`Период на чекање: ${process.env.WAITING_PERIOD_HOURS} часа`);
  }
  const { chainId } = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("FrostShield");
  const out = {
    network: hre.network.name,
    chainId: Number(chainId),
    address,
    deployBlock: await hre.ethers.provider.getBlockNumber(),
    abi: artifact.abi,
  };

  const targets = [
    path.join(__dirname, "..", "..", "backend", "contract.json"),
    path.join(__dirname, "..", "..", "frontend", "src", "contract.json"),
  ];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Запишано: ${path.relative(process.cwd(), t)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
