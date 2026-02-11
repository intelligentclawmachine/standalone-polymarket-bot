/**
 * Configuration types and resolver.
 */

export interface TraderConfig {
  privateKey: string;
  funderAddress: string;
  signatureType: 0 | 1 | 2;
  enabled: boolean;
  dryRun: boolean;
  maxOrderSize: number;
  minEntryPrice: number;
  entryWindowMinStart: number;
  entryWindowMinEnd: number;
  tickIntervalSec: number;
}

export function resolveConfig(raw: Record<string, unknown>): TraderConfig {
  return {
    privateKey: (raw.privateKey as string) || process.env.POLYMARKET_PRIVATE_KEY || "",
    funderAddress: (raw.funderAddress as string) || process.env.POLYMARKET_FUNDER_ADDRESS || "",
    signatureType: (raw.signatureType as 0 | 1 | 2) ?? 1,
    enabled: (raw.enabled as boolean) ?? false,
    dryRun: (raw.dryRun as boolean) ?? true,
    maxOrderSize: (raw.maxOrderSize as number) ?? 10,
    minEntryPrice: (raw.minEntryPrice as number) ?? 0.60,
    entryWindowMinStart: (raw.entryWindowMinStart as number) ?? 5,
    entryWindowMinEnd: (raw.entryWindowMinEnd as number) ?? 10,
    tickIntervalSec: (raw.tickIntervalSec as number) ?? 30,
  };
}

export const MARKET_DURATION_SEC = 900; // 15 minutes
export const CLOB_HOST = "https://clob.polymarket.com";
export const GAMMA_HOST = "https://gamma-api.polymarket.com";
export const POLYGON_CHAIN_ID = 137;
