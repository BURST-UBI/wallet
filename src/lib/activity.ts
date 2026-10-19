import type { ComponentType, SVGProps } from "react";
import { ArrowUpRight, ArrowDownLeft, Shield, Vote, FileText } from "lucide-react";
import { BrnIcon, TrstIcon, WalletIcon } from "@/components/burst-icons";

const kinds: Record<string, { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = {
  open: { label: "Wallet opened", Icon: WalletIcon },
  send: { label: "Sent TRST", Icon: ArrowUpRight },
  receive: { label: "Received TRST", Icon: ArrowDownLeft },
  rejectreceive: { label: "Payment returned", Icon: WalletIcon },
  burn: { label: "Paid with BRN", Icon: BrnIcon },
  merge: { label: "TRST combined", Icon: TrstIcon },
  endorse: { label: "Wallet endorsed", Icon: Shield },
  challenge: { label: "Wallet challenged", Icon: Shield },
  verificationvote: { label: "Verification vote", Icon: Shield },
  verifieroptin: { label: "Volunteered to verify", Icon: Shield },
  verifieroptout: { label: "Stopped volunteering", Icon: Shield },
  governanceproposal: { label: "Proposal submitted", Icon: Vote },
  governancevote: { label: "Proposal vote", Icon: Vote },
  governanceendorse: { label: "Proposal endorsed", Icon: Vote },
  governancewithdraw: { label: "Proposal withdrawn", Icon: Vote },
  governanceactivation: { label: "Protocol updated", Icon: FileText },
  delegate: { label: "Voting delegated", Icon: Vote },
  revokedelegation: { label: "Delegation removed", Icon: Vote },
  changerepresentative: { label: "Account updated", Icon: WalletIcon },
  epoch: { label: "Protocol updated", Icon: FileText },
};
const unknownActivity = { label: "Account activity", Icon: FileText };

export function activityPresentation(blockType: string) {
  const key = blockType.toLowerCase();
  return Object.prototype.hasOwnProperty.call(kinds, key) ? kinds[key] : unknownActivity;
}
