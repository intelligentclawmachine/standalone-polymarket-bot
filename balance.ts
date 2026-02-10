/**
 * CLI: Print current Polymarket account balance.
 *
 * Usage:
 *   bun run balance.ts
 *   bun run balance
 *   npm run balance
 */

import dotenv from "dotenv";

dotenv.config({ override: true });
import { readFileSync } from "fs";
import { resolveConfig } from "./src/config.js";
import { initClient } from "./src/client.js";
import { fetchBalance } from "./src/balance.js";

const env = process.env;
const configFile = JSON.parse(readFileSync("./config.json", "utf-8"));

const config = resolveConfig({
  privateKey: env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS || "",
  signatureType: configFile.signatureType ?? 1,
});

if (!config.privateKey || !config.funderAddress ||
    config.privateKey === "0x..." || config.funderAddress === "0x...") {
  console.error("Error: Missing credentials. Set POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS in .env");
  process.exit(1);
}

try {
  await initClient(config);
  const bal = await fetchBalance();

  console.log("");
  console.log("  Polymarket Account Balance");
  console.log("  ──────────────────────────");
  const fmt = (x: string) => {
    const n = Number(x);
    if (Number.isFinite(n)) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return x;
  };

  console.log(`  USDC balance:   $${fmt(bal.collateral)}`);
  console.log(`  USDC allowance: $${fmt(bal.allowance)}`);
  console.log("");
} catch (err: any) {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
}
