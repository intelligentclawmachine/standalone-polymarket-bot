/**
 * Risk management guardrails.
 * Enforces position limits, daily loss limits, trade frequency caps.
 * All state is in-memory (resets on restart).
 */

import { TraderConfig } from "./config.js";

export interface GuardrailState {
  dailyPnl: number;           // Running P&L for the day (negative = loss)
  dailyTradeCount: number;    // Trades placed today
  hourlyTrades: number[];     // Timestamps of trades in the last hour
  totalExposure: number;      // Current total position value in USDC
  openPositions: Map<string, PositionRecord>; // conditionId -> position
  killswitch: boolean;        // Hard stop: no more trading
  lastResetDay: string;       // YYYY-MM-DD of last daily reset
}

export interface PositionRecord {
  conditionId: string;
  tokenId: string;
  outcome: "Up" | "Down";
  entryPrice: number;
  size: number;               // Number of shares
  costBasis: number;          // Total USDC spent
  entryTime: number;          // Unix ms
  marketSlug: string;
}

let state: GuardrailState = createFreshState();

function createFreshState(): GuardrailState {
  return {
    dailyPnl: 0,
    dailyTradeCount: 0,
    hourlyTrades: [],
    totalExposure: 0,
    openPositions: new Map(),
    killswitch: false,
    lastResetDay: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Check if daily reset is needed (new UTC day).
 */
function maybeResetDaily(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== state.lastResetDay) {
    state.dailyPnl = 0;
    state.dailyTradeCount = 0;
    state.hourlyTrades = [];
    state.lastResetDay = today;
    // Don't reset killswitch — must be manually cleared
  }
}

/**
 * Prune hourly trade timestamps older than 1 hour.
 */
function pruneHourlyTrades(): void {
  const oneHourAgo = Date.now() - 3_600_000;
  state.hourlyTrades = state.hourlyTrades.filter((t) => t > oneHourAgo);
}

export interface PreTradeCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Run all pre-trade checks. Returns { allowed: true } or { allowed: false, reason }.
 */
export function checkPreTrade(config: TraderConfig, orderSizeUSDC: number): PreTradeCheck {
  maybeResetDaily();
  pruneHourlyTrades();

  if (state.killswitch) {
    return { allowed: false, reason: "KILLSWITCH active — trading halted" };
  }

  if (!config.enabled) {
    return { allowed: false, reason: "Trading is disabled (enabled=false)" };
  }

  if (orderSizeUSDC > config.maxOrderSize) {
    return { allowed: false, reason: `Order size $${orderSizeUSDC} exceeds max $${config.maxOrderSize}` };
  }

  if (state.totalExposure + orderSizeUSDC > config.maxPositionSize) {
    return {
      allowed: false,
      reason: `Would exceed max position: current $${state.totalExposure} + $${orderSizeUSDC} > $${config.maxPositionSize}`,
    };
  }

  if (Math.abs(state.dailyPnl) >= config.maxDailyLoss && state.dailyPnl < 0) {
    return {
      allowed: false,
      reason: `Daily loss limit hit: $${Math.abs(state.dailyPnl).toFixed(2)} >= $${config.maxDailyLoss}`,
    };
  }

  if (state.hourlyTrades.length >= config.maxTradesPerHour) {
    return {
      allowed: false,
      reason: `Hourly trade limit hit: ${state.hourlyTrades.length} >= ${config.maxTradesPerHour}`,
    };
  }

  return { allowed: true };
}

/**
 * Record that a trade was placed.
 */
export function recordTrade(position: PositionRecord): void {
  state.hourlyTrades.push(Date.now());
  state.dailyTradeCount++;
  state.totalExposure += position.costBasis;
  state.openPositions.set(position.conditionId, position);
}

/**
 * Record a position close (sell or resolution).
 */
export function recordClose(conditionId: string, proceeds: number): void {
  const pos = state.openPositions.get(conditionId);
  if (pos) {
    const pnl = proceeds - pos.costBasis;
    state.dailyPnl += pnl;
    state.totalExposure -= pos.costBasis;
    state.openPositions.delete(conditionId);

    // Auto-killswitch if daily loss limit breached
    if (state.dailyPnl < 0 && Math.abs(state.dailyPnl) >= 25) {
      state.killswitch = true;
    }
  }
}

/**
 * Activate the killswitch (soft stop).
 */
export function activateKillswitch(reason: string): void {
  state.killswitch = true;
}

/**
 * Deactivate the killswitch (manual reset).
 */
export function resetKillswitch(): void {
  state.killswitch = false;
}

/**
 * Get current guardrail state snapshot (for monitoring tools).
 */
export function getGuardrailState(): GuardrailState & { positionsList: PositionRecord[] } {
  maybeResetDaily();
  pruneHourlyTrades();
  return {
    ...state,
    positionsList: Array.from(state.openPositions.values()),
  };
}

/**
 * Full state reset (for testing or restart).
 */
export function resetState(): void {
  state = createFreshState();
}
