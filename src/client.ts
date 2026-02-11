/**
 * Polymarket CLOB client initialization and management.
 * Wraps the official @polymarket/clob-client SDK.
 */

import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { TraderConfig, CLOB_HOST, POLYGON_CHAIN_ID } from "./config.js";

let clientInstance: ClobClient | null = null;

export async function initClient(config: TraderConfig): Promise<ClobClient> {
  const signer = new Wallet(config.privateKey);

  // Step 1: Create a temporary client to derive API credentials
  const tempClient = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey();

  // Step 2: Reinitialize with full auth (credentials + signature type + funder)
  clientInstance = new ClobClient(
    CLOB_HOST,
    POLYGON_CHAIN_ID,
    signer,
    apiCreds,
    config.signatureType,
    config.funderAddress,
  );

  return clientInstance;
}

export function getClient(): ClobClient {
  if (!clientInstance) {
    throw new Error("Polymarket client not initialized. Call initClient() first.");
  }
  return clientInstance;
}

export function isClientReady(): boolean {
  return clientInstance !== null;
}
