/**
 * Standalone Polymarket BTC 15-Minute Trader
 *
 * Usage:
 *   bun run main.ts                          # dry-run mode (default)
 *   LIVE=1 bun run main.ts                   # live trading
 *   POLYMARKET_PRIVATE_KEY=0x... bun run main.ts   # override key
 *
 * Environment variables:
 *   POLYMARKET_PRIVATE_KEY   - Polygon wallet private key
 *   POLYMARKET_FUNDER_ADDRESS - Proxy wallet address from Polymarket
 *   LIVE                     - Set to "1" to disable dry-run
 *   ENABLED                  - Set to "0" to disable trading (default: "1")
 *   TICK_INTERVAL            - Seconds between ticks (default: 30)
 */

import { resolveConfig } from "./src/config.js";
import { initClient } from "./src/client.js";
import { startService, stopService } from "./src/trader-service.js";

const env = process.env;

const config = resolveConfig({
  privateKey: env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS || "",
  signatureType: parseInt(env.SIGNATURE_TYPE || "1") as 0 | 1 | 2,
  enabled: env.ENABLED !== "0",
  dryRun: env.LIVE !== "1",
  maxOrderSize: parseFloat(env.MAX_ORDER_SIZE || "10"),
  maxPositionSize: parseFloat(env.MAX_POSITION_SIZE || "50"),
  maxDailyLoss: parseFloat(env.MAX_DAILY_LOSS || "25"),
  maxTradesPerHour: parseInt(env.MAX_TRADES_PER_HOUR || "10"),
  minEntryPrice: parseFloat(env.MIN_ENTRY_PRICE || "0.60"),
  entryWindowMinStart: parseInt(env.ENTRY_WINDOW_START || "5"),
  entryWindowMinEnd: parseInt(env.ENTRY_WINDOW_END || "10"),
  takeProfitPct: parseFloat(env.TAKE_PROFIT_PCT || "0.80"),
  tickIntervalSec: parseInt(env.TICK_INTERVAL || "30"),
});

const log = (...args: any[]) => console.log(new Date().toISOString(), ...args);

log("=== Polymarket BTC 15m Trader ===");
log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE TRADING"}`);
log(`Trading: ${config.enabled ? "ENABLED" : "DISABLED"}`);
log(`Tick interval: ${config.tickIntervalSec}s`);
log(`Max order: $${config.maxOrderSize} | Max position: $${config.maxPositionSize} | Max daily loss: $${config.maxDailyLoss}`);
log(`Entry window: ${config.entryWindowMinStart}-${config.entryWindowMinEnd}min | Min price: $${config.minEntryPrice} | Take profit: ${config.takeProfitPct * 100}%`);

if (!config.privateKey || !config.funderAddress) {
  console.error("\nMissing POLYMARKET_PRIVATE_KEY or POLYMARKET_FUNDER_ADDRESS environment variables.");
  console.error("Set them in your shell or create a .env file.");
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

// Graceful shutdown
const shutdown = () => {
  log("Shutting down...");
  stopService(log);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("Bot running. Press Ctrl+C to stop.\n");
