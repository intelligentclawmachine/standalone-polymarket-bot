import dotenv from "dotenv";

dotenv.config({ override: true });

import { readFileSync } from "fs";
import { resolveConfig } from "./src/config.js";

const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const env = process.env;
const configFile = JSON.parse(readFileSync("./config.json", "utf-8"));

const config = resolveConfig({
  privateKey: env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS || "",
  signatureType: configFile.signatureType ?? 1,
});

if (
  !config.privateKey ||
  !config.funderAddress ||
  config.privateKey === "0x..." ||
  config.funderAddress === "0x..."
) {
  console.error(
    "Error: Missing credentials. Set POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS in .env"
  );
  process.exit(1);
}

const fmt = (x: string): string => {
  if (!/^-?\d+$/.test(x)) return x;
  const neg = x.startsWith("-");
  const abs = neg ? x.slice(1) : x;
  const padded = abs.padStart(7, "0"); // at least 1 digit before decimal
  const intPart = padded.slice(0, padded.length - 6);
  const decPart = padded.slice(padded.length - 6);
  const withCommas = intPart.replace(/\B(?=(\d{3})+$)/g, ",");
  return (neg ? "-" : "") + withCommas + "." + decPart;
};

try {
  // Dynamic imports ensure dotenv override is applied before modules read env.
  const { initClient } = await import("./src/client.js");
  const { fetchBalance } = await import("./src/balance.js");

  await initClient(config);
  const bal = await fetchBalance();

  if (outputJson) {
    console.log(
      JSON.stringify({
        usdcBalance: fmt(bal.collateral),
        usdcAllowance: fmt(bal.allowance),
      })
    );
    process.exit(0);
  }

  console.log("");
  console.log("  Polymarket Account Balance");
  console.log("  ──────────────────────────");
  console.log(`  USDC balance:   $${fmt(bal.collateral)}`);
  console.log(`  USDC allowance: $${fmt(bal.allowance)}`);
  console.log("");
} catch (err: any) {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
}
