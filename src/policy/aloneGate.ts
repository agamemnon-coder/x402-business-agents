// Where approveWithinLimit (src/policy/approvals.ts) and the execution guard (src/policy/signedApproval.ts) ask about task
// mandates and task tokens (src/policy/taskMandates.ts, taskTokens.ts). The full gate is installed when taskMandates.ts
// loads: the runner opens every ledger with it (src/db/open.ts imports it), and since 26 Nov so does Purser Cloud's
// engine (cloud/src/engine/hostWorker.ts imports it; about 5.5 KB gzipped in the Worker's bundle). Anywhere it is not
// loaded, this small gate stands in, failing closed: once a task mandate is on record, or a payment comes with a task
// token, nothing is paid alone, and an approval alone that names a mandate does not run.

import type { DB } from "../db/open.js";

export type GateCheck = { ok: true; mandate: string | null; token: string | null } | { ok: false; code: "mandate" | "token"; reason: string };

export interface AloneGate {
  /** Whether this payment may be approved alone as far as task mandates and tokens go; records its own refusals. */
  check(db: DB, p: { proposal_id: string; kind: string }, terms: Record<string, unknown>, a: { agent: string; issueDate: string | null; taskToken?: string }, now: Date): GateCheck;
  /** For the execution guard and verify: why an approval alone at audit row `seq` did not stand on a mandate then, or null. */
  executionRefusal(db: DB, agent: string, mandate: unknown, seq: number): string | null;
  /** Why a policy change's value is not a task mandate in its one written form, or null. */
  validate(value: string): string | null;
  /** The task mandates written in the settings, as [key, value], for the policy's version (src/policy/versions.ts). */
  values(db: DB): [string, string][];
}

/** Any task mandate on record or in the settings (before audit row `seq`: on record only). */
function onRecord(db: DB, seq?: number): boolean {
  const like = "task\\_mandate.%";
  return !!db.prepare("SELECT 1 FROM audit_log WHERE subject LIKE ? ESCAPE '\\' AND seq < ? LIMIT 1").get(like, seq ?? Number.MAX_SAFE_INTEGER)
    || (seq === undefined && !!db.prepare("SELECT 1 FROM settings WHERE key LIKE ? ESCAPE '\\' LIMIT 1").get(like));
}

const ABSENT = "the task-mandate gate is not loaded here (src/policy/taskMandates.ts)";

export const failClosed: AloneGate = {
  check: (db, _p, _t, a) => (a.taskToken !== undefined || onRecord(db) ? { ok: false, code: "mandate", reason: `mandate_gate_absent: ${ABSENT}` } : { ok: true, mandate: null, token: null }),
  executionRefusal: (db, _agent, mandate, seq) => (mandate !== undefined || onRecord(db, seq) ? ABSENT : null),
  validate: () => ABSENT,
  values: () => [],
};

let installed: AloneGate | null = null;

/** Installs the full gate (src/policy/taskMandates.ts does, when it loads). */
export function installAloneGate(g: AloneGate): void { installed = g; }

/** The gate in force: the full one where it is loaded, else the one that fails closed. */
export const aloneGate = (): AloneGate => installed ?? failClosed;
