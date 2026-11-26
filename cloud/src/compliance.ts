// The Compliance view in Purser Cloud (27 Nov): the runner's compliance evidence in short, as the runner reads it from its
// own ledger (src/compliance/evidence.ts complianceSnapshot: the last 30 days, per framework how many requirements have
// evidence, no records, are documented only or are gaps; per control its records; the map's gaps). The cloud holds only
// what the runner pushes, so the runner sends the snapshot with its sync (src/cloudsync/client.ts batchesFor, the first
// batch), as it sends the authority map (./authorityMap.ts). It is checked here against a strict schema (every field
// named, each text bounded, counts only: no audit row, subject or payload), kept per company as one row ('latest') and
// read by GET /v1/compliance. The same counts again change nothing; an older snapshot never replaces a newer one. Read
// only: evidence for a mapping, signed and verified on the runner (npm run compliance-evidence), not here.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { z } from "zod";
import { sha256Hex } from "./crypto.js";
import type { Stmt, TenantDb } from "./tenant.js";

export const COMPLIANCE_MAX_BYTES = 64 * 1024;
const STAMP = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const N = z.number().int().min(0).max(10_000_000);
const FW = z.enum(["eu-ai-act", "iso-42001", "soc2", "dora", "psd2-sca", "gdpr", "eidas", "nis2", "iso-27001"]);

export const ComplianceSnapshot = z.object({
  generated_at: STAMP,
  period: z.object({ from: DAY, to: DAY }).strict(),
  audit: z.object({ first_seq: N, last_seq: N, rows: N, head: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  frameworks: z.array(z.object({ framework: FW, name: z.string().min(1).max(200), requirements: N, evidence_in_period: N, no_records_in_period: N, documented: N, gap: N }).strict()).max(10),
  controls: z.array(z.object({ id: z.string().regex(/^PC-\d{2}$/), name: z.string().min(1).max(200), status: z.enum(["records-in-period", "no-records-in-period", "documented"]), records: N }).strict()).max(100),
  gaps: z.array(z.object({ framework: FW, clause: z.string().min(1).max(60), gap: z.string().max(1000) }).strict()).max(100),
  note: z.string().max(1000),
}).strict().refine((s) => JSON.stringify(s).length <= COMPLIANCE_MAX_BYTES, `the compliance snapshot is larger than ${COMPLIANCE_MAX_BYTES} bytes`);
export type ComplianceSnapshot = z.infer<typeof ComplianceSnapshot>;

/** The statements that keep the pushed snapshot, and what it did: added, changed (a newer one) or unchanged. */
export async function storeCompliance(db: TenantDb, s: ComplianceSnapshot, now: string, out: Stmt[]): Promise<{ added: number; changed: number; unchanged: number }> {
  // The counts, without the moment they were read: the same counts pushed again are unchanged.
  const counts: Partial<ComplianceSnapshot> = { ...s };
  delete counts.generated_at;
  const sha = await sha256Hex(jcs(counts as unknown as Json));
  const cur = await db.one<{ at: string; body_sha256: string }>("compliance_summaries", { id: "latest" });
  if (cur && (cur.body_sha256 === sha || s.generated_at < cur.at)) return { added: 0, changed: 0, unchanged: 1 };
  const row = { at: s.generated_at, body_json: JSON.stringify(s), body_sha256: sha, received_at: now };
  out.push(cur ? db.update("compliance_summaries", { id: "latest" }, row) : db.insert("compliance_summaries", { id: "latest", ...row }));
  return cur ? { added: 0, changed: 1, unchanged: 0 } : { added: 1, changed: 0, unchanged: 0 };
}

/** The company's newest snapshot and when the cloud received it; null before the runner pushed one. */
export async function readCompliance(db: TenantDb): Promise<{ compliance: ComplianceSnapshot | null; received_at: string | null }> {
  const r = await db.one<{ body_json: string; received_at: string }>("compliance_summaries", { id: "latest" });
  return { compliance: r ? (JSON.parse(r.body_json) as ComplianceSnapshot) : null, received_at: r?.received_at ?? null };
}
