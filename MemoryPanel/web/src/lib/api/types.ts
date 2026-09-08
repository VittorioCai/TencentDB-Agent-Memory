/**
 * api/types.ts — 跨模块共享的类型定义。
 *
 * 只放被 2 个以上 API 模块引用的类型；单一模块专属类型就近放在对应模块文件里。
 */

/** meta / control 信封格式 */
export interface MetaEnvelope<T> {
  code: number;
  message: string;
  request_id: string;
  data: T | null;
}

/** 内核分页响应（task/list、agent/list 等） */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * auth/verify、user/get、user/list 均会返回的公共用户结构。
 * `user_type === 'system_admin'` 是判断"当前登录用户是不是 admin"的唯一权威字段。
 */
export interface PublicUser {
  user_id: string;
  auth_provider: string;
  external_id: string;
  username: string;
  display_name?: string;
  email?: string;
  status: 'active' | 'inactive' | 'invited';
  created_at: string;
  updated_at: string;
  /**
   * 全局用户类型（auth/verify、user/get、user/list 均会返回），
   * 'system_admin' = 全局唯一的 admin 身份，与 team 无关；其余（如 'user'）都是普通用户。
   * 这是判断"当前登录用户是不是 admin"的唯一权威字段——不要再用 username === 'admin' 兜底猜。
   */
  user_type?: 'system_admin' | 'user' | string;
}

export interface Team {
  team_id: string;
  name: string;
  description?: string;
  owner_user_id: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'admin' | 'member' | 'reviewer';
  joined_at: string;
  status: 'active' | 'removed';
  /** team-member/list · get 响应附带（读时 JOIN） */
  username?: string;
}

export interface Agent {
  agent_id: string;
  team_id: string;
  owner_user_id: string;
  name: string;
  description?: string;
  prompt?: string;
  visibility: 'private' | 'task' | 'agent' | 'team' | 'restricted';
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export type AssetType = 'skill' | 'llm_wiki' | 'code_graph' | 'chat_memory';
export type AssetStatus = 'draft' | 'candidate' | 'approved' | 'deprecated' | 'archived';

export interface Asset {
  asset_id: string;
  team_id: string;
  asset_type: AssetType;
  name: string;
  description?: string;
  owner_user_id: string;
  source_type: 'uploaded' | 'url' | 'extracted' | 'synced';
  source_ref?: string;
  version: number;
  visibility: 'private' | 'task' | 'agent' | 'team' | 'restricted';
  status: AssetStatus;
  confidence?: number;
  expires_at?: string;
  last_used_at?: string;
  usage_count: number;
  content_ref?: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface AgentAssetView {
  asset_id: string;
  asset_type: AssetType;
  name: string;
  description?: string;
  status: AssetStatus;
  visibility: string;
  injection_mode: 'direct' | 'summary' | 'tool' | 'reference';
  priority: number;
  created_at: string;
}

export interface FixedAssetBinding {
  asset_id: string;
  asset_type: AssetType;
  injection_mode?: 'direct' | 'summary' | 'tool' | 'reference';
  priority?: number;
}

// ===== Admission gate (Core, 2026-09-07) =====
export type GateDecisionKind = 'admit' | 'pending' | 'reject';
export type ReviewPriority = 'high' | 'normal' | 'low';
export interface AuthorAssessmentSummary {
  competence: 'high' | 'medium' | 'low' | 'unknown';
  competence_as_said?: string;
  domain: string;
  assessed_at: string;
  /** Only records dated at or before this were used (2026-09-08b). */
  evidence_cutoff?: string | null;
  citations: number;
  execution_claims?: { success: number; failure: number } | null;
  asset_claim_check?: { verdict: 'supports' | 'contradicts' | 'silent'; record_ids?: string[]; strength?: 'strong' | 'weak' | null } | null;
  written_by?: string;
  written_at?: string;
}
export interface GateDecision {
  schema_version: string;
  rules_version: string;
  asset_id: string;
  decided_at: string;
  decision: GateDecisionKind;
  status_target: 'approved' | 'failed' | 'candidate';
  asset_version?: number;
  content_hash?: string | null;
  confidence: number | null;
  /** Denominator behind confidence: cross-person calls that validated or were corrected (2026-09-08). */
  confidence_n?: number;
  evidence_policy?: 'trusted-only';
  reasons: string[];
  evidence_refs: Array<{ outcome_id: string; state: string; relation: string; call_id?: string | null }>;
  signals: {
    online: { validated: number; corrected: number; used: number; cross_user_validated: number; distinct_consumers: number; distinct_tasks: number; calls?: number; untrusted_ignored?: number; other_version?: number; unbound_ignored?: number; retracted_ignored?: number; same_call_ties?: number };
    author: { user_id: string; validated: number; corrected: number; distinct_consumers: number; recent_wrong_asset_ids: string[]; assessment: AuthorAssessmentSummary | null; assessment_ignored?: string | null };
  };
  review_priority: ReviewPriority | null;
  /**
   * The corrected outcomes this reject rests on. An admit lifts the reject
   * only by naming every one of them (`HumanReview.overrode`).
   */
  reject_evidence_ids?: string[];
  reject_evidence_latest_at?: string | null;
  evidence_as_of?: string | null;
}
export interface HumanReview {
  id?: string;
  decision: 'admit' | 'reject';
  status: AssetStatus;
  by: string;
  at: string;
  note: string | null;
  /** The version and content the decision was made on (2026-09-08b). */
  asset_version?: number;
  content_hash?: string | null;
  /** The corrected outcomes this admit overrules, each with the reviewer's reason. */
  overrode?: Array<{ outcome_id: string; reason: string }> | null;
  expired_at?: string | null;
  expired_reason?: string | null;
}
/** The rule's suggestion and the human decision resolved to the status the asset carries. */
export interface GateEffective { status: 'approved' | 'failed' | 'candidate'; source: 'rule' | 'review'; review_id: string | null; reason: string; at: string }
/** The owner's request that the team review a candidate (2026-09-08). */
export interface ReviewRequest { requested_at?: string; requested_by?: string; note?: string | null; asset_version?: number; content_hash?: string | null; withdrawn_at?: string; withdrawn_by?: string; expired_at?: string; expired_reason?: string }
export interface AssetGateView {
  asset_id: string;
  name: string;
  asset_type: AssetType;
  owner_user_id: string;
  visibility: Asset['visibility'];
  created_at: string;
  updated_at: string;
  status: AssetStatus;
  confidence: number | null;
  version?: number;
  content_hash?: string | null;
  /** The row revision the view was rendered from; a review must send it back. */
  revision?: number;
  gate: GateDecision | null;
  /** The human decision in force for the current version, or null. */
  review: HumanReview | null;
  /** The whole history, oldest first, expired ones included. */
  reviews?: HumanReview[];
  effective?: GateEffective | null;
  review_request?: ReviewRequest | null;
  /** Requests that expired with a version or content change, oldest first. */
  review_requests?: ReviewRequest[];
  review_requested?: boolean;
}
export interface AssetOutcome {
  id: string;
  team_id: string;
  asset_id: string;
  asset_version: number | null;
  state: 'validated' | 'corrected' | 'used';
  relation: 'cross_user' | 'cross_agent' | 'self' | 'unknown';
  corrected_reason: 'wrong' | 'stale' | 'other' | null;
  consumer_user_id: string;
  consumer_agent_id: string | null;
  task_id: string | null;
  run_id: string | null;
  source: string;
  evidence_json: string;
  occurred_at: string;
  created_at: string;
  /** Whether the gate may act on this row, decided by Core, not by the reader. */
  gate_validity?: {
    usable: boolean;
    trusted: boolean;
    retracted: boolean;
    bound: 'current' | 'other_version' | 'unbound' | 'unknown';
    reason: string | null;
    asset_version_now: number | null;
    asset_content_hash_now: string | null;
  };
}
