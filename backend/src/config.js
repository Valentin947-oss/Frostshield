import "dotenv/config";

// Редоследот мора да одговара на индексите во смарт-договорот.
export const REGIONS = [
  { id: 0, name: "Струмица", lat: 41.4378, lon: 22.6427 },
  { id: 1, name: "Гевгелија", lat: 41.1414, lon: 22.5025 },
  { id: 2, name: "Валандово", lat: 41.3169, lon: 22.5611 },
  { id: 3, name: "Богданци", lat: 41.2031, lon: 22.5753 },
];

export const CROPS = ["Домат", "Пипер", "Краставица", "Марула", "Зелка", "Кромид", "Лук"];
export const PROD_TYPES = ["Отворено", "Мал пластеник", "Пластеник"];

export const config = {
  port: Number(process.env.PORT || 4000),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  // Hardhat сметка #1 (само за локален развој!). Во продукција – свој клуч.
  oraclePrivateKey:
    process.env.ORACLE_PRIVATE_KEY ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  apiKey: process.env.ORACLE_API_KEY || "dev-oracle-key",
  timezone: process.env.TZ_NAME || "Europe/Skopje",
  cronEnabled: process.env.CRON_ENABLED !== "false",
  // Секој ден во 09:15, само февруари–април, се проверува претходниот ден.
  cronSchedule: process.env.CRON_SCHEDULE || "15 9 * 2-4 *",
  autoClaim: process.env.AUTO_CLAIM !== "false",
  corsOrigin: process.env.CORS_ORIGIN || "*",
};
