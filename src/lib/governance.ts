import type { Proposal } from "./types";
import { parameterDisplay, parameterUnitForName } from "./parameters";

const phases: Record<string, string> = {
  Proposal: "Collecting support", Exploration: "Voting", Cooldown: "Discussion",
  Promotion: "Legacy proposal", Activation: "Scheduled", Activated: "In effect",
  Rejected: "Not passed", Withdrawn: "Withdrawn", Conflicted: "Could not apply",
};

export function governancePhaseLabel(proposal: Pick<Proposal, "phase" | "phase_projected">) {
  if (proposal.phase_projected) {
    if (["Activated", "Rejected", "Conflicted", "Expired"].includes(proposal.phase)) return "Result pending";
    return `${phases[proposal.phase] ?? proposal.phase} · Provisional`;
  }
  return phases[proposal.phase] ?? proposal.phase;
}

export function governanceParameterLabel(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")
    .replace(/\bbrn\b/gi, "BRN").replace(/\btrst\b/gi, "TRST")
    .replace(/\bRate\b/g, "rate");
}

export function governanceValue(proposal: Pick<Proposal, "param" | "proposed_value">) {
  const raw = proposal.proposed_value;
  if (!raw) return "Not provided";
  const name = proposal.param?.replace(/([a-z])([A-Z])/g,"$1_$2").toLowerCase();
  const unit = name ? parameterUnitForName(name) : null;
  if (name && unit && /^\d+$/.test(raw)) {
    return parameterDisplay({name,unit,current:raw,maximum:"",legacy:false});
  }
  if (proposal.param?.endsWith("Secs")) return raw + " seconds";
  if (proposal.param?.endsWith("Bps")) return raw + " basis points";
  return raw;
}

export function governanceTitle(proposal: Pick<Proposal, "description" | "param" | "proposed_value">) {
  const generated = /^Change ([A-Za-z]+) to (\d+)$/.exec(proposal.description);
  if (!generated) return proposal.description;
  const param = proposal.param ?? generated?.[1];
  const proposed_value = proposal.proposed_value ?? generated?.[2];
  if (!param || param === "constitution" || !proposed_value) return proposal.description;
  return `Change ${governanceParameterLabel(param)} to ${governanceValue({param, proposed_value})}`;
}
