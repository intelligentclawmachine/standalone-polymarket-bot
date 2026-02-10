/**
 * Standalone Polymarket BTC 15-Minute Trader
 *
 * Usage:
 *   bun run main.ts                          # uses config.json settings
 *   POLYMARKET_PRIVATE_KEY=0x... bun run main.ts   # override key from .env
 *
 * Configuration:
 *   - config.json: Trading parameters and risk limits
 *   - .env: API credentials (private key, funder address)
 *
 * Environment variables:
 *   POLYMARKET_PRIVATE_KEY   - Polygon wallet private key
 *   POLYMARKET_FUNDER_ADDRESS - Proxy wallet address from Polymarket
 *   POLYGON_RPC_URL          - Polygon RPC endpoint (default: https://polygon-rpc.com)
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { resolveConfig } from "./src/config.js";
import { initClient } from "./src/client.js";
import { startService, stopService } from "./src/trader-service.js";
import { startRedemptionTimer, stopRedemptionTimer } from "./src/redeemer.js";

const env = process.env;

// Load config from config.json
const configFile = JSON.parse(readFileSync("./config.json", "utf-8"));

const config = resolveConfig({
  privateKey: env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS || "",
  signatureType: configFile.signatureType ?? 1,
  enabled: configFile.enabled ?? true,
  dryRun: !(configFile.live ?? false),
  maxOrderSize: configFile.maxOrderSize ?? 10,
  minEntryPrice: configFile.minEntryPrice ?? 0.60,
  entryWindowMinStart: configFile.entryWindowStart ?? 5,
  entryWindowMinEnd: configFile.entryWindowEnd ?? 10,
  tickIntervalSec: configFile.tickInterval ?? 30,
});

const log = (...args: any[]) => console.log(new Date().toISOString(), ...args);

log("=== Polymarket BTC 15m Trader ===");
log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE TRADING"}`);
log(`Trading: ${config.enabled ? "ENABLED" : "DISABLED"}`);
log(`Tick interval: ${config.tickIntervalSec}s`);
log(`Max order: $${config.maxOrderSize}`);
log(`Entry window: ${config.entryWindowMinStart}-${config.entryWindowMinEnd}min | Min price: $${config.minEntryPrice}`);

if (!config.privateKey || !config.funderAddress ||
    config.privateKey === "0x..." || config.funderAddress === "0x...") {
  console.error("\nError: Missing or invalid API credentials in .env file.");
  console.error("\nPlease:");
  console.error("  1. Copy .env.example to .env");
  console.error("  2. Replace the placeholder values with your actual credentials:");
  console.error("     - POLYMARKET_PRIVATE_KEY: Your Polygon wallet private key");
  console.error("     - POLYMARKET_FUNDER_ADDRESS: Your Polymarket proxy wallet address");
  console.error("\nCurrent values:");
  console.error(`  POLYMARKET_PRIVATE_KEY: ${config.privateKey ? (config.privateKey.substring(0, 6) + "...") : "(empty)"}`);
  console.error(`  POLYMARKET_FUNDER_ADDRESS: ${config.funderAddress || "(empty)"}`);
  process.exit(1);
}

// Initialize Polymarket client
try {
  await initClient(config);
  log("Polymarket client initialized successfully");
} catch (err: any) {
  console.error("Failed to initialize Polymarket client:", err.message);
  process.exit(1);
}

// Start the trading loop
startService(config, log);

// Start the standalone redemption timer (first sweep in 30s, then every 45min)
startRedemptionTimer(config.privateKey, config.funderAddress, log);

// Graceful shutdown
const shutdown = () => {
  log("Shutting down...");
  stopService(log);
  stopRedemptionTimer();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("Bot running. Press Ctrl+C to stop.\n");
