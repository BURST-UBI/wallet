import type {GovernableParameter} from "./types";

const labels: Record<string, string> = {
  brn_rate: "BRN accrual rate", trst_expiry_secs: "TRST expiry",
  endorsement_threshold: "Endorsements for verification", endorsement_burn_amount: "Verification endorsement burn",
  num_verifiers: "Verifiers per panel", verification_threshold_bps: "Verification threshold",
  verifier_stake_amount: "Verifier stake", max_revotes: "Verification revotes",
  challenge_stake_amount: "Challenge stake", verification_timeout_secs: "Verification voting period",
  challenge_duration_secs: "Challenge voting period", challenge_reward_bps: "Challenge reward rate",
  challenge_reward_cap: "Challenge reward cap", governance_proposal_duration_secs: "Proposal support period",
  governance_exploration_duration_secs: "Governance voting period", governance_cooldown_duration_secs: "Governance cooldown",
  governance_supermajority_bps: "Governance approval threshold", governance_quorum_bps: "Governance quorum",
  governance_proposal_endorsements: "Endorsements for a proposal", governance_proposal_cost: "Proposal endorsement burn",
  governance_propagation_buffer_secs: "Vote propagation buffer", consti_supermajority_bps: "Constitution approval threshold",
  consti_quorum_bps: "Constitution quorum", new_wallet_spending_limit: "New wallet spending limit",
  new_wallet_limit_duration_secs: "New wallet spending-limit period", bootstrap_exit_threshold: "Bootstrap exit population",
  new_wallet_tx_limit_per_day: "New wallet daily transaction limit", new_wallet_rate_limit_duration_secs: "New wallet rate-limit period",
  min_work_difficulty: "Transaction work difficulty",
  min_verification_age_secs: "Minimum verified age for verifiers",
  neither_penalty_cooldown_secs: "Neither-vote penalty cooldown",
  neither_penalty_threshold_bps: "Neither-vote penalty threshold",
  neither_window_assignments: "Neither-vote history window",
  min_verifier_brn_balance: "Minimum verifier balance",
  emergency_voting_duration_secs: "Emergency voting period",
  emergency_quorum_bps: "Emergency quorum",
  emergency_supermajority_bps: "Emergency approval threshold",
};
export const parameterLabel = (name: string) => labels[name] ?? name.replace(/_/g, " ");
export function parameterUnitForName(name: string): GovernableParameter["unit"] | null {
  if (!(name in labels)) return null;
  if (name === "brn_rate") return "brn_per_second";
  if (["endorsement_burn_amount","verifier_stake_amount","challenge_stake_amount","governance_proposal_cost","min_verifier_brn_balance"].includes(name)) return "brn";
  if (["challenge_reward_cap","new_wallet_spending_limit"].includes(name)) return "trst";
  if (name.endsWith("_secs")) return "seconds";
  if (name.endsWith("_bps")) return "basis_points";
  return name === "min_work_difficulty" ? "difficulty" : "count";
}
export const parameterUnit = (unit: GovernableParameter["unit"]) => ({
  brn_per_second:"BRN per second", brn:"BRN", trst:"TRST", seconds:"seconds",
  basis_points:"%", count:"", difficulty:"difficulty",
})[unit];
const precision = (unit: GovernableParameter["unit"]) =>
  unit === "brn_per_second" || unit === "brn" || unit === "trst" ? 18 : unit === "basis_points" ? 2 : 0;

export function parameterInput(row: GovernableParameter, raw = row.current) {
  const decimals = precision(row.unit);
  if (!decimals) return raw;
  const padded = raw.padStart(decimals+1,"0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return padded.slice(0,-decimals) + (fraction ? "."+fraction : "");
}
export function parameterDisplay(row: GovernableParameter, raw = row.current) {
  if (row.name === "trst_expiry_secs" && raw === "18446744073709551615") return "No expiry";
  return [parameterInput(row,raw),parameterUnit(row.unit)].filter(Boolean).join(" ");
}
export function parameterRaw(row: GovernableParameter, input: string): string {
  const decimals = precision(row.unit);
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals || 1}})?$`).test(input) || (!decimals && input.includes("."))) {
    throw new Error(decimals ? `Enter a non-negative number with up to ${decimals} decimal places.` : "Enter a non-negative whole number.");
  }
  const [whole,fraction=""] = input.split(".");
  const value = BigInt(whole + fraction.padEnd(decimals,"0"));
  if (value > BigInt(row.maximum)) throw new Error(`The maximum is ${parameterDisplay(row,row.maximum)}.`);
  return value.toString();
}
