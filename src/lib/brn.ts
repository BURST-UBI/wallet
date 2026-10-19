export interface BrnComponents {
  verified_at: number;
  total_burned: string;
  total_staked: string;
  accrual_active: boolean;
  accrual_stopped_at: number | null;
  paused_intervals?: { start: number; end: number }[];
  as_of: number;
  rate_history: { rate: string; start: number; end: number | null }[];
}

export function incomeStatus(state: BrnComponents | null, now: number) {
  const segment = state?.rate_history.find(rate => rate.start <= now && (rate.end === null || now < rate.end));
  if (!state || !segment || !/^\d+$/.test(segment.rate)) return { state: "unknown", daily: null } as const;
  const rate = BigInt(segment.rate);
  if (rate < 0n) return { state: "unknown", daily: null } as const;
  if (rate === 0n) return { state: "off", daily: "0" } as const;
  if (!state.accrual_active) return { state: "paused", daily: null } as const;
  return { state: "active", daily: (rate * 86400n).toString() } as const;
}

/** Whitepaper BRN equation, split at each governance rate change.
 * Integer raw units throughout; nothing is retroactively repriced. */
export function computeBrn(state: BrnComponents, now: number): string {
  const until = Math.floor(state.accrual_active ? now : Math.min(now, state.accrual_stopped_at ?? state.as_of));
  let accrued = 0n;
  for (const segment of state.rate_history) {
    const start = Math.max(segment.start, state.verified_at);
    const end = Math.min(segment.end ?? until, until);
    let seconds = Math.max(0, end - start);
    for (const pause of state.paused_intervals ?? []) {
      seconds -= Math.max(0, Math.min(end, pause.end) - Math.max(start, pause.start));
    }
    if (seconds > 0) {
      accrued += BigInt(seconds) * BigInt(segment.rate);
      if (accrued > (1n << 128n) - 1n) throw new Error("BRN accrual exceeds protocol precision");
    }
  }
  const balance = accrued - BigInt(state.total_burned) - BigInt(state.total_staked);
  if (balance > (1n << 128n) - 1n) throw new Error("BRN amount exceeds protocol precision");
  return (balance > 0n ? balance : 0n).toString();
}

/** Convert human BRN/TRST to raw units, without floating-point rounding. */
export function parseAmount(value: string): string {
  const input = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(input)) throw new Error("Enter a positive amount with at most 18 decimal places");
  const [whole, fraction = ""] = input.split(".");
  const raw = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (raw <= 0n || raw > (1n << 128n) - 1n) throw new Error("Amount is outside the protocol range");
  return raw.toString();
}
