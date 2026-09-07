/**
 * 权限判定纯函数。
 *
 * 对应设计文档 §10.3（checkPermission，owner+scope+grant 三段式）
 * 与 §10.4（canBindAsset，固定资产绑定校验）。
 *
 * 设计要点：
 *   - 判定顺序优化为「资源 → owner → 成员 → visibility → 角色默认 → ACL → deny」，
 *     高频场景（admin 读写 / member 只读）在角色默认即放行，无需查 ACL 表。
 *   - role 默认权限是代码级硬编码常量，无需为 role 预先配置数据。
 *   - 一期 allow-only 模型。
 */

import type { AssetEntity, AssetReadPurpose, TeamMemberEntity, AclEntity, Permission } from "../types.js";

export interface PermCheckLogger {
  debug: (msg: string) => void;
}

export interface PermCheckContext {
  user: { user_id: string };
  asset: AssetEntity | null;
  /** 用户在 asset.team_id 下的成员关系。 */
  membership: TeamMemberEntity | null;
  action: Permission;
  /** asset 相关的所有 ACL 记录（懒加载：仅当走到 ACL 步骤时由 service 提供）。 */
  aclRecords: AclEntity[];
  /** 可选，当 action='use' 且调用方是 agent 时传入。 */
  agentId?: string;
  /**
   * Why the asset is read (2026-09-08). `use` — the model's everyday path —
   * passes only an admitted (approved) asset, the owner included: admission
   * is a property of the asset, not of who is asking. `manage` (default,
   * the human's path) lets the owner, admins and reviewers also see
   * candidates and rejections. Applies to action='read' and 'use'.
   */
  purpose?: AssetReadPurpose;
  logger?: PermCheckLogger;
}

export interface PermCheckResult {
  allowed: boolean;
  reason: string;
}

const ADMIN_ACTIONS: Permission[] = ["read", "write", "assign", "share"];
const MEMBER_ACTIONS: Permission[] = ["read"];

const noopLogger: PermCheckLogger = { debug: () => {} };

export function checkPermission(ctx: PermCheckContext): PermCheckResult {
  const { user, asset, membership, action, aclRecords, agentId } = ctx;
  const logger = ctx.logger ?? noopLogger;

  // 1. 资源不存在/归档
  if (!asset || asset.status === "archived") {
    logger.debug(`[META] perm_check DENY: asset not found or archived`);
    return { allowed: false, reason: "asset_not_available" };
  }

  // 1b. 日常使用（模型路径）：只有 approved 才放行，owner 也不例外。准入是
  //     资产的属性，不看谁在问；draft / candidate / failed / deprecated 一律拒。
  if (ctx.purpose === "use" && (action === "read" || action === "use") && asset.status !== "approved") {
    logger.debug(`[META] perm_check DENY: purpose=use, status=${asset.status}`);
    return { allowed: false, reason: `not_admitted:${asset.status}` };
  }

  // 2. Owner 全允许
  if (asset.owner_user_id === user.user_id) {
    logger.debug(`[META] perm_check ALLOW: owner`);
    return { allowed: true, reason: "owner" };
  }

  // 3. 非 team 成员
  if (!membership || membership.status !== "active") {
    logger.debug(`[META] perm_check DENY: not team member`);
    return { allowed: false, reason: "not_team_member" };
  }

  const reviewerRole = membership.role === "admin" || membership.role === "reviewer";

  // 3b. 候选池：status=candidate 的资产还没过准入闸门，只有 owner（第 2 步已放行）、
  //     team admin 和 reviewer 能读——这就是"候选资产不进正式池"的落点。
  //     failed / deprecated 同理（2026-09-08）：拒绝原因是给作者和复核员看的，
  //     普通成员在管理路径上也看不到；archived 在第 1 步已拒。draft（手工登记、
  //     未经闸门的旧资产）在管理路径上保持原样可读——它对模型路径已在 1b 拒绝。
  if ((asset.status === "candidate" || asset.status === "failed" || asset.status === "deprecated") && !reviewerRole) {
    logger.debug(`[META] perm_check DENY: status=${asset.status}, role=${membership.role}`);
    return { allowed: false, reason: `status_${asset.status}` };
  }

  // 3c. 私有候选只有作者提交了团队审核，复核员才能看（2026-09-08）。进入候选池
  //     不扩大 private 的边界：未提交的私有候选对 admin / reviewer 同样不可见。
  if (asset.status === "candidate" && asset.visibility === "private" && reviewerRole && action === "read" && reviewRequested(asset)) {
    logger.debug(`[META] perm_check ALLOW: private candidate submitted for review, role=${membership.role}`);
    return { allowed: true, reason: "review_requested" };
  }

  // 4. visibility 限制
  switch (asset.visibility) {
    case "private":
      // 私密语义（2026-07 变更）：严格私密，只有 owner_user_id 能访问。
      // 团队 admin 也不放行 —— 因为第 2 步 owner 判定已优先返回 ALLOW，
      // 走到这里说明当前 user 不是 owner，即使是 admin 也一律拒绝。
      //
      // 语义解释：
      //   - private = 个人隐私资产，团队里没人能看到（包括管理员）
      //   - team    = 共享给整个团队（team 成员可读，owner/admin 可写）
      //   - restricted = 严格 ACL 白名单（走下面 case）
      //
      // 影响面：
      //   - list-accessible 不返回其他人的 private asset（对 admin 也生效）
      //   - permission-checker.check 对 admin 访问他人 private 也返回 DENY
      //   - 若管理员确实需要看，让 owner 主动切到 team 或通过 acl/grant 授权
      logger.debug(`[META] perm_check DENY: visibility=private, role=${membership.role}`);
      return { allowed: false, reason: "visibility_restricted" };
    case "restricted":
      if (membership.role !== "admin") {
        // Non-admin: skip role defaults, only explicit ACL can grant access
        const matched = aclRecords.find(
          (acl) =>
            acl.permission === action &&
            acl.effect === "allow" &&
            ((acl.subject_type === "user" && acl.subject_id === user.user_id) ||
              (acl.subject_type === "team_role" && acl.subject_id === membership.role) ||
              (acl.subject_type === "agent" && !!agentId && acl.subject_id === agentId)),
        );
        if (matched) {
          logger.debug(`[META] perm_check ALLOW: restricted + acl id=${matched.id}`);
          return { allowed: true, reason: `acl:${matched.id}` };
        }
        logger.debug(`[META] perm_check DENY: visibility=restricted, no ACL match`);
        return { allowed: false, reason: "visibility_restricted" };
      }
      break;
    case "task":
      if (action !== "read" && membership.role !== "admin") {
        logger.debug(`[META] perm_check DENY: visibility=task, non-admin non-read`);
        return { allowed: false, reason: "visibility_restricted" };
      }
      break;
    case "team":
    case "agent":
      break;
    default:
      logger.debug(`[META] perm_check DENY: unknown visibility=${asset.visibility}`);
      return { allowed: false, reason: "visibility_restricted" };
  }

  // 5. 角色默认权限（命中即放行，可跳过 ACL 查询）
  const defaults = membership.role === "admin" ? ADMIN_ACTIONS : MEMBER_ACTIONS;
  if (defaults.includes(action)) {
    logger.debug(`[META] perm_check ALLOW: role_default=${membership.role}`);
    return { allowed: true, reason: `role_default:${membership.role}` };
  }

  // 6. 显式 ACL（user / team_role / agent 三种主体）
  const matched = aclRecords.find(
    (acl) =>
      acl.permission === action &&
      acl.effect === "allow" &&
      ((acl.subject_type === "user" && acl.subject_id === user.user_id) ||
        (acl.subject_type === "team_role" && acl.subject_id === membership.role) ||
        (acl.subject_type === "agent" && !!agentId && acl.subject_id === agentId)),
  );
  if (matched) {
    logger.debug(`[META] perm_check ALLOW: acl id=${matched.id}`);
    return { allowed: true, reason: `acl:${matched.id}` };
  }

  logger.debug(`[META] perm_check DENY: no matching rule`);
  return { allowed: false, reason: "no_permission" };
}

/**
 * Whether the owner's request for team review is in force for the asset's
 * CURRENT text (metadata_json.gate.review_request): requested, not
 * withdrawn, not expired, and made on this version and content. A request
 * granted reviewers access to one text; a newer version or edited content
 * needs a new request (2026-09-08c).
 */
export function reviewRequested(asset: Pick<AssetEntity, "metadata_json"> & { version?: number; content_hash?: string | null }): boolean {
  try {
    const m = JSON.parse(asset.metadata_json || "{}") as { gate?: { review_request?: { requested_at?: unknown; withdrawn_at?: unknown; expired_at?: unknown; asset_version?: unknown; content_hash?: unknown } } };
    const r = m?.gate?.review_request;
    if (!r || typeof r !== "object" || typeof r.requested_at !== "string" || r.withdrawn_at || r.expired_at) return false;
    if (asset.version !== undefined && typeof r.asset_version === "number" && r.asset_version !== asset.version) return false;
    if (asset.content_hash && typeof r.content_hash === "string" && r.content_hash !== asset.content_hash) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 角色默认权限是否覆盖该 action（service 据此判断是否需懒加载 ACL）。
 * 返回 true 表示无需查 ACL 表。
 */
export function roleDefaultCovers(role: TeamMemberEntity["role"], action: Permission): boolean {
  const defaults = role === "admin" ? ADMIN_ACTIONS : MEMBER_ACTIONS;
  return defaults.includes(action);
}

/**
 * 判断 Asset 的 visibility 是否允许绑定到指定 Agent（§10.4）。
 * 与 checkPermission 互补：checkPermission 管「谁能操作资源」，
 * canBindAsset 管「资源能否挂到 agent 上」。
 */
export function canBindAsset(
  agent: Pick<import("../types.js").AgentEntity, "team_id" | "owner_user_id">,
  asset: Pick<AssetEntity, "visibility" | "team_id" | "owner_user_id">,
): boolean {
  switch (asset.visibility) {
    case "team":
      return asset.team_id === agent.team_id;
    case "agent":
      return asset.team_id === agent.team_id;
    case "private":
      return asset.owner_user_id === agent.owner_user_id && asset.team_id === agent.team_id;
    case "task":
    case "restricted":
      return false;
    default:
      return false;
  }
}
