import dotenv from "dotenv";
import { appendFileSync, mkdirSync, readFileSync } from "fs";

import { resolveConfig } from "../src/config.js";
import { fetchBalance } from "../src/balance.js";
import { initClient } from "../src/client.js";

dotenv.config({ override: true });

const logDir = new URL("../logs", import.meta.url);
const logFile = new URL("../logs/balance-health.jsonl", import.meta.url);
const configPath = new URL("../config.json", import.meta.url);

const logFmt = (value: string): string => {
  if (!value) {
    return "N/A";
  }
  if (!/^-?\d+$/.test(value)) {
    return value;
  }
  const neg = value.startsWith("-");
  const abs = neg ? value.slice(1) : value;
  const padded = abs.padStart(7, "0");
  const intPart = padded.slice(0, padded.length - 6);
  const decPart = padded.slice(padded.length - 6);
  const withCommas = intPart.replace(/\B(?=(\d{3})+$)/g, ",");
  return `${neg ? "-" : ""}${withCommas}.${decPart}`;
};

const configFile = JSON.parse(readFileSync(configPath, "utf-8"));

const config = resolveConfig({
  privateKey: process.env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS || "",
  signatureType: (configFile.signatureType as 0 | 1 | 2) ?? 1,
});

const credentialMissing =
  !config.privateKey ||
  !config.funderAddress ||
  config.privateKey === "0x..." ||
  config.funderAddress === "0x...";

if (credentialMissing) {
  console.error(
    "Error: Missing credentials. Set POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS in .env"
  );
  process.exit(1);
}

mkdirSync(logDir, { recursive: true });

const appendLog = (entry: Record<string, unknown>) => {
  appendFileSync(logFile, JSON.stringify(entry) + "\n");
};

const recordSuccess = (balance: string, allowance: string) => {
  const formattedBalance = `$${logFmt(balance)}`;
  const formattedAllowance = `$${logFmt(allowance)}`;
  const entry = {
    timestamp: new Date().toISOString(),
    status: "success",
    rawBalance: balance,
    rawAllowance: allowance,
    formattedBalance,
    formattedAllowance,
  };
  appendLog(entry);
  console.log(
    `Balance health recorded: ${formattedBalance} available, ${formattedAllowance} allowance.`
  );
};

const recordFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const entry = {
    timestamp: new Date().toISOString(),
    status: "error",
    message,
  };
  appendLog(entry);
  console.error("Balance health check failed:", message);
};

const run = async (): Promise<void> => {
  try {
    await initClient(config);
    const balance = await fetchBalance();
    recordSuccess(balance.collateral, balance.allowance);
  } catch (error) {
    recordFailure(error);
    process.exit(1);
  }
};

run();
