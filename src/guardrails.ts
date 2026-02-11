/**
 * Minimal risk management: killswitch, enabled check, order size cap.
 * Tracks open positions in-memory (resets on restart).
 */

import { TraderConfig } from "./config.js";

export interface PositionRecord {
  conditionId: string;
  tokenId: string;
  outcome: "Up" | "Down";
  entryPrice: number;
  size: number;               // Number of shares
  costBasis: number;          // Total USDC spent
  entryTime: number;          // Unix ms
  marketSlug: string;
  negRisk: boolean;
}

export interface GuardrailState {
  openPositions: Map<string, PositionRecord>;
  killswitch: boolean;
}

let state: GuardrailState = {
  openPositions: new Map(),
  killswitch: false,
};

export interface PreTradeCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Run pre-trade checks: killswitch, enabled, order size.
 */
export function checkPreTrade(config: TraderConfig, orderSizeUSDC: number): PreTradeCheck {
  if (state.killswitch) {
    return { allowed: false, reason: "KILLSWITCH active — trading halted" };
  }

  if (!config.enabled) {
    return { allowed: false, reason: "Trading is disabled (enabled=false)" };
  }

  if (orderSizeUSDC > config.maxOrderSize) {
    return { allowed: false, reason: `Order size $${orderSizeUSDC} exceeds max $${config.maxOrderSize}` };
  }

  return { allowed: true };
}

/**
 * Record that a trade was placed.
 */
export function recordTrade(position: PositionRecord): void {
  state.openPositions.set(position.conditionId, position);
}

/**
 * Activate the killswitch (soft stop).
 */
export function activateKillswitch(reason: string): void {
  state.killswitch = true;
}

/**
 * Get current state snapshot (used by strategy to check existing positions).
 */
export function getGuardrailState(): GuardrailState & { positionsList: PositionRecord[] } {
  return {
    ...state,
    positionsList: Array.from(state.openPositions.values()),
  };
}
