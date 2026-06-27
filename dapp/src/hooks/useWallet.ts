// Wallet connection hook using Freighter

import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction,
  getNetwork,
} from "@stellar/freighter-api";
import { useWalletStore } from "@/store/wallet";

export function useWallet() {
  const { address, network, setAddress, setNetwork, clear } =
    useWalletStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already connected on mount
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const { isConnected: installed, error: connError } =
        await isConnected();
      if (connError || !installed) return;

      const { address: addr, error: addrError } = await getAddress();
      if (addrError || !addr) return;

      const { network: net, error: netError } = await getNetwork();
      if (netError) return;

      setAddress(addr);
      setNetwork(net);
    } catch {
      // Freighter not available
    }
  };

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { isConnected: installed, error: connError } =
        await isConnected();
      if (connError || !installed) {
        throw new Error("Freighter extension not installed");
      }

      const { address: addr, error: accessError } =
        await requestAccess();
      if (accessError) throw new Error(accessError.message);

      const { network: net, error: netError } = await getNetwork();
      if (netError) throw new Error(netError.message);

      setAddress(addr);
      setNetwork(net);
      return addr;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setAddress, setNetwork]);

  const disconnect = useCallback(() => {
    clear();
  }, [clear]);

  const sign = useCallback(
    async (xdr: string, networkPassphrase: string) => {
      if (!address) throw new Error("Wallet not connected");
      const { signedTxXdr, error: signError } = await signTransaction(
        xdr,
        { networkPassphrase }
      );
      if (signError) throw new Error(signError.message);
      return signedTxXdr;
    },
    [address]
  );

  return {
    address,
    network,
    connected: !!address,
    loading,
    error,
    connect,
    disconnect,
    sign,
  };
}
