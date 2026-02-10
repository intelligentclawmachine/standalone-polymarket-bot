/**
 * Trading strategy: "Ride the Wave"
 *
 * Core logic:
 * 1. Wait until 5-10 minutes remain in the 15-min market
 * 2. Identify the leading outcome (Up or Down)
 * 3. If leading outcome price >= $0.60, BUY it
 * 4. If holding and unrealized gain >= 80%, SELL early
 * 5. Otherwise hold to resolution ($1.00 if correct, $0.00 if wrong)
 *
 * The thesis: by minute 5-10, BTC's direction is mostly baked in,
 * so the $0.60+ leader is statistically likely to resolve correct.
 */

import { ActiveMarket, MarketOutcome, getLeadingOutcome, isInEntryWindow } from "./market-discovery.js";
import { TraderConfig } from "./config.js";
import { getGuardrailState, PositionRecord } from "./guardrails.js";

export type Signal = "BUY" | "SELL" | "HOLD" | "WAIT";

export interface TradeSignal {
  signal: Signal;
  outcome?: MarketOutcome;
  reason: string;
  suggestedSize?: number;     // Number of shares to buy
  suggestedPrice?: number;    // Price to pay per share
  unrealizedGainPct?: number; // For SELL signals
}

/**
 * Evaluate the current market and produce a trade signal.
 */
export function evaluateMarket(
  market: ActiveMarket,
  config: TraderConfig,
): TradeSignal {
  const guardrails = getGuardrailState();

  // Check if we already have a position in this market
  const existingPosition = guardrails.positionsList.find(
    (p) => p.conditionId === market.conditionId,
  );

  if (existingPosition) {
    return evaluateExit(market, existingPosition, config);
  }

  return evaluateEntry(market, config);
}

/**
 * Evaluate whether to enter a new position.
 */
function evaluateEntry(market: ActiveMarket, config: TraderConfig): TradeSignal {
  // Market must not be closed
  if (market.closed) {
    return { signal: "WAIT", reason: "Market is closed" };
  }

  // Must be in the entry window
  if (!isInEntryWindow(market, config.entryWindowMinStart, config.entryWindowMinEnd)) {
    const minRemaining = market.minutesRemaining.toFixed(1);
    if (market.minutesRemaining > config.entryWindowMinEnd) {
      return {
        signal: "WAIT",
        reason: `Too early: ${minRemaining}min remaining (window: ${config.entryWindowMinStart}-${config.entryWindowMinEnd}min)`,
      };
    }
    return {
      signal: "WAIT",
      reason: `Too late: ${minRemaining}min remaining (window starts at ${config.entryWindowMinStart}min)`,
    };
  }

  // Find the leading outcome
  const leader = getLeadingOutcome(market);
  if (!leader) {
    return { signal: "WAIT", reason: "No outcomes available" };
  }

  // Leader must be above minimum entry price
  if (leader.price < config.minEntryPrice) {
    return {
      signal: "WAIT",
      reason: `Leading outcome "${leader.outcome}" at $${leader.price.toFixed(2)} < min entry $${config.minEntryPrice}`,
    };
  }

  // Calculate position size: buy as many shares as max order size allows
  const pricePerShare = leader.price;
  const maxShares = Math.floor(config.maxOrderSize / pricePerShare);
  if (maxShares <= 0) {
    return { signal: "WAIT", reason: "Order size too small for current price" };
  }

  return {
    signal: "BUY",
    outcome: leader,
    reason: `Entry signal: "${leader.outcome}" at $${pricePerShare.toFixed(2)} with ${market.minutesRemaining.toFixed(1)}min remaining`,
    suggestedSize: maxShares,
    suggestedPrice: pricePerShare,
  };
}

/**
 * Evaluate whether to exit (sell) an existing position.
 */
function evaluateExit(
  market: ActiveMarket,
  position: PositionRecord,
  config: TraderConfig,
): TradeSignal {
  // Find current price of our held outcome
  const held = market.outcomes.find((o) => o.tokenId === position.tokenId);
  if (!held) {
    return { signal: "HOLD", reason: "Can't find current price for held position" };
  }

  const currentValue = held.price * position.size;
  const unrealizedGainPct = (currentValue - position.costBasis) / position.costBasis;

  // Take profit if gain exceeds threshold
  if (unrealizedGainPct >= config.takeProfitPct) {
    return {
      signal: "SELL",
      outcome: held,
      reason: `Take profit: ${(unrealizedGainPct * 100).toFixed(1)}% gain >= ${(config.takeProfitPct * 100).toFixed(0)}% target`,
      suggestedSize: position.size,
      suggestedPrice: held.price,
      unrealizedGainPct,
    };
  }

  // If market is about to close (< 1 min) and we're in profit, consider selling
  if (market.minutesRemaining < 1 && unrealizedGainPct > 0.1) {
    return {
      signal: "SELL",
      outcome: held,
      reason: `Near-expiry profit lock: ${(unrealizedGainPct * 100).toFixed(1)}% gain with <1min remaining`,
      suggestedSize: position.size,
      suggestedPrice: held.price,
      unrealizedGainPct,
    };
  }

  return {
    signal: "HOLD",
    reason: `Holding "${position.outcome}" at ${(unrealizedGainPct * 100).toFixed(1)}% unrealized (target: ${(config.takeProfitPct * 100).toFixed(0)}%)`,
    unrealizedGainPct,
  };
}
