/**
 * Background trader service — the heartbeat of the bot.
 *
 * Ticks every N seconds (default 30). On each tick:
 * 1. Discover the current active 15-min BTC market
 * 2. Evaluate the strategy (BUY / HOLD / WAIT)
 * 3. Execute if signal is actionable
 * 4. Log everything
 */

import { TraderConfig } from "./config.js";
import { discoverCurrentMarket, ActiveMarket } from "./market-discovery.js";
import { evaluateMarket, TradeSignal } from "./strategy.js";
import { executeBuy } from "./executor.js";
import { activateKillswitch } from "./guardrails.js";
import { getClient, isClientReady } from "./client.js";

export interface TickResult {
  timestamp: string;
  market: ActiveMarket | null;
  signal: TradeSignal | null;
  execution: { success: boolean; message: string } | null;
  error?: string;
}

type Logger = (...args: any[]) => void;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let tickCount = 0;

/**
 * Run a single strategy tick.
 */
export async function tick(config: TraderConfig, logger: Logger): Promise<TickResult> {
  const result: TickResult = {
    timestamp: new Date().toISOString(),
    market: null,
    signal: null,
    execution: null,
  };

  try {
    // 1. Discover the current active market
    result.market = await discoverCurrentMarket();
    if (!result.market) {
      logger(`[tick #${++tickCount}] No active BTC 15m market found`);
      return result;
    }

    if (result.market.closed) {
      logger(`[tick #${++tickCount}] Market ${result.market.slug} is closed`);
      return result;
    }

    // 2. Evaluate strategy
    result.signal = evaluateMarket(result.market, config);

    const mkt = result.market;
    const sig = result.signal;
    const pricesStr = mkt.outcomes.map((o) => `${o.outcome}=$${o.price.toFixed(2)}`).join(" ");
    const timeStr = `${mkt.minutesRemaining.toFixed(1)}min left`;

    let balanceStr = "";
    if (isClientReady()) {
      try {
        const bal = await getClient().getBalanceAllowance({ asset_type: "COLLATERAL" as any });
        balanceStr = ` | Bal: $${(parseFloat(bal.balance) / 1e6).toFixed(2)}`;
      } catch {}
    }

    logger(`[tick #${++tickCount}] ${mkt.slug} | ${pricesStr} | ${timeStr}${balanceStr} | ${sig.signal}: ${sig.reason}`);

    // 3. Execute if actionable
    if (sig.signal === "BUY") {
      result.execution = await executeBuy(sig, mkt, config, logger);
    }

    if (result.execution && !result.execution.success) {
      logger(`[EXEC FAIL] ${result.execution.message}`);
    }
  } catch (err: any) {
    const errMsg = err.message || String(err);
    result.error = errMsg;
    logger(`[tick ERROR] ${errMsg}`);

    // If we're getting repeated errors, activate killswitch
    if (errMsg.includes("insufficient") || errMsg.includes("balance")) {
      activateKillswitch(`Balance error: ${errMsg}`);
      logger("[KILLSWITCH] Activated due to balance error");
    }
  }

  return result;
}

/**
 * Start the background trading loop.
 */
export function startService(config: TraderConfig, logger: Logger): void {
  if (isRunning) {
    logger("[service] Already running");
    return;
  }

  isRunning = true;
  tickCount = 0;
  const intervalMs = config.tickIntervalSec * 1000;

  logger(`[service] Starting trader service (tick every ${config.tickIntervalSec}s, dryRun=${config.dryRun}, enabled=${config.enabled})`);

  // Run first tick immediately
  tick(config, logger);

  // Then schedule recurring ticks
  tickTimer = setInterval(() => {
    tick(config, logger);
  }, intervalMs);
}

/**
 * Stop the background trading loop.
 */
export function stopService(logger: Logger): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  isRunning = false;
  logger("[service] Trader service stopped");
}
