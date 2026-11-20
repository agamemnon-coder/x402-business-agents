// The agents' payment tokens, as the ledger keeps them (./agentTokens.ts issues and checks them). Only a token's
// SHA-256 is kept, never the token itself: the agent holds it, and a copy of the ledger cannot pay. Revoking an agent
// (src/policy/principals.ts revokePrincipal) revokes its tokens here at once, in the same call.
// No imports beyond the ledger and the audit log, so the agents' identities can call it without a cycle.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";

const TABLES = `
CREATE TABLE IF NOT EXISTS agent_tokens (
  token_id TEXT PRIMARY KEY, token_sha256 TEXT NOT NULL UNIQUE, agent TEXT NOT NULL, card_id TEXT NOT NULL, card_last4 TEXT NOT NULL,
  token_last4 TEXT NOT NULL, mandate_json TEXT NOT NULL, mandate_sha256 TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, revoked_why TEXT
);
CREATE TABLE IF NOT EXISTS agent_token_uses (
  token_id TEXT NOT NULL, transaction_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, approved INTEGER NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (token_id, transaction_id)
);`;

export interface AgentTokenRow {
  token_id: string; token_sha256: string; agent: string; card_id: string; card_last4: string; token_last4: string;
  mandate_json: string; mandate_sha256: string; status: "active" | "revoked"; issued_at: string; expires_at: string; revoked_at: string | null; revoked_why: string | null;
}

export function tokenTables(db: DB): void {
  db.exec(TABLES);
}

export function tokenRows(db: DB, agent?: string): AgentTokenRow[] {
  tokenTables(db);
  return (agent ? db.prepare("SELECT * FROM agent_tokens WHERE agent = ? ORDER BY issued_at").all(agent) : db.prepare("SELECT * FROM agent_tokens ORDER BY agent, issued_at").all()) as AgentTokenRow[];
}

/** Revokes every live token of the agent; each is recorded. Returns the ids revoked (none when it had none). */
export function revokeAgentTokens(db: DB, agent: string, why: string, by: string, now = new Date()): string[] {
  tokenTables(db);
  const live = db.prepare("SELECT token_id, card_last4, mandate_sha256 FROM agent_tokens WHERE agent = ? AND status = 'active'").all(agent) as { token_id: string; card_last4: string; mandate_sha256: string }[];
  for (const t of live) {
    db.prepare("UPDATE agent_tokens SET status = 'revoked', revoked_at = ?, revoked_why = ? WHERE token_id = ? AND status = 'active'").run(now.toISOString(), why.slice(0, 200), t.token_id);
    audit(db, "system", "agent_token.revoked", agent, { agent, token_id: t.token_id, card_last4: t.card_last4, mandate_sha256: t.mandate_sha256, why: why.slice(0, 200), by: by.slice(0, 60) }, now);
  }
  return live.map((t) => t.token_id);
}
