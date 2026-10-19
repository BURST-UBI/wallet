import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { defaultGroupPolicy, readGroupPolicy, type GroupPolicy } from "@/lib/group-policy";

interface WalletState {
  address: string | null;
  isLocked: boolean;
  watchOnly: boolean;
  setWatchOnly: (watchOnly: boolean) => void;
  isLocking: boolean;
  lockWallet: () => Promise<boolean>;
  rpcUrl: string;
  verificationState: string;
  autoAccept: boolean;
  trustedSenders: string[];
  mergeLevel: number;
  groupPolicy: GroupPolicy | null;
  groupHolds: Record<string,string>;
  setGroupPolicy: (policy: GroupPolicy) => void;
  setGroupHolds: (holds: Record<string,string>) => void;
  setAutomation: (value: Partial<Pick<WalletState, "autoAccept" | "trustedSenders" | "mergeLevel">>) => void;
  setAddress: (address: string | null) => void;
  setLocked: (locked: boolean) => void;
  setRpcUrl: (url: string) => void;
  setVerificationState: (state: string) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      address: null,
      isLocked: true,
      watchOnly: false,
      setWatchOnly: (watchOnly) => set({ watchOnly }),
      isLocking: false,
      lockWallet: async () => {
        if (get().isLocking) return false;
        set({ isLocking: true });
        try {
          await invoke("lock_wallet");
          set({ isLocked: true, watchOnly: false, address: null, verificationState: "Unverified" });
          return true;
        } finally {
          set({ isLocking: false });
        }
      },
      rpcUrl: "http://127.0.0.1:7077",
      verificationState: "Unverified",
      autoAccept: true,
      trustedSenders: [],
      mergeLevel: 50,
      groupPolicy: defaultGroupPolicy,
      groupHolds: {},
      setGroupPolicy: (groupPolicy) => set({groupPolicy,groupHolds:{}}),
      setGroupHolds: (groupHolds) => set({groupHolds}),
      setAutomation: (value) => set(value),
      setAddress: (address) => set({ address }),
      setLocked: (isLocked) => set({ isLocked }),
      setRpcUrl: (rpcUrl) => set({ rpcUrl }),
      setVerificationState: (state) => set({ verificationState: state.charAt(0).toUpperCase() + state.slice(1).toLowerCase() }),
    }),
    {
      name: "burst-wallet",
      // Rust owns the unlocked key. A persisted UI flag cannot restore it.
      partialize: ({ rpcUrl, autoAccept, trustedSenders, mergeLevel, groupPolicy }) => ({ rpcUrl, autoAccept, trustedSenders, mergeLevel, groupPolicy }),
      merge: (saved, current) => ({
        ...current,
        groupPolicy: saved && typeof saved==="object" && "groupPolicy" in saved ? readGroupPolicy(saved.groupPolicy) : defaultGroupPolicy,
        autoAccept: typeof (saved as Partial<WalletState>)?.autoAccept === "boolean" ? (saved as Partial<WalletState>).autoAccept! : true,
        trustedSenders: Array.isArray((saved as Partial<WalletState>)?.trustedSenders) ? (saved as Partial<WalletState>).trustedSenders!.filter(s => typeof s === "string") : [],
        mergeLevel: typeof (saved as Partial<WalletState>)?.mergeLevel === "number" ? Math.max(0, Math.min(100, (saved as Partial<WalletState>).mergeLevel!)) : 50,
        rpcUrl: typeof (saved as Partial<WalletState>)?.rpcUrl === "string"
          ? (saved as Partial<WalletState>).rpcUrl! : current.rpcUrl,
      }),
    },
  ),
);
