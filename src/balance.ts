/**
 * Fetches Polymarket account balance via the CLOB client.
 */

import { AssetType } from "@polymarket/clob-client";
import { getClient } from "./client.js";

export interface AccountBalance {
  collateral: string;   // USDC balance available for trading
  allowance: string;    // USDC spending allowance on CLOB
}

export async function fetchBalance(): Promise<AccountBalance> {
  const client = getClient();
  const res = await client.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });
  return {
    collateral: res.balance ?? "N/A",
    allowance: (res as any).allowance ?? "N/A",
  };
}
