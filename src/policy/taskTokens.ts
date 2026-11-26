// Short-lived task tokens for task mandates (26 Nov; Airwallex's agent-cards reference, docs/going-to-production.md:
// "short-lived signed tokens carrying agent_id, task_id and expiry; derive the agent from the token, never from the tool
// call's arguments"). A task token (ptask_…) binds one agent to one task mandate (src/policy/taskMandates.ts) until a
// time no later than the mandate's own end, at most TASK_TOKEN_HOURS. Like the agents' card tokens
// (src/policy/agentTokens.ts) only its SHA-256 is kept, so the ledger alone cannot forge one, and nothing the agent
// writes beside it counts: the agent and the task are read from the token's row.
//
// A payment approved alone with a token (approveWithinLimit's `taskToken`) is judged under that one mandate only, for
// that one agent: an unknown, revoked or expired token, a principal revoked or expired (src/policy/principals.ts), a
// payment naming another agent or another task, or a mandate no longer in force: refused, recorded, nothing approved.
// Revoking the mandate revokes its tokens; revoking the agent stops them through principalActive.

import { createHash, randomBytes } from "node:crypto";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { principalActive } from "./principals.js";
import { principalOfActor } from "./taskMandateCore.js";
import { mandateInForce } from "./taskMandates.js";

/** The longest a task token works. */
export const TASK_TOKEN_HOURS = 24;
export const TASK_TOKEN_ISSUED = "task_token.issued";
export const TASK_TOKEN_REVOKED = "task_token.revoked";
export const TASK_TOKEN_REFUSED = "task_token.refused";

const TABLE = `CREATE TABLE IF NOT EXISTS task_tokens (
  token_id TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  agent TEXT NOT NULL,
  mandate_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface TaskTokenRow { token_id: string; token_sha256: string; agent: string; mandate_id: string; status: "active" | "revoked"; issued_at: string; expires_at: string; revoked_at: string | null }

/** Issues a token for mandate `id` (in force, active, not ended), to the agent the mandate names. Only its hash is kept. */
export function issueTaskToken(db: DB, id: string, now = new Date(), hours = TASK_TOKEN_HOURS, by = "human"): { token: string; token_id: string; agent: string; mandate_id: string; expires_at: string } {
  db.exec(TABLE);
  const rec = mandateInForce(db, id);
  if (!rec) throw new Error(`task mandate ${id} is not in force: no token for it`);
  if (rec.mandate.status !== "active") throw new Error(`task mandate ${id} was revoked: no token for it`);
  const end = Date.parse(`${rec.mandate.until}T23:59:59.999Z`);
  if (end <= now.getTime()) throw new Error(`task mandate ${id} ended ${rec.mandate.until}: no token for it`);
  if (!principalActive(db, rec.mandate.agent, now)) throw new Error(`the ${rec.mandate.agent} agent's identity is revoked or expired: no token for it`);
  const h = Math.min(Math.max(1, Math.floor(hours)), TASK_TOKEN_HOURS);
  const expires = new Date(Math.min(end, now.getTime() + h * 3_600_000)).toISOString();
  const token = `ptask_${randomBytes(24).toString("base64url")}`;
  const token_id = `tt_${sha256(token).slice(0, 16)}`;
  db.prepare("INSERT INTO task_tokens (token_id, token_sha256, agent, mandate_id, status, issued_at, expires_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
    .run(token_id, sha256(token), rec.mandate.agent, id, now.toISOString(), expires);
  audit(db, "human", TASK_TOKEN_ISSUED, token_id, { token_id, agent: rec.mandate.agent, mandate: id, expires_at: expires, by: by.slice(0, 80) }, now);
  return { token, token_id, agent: rec.mandate.agent, mandate_id: id, expires_at: expires };
}

/** Revokes every live token of mandate `id` (when it is revoked or narrowed). Returns the ids revoked. */
export function revokeTaskTokens(db: DB, id: string, why: string, now = new Date()): string[] {
  db.exec(TABLE);
  const live = db.prepare("SELECT token_id FROM task_tokens WHERE mandate_id = ? AND status = 'active'").all(id) as { token_id: string }[];
  for (const t of live) {
    db.prepare("UPDATE task_tokens SET status = 'revoked', revoked_at = ? WHERE token_id = ?").run(now.toISOString(), t.token_id);
    audit(db, "system", TASK_TOKEN_REVOKED, t.token_id, { token_id: t.token_id, mandate: id, why: why.slice(0, 200) }, now);
  }
  return live.map((t) => t.token_id);
}

export type TaskTokenCheck = { ok: true; token_id: string; agent: string; mandate_id: string } | { ok: false; code: "token_unknown" | "token_revoked" | "token_expired" | "token_agent" | "token_task" | "token_principal"; reason: string; token_id: string | null };

/**
 * The agent and the task a token carries, checked: the token is known, live and not expired, its agent's principal is
 * active, and what the caller claims (the acting agent; the task, when it names one) is the token's. Writes nothing.
 */
export function checkTaskToken(db: DB, token: string, claim: { agent: string; mandate?: string }, now = new Date()): TaskTokenCheck {
  db.exec(TABLE);
  const row = typeof token === "string" && token.startsWith("ptask_") ? db.prepare("SELECT * FROM task_tokens WHERE token_sha256 = ?").get(sha256(token)) as TaskTokenRow | undefined : undefined;
  if (!row) return { ok: false, code: "token_unknown", reason: "token_unknown: the task token is not one Purser issued", token_id: null };
  const no = (code: Extract<TaskTokenCheck, { ok: false }>["code"], why: string): TaskTokenCheck => ({ ok: false, code, reason: `${code}: ${why}`, token_id: row.token_id });
  if (row.status !== "active") return no("token_revoked", `task token ${row.token_id} was revoked`);
  if (Date.parse(row.expires_at) <= now.getTime()) return no("token_expired", `task token ${row.token_id} expired at ${row.expires_at}`);
  if (!principalActive(db, row.agent, now)) return no("token_principal", `the ${row.agent} agent's identity is revoked or expired`);
  if (principalOfActor(claim.agent) !== row.agent) return no("token_agent", `the token is the ${row.agent} agent's; the payment names the ${principalOfActor(claim.agent)} agent`);
  if (claim.mandate !== undefined && claim.mandate !== row.mandate_id) return no("token_task", `the token is for task mandate ${row.mandate_id}; the payment cites ${claim.mandate.slice(0, 40)}`);
  return { ok: true, token_id: row.token_id, agent: row.agent, mandate_id: row.mandate_id };
}

export function taskTokenRows(db: DB, mandate?: string): TaskTokenRow[] {
  db.exec(TABLE);
  return (mandate ? db.prepare("SELECT * FROM task_tokens WHERE mandate_id = ? ORDER BY issued_at").all(mandate) : db.prepare("SELECT * FROM task_tokens ORDER BY issued_at").all()) as TaskTokenRow[];
}
