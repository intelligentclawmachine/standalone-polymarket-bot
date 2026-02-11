/**
 * On-chain token redemption for resolved Polymarket positions.
 *
 * Scans recent BTC 15-min markets for CTF tokens held by the proxy wallet,
 * then calls redeemPositions on the CTF contract through the proxy factory.
 *
 * Runs 30s after startup, then every 45 minutes.
 */

import { ethers } from "ethers";
import { GAMMA_HOST, MARKET_DURATION_SEC } from "./config.js";
import { logResolution, hasResolution } from "./trade-log.js";

// Polygon contract addresses
const PROXY_WALLET_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052";
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const PROXY_FACTORY_ABI = [
  "function proxy(tuple(address to, string typeCode, bytes data, string value)[] calls) external",
];

const CTF_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
];

type Logger = (...args: any[]) => void;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Parse the winning outcome from Gamma API market data.
 * outcomePrices is "1,0" or '["1","0"]' for resolved markets.
 */
function getWinner(market: any): "Up" | "Down" | null {
  let outcomes: string[] = [];
  let prices: string[] = [];
  try {
    outcomes = typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : (market.outcomes || []);
    const raw = market.outcomePrices;
    if (typeof raw === "string") {
      prices = raw.startsWith("[") ? JSON.parse(raw) : raw.split(",");
    } else if (Array.isArray(raw)) {
      prices = raw.map(String);
    }
  } catch { return null; }

  for (let i = 0; i < prices.length; i++) {
    if (parseFloat(prices[i]) === 1) {
      const label = (outcomes[i] || "").toLowerCase();
      return label.includes("up") ? "Up" : "Down";
    }
  }
  return null;
}

/**
 * Wait for a tx receipt with retries (public RPCs rate-limit aggressively).
 */
async function waitForTx(
  tx: ethers.providers.TransactionResponse,
  provider: ethers.providers.JsonRpcProvider,
  logger: Logger,
): Promise<ethers.providers.TransactionReceipt | null> {
  // Try tx.wait() first
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await tx.wait();
    } catch {
      logger(`[REDEEM] Waiting for confirmation (attempt ${attempt + 2}/4)...`);
      await sleep(5000);
    }
  }

  // Last resort: poll getTransactionReceipt directly
  try {
    await sleep(10000);
    const receipt = await provider.getTransactionReceipt(tx.hash);
    if (receipt && receipt.blockNumber) return receipt;
  } catch {}

  return null;
}

/**
 * Run one redemption sweep: scan the last N markets on-chain for unredeemed
 * CTF tokens held by the proxy wallet, then redeem them.
 */
export async function runRedemptionSweep(
  privateKey: string,
  funderAddress: string,
  logger: Logger,
): Promise<void> {
  const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

  let provider: ethers.providers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  try {
    provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    wallet = new ethers.Wallet(privateKey, provider);
  } catch (err: any) {
    logger(`[REDEEM] Failed to connect to Polygon RPC: ${err.message}`);
    return;
  }

  // Check MATIC balance for gas
  try {
    const maticBal = await provider.getBalance(wallet.address);
    if (maticBal.lt(ethers.utils.parseEther("0.001"))) {
      logger(`[REDEEM] Skipping — EOA has insufficient MATIC for gas (${ethers.utils.formatEther(maticBal)})`);
      return;
    }
  } catch (err: any) {
    logger(`[REDEEM] RPC error checking balance: ${err.message}`);
    return;
  }

  const factory = new ethers.Contract(PROXY_WALLET_FACTORY, PROXY_FACTORY_ABI, wallet);
  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);

  const nowSec = Math.floor(Date.now() / 1000);
  const currentSlotStart = Math.floor(nowSec / MARKET_DURATION_SEC) * MARKET_DURATION_SEC;

  const ctfIface = new ethers.utils.Interface(CTF_ABI);

  let redeemedCount = 0;

  // Scan last 20 market slots for unredeemed tokens
  for (let i = 1; i <= 20; i++) {
    const slotStart = currentSlotStart - (i * MARKET_DURATION_SEC);
    const slug = `btc-updown-15m-${slotStart}`;

    try {
      const res = await fetch(`${GAMMA_HOST}/markets?slug=${slug}`);
      if (!res.ok) continue;
      const markets = await res.json();
      if (!Array.isArray(markets) || markets.length === 0) continue;

      const market = markets[0];
      const conditionId = market.conditionId || market.condition_id;
      if (!conditionId) continue;

      // Log resolution if we haven't already
      const winner = getWinner(market);
      if (winner && !hasResolution(slug)) {
        logResolution(slug, winner);
        logger(`[REDEEM] Resolved: ${slug} → ${winner}`);
      }

      let tokenIds: string[] = [];
      try {
        tokenIds = typeof market.clobTokenIds === "string"
          ? JSON.parse(market.clobTokenIds)
          : (market.clobTokenIds || []);
      } catch { continue; }

      await sleep(2000); // respect RPC rate limits

      for (const tokenId of tokenIds) {
        let bal: ethers.BigNumber;
        try {
          bal = await ctf.balanceOf(funderAddress, tokenId);
        } catch {
          await sleep(5000);
          continue;
        }

        if (bal.gt(0)) {
          const shares = ethers.utils.formatUnits(bal, 6);
          logger(`[REDEEM] Found ${shares} shares on ${slug} (condition: ${conditionId.slice(0, 10)}...)`);

          await sleep(3000);

          try {
            const data = ctfIface.encodeFunctionData("redeemPositions", [
              USDC_ADDRESS,
              ethers.constants.HashZero,
              conditionId,
              [1, 2],
            ]);

            const tx = await factory.proxy(
              [{ to: CTF_ADDRESS, typeCode: "1", data, value: "0" }],
              { gasLimit: 500000, gasPrice: ethers.utils.parseUnits("50", "gwei") },
            );

            logger(`[REDEEM] Tx submitted: ${tx.hash}`);

            const receipt = await waitForTx(tx, provider, logger);

            if (receipt && receipt.status === 1) {
              logger(`[REDEEM] Redeemed ${shares} shares from ${slug} — block ${receipt.blockNumber}`);
              redeemedCount++;
            } else if (receipt && receipt.status === 0) {
              logger(`[REDEEM] Tx reverted on ${slug} — market may not be resolved yet`);
            } else {
              logger(`[REDEEM] Tx sent for ${slug} (${tx.hash}) — receipt unavailable due to RPC limits, will verify next sweep`);
              redeemedCount++;
            }
          } catch (err: any) {
            const reason = err.reason || err.error?.message || err.message || String(err);
            if (reason.includes("insufficient funds")) {
              logger(`[REDEEM] Out of MATIC for gas — stopping sweep`);
              return;
            }
            logger(`[REDEEM] Failed on ${slug}: ${reason}`);
          }

          await sleep(5000); // longer pause between redemptions
        }
      }
    } catch {
      continue;
    }
  }

  if (redeemedCount === 0) {
    logger("[REDEEM] Sweep complete — no unredeemed tokens found");
  } else {
    logger(`[REDEEM] Sweep complete — redeemed ${redeemedCount} position(s)`);
  }
}

let redeemTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the redemption timer: first sweep at 30s, then every 45 minutes.
 */
export function startRedemptionTimer(
  privateKey: string,
  funderAddress: string,
  logger: Logger,
): void {
  const FORTY_FIVE_MIN_MS = 45 * 60 * 1000;

  logger("[REDEEM] Redemption timer started (first sweep in 30s, then every 45min)");

  setTimeout(() => runRedemptionSweep(privateKey, funderAddress, logger), 30_000);

  redeemTimer = setInterval(() => {
    runRedemptionSweep(privateKey, funderAddress, logger);
  }, FORTY_FIVE_MIN_MS);
}

/**
 * Stop the redemption timer.
 */
export function stopRedemptionTimer(): void {
  if (redeemTimer) {
    clearInterval(redeemTimer);
    redeemTimer = null;
  }
}
