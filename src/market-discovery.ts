/**
 * Market discovery: find the current active BTC 15-minute market.
 *
 * Market slug pattern: btc-updown-15m-{unixStartTimestamp}
 * Markets start every 15 minutes (900 seconds), aligned to Unix epoch.
 * Each market has two outcomes: "Up" and "Down".
 */

import { GAMMA_HOST, MARKET_DURATION_SEC } from "./config.js";

export interface MarketOutcome {
  tokenId: string;
  outcome: "Up" | "Down";
  price: number;
}

export interface ActiveMarket {
  conditionId: string;
  slug: string;
  question: string;
  startTime: number;      // Unix seconds
  endTime: number;        // Unix seconds
  secondsRemaining: number;
  minutesRemaining: number;
  outcomes: MarketOutcome[];
  tickSize: string;
  negRisk: boolean;
  closed: boolean;
}

/**
 * Calculate the Unix start timestamp of the current 15-minute slot.
 */
export function getCurrentSlotStart(nowSec?: number): number {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  return Math.floor(now / MARKET_DURATION_SEC) * MARKET_DURATION_SEC;
}

/**
 * Get how many seconds remain in the current 15-minute slot.
 */
export function getSecondsRemaining(nowSec?: number): number {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const slotStart = getCurrentSlotStart(now);
  const slotEnd = slotStart + MARKET_DURATION_SEC;
  return Math.max(0, slotEnd - now);
}

/**
 * Build the expected market slug for a given slot start time.
 */
export function buildMarketSlug(slotStartSec: number): string {
  return `btc-updown-15m-${slotStartSec}`;
}

/**
 * Fetch market metadata from the Gamma API by slug.
 * Returns null if market not found.
 */
export async function fetchMarketBySlug(slug: string): Promise<any | null> {
  try {
    const res = await fetch(`${GAMMA_HOST}/markets?slug=${slug}`);
    if (!res.ok) return null;
    const markets = await res.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
    return markets[0];
  } catch {
    return null;
  }
}

/**
 * Fetch the event (which contains multiple markets/outcomes) by slug.
 */
export async function fetchEventBySlug(slug: string): Promise<any | null> {
  try {
    const res = await fetch(`${GAMMA_HOST}/events?slug=${slug}`);
    if (!res.ok) return null;
    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) return null;
    return events[0];
  } catch {
    return null;
  }
}

/**
 * Discover the currently active BTC 15-minute market.
 * Tries current slot first, then previous slot (in case of timing edge).
 */
export async function discoverCurrentMarket(): Promise<ActiveMarket | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const currentSlotStart = getCurrentSlotStart(nowSec);

  // Try current slot
  let market = await tryFetchActiveMarket(currentSlotStart, nowSec);
  if (market) return market;

  // Try previous slot (might still be resolving)
  const prevSlotStart = currentSlotStart - MARKET_DURATION_SEC;
  market = await tryFetchActiveMarket(prevSlotStart, nowSec);
  if (market) return market;

  // Try next slot (might already be listed for trading)
  const nextSlotStart = currentSlotStart + MARKET_DURATION_SEC;
  market = await tryFetchActiveMarket(nextSlotStart, nowSec);
  return market;
}

async function tryFetchActiveMarket(slotStart: number, nowSec: number): Promise<ActiveMarket | null> {
  const slug = buildMarketSlug(slotStart);
  const raw = await fetchMarketBySlug(slug);
  if (!raw) return null;

  const endTime = slotStart + MARKET_DURATION_SEC;
  const secondsRemaining = Math.max(0, endTime - nowSec);

  // Parse outcomes from the market tokens
  const outcomes: MarketOutcome[] = [];

  // Gamma API returns clobTokenIds as a JSON string array and outcomePrices similarly
  let tokenIds: string[] = [];
  let prices: string[] = [];
  let outcomeLabels: string[] = [];

  try {
    tokenIds = typeof raw.clobTokenIds === "string" ? JSON.parse(raw.clobTokenIds) : (raw.clobTokenIds || []);
    prices = typeof raw.outcomePrices === "string" ? JSON.parse(raw.outcomePrices) : (raw.outcomePrices || []);
    outcomeLabels = typeof raw.outcomes === "string" ? JSON.parse(raw.outcomes) : (raw.outcomes || []);
  } catch {
    // If parsing fails, try alternate field names
    tokenIds = raw.clob_token_ids || [];
    prices = raw.outcome_prices || [];
    outcomeLabels = raw.outcomes || [];
  }

  for (let i = 0; i < tokenIds.length; i++) {
    const label = (outcomeLabels[i] || "").toLowerCase();
    const outcome: "Up" | "Down" = label.includes("up") ? "Up" : "Down";
    outcomes.push({
      tokenId: tokenIds[i],
      outcome,
      price: parseFloat(prices[i]) || 0,
    });
  }

  return {
    conditionId: raw.conditionId || raw.condition_id || "",
    slug,
    question: raw.question || "",
    startTime: slotStart,
    endTime,
    secondsRemaining,
    minutesRemaining: secondsRemaining / 60,
    outcomes,
    tickSize: raw.minimumTickSize || raw.minimum_tick_size || "0.01",
    negRisk: raw.negRisk ?? raw.neg_risk ?? false,
    closed: raw.closed ?? false,
  };
}

/**
 * Find the leading outcome (highest price) in a market.
 */
export function getLeadingOutcome(market: ActiveMarket): MarketOutcome | null {
  if (market.outcomes.length === 0) return null;
  return market.outcomes.reduce((best, o) => o.price > best.price ? o : best);
}

/**
 * Check if the market is in the entry window (5-10 minutes remaining by default).
 */
export function isInEntryWindow(
  market: ActiveMarket,
  minStart: number = 5,
  minEnd: number = 10,
): boolean {
  return market.minutesRemaining >= minStart && market.minutesRemaining <= minEnd;
}
