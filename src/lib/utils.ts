import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["caption", "ui", "heading", "title", "balance"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Protocol raw units are u128 with 1 BRN/TRST = 10^18 raw (decisions 5.2/6.1).
// Pure string math — u128 exceeds Number's 2^53 integer range, so this must
// never round-trip through Number/parseFloat.
const UNIT_DECIMALS = 18;
const DISPLAY_DECIMALS = 6;

export function formatAmount(raw: string, decimals = DISPLAY_DECIMALS): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > UNIT_DECIMALS) {
    throw new RangeError("Amount precision must be between 0 and 18 decimals");
  }
  if (!raw || /^0+$/.test(raw)) return decimals ? `0.${"0".repeat(decimals)}` : "0";
  const padded = raw.padStart(UNIT_DECIMALS + 1, "0");
  const integer = padded.slice(0, -UNIT_DECIMALS) || "0";
  const decimal = padded.slice(-UNIT_DECIMALS).slice(0, decimals);
  if (/^0+$/.test(integer + decimal)) {
    return decimals ? `<0.${"0".repeat(decimals - 1)}1` : "<1";
  }
  return decimals ? `${integer}.${decimal}` : integer;
}

export function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 20) return addr;
  return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
}

export function formatTimeRemaining(expiryTimestamp: number): string {
  const now = Date.now() / 1000;
  const remaining = expiryTimestamp - now;
  if (remaining <= 0) return "Expired";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatTimeSince(timestamp: number): string {
  const now = Date.now() / 1000;
  const elapsed = now - timestamp;
  if (elapsed < 0) return "just now";

  const seconds = Math.floor(elapsed);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function formatBrnAccrual(
  verifiedAt: number,
  totalBurned: string,
  rate: number,
): string {
  const now = Date.now() / 1000;
  const elapsed = Math.max(0, now - verifiedAt);
  const accrued = rate * elapsed;
  const burned = parseFloat(formatAmount(totalBurned, UNIT_DECIMALS));
  const available = Math.max(0, accrued - burned);
  return available.toFixed(6);
}
