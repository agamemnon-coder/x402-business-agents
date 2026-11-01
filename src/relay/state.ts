// What the runner pushes to the relay Worker whenever the ledger changes (tier 2 item 5): the dashboard snapshot,
// and for the phone each waiting proposal's exact canonical terms (the phone hashes them itself), the pinned
// passkey, and an open enrolment window. Nothing in it can approve or move money: no key, no code, no token.

import { fourEyes } from "../policy/fourEyes.js";
import { createHash, createHmac } from "node:crypto";
import { buildSnapshot, parseReview, PAYEE_NAMES, type Pending, type Snapshot } from "../dashboard/snapshot.js";
import type { DB } from "../db/open.js";
import { canonicalTerms, type Terms } from "../lib/terms.js";
import { openWindow } from "../passkey/ledger.js";
import { currentPolicy, type PolicyEntry } from "../policy/rules.js";

export interface RelayProposal {
  proposal_id: string;
  kind: string;
  /** Proposals with the same group are alternatives (price options); the phone shows them side by side. */
  group: string;
  /** The canonical JSON whose SHA-256 is terms_sha256. The phone shows what it parses from this, and only this. */
  canonical: string;
  terms_sha256: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  review: Pending["review"];
  /** Planted instructions code found in this proposal's documents (review N5): shown on the phone as a warning. */
  warnings: string[];
  /** E1: present when this proposal needs two different people; who has approved it so far. */
  four_eyes?: { approved_by: string[] };
  /**
   * With the agents on: the Treasury agent's recommendation for a price-rise option, advisory like the Opus review
   * (code accepted its plan; the CFO decides). Absent when code made the plan.
   */
  agent_advice?: { agent: string; model: string | null; recommends: boolean; text: string; verdict?: string };
}

export interface RelayEnrolment {
  window_id: string;
  challenge: string;
  user_id: string;
  user_name: string;
  /**
   * Lets the relay refuse a wrong code early; the runner checks the code again itself. HMAC-SHA256 keyed by the relay
   * token over the code's SHA-256: without the token, the 40-bit code cannot be brute-forced from this (M3).
   */
  code_mac: string;
  rp_id: string;
  expires_at: string;
}

export interface RelayState {
  version: 1;
  generated_at: string;
  snapshot: Snapshot;
  approvals: {
    proposals: RelayProposal[];
    /** Lower-case address to the name the ledger knows it by; shown beside the address, never instead of it. */
    names: Record<string, string>;
    passkey: { rp_id: string; credentials: { id: string; label: string; enrolled_at: string }[] };
    /** The CFO policy as it is now, for the phone's editor (it builds changes from these values). */
    policy: PolicyEntry[];
    /** The ledger's last audit row: signed with the rest, so the phone refuses an older set replayed (review N4). */
    ledger_seq: number;
  };
  enrolment: RelayEnrolment | null;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type PRow = { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; created_by: string; explanation: string | null; evidence_json: string | null; expires_at: string; created_at: string };

/** Planted lines code found, by the SHA-256 of the document they were in. */
function plantedByDocument(db: DB): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.prepare("SELECT payload_json FROM audit_log WHERE event = 'document.injection_flagged' ORDER BY seq").all() as { payload_json: string }[]) {
    try {
      const p = JSON.parse(r.payload_json) as { document_sha256?: string; findings?: { excerpt?: string }[] };
      const first = p.findings?.[0]?.excerpt;
      if (p.document_sha256 && first && !out.has(p.document_sha256)) out.set(p.document_sha256, first);
    } catch { /* not ours to fix here */ }
  }
  return out;
}

/**
 * The phone gets at most this many waiting proposals: policy changes (the emergency stop among them) first, then the
 * oldest. A flood of proposals can then never push the state over the relay's size limit and hide the stop.
 */
export const MAX_RELAY_PROPOSALS = 50;

export function buildRelayState(db: DB, cfg: { rpId: string; label?: string; relayToken: string }, now = new Date()): RelayState {
  const rows = db.prepare(`SELECT * FROM proposals WHERE status = 'PENDING_APPROVAL' AND expires_at > ?
    ORDER BY kind != 'policy_change', created_at, proposal_id LIMIT ${MAX_RELAY_PROPOSALS}`).all(now.toISOString()) as PRow[];
  const planted = plantedByDocument(db);
  // The Treasury agent's last plan (with the agents on): which option it recommends, and its advice in its own words.
  const plans = (db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'price_rise.plan' ORDER BY seq").all() as { ts: string; payload_json: string }[])
    .map((r) => ({ ts: r.ts, p: JSON.parse(r.payload_json) as { source?: string; model?: string; recommended?: string; advice?: string } }))
    .filter((x) => x.p.source === "claude" && (x.p.recommended === "A" || x.p.recommended === "B"));
  const adviceFor = (createdAt: string, option: unknown) => {
    const plan = plans.filter((x) => x.ts <= createdAt).at(-1);
    if (!plan || typeof option !== "string") return undefined;
    return { agent: "Treasury agent", model: plan.p.model ?? null, recommends: plan.p.recommended === option, text: String(plan.p.advice ?? "").slice(0, 600) };
  };
  const timingFor = (id: string): RelayProposal["agent_advice"] => {
    const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'licence.timing_advised' AND subject = ? ORDER BY seq DESC LIMIT 1").get(id) as { payload_json: string } | undefined;
    if (!r) return undefined;
    const a = JSON.parse(r.payload_json) as { timing?: string; date?: string | null; reason?: string; model?: string | null };
    return { agent: "Treasury agent", model: a.model ?? null, recommends: a.timing === "pay_now", text: String(a.reason ?? "").slice(0, 600), verdict: a.timing === "pay_now" ? "advises paying now" : `advises waiting until ${String(a.date ?? "")}` };
  };
  const proposals: RelayProposal[] = rows.filter((p) => Date.parse(p.expires_at) > now.getTime()).map((p) => {
    let evidence: { sha256?: string }[] = [];
    try {
      const e: unknown = JSON.parse(p.evidence_json ?? "null") ?? (JSON.parse(p.terms_json) as { evidence?: unknown }).evidence;
      if (Array.isArray(e)) evidence = e as { sha256?: string }[];
    } catch { /* no evidence */ }
    const warnings = evidence.flatMap((e) => (e.sha256 && planted.has(e.sha256)
      ? [`Code found a line aimed at the AI in the document behind this proposal, and ignored it: "${planted.get(e.sha256)}"`] : []));
    let canonical = p.terms_json;
    let group = p.proposal_id;
    let advice: RelayProposal["agent_advice"];
    try {
      const terms = JSON.parse(p.terms_json) as Terms;
      canonical = canonicalTerms(terms);
      // Price options are proposed together and change the same mandates in the same steps.
      if (p.kind === "mandate_replace") {
        group = `mandate_replace:${sha256(JSON.stringify(terms.steps ?? null)).slice(0, 16)}`;
        advice = adviceFor(p.created_at, terms.option);
      }
      // Block 5.3: the Treasury agent's advice on when to pay this invoice (advisory; the terms are code's).
      if (p.kind === "invoice_payment") advice = timingFor(p.proposal_id);
    } catch {
      // Unreadable terms go out as stored: the phone's own hash check fails and it refuses to sign them.
    }
    const twoPeople = fourEyes(db, p);
    return {
      proposal_id: p.proposal_id, kind: p.kind, group, canonical, terms_sha256: p.terms_sha256, expires_at: p.expires_at,
      created_by: p.created_by, created_at: p.created_at, review: parseReview(p.explanation), warnings,
      ...(advice ? { agent_advice: advice } : {}),
      ...(twoPeople ? { four_eyes: { approved_by: (db.prepare("SELECT person FROM cosignatures WHERE proposal_id = ? ORDER BY created_at").all(p.proposal_id) as { person: string }[]).map((x) => x.person) } } : {}),
    };
  });

  const names: Record<string, string> = {};
  for (const a of db.prepare("SELECT address, role FROM metal_accounts").all() as { address: string; role: string }[]) {
    const name = PAYEE_NAMES[a.role];
    if (name) names[a.address.toLowerCase()] = name;
  }
  const credentials = db.prepare("SELECT credential_id AS id, label, enrolled_at FROM passkeys WHERE status = 'ACTIVE' AND rp_id = ? ORDER BY enrolled_at")
    .all(cfg.rpId) as { id: string; label: string; enrolled_at: string }[];
  const w = openWindow(db, now);
  return {
    version: 1,
    generated_at: now.toISOString(),
    snapshot: buildSnapshot(db, now),
    approvals: {
      proposals, names, passkey: { rp_id: cfg.rpId, credentials }, policy: currentPolicy(db),
      ledger_seq: (db.prepare("SELECT MAX(seq) AS n FROM audit_log").get() as { n: number | null }).n ?? 0,
    },
    enrolment: w && w.rp_id === cfg.rpId
      ? { window_id: w.window_id, challenge: w.challenge, user_id: w.user_id, user_name: cfg.label ?? "max", code_mac: createHmac("sha256", cfg.relayToken).update(w.code_sha256).digest("hex"), rp_id: w.rp_id, expires_at: w.expires_at }
      : null,
  };
}

/** Changes only when the ledger does: the build time is left out, so an idle runner pushes nothing new. */
export function stateHash(s: RelayState): string {
  // Moments and ages change every second without anything happening; the alarms themselves still count.
  const h = s.snapshot.health;
  const health = h ? { ...h, at: null, metrics: { ...h.metrics, reconcile_age_seconds: null } } : h;
  return sha256(JSON.stringify({ ...s, generated_at: null, snapshot: { ...s.snapshot, generated_at: null, health } }));
}
