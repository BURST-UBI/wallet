export interface GroupEndpoint {
  id: string;
  name: string;
  description: string;
  endpoint_url: string;
  trust_directly?: boolean;
}

export interface GroupPolicy {
  mode: "protocol" | "personal" | "any" | "all";
  groups: GroupEndpoint[];
  trusted_creators?: string[];
  offline_fallback: "protocol" | "review";
  max_hops?: number;
}

export const defaultGroupPolicy: GroupPolicy = {mode:"protocol",groups:[],offline_fallback:"protocol",max_hops:0};

export function readGroupPolicy(value: unknown): GroupPolicy | null {
  if (!value || typeof value !== "object") return null;
  const policy=value as Partial<GroupPolicy>;
  if (!["protocol","personal","any","all"].includes(policy.mode ?? "") || !["protocol","review"].includes(policy.offline_fallback ?? "")) return null;
  const creators=policy.trusted_creators===undefined ? [] : policy.trusted_creators;
  if (!Array.isArray(creators) || creators.length>256 || creators.some(address=>typeof address!=="string" || !address.trim() || address!==address.trim() || address.length>128)) return null;
  if (policy.mode==="personal" && !creators.length) return null;
  const usesGroups=policy.mode==="any" || policy.mode==="all";
  if (!Array.isArray(policy.groups) || policy.groups.length>32 || (usesGroups && !policy.groups.length)) return null;
  const maxHops=policy.max_hops===undefined ? 0 : policy.max_hops;
  if (!Number.isInteger(maxHops) || maxHops<0 || maxHops>8) return null;
  if (usesGroups && !policy.groups.some(group=>group && group.trust_directly!==false)) return null;
  const ids=new Set<string>();
  const encoder=new TextEncoder();
  for (const group of policy.groups) {
    if (!group || typeof group!=="object" || typeof group.id!=="string" || !group.id.trim() || group.id!==group.id.trim()
      || encoder.encode(group.id).length>128 || /[\u0000-\u001f\u007f-\u009f]/.test(group.id) || ids.has(group.id)
      || typeof group.name!=="string" || !group.name.trim() || encoder.encode(group.name).length>128 || /[\u0000-\u001f\u007f-\u009f]/.test(group.name)
      || typeof group.description!=="string" || encoder.encode(group.description).length>4096
      || typeof group.endpoint_url!=="string" || encoder.encode(group.endpoint_url).length>2048
      || (group.trust_directly!==undefined && typeof group.trust_directly!=="boolean")) return null;
    try {
      const endpoint=new URL(group.endpoint_url);
      if (!["https:","http:"].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    } catch {return null;}
    ids.add(group.id);
  }
  return {mode:policy.mode!,groups:policy.groups.map(group=>({...group,trust_directly:group.trust_directly??true})),offline_fallback:policy.offline_fallback!,max_hops:maxHops,trusted_creators:creators};
}
