/**
 * BTC spot price feed.
 * Uses multiple free exchange APIs for redundancy.
 * No API key required for any of these.
 */

interface PriceSource {
  name: string;
  url: string;
  extract: (data: any) => number;
}

const SOURCES: PriceSource[] = [
  {
    name: "Binance",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    extract: (d) => parseFloat(d.price),
  },
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    extract: (d) => d.bitcoin.usd,
  },
  {
    name: "Coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    extract: (d) => parseFloat(d.data.amount),
  },
];

let lastPrice: number | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5_000; // 5 second cache

/**
 * Fetch current BTC/USD spot price.
 * Tries multiple sources, returns first successful result.
 * Caches for 5 seconds to avoid hammering APIs.
 */
export async function getBtcPrice(): Promise<number> {
  const now = Date.now();
  if (lastPrice !== null && now - lastFetchTime < CACHE_TTL_MS) {
    return lastPrice;
  }

  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const price = source.extract(data);
      if (price > 0) {
        lastPrice = price;
        lastFetchTime = now;
        return price;
      }
    } catch {
      continue;
    }
  }

  if (lastPrice !== null) return lastPrice; // stale but better than nothing
  throw new Error("Failed to fetch BTC price from all sources");
}

/**
 * Simple volatility estimate: fetch recent BTC price and compare to current.
 * Returns approximate 15-minute implied move as a fraction (e.g., 0.005 = 0.5%).
 * This is a rough heuristic, not a proper vol model.
 */
export async function estimateShortTermVol(): Promise<number> {
  try {
    // Use Binance klines for 15-minute candles
    const res = await fetch(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=20",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return 0.005; // fallback: 0.5%

    const klines = await res.json();
    if (!Array.isArray(klines) || klines.length < 5) return 0.005;

    // Calculate average absolute % move over recent 15-min candles
    let totalMove = 0;
    for (const k of klines) {
      const open = parseFloat(k[1]);
      const close = parseFloat(k[4]);
      if (open > 0) {
        totalMove += Math.abs((close - open) / open);
      }
    }
    return totalMove / klines.length;
  } catch {
    return 0.005;
  }
}
