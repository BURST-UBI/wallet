export interface WalletInfo {
  address: string;
  verification_state: string;
  recovery_phrase?: string;
  watch_only?: boolean;
}

export interface TrstBalance {
  active: string;
  expired: string;
  revoked: string;
  pending?: string | null;
}

export interface AccountInfo {
  address: string;
  /** Spendable BRN computed by account_info, including rate history and stakes.
   * Unlike the similarly named state-block field, this is NOT a spent odometer. */
  brn_balance: string;
  trst_balance: string;
  trst_expired: string;
  trst_revoked: string;
  total_brn_burned: string;
  total_brn_staked: string;
  verification_state: string;
  verified_at?: number;
  block_count: string;
  confirmation_height: string;
  representative: string;
}

export interface TrstBatch {
  id?: string | null;
  origin_kind?: string | null;
  origin: string;
  amount: string;
  originator: string;
  timestamp: number;
  expiry_at: number | null;
  reference_value_bps?: number | null;
  status: "active" | "expired" | "revoked";
  chain_length: number | null;
}

export interface TrstPortfolio {
  batches: TrstBatch[];
  total_active: string;
  total_expired: string;
  total_revoked: string;
  total_pending?: string | null;
}

export interface VerifierVote {
  verifier: string;
  vote: string;
  timestamp: number;
}

export interface VerificationStatus {
  state: string;
  verified_at?: number;
  endorsement_count: number;
  endorsement_threshold: number;
  endorsers: string[];
  verifier_votes: VerifierVote[];
  challenge_active: boolean;
  selection_available?: boolean | null;
  verifier_opted_in?: boolean | null;
}

export interface DelegationInfo {
  delegated_to?: string;
  delegated_from: string[];
}

export interface Proposal {
  hash: string;
  proposer: string;
  phase: string;
  phase_projected?: boolean;
  description: string;
  param?: string;
  proposed_value?: string;
  votes_yea: number;
  votes_nay: number;
  votes_abstain?: number;
  created_at?: number;
  phase_deadline?: number;
  amendment_text?: string;
  amendment_operations?: AmendmentOperation[];
  activation_conflict?: Record<string, string | number>;
}

export type AmendmentOperation =
  | {AddArticle: {title: string; text: string}}
  | {ModifyArticle: {article_number: string; new_text: string}}
  | {RepealArticle: {article_number: string}};
export interface ConstitutionDocument {
  version: string;
  articles: {id: string; title: string; text: string}[];
}
export interface ConstitutionContext {
  parameters?: GovernableParameter[];
  enabled: boolean;
  document: ConstitutionDocument;
  genesis: string;
  params_hash: string;
  endorsement_cost: string;
  revision: string;
}

export interface GovernableParameter {
  name: string;
  current: string;
  maximum: string;
  unit: "brn_per_second" | "brn" | "trst" | "seconds" | "basis_points" | "count" | "difficulty";
  legacy: boolean;
}

export interface ProposalList {
  proposals: Proposal[];
  cursor?: string;
}

export interface HistoryEntry {
  hash: string;
  block_type: string;
  account: string;
  amount: string;
  timestamp: number;
  origin?: string;
  link?: string;
}

export interface AccountHistory {
  account: string;
  history: HistoryEntry[];
  cursor?: string;
}

export interface PendingBlock {
  hash: string;
  source: string;
  amount: string;
  block_type: string;
  return_credit?: boolean;
}

export interface PendingBlocks {
  blocks: PendingBlock[];
  cursor?: string | null;
}

export interface BlockResult {
  hash: string;
  accepted: boolean;
  detail?: string;
}
