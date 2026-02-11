/**
 * Persistent trade log — append-only JSONL file.
 * Records two facts: what we bought, and how each market resolved.
 * Also used to prevent duplicate buys on restart.
 */

import { appendFileSync, readFileSync, existsSync } from "fs";

const LOG_FILE = "./trades.jsonl";

export interface BuyEntry {
  type: "buy";
  time: string;
  slug: string;
  outcome: "Up" | "Down";
  price: number;
  size: number;
  cost: number;
  orderId: string;
}

export interface ResolutionEntry {
  type: "resolution";
  time: string;
  slug: string;
  resolved: "Up" | "Down";
}

/**
 * Append a buy entry to the log.
 */
export function logBuy(data: Omit<BuyEntry, "type" | "time">): void {
  const entry: BuyEntry = { type: "buy", time: new Date().toISOString(), ...data };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

/**
 * Append a resolution entry to the log.
 */
export function logResolution(slug: string, resolved: "Up" | "Down"): void {
  const entry: ResolutionEntry = { type: "resolution", time: new Date().toISOString(), slug, resolved };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

/**
 * Check if we already bought in a given market slot.
 */
export function hasBoughtSlug(slug: string): boolean {
  return hasEntry("buy", slug);
}

/**
 * Check if we already logged resolution for a slug.
 */
export function hasResolution(slug: string): boolean {
  return hasEntry("resolution", slug);
}

function hasEntry(type: string, slug: string): boolean {
  if (!existsSync(LOG_FILE)) return false;
  try {
    const lines = readFileSync(LOG_FILE, "utf-8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      const entry = JSON.parse(lines[i]);
      if (entry.type === type && entry.slug === slug) return true;
    }
  } catch {}
  return false;
}
