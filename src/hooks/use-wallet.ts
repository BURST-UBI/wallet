import { useWalletStore } from "@/stores/wallet-store";

export function useWallet() {
  return useWalletStore();
}
