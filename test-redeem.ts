/**
 * One-time redemption test
 * Usage: bun run test-redeem.ts
 */
import { ethers } from "ethers";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
const USDC_ABI = ["function balanceOf(address owner) view returns (uint256)"];

const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS;
if (!privateKey || !funderAddress) {
  console.error("Set POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS");
  process.exit(1);
}

const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

console.log(`EOA: ${wallet.address}`);
console.log(`Proxy: ${funderAddress}`);

const maticBal = await provider.getBalance(wallet.address);
console.log(`MATIC: ${ethers.utils.formatEther(maticBal)}`);

const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);
const factory = new ethers.Contract(PROXY_WALLET_FACTORY, PROXY_FACTORY_ABI, wallet);

const balBefore = await usdc.balanceOf(funderAddress);
console.log(`Proxy USDC before: $${(parseFloat(balBefore.toString()) / 1e6).toFixed(2)}`);

// Scan last 20 markets for unredeemed tokens
const MARKET_DURATION_SEC = 900;
const nowSec = Math.floor(Date.now() / 1000);
const currentSlotStart = Math.floor(nowSec / MARKET_DURATION_SEC) * MARKET_DURATION_SEC;
const GAMMA_HOST = "https://gamma-api.polymarket.com";

console.log(`\nScanning last 20 markets for unredeemed tokens...`);

const ctfIface = new ethers.utils.Interface([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
]);

let redeemed = 0;

for (let i = 0; i <= 20; i++) {
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

    let tokenIds: string[] = [];
    try {
      tokenIds = typeof market.clobTokenIds === "string"
        ? JSON.parse(market.clobTokenIds)
        : (market.clobTokenIds || []);
    } catch { continue; }

    await sleep(1500); // rate limit

    for (const tokenId of tokenIds) {
      let bal;
      try {
        bal = await ctf.balanceOf(funderAddress, tokenId);
      } catch { await sleep(3000); continue; }

      if (bal.gt(0)) {
        console.log(`\n  FOUND: ${slug}`);
        console.log(`    Token: ${tokenId.slice(0, 20)}...`);
        console.log(`    Balance: ${ethers.utils.formatUnits(bal, 6)} shares`);
        console.log(`    Condition: ${conditionId}`);
        console.log(`    Closed: ${market.closed ?? false}`);

        // Attempt redemption
        console.log(`    Redeeming...`);
        await sleep(2000);
        try {
          const data = ctfIface.encodeFunctionData("redeemPositions", [
            USDC_ADDRESS, ethers.constants.HashZero, conditionId, [1, 2],
          ]);

          const tx = await factory.proxy(
            [{ to: CTF_ADDRESS, typeCode: "1", data, value: "0" }],
            { gasLimit: 500000, gasPrice: ethers.utils.parseUnits("50", "gwei") },
          );
          console.log(`    Tx: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`    Confirmed block ${receipt.blockNumber}, gas ${receipt.gasUsed.toString()}, status ${receipt.status}`);
          redeemed++;
        } catch (err: any) {
          const reason = err.reason || err.error?.message || err.message || String(err);
          console.log(`    Failed: ${reason}`);
        }
        await sleep(2000);
      }
    }
  } catch { continue; }
}

if (redeemed === 0) {
  console.log("\nNo positions were redeemed.");
}

await sleep(2000);
const balAfter = await usdc.balanceOf(funderAddress);
console.log(`\nProxy USDC after: $${(parseFloat(balAfter.toString()) / 1e6).toFixed(2)}`);
const diff = parseFloat(balAfter.toString()) - parseFloat(balBefore.toString());
if (diff > 0) {
  console.log(`Recovered: +$${(diff / 1e6).toFixed(2)}`);
}

console.log("Done.");
