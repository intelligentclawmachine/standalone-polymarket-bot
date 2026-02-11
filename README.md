# Polymarket BTC 15-Minute Trader

Automated trading bot for Polymarket's BTC 15-minute Up/Down binary options markets.

## How It Works

Every 30 seconds, the bot:
1. Finds the current BTC 15-minute market on Polymarket
2. Checks the Up and Down token prices
3. If the leading outcome is priced at $0.60+ and 5-10 minutes remain, buys it
4. If holding a position with 80%+ gain, sells for profit
5. Otherwise holds to resolution ($1.00 if correct, $0.00 if wrong)

## Quick Start

```bash
# Install dependencies
npm install

# Copy the example env file and add your credentials
cp .env.example .env
# IMPORTANT: Edit .env and replace "0x..." with your actual credentials:
#   - POLYMARKET_PRIVATE_KEY: Your Polygon wallet private key
#   - POLYMARKET_FUNDER_ADDRESS: Your Polymarket proxy wallet address

# Edit config.json to adjust trading parameters
# Set "live": true in config.json when ready for real trades

# Run the bot
bun run start
```

## Check Balance

```bash
bun run balance          # or: npm run balance
bun run balance --json   # machine-friendly JSON summary for automations
```

Prints your current USDC balance and CLOB spending allowance. Requires `.env` credentials.

## Stop

**Ctrl+C** — the bot shuts down gracefully.

## Configuration

Configuration is split into two files:

### `.env` - API Credentials (keep secret)
| Variable | Description |
|----------|-------------|
| `POLYMARKET_PRIVATE_KEY` | Your Polygon wallet private key |
| `POLYMARKET_FUNDER_ADDRESS` | Proxy wallet address from your Polymarket profile |

### `config.json` - Trading Parameters
| Field | Default | Description |
|-------|---------|-------------|
| `signatureType` | `1` | `0` = EOA, `1` = Magic Link, `2` = Browser wallet |
| `live` | `false` | `false` = dry-run (logs only), `true` = real orders |
| `enabled` | `true` | `false` = disabled, `true` = active |
| `maxOrderSize` | `10` | Max USDC per order |
| `maxPositionSize` | `50` | Max total USDC exposure |
| `maxDailyLoss` | `25` | Auto-stops trading after this loss |
| `maxTradesPerHour` | `10` | Rate limit |
| `minEntryPrice` | `0.60` | Only buy if leader is at this price or higher |
| `entryWindowStart` | `5` | Start looking for entries at this many minutes remaining |
| `entryWindowEnd` | `10` | Stop looking after this many minutes remaining |
| `takeProfitPct` | `0.80` | Sell early at this % gain (0.80 = 80%) |
| `tickInterval` | `30` | Seconds between each check |

## Strategy Logic

The "Ride the Wave" strategy bets that by minute 5-10 of a 15-minute window, BTC's direction is mostly decided. If one outcome is trading at $0.60+, it's statistically likely to resolve correct at $1.00.

**Entry:** Buy the leading outcome (Up or Down) when its price >= $0.60 and 5-10 minutes remain.

**Exit:**
- Take profit at 80% unrealized gain
- Lock profit if <1 minute remains and gain > 10%
- Otherwise hold to market resolution

**Safety:**
- Killswitch auto-activates if daily loss hits the limit
- One position at a time per market
- All orders are GTC limit orders on the Polymarket CLOB

## Files

```
standalone/
├── main.ts              # Entry point — run this
├── balance.ts           # Check account balance
├── config.json          # Trading parameters and risk limits
├── .env                 # API credentials (keep secret)
├── src/
│   ├── strategy.ts      # Trading logic (edit this to change strategy)
│   ├── executor.ts      # Order placement
│   ├── guardrails.ts    # Risk management
│   ├── market-discovery.ts  # Finds active 15-min markets
│   ├── balance.ts       # Balance fetching
│   ├── client.ts        # Polymarket CLOB client
│   └── config.ts        # Config types and defaults
├── package.json
└── tsconfig.json
```

## Example Output

```
2026-02-10T02:49:52Z === Polymarket BTC 15m Trader ===
2026-02-10T02:49:52Z Mode: DRY RUN
2026-02-10T02:49:52Z Trading: ENABLED
2026-02-10T02:49:52Z Polymarket client initialized successfully
2026-02-10T02:49:52Z Bot running. Press Ctrl+C to stop.

2026-02-10T02:49:52Z [tick #1] btc-updown-15m-1770691500 | Up=$0.54 Down=$0.47 | 10.1min left | WAIT: Too early
2026-02-10T02:50:22Z [tick #2] btc-updown-15m-1770691500 | Up=$0.62 Down=$0.38 | 9.6min left | BUY: Entry signal: "Up" at $0.62
2026-02-10T02:50:22Z [DRY RUN] Would BUY 16 shares of "Up" @ $0.62 ($9.92 total)
```
