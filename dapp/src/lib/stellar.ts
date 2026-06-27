// Stellar SDK configuration and helpers

import * as StellarSdk from "@stellar/stellar-sdk";

// Network configuration from environment
export const config = {
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
  rpcUrl:
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
    "https://soroban-testnet.stellar.org",
  horizonUrl:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    "https://horizon-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
    StellarSdk.Networks.TESTNET,
  wrapperContractId:
    process.env.NEXT_PUBLIC_WRAPPER_CONTRACT_ID || "",
  verifierContractId:
    process.env.NEXT_PUBLIC_VERIFIER_CONTRACT_ID || "",
  assetAddress:
    process.env.NEXT_PUBLIC_ASSET_ADDRESS || "",
};

// SDK instances
export const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
export const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);

/**
 * Get account balance for a specific asset.
 */
export async function getBalance(
  address: string,
  assetCode?: string
): Promise<string> {
  try {
    const account = await horizon.loadAccount(address);
    if (!assetCode || assetCode === "XLM") {
      const native = account.balances.find(
        (b) => b.asset_type === "native"
      );
      return native?.balance || "0";
    }
    const asset = account.balances.find(
      (b) =>
        b.asset_type !== "native" &&
        "asset_code" in b &&
        b.asset_code === assetCode
    );
    return (asset as any)?.balance || "0";
  } catch {
    return "0";
  }
}

/**
 * Format an amount with decimals for display.
 */
export function formatAmount(
  amount: bigint | string | number,
  decimals: number = 7
): string {
  const value =
    typeof amount === "bigint"
      ? Number(amount) / Math.pow(10, decimals)
      : typeof amount === "string"
      ? parseFloat(amount)
      : amount / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse a display amount to stroops (smallest unit).
 */
export function parseAmount(
  displayAmount: string,
  decimals: number = 7
): bigint {
  const value = parseFloat(displayAmount);
  if (isNaN(value) || value <= 0) return 0n;
  return BigInt(Math.round(value * Math.pow(10, decimals)));
}
