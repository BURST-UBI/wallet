export interface WalletInfo {
  address: string;
  verification_state: string;
}

export interface TrstBalance {
  active: string;
  expired: string;
  revoked: string;
}

export interface AccountInfo {
  address: string;
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
  origin: string;
  amount: string;
  originator: string;
  timestamp: number;
  expiry_at: number;
  status: "active" | "expired" | "revoked";
  chain_length: number;
}

export interface TrstPortfolio {
  batches: TrstBatch[];
  total_active: string;
  total_expired: string;
  total_revoked: string;
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
}

export interface DelegationInfo {
  delegated_to?: string;
  delegated_from: string[];
}

export interface HistoryEntry {
  hash: string;
  block_type: string;
  account: string;
  amount: string;
  timestamp: string;
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
}

export interface PendingBlocks {
  blocks: PendingBlock[];
}

export interface BlockResult {
  hash: string;
  accepted: boolean;
  detail?: string;
}
