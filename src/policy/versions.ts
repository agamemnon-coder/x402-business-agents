// Policy versions (backend review B4). The CFO policy is the set of rules in src/policy/rules.ts with their current
// values. Each distinct set is a version: numbered, stored whole, and hashed. A decision records the version it was
// made under (a proposal when made, an approval when signed, a hold when reserved), so the audit and `npm run
// verify` can show exactly which rule held at that moment, and that the stored rules still hash to what was recorded.

import { createHash } from "node:crypto";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { currentPolicy } from "./rules.js";

export interface PolicyVersion { version: number; sha256: string }

const canonical = (values: Record<string, string>) => JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]));
export const policySha = (values: Record<string, string>) => createHash("sha256").update(canonical(values)).digest("hex");

/** The policy as it stands, by rule key. */
export function policyValues(db: DB): Record<string, string> {
  return Object.fromEntries(currentPolicy(db).map((r) => [r.key, r.value]));
}

/**
 * The version of the policy as it stands now: the last recorded one if nothing changed since, otherwise a new
 * version, recorded with what changed. Runs inside the caller's transaction (it opens none of its own).
 */
export function policyVersion(db: DB, now = new Date()): PolicyVersion {
  const values = policyValues(db);
  const sha = policySha(values);
  const last = db.prepare("SELECT version, sha256, values_json FROM policy_versions ORDER BY version DESC LIMIT 1").get() as { version: number; sha256: string; values_json: string } | undefined;
  if (last?.sha256 === sha) return { version: last.version, sha256: sha };
  const version = (last?.version ?? 0) + 1;
  db.prepare("INSERT INTO policy_versions (version, sha256, values_json, created_at) VALUES (?, ?, ?, ?)").run(version, sha, JSON.stringify(values), now.toISOString());
  const before = last ? (JSON.parse(last.values_json) as Record<string, string>) : {};
  const changed = Object.keys({ ...before, ...values }).sort().filter((k) => before[k] !== values[k]).map((k) => ({ key: k, from: before[k] ?? null, to: values[k] ?? null }));
  audit(db, "system", "policy.version", `v${version}`, { version, sha256: sha, changed: last ? changed : `${changed.length} rules (first version)` }, now);
  return { version, sha256: sha };
}

/** One recorded version and its rules, or null. */
export function policyAt(db: DB, version: number): { version: number; sha256: string; values: Record<string, string>; created_at: string } | null {
  const r = db.prepare("SELECT version, sha256, values_json, created_at FROM policy_versions WHERE version = ?").get(version) as { version: number; sha256: string; values_json: string; created_at: string } | undefined;
  return r ? { version: r.version, sha256: r.sha256, values: JSON.parse(r.values_json) as Record<string, string>, created_at: r.created_at } : null;
}

export interface PolicyCheck { ok: boolean; what: string; detail: string }

/**
 * For verify: every recorded version's rules still hash to its recorded hash, versions are numbered without gaps,
 * and every approval names a version that existed when it was signed, with the rules it was made under.
 */
export function policyVersionChecks(db: DB): PolicyCheck[] {
  const out: PolicyCheck[] = [];
  const versions = db.prepare("SELECT version, sha256, values_json, created_at FROM policy_versions ORDER BY version").all() as { version: number; sha256: string; values_json: string; created_at: string }[];
  versions.forEach((v, i) => {
    const values = JSON.parse(v.values_json) as Record<string, string>;
    const ok = policySha(values) === v.sha256 && v.version === i + 1;
    out.push({ ok, what: `policy v${v.version}`, detail: ok ? `${Object.keys(values).length} rules, sha256 ${v.sha256.slice(0, 8)}…, from ${v.created_at}` : `the stored rules do not hash to ${v.sha256.slice(0, 8)}… or the numbering has a gap` });
  });
  const approvals = db.prepare("SELECT a.proposal_id, a.decision, a.policy_version, a.created_at, p.kind FROM approvals a JOIN proposals p USING (proposal_id) ORDER BY a.approval_id").all() as
    { proposal_id: string; decision: string; policy_version: number | null; created_at: string; kind: string }[];
  for (const a of approvals) {
    if (a.policy_version === null) continue; // signed before policy versions were recorded
    const v = versions.find((x) => x.version === a.policy_version);
    const ok = !!v && Date.parse(v.created_at) <= Date.parse(a.created_at);
    out.push({ ok, what: `${a.proposal_id} ${a.decision.toLowerCase()}`, detail: ok ? `under policy v${a.policy_version} (sha256 ${v!.sha256.slice(0, 8)}…), ${a.kind}` : `names policy v${a.policy_version}, which was not recorded before it` });
  }
  return out;
}
