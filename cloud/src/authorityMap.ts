// The authority map in Purser Cloud (26 Nov): who may pay what, per agent, as the runner reads it from its own policy and
// ledger (src/policy/authorityMap.ts). The cloud holds only what the runner pushes, so the runner sends a snapshot with
// its sync (src/cloudsync/client.ts batchesFor, the first batch). It is checked here against a strict schema (every field
// named, each text bounded, the whole at most AUTHORITY_MAX_BYTES), kept per company as one row ('latest'), and read by
// GET /v1/authority-map. The same snapshot again changes nothing; an older one never replaces a newer one. It is a
// statement of the runner's rules, read only: nothing in the cloud acts on it.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { z } from "zod";
import { sha256Hex } from "./crypto.js";
import type { Stmt, TenantDb } from "./tenant.js";

/** The snapshot's JSON at most this long (a company with many outside agents and task mandates stays well under it). */
export const AUTHORITY_MAX_BYTES = 128 * 1024;
const T = z.string().max(1000);
const STAMP = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
const WORD = z.string().regex(/^[a-z_]{1,40}$/);

export const AuthorityMapSnapshot = z.object({
  generated_at: STAMP,
  policy_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  agents: z.array(z.object({
    agent: z.string().regex(/^[a-z0-9:_-]{1,80}$/),
    name: z.string().min(1).max(200),
    status: z.enum(["working", "frozen", "paused", "stopped", "revoked"]),
    identity: z.object({ rails: z.array(WORD).max(10), currencies: z.array(z.string().regex(/^[A-Z]{3,4}$/)).max(200), payees: z.array(WORD).max(10), expires_at: STAMP.nullable() }).strict(),
    rows: z.array(z.object({ what: T, rail: T, per_payment: T, in_all: T, from: T, to: T, when: T, under: T, needs_cfo: T }).strict()).max(40),
  }).strict()).max(50),
}).strict().refine((m) => JSON.stringify(m).length <= AUTHORITY_MAX_BYTES, `the authority map is larger than ${AUTHORITY_MAX_BYTES} bytes`);
export type AuthorityMapSnapshot = z.infer<typeof AuthorityMapSnapshot>;

/** The statements that keep the pushed map, and what it did: added, changed (a newer map) or unchanged. */
export async function storeAuthorityMap(db: TenantDb, m: AuthorityMapSnapshot, now: string, out: Stmt[]): Promise<{ added: number; changed: number; unchanged: number }> {
  // The rules, without the moment they were read: the same rules pushed again are unchanged.
  const sha = await sha256Hex(jcs({ policy_sha256: m.policy_sha256, agents: m.agents } as unknown as Json));
  const cur = await db.one<{ at: string; body_sha256: string }>("authority_maps", { id: "latest" });
  if (cur && (cur.body_sha256 === sha || m.generated_at < cur.at)) return { added: 0, changed: 0, unchanged: 1 };
  const row = { at: m.generated_at, policy_sha256: m.policy_sha256, body_json: JSON.stringify(m), body_sha256: sha, received_at: now };
  out.push(cur ? db.update("authority_maps", { id: "latest" }, row) : db.insert("authority_maps", { id: "latest", ...row }));
  return cur ? { added: 0, changed: 1, unchanged: 0 } : { added: 1, changed: 0, unchanged: 0 };
}

/** The company's newest map and when the cloud received it; null before the runner pushed one. */
export async function readAuthorityMap(db: TenantDb): Promise<{ authority_map: AuthorityMapSnapshot | null; received_at: string | null }> {
  const r = await db.one<{ body_json: string; received_at: string }>("authority_maps", { id: "latest" });
  return { authority_map: r ? (JSON.parse(r.body_json) as AuthorityMapSnapshot) : null, received_at: r?.received_at ?? null };
}
