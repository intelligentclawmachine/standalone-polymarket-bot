/**
 * Plugin configuration types and defaults.
 * Config is provided via openclaw.json plugins.entries.polymarket-trader.config
 */

export interface TraderConfig {
  privateKey: string;
  funderAddress: string;
  signatureType: 0 | 1 | 2;
  enabled: boolean;
  dryRun: boolean;
  maxOrderSize: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxTradesPerHour: number;
  minEntryPrice: number;
  entryWindowMinStart: number;
  entryWindowMinEnd: number;
  takeProfitPct: number;
  tickIntervalSec: number;
}

export const DEFAULT_CONFIG: Omit<TraderConfig, "privateKey" | "funderAddress"> = {
  signatureType: 1,
  enabled: false,
  dryRun: true,
  maxOrderSize: 10,
  maxPositionSize: 50,
  maxDailyLoss: 25,
  maxTradesPerHour: 10,
  minEntryPrice: 0.60,
  entryWindowMinStart: 5,
  entryWindowMinEnd: 10,
  takeProfitPct: 0.80,
  tickIntervalSec: 30,
};

export function resolveConfig(raw: Record<string, unknown>): TraderConfig {
  return {
    privateKey: (raw.privateKey as string) || process.env.POLYMARKET_PRIVATE_KEY || "",
    funderAddress: (raw.funderAddress as string) || process.env.POLYMARKET_FUNDER_ADDRESS || "",
    signatureType: (raw.signatureType as 0 | 1 | 2) ?? DEFAULT_CONFIG.signatureType,
    enabled: (raw.enabled as boolean) ?? DEFAULT_CONFIG.enabled,
    dryRun: (raw.dryRun as boolean) ?? DEFAULT_CONFIG.dryRun,
    maxOrderSize: (raw.maxOrderSize as number) ?? DEFAULT_CONFIG.maxOrderSize,
    maxPositionSize: (raw.maxPositionSize as number) ?? DEFAULT_CONFIG.maxPositionSize,
    maxDailyLoss: (raw.maxDailyLoss as number) ?? DEFAULT_CONFIG.maxDailyLoss,
    maxTradesPerHour: (raw.maxTradesPerHour as number) ?? DEFAULT_CONFIG.maxTradesPerHour,
    minEntryPrice: (raw.minEntryPrice as number) ?? DEFAULT_CONFIG.minEntryPrice,
    entryWindowMinStart: (raw.entryWindowMinStart as number) ?? DEFAULT_CONFIG.entryWindowMinStart,
    entryWindowMinEnd: (raw.entryWindowMinEnd as number) ?? DEFAULT_CONFIG.entryWindowMinEnd,
    takeProfitPct: (raw.takeProfitPct as number) ?? DEFAULT_CONFIG.takeProfitPct,
    tickIntervalSec: (raw.tickIntervalSec as number) ?? DEFAULT_CONFIG.tickIntervalSec,
  };
}

// Series identifier for BTC 15-minute Up/Down markets
export const BTC_15M_SERIES_SLUG = "btc-up-or-down-15m";
export const MARKET_DURATION_SEC = 900; // 15 minutes
export const CLOB_HOST = "https://clob.polymarket.com";
export const GAMMA_HOST = "https://gamma-api.polymarket.com";
export const DATA_HOST = "https://data-api.polymarket.com";
export const POLYGON_CHAIN_ID = 137;
