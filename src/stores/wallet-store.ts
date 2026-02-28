import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WalletState {
  address: string | null;
  isLocked: boolean;
  rpcUrl: string;
  verificationState: string;
  setAddress: (address: string | null) => void;
  setLocked: (locked: boolean) => void;
  setRpcUrl: (url: string) => void;
  setVerificationState: (state: string) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      address: null,
      isLocked: true,
      rpcUrl: "http://127.0.0.1:7077",
      verificationState: "Unverified",
      setAddress: (address) => set({ address }),
      setLocked: (isLocked) => set({ isLocked }),
      setRpcUrl: (rpcUrl) => set({ rpcUrl }),
      setVerificationState: (verificationState) => set({ verificationState }),
    }),
    { name: "burst-wallet" },
  ),
);
