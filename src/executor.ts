/**
 * Order execution engine.
 * Places orders via the Polymarket CLOB client.
 * All orders go through guardrail checks before submission.
 */

import { Side, OrderType } from "@polymarket/clob-client";
import type { TickSize } from "@polymarket/clob-client";
import { getClient, isClientReady } from "./client.js";
import { TraderConfig } from "./config.js";
import { checkPreTrade, recordTrade } from "./guardrails.js";
import { TradeSignal } from "./strategy.js";
import { ActiveMarket } from "./market-discovery.js";
import { hasBoughtSlug, logBuy } from "./trade-log.js";

const VALID_TICK_SIZES = new Set(["0.1", "0.01", "0.001", "0.0001"]);

function toTickSize(raw: string): TickSize {
  if (VALID_TICK_SIZES.has(raw)) return raw as TickSize;
  return "0.01"; // safe default
}

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  message: string;
  dryRun: boolean;
}

/**
 * Execute a BUY signal: place a limit order for the target outcome.
 */
export async function executeBuy(
  signal: TradeSignal,
  market: ActiveMarket,
  config: TraderConfig,
  logger: (...args: any[]) => void,
): Promise<ExecutionResult> {
  if (!signal.outcome || !signal.suggestedSize || !signal.suggestedPrice) {
    return { success: false, message: "Invalid buy signal: missing outcome/size/price", dryRun: false };
  }

  const orderCost = signal.suggestedSize * signal.suggestedPrice;

  // Check if we already bought in this 15-min block (survives restarts)
  if (hasBoughtSlug(market.slug)) {
    return { success: false, message: `Already bought in this block (${market.slug})`, dryRun: false };
  }

  // Pre-trade guardrail check
  const check = checkPreTrade(config, orderCost);
  if (!check.allowed) {
    return { success: false, message: `Guardrail blocked: ${check.reason}`, dryRun: false };
  }

  // Dry run mode: log but don't execute
  if (config.dryRun) {
    const msg = `[DRY RUN] Would BUY ${signal.suggestedSize} shares of "${signal.outcome.outcome}" @ $${signal.suggestedPrice.toFixed(2)} ($${orderCost.toFixed(2)} total) — ${signal.reason}`;
    logger(msg);

    // Still record in guardrails so dry-run respects limits
    recordTrade({
      conditionId: market.conditionId,
      tokenId: signal.outcome.tokenId,
      outcome: signal.outcome.outcome,
      entryPrice: signal.suggestedPrice,
      size: signal.suggestedSize,
      costBasis: orderCost,
      entryTime: Date.now(),
      marketSlug: market.slug,
      negRisk: market.negRisk,
    });

    logBuy({ slug: market.slug, outcome: signal.outcome.outcome, price: signal.suggestedPrice, size: signal.suggestedSize, cost: orderCost, orderId: "dry-run" });

    return { success: true, message: msg, dryRun: true };
  }

  // Live execution
  if (!isClientReady()) {
    return { success: false, message: "Client not initialized", dryRun: false };
  }

  try {
    const client = getClient();
    const response = await client.createAndPostOrder(
      {
        tokenID: signal.outcome.tokenId,
        price: signal.suggestedPrice,
        size: signal.suggestedSize,
        side: Side.BUY,
      },
      {
        tickSize: toTickSize(market.tickSize),
        negRisk: market.negRisk,
      },
      OrderType.GTC, // Good-Till-Cancelled limit order
    );

    const orderId = response?.orderID || "unknown";
    const status = response?.status || "unknown";

    if (status === "matched" || status === "live") {
      recordTrade({
        conditionId: market.conditionId,
        tokenId: signal.outcome.tokenId,
        outcome: signal.outcome.outcome,
        entryPrice: signal.suggestedPrice,
        size: signal.suggestedSize,
        costBasis: orderCost,
        entryTime: Date.now(),
        marketSlug: market.slug,
        negRisk: market.negRisk,
      });

      logBuy({ slug: market.slug, outcome: signal.outcome.outcome, price: signal.suggestedPrice, size: signal.suggestedSize, cost: orderCost, orderId });

      const msg = `BUY FILLED: ${signal.suggestedSize} shares of "${signal.outcome.outcome}" @ $${signal.suggestedPrice.toFixed(2)} ($${orderCost.toFixed(2)}) — Order ${orderId}`;
      logger(msg);
      return { success: true, orderId, message: msg, dryRun: false };
    }

    return { success: false, message: `Order not filled. Status: ${status}, ID: ${orderId}`, dryRun: false };
  } catch (err: any) {
    return { success: false, message: `Buy failed: ${err.message || err}`, dryRun: false };
  }
}
