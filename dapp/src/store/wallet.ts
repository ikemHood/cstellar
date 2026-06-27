// Wallet state store (Zustand)

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WalletState {
  address: string | null;
  network: string | null;
  setAddress: (address: string) => void;
  setNetwork: (network: string) => void;
  clear: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      address: null,
      network: null,
      setAddress: (address) => set({ address }),
      setNetwork: (network) => set({ network }),
      clear: () => set({ address: null, network: null }),
    }),
    { name: "sct01-wallet" }
  )
);
