/**
 * Order execution engine.
 * Places and cancels orders via the Polymarket CLOB client.
 * All orders go through guardrail checks before submission.
 */

import { Side, OrderType } from "@polymarket/clob-client";
import type { TickSize } from "@polymarket/clob-client";
import { getClient, isClientReady } from "./client.js";
import { TraderConfig } from "./config.js";
import { checkPreTrade, recordTrade, recordClose, PositionRecord } from "./guardrails.js";
import { TradeSignal } from "./strategy.js";
import { ActiveMarket } from "./market-discovery.js";

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
    });

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
      });

      const msg = `BUY FILLED: ${signal.suggestedSize} shares of "${signal.outcome.outcome}" @ $${signal.suggestedPrice.toFixed(2)} ($${orderCost.toFixed(2)}) — Order ${orderId}`;
      logger(msg);
      return { success: true, orderId, message: msg, dryRun: false };
    }

    return { success: false, message: `Order not filled. Status: ${status}, ID: ${orderId}`, dryRun: false };
  } catch (err: any) {
    return { success: false, message: `Buy failed: ${err.message || err}`, dryRun: false };
  }
}

/**
 * Execute a SELL signal: sell held position shares.
 */
export async function executeSell(
  signal: TradeSignal,
  market: ActiveMarket,
  config: TraderConfig,
  logger: (...args: any[]) => void,
): Promise<ExecutionResult> {
  if (!signal.outcome || !signal.suggestedSize || !signal.suggestedPrice) {
    return { success: false, message: "Invalid sell signal: missing outcome/size/price", dryRun: false };
  }

  const proceeds = signal.suggestedSize * signal.suggestedPrice;

  if (config.dryRun) {
    const msg = `[DRY RUN] Would SELL ${signal.suggestedSize} shares of "${signal.outcome.outcome}" @ $${signal.suggestedPrice.toFixed(2)} ($${proceeds.toFixed(2)}) — ${signal.reason}`;
    logger(msg);
    recordClose(market.conditionId, proceeds);
    return { success: true, message: msg, dryRun: true };
  }

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
        side: Side.SELL,
      },
      {
        tickSize: toTickSize(market.tickSize),
        negRisk: market.negRisk,
      },
      OrderType.GTC,
    );

    const orderId = response?.orderID || "unknown";
    const status = response?.status || "unknown";

    if (status === "matched" || status === "live") {
      recordClose(market.conditionId, proceeds);
      const msg = `SELL FILLED: ${signal.suggestedSize} shares of "${signal.outcome.outcome}" @ $${signal.suggestedPrice.toFixed(2)} ($${proceeds.toFixed(2)}) — Order ${orderId}`;
      logger(msg);
      return { success: true, orderId, message: msg, dryRun: false };
    }

    return { success: false, message: `Sell order not filled. Status: ${status}, ID: ${orderId}`, dryRun: false };
  } catch (err: any) {
    return { success: false, message: `Sell failed: ${err.message || err}`, dryRun: false };
  }
}

/**
 * Cancel all open orders (emergency).
 */
export async function cancelAllOrders(logger: (...args: any[]) => void): Promise<ExecutionResult> {
  if (!isClientReady()) {
    return { success: false, message: "Client not initialized", dryRun: false };
  }

  try {
    const client = getClient();
    await client.cancelAll();
    logger("ALL ORDERS CANCELLED");
    return { success: true, message: "All open orders cancelled", dryRun: false };
  } catch (err: any) {
    return { success: false, message: `Cancel all failed: ${err.message || err}`, dryRun: false };
  }
}

/**
 * Get open orders from the CLOB.
 */
export async function getOpenOrders(): Promise<any[]> {
  if (!isClientReady()) return [];
  try {
    const client = getClient();
    return await client.getOpenOrders() || [];
  } catch {
    return [];
  }
}

/**
 * Get trade history from the CLOB.
 */
export async function getTradeHistory(): Promise<any[]> {
  if (!isClientReady()) return [];
  try {
    const client = getClient();
    return await client.getTrades() || [];
  } catch {
    return [];
  }
}
