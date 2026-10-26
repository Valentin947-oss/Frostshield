import { BrowserProvider, Contract, JsonRpcProvider, formatEther } from "ethers";
import deployment from "../contract.json";

export const REGIONS = ["Струмица", "Гевгелија", "Валандово", "Богданци"];
// Редоследот мора да одговара на договорот (CROP_COUNT = 4).
export const CROPS = ["Домат", "Пипер", "Краставица", "Марула"];
export const PROD_TYPES = ["Отворено", "Мал пластеник", "Пластеник"];

export const CHAIN_ID = deployment.chainId;
export const CONTRACT_ADDRESS = deployment.address;

// RPC се избира според мрежата од contract.json; VITE_RPC_URL во .env има предност ако е поставен.
const DEFAULT_RPC = {
  31337: "http://127.0.0.1:8545",
  43113: "https://api.avax-test.network/ext/bc/C/rpc",
  80002: "https://rpc-amoy.polygon.technology",
};
export const RPC_URL = import.meta.env.VITE_RPC_URL || DEFAULT_RPC[CHAIN_ID] || "http://127.0.0.1:8545";
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const NETWORKS = {
  31337: { name: "Hardhat (локално)", symbol: "ETH", explorer: null },
  80002: { name: "Polygon Amoy", symbol: "POL", explorer: "https://amoy.polygonscan.com" },
  43113: { name: "Avalanche Fuji", symbol: "AVAX", explorer: "https://testnet.snowtrace.io" },
};
export const NETWORK = NETWORKS[CHAIN_ID] || { name: `Chain ${CHAIN_ID}`, symbol: "ETH", explorer: null };

// Читање: директно од синџирот, без паричник и без backend.
export const readProvider = new JsonRpcProvider(RPC_URL, undefined, {
  cacheTimeout: -1,
  batchMaxCount: 1,
  polling: true,
  pollingInterval: 4000,
});
export const readContract = new Contract(CONTRACT_ADDRESS, deployment.abi, readProvider);

export function txLink(hash) {
  return NETWORK.explorer ? `${NETWORK.explorer}/tx/${hash}` : null;
}

export function addressLink(addr) {
  return NETWORK.explorer ? `${NETWORK.explorer}/address/${addr}` : null;
}

/** Поврзување со MetaMask и префрлање на точната мрежа. */
export async function connectWallet() {
  if (!window.ethereum) throw new Error("Не е пронајден паричник. Инсталирај MetaMask.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const hexId = "0x" + CHAIN_ID.toString(16);
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(current, 16) !== CHAIN_ID) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (err) {
      if (err.code !== 4902) throw err;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: NETWORK.name,
          nativeCurrency: { name: NETWORK.symbol, symbol: NETWORK.symbol, decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: NETWORK.explorer ? [NETWORK.explorer] : undefined,
        }],
      });
    }
  }
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return { signer, address: await signer.getAddress(), contract: new Contract(CONTRACT_ADDRESS, deployment.abi, signer) };
}

// ---------- Форматирање ----------

export const fmtToken = (wei, digits = 4) =>
  `${Number(formatEther(wei)).toLocaleString("mk-MK", { maximumFractionDigits: digits })} ${NETWORK.symbol}`;

export const fmtTemp = (tenths) =>
  `${(Number(tenths) / 10).toLocaleString("mk-MK", { minimumFractionDigits: 1 }).replace("-", "−")} °C`;

export const fmtPct = (bps) => `${(Number(bps) / 100).toLocaleString("mk-MK", { maximumFractionDigits: 1 })} %`;

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

const MONTHS = ["јан", "фев", "мар", "апр", "мај", "јун", "јул", "авг", "сеп", "окт", "ное", "дек"];
export function fmtDateInt(n) {
  const s = String(n);
  return `${Number(s.slice(6, 8))} ${MONTHS[Number(s.slice(4, 6)) - 1]} ${s.slice(0, 4)}`;
}
export const isoToInt = (iso) => Number(iso.replaceAll("-", ""));

/** Ја преведува грешката од договорот или паричникот во разбирлива порака. */
export function explainError(err) {
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Трансакцијата е одбиена во паричникот.";
  const name = err?.revert?.name;
  const map = {
    InvalidInput: "Невалидни податоци. Провери ги полињата.",
    NotCovered: "Овој мраз не е покриен со полисата (друг регион или надвор од сезоната).",
    AlreadyClaimed: "Исплатата за овој мраз е веќе направена.",
    InsufficientPool: "Базенот нема доволно средства за ова покритие.",
    NothingToPay: "Нема штета за исплата.",
    FutureDate: "Датумот на мразот е во иднина според времето на синџирот.",
    AccessControlUnauthorizedAccount: "Овој паричник нема дозвола за таа акција.",
  };
  return map[name] || err?.shortMessage || err?.message || String(err);
}