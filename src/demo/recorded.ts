// The recorded dashboard (K5 for the CFO's view): one snapshot of a real run's ledger, for guests who have no viewer
// key, plus the headline figures the landing page shows. Everything is computed from the ledger, nothing is typed in;
// the page says it is a recording and when it was made. The passkey's id and any enrolment are left out.

import type { DB } from "../db/open.js";
import { buildSnapshot, describe, type Snapshot } from "../dashboard/snapshot.js";
import { fromCents } from "../lib/money.js";
import { COMPANY } from "../config/brand.js";

export interface RecordedProof {
  /** What the agents did inside their limits, with no person involved. */
  alone: number;
  /** Attempts refused before money moved (chain, policy, card, fraud checks). */
  blocked: number;
  /** EUR approved on a card above the per-purchase or monthly limit that card had at that moment: must be 0.00. */
  over_limit_eur: string;
  fake_invoices: number;
  ai_tricks: number;
  face_id: number;
  card_declines: number;
  chain_refusals: number;
  clearing_receipts: number;
}

export interface Recorded {
  recorded_at: string;
  run: string;
  /** The example company the run was recorded with (absent in recordings made before Purser's rename). */
  company?: string;
  snapshot: Snapshot;
  proof: RecordedProof;
}

type Row = { seq: number; ts: string; actor: string; event: string; payload_json: string };

/**
 * Each approved card charge against the limits its card had when the charge was made: the per-purchase limit, and
 * the monthly limit over that calendar month (UTC). A charge over both counts once, by the larger excess. A charge
 * whose card has no limit on record cannot be checked, so the recording is refused rather than showing a false zero.
 */
function overLimitCents(db: DB): number {
  const rows = db.prepare("SELECT seq, ts, actor, event, payload_json FROM audit_log WHERE event IN ('card.issued', 'card.adopted', 'card.limits_synced', 'card.charge_approved') ORDER BY seq").all() as Row[];
  const limits = new Map<string, { perTx: number; monthly: number }>();
  const spent = new Map<string, number>();
  const cents = (s: string | undefined) => Math.round(Number((s ?? "").replace(/[^\d.]/g, "")) * 100);
  const parse = (s: string | undefined) => { const [perTx, monthly] = (s ?? "").split(" / "); return { perTx: cents(perTx), monthly: cents(monthly) }; };
  let over = 0;
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as { agent?: string; limits?: string; to?: string; amount?: string };
    const agent = p.agent ?? r.actor;
    if (r.event === "card.issued" || r.event === "card.adopted") limits.set(agent, parse(p.limits));
    else if (r.event === "card.limits_synced") limits.set(agent, parse(p.to));
    else {
      const limit = limits.get(agent);
      if (!limit || !limit.perTx || !limit.monthly) throw new Error(`card charge in audit row ${r.seq} (${agent}) has no card limit on record before it`);
      const amount = cents(p.amount);
      const month = `${agent} ${r.ts.slice(0, 7)}`;
      const after = (spent.get(month) ?? 0) + amount;
      spent.set(month, after);
      over += Math.max(0, amount - limit.perTx, Math.min(amount, after - limit.monthly));
    }
  }
  return over;
}

export function buildRecorded(db: DB, run: string, now = new Date()): Recorded {
  const snap = buildSnapshot(db, now);
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  // The live feed shows the newest rows; a guest should also see the bank transfers and invoices, however old, so a
  // SWIFT payment is never mistaken for a card charge or missing from the story.
  const shown = new Set(snap.feed.map((f) => f.seq));
  const bank = (db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log WHERE event LIKE 'transfer.%' OR event LIKE 'invoice.%' ORDER BY seq").all() as Parameters<typeof describe>[0][])
    .filter((r) => !shown.has(r.seq))
    .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, ...describe(r, () => undefined) }));
  const snapshot: Snapshot = {
    ...snap,
    feed: [...snap.feed, ...bank].sort((a, b) => b.seq - a.seq),
    passkey: { credential: null, label: snap.passkey.label, enrolled_at: snap.passkey.enrolled_at, enrolment_open: false },
  };
  return {
    recorded_at: now.toISOString(),
    run,
    company: COMPANY,
    snapshot,
    proof: {
      alone: snap.counts.alone,
      blocked: snap.counts.blocked,
      over_limit_eur: fromCents(overLimitCents(db)),
      fake_invoices: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'invoice.fraud_suspected'"),
      // One document flagged twice (read again later) is one trick, not two.
      ai_tricks: count("SELECT COUNT(DISTINCT COALESCE(json_extract(payload_json, '$.document_sha256'), seq)) AS n FROM audit_log WHERE event = 'document.injection_flagged'"),
      face_id: count("SELECT COUNT(*) AS n FROM approvals WHERE method = 'passkey'"),
      card_declines: count("SELECT COUNT(*) AS n FROM card_transactions WHERE approved = 0"),
      chain_refusals: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.refused' AND payload_json LIKE '%mandate_%'"),
      clearing_receipts: count("SELECT COUNT(*) AS n FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'"),
    },
  };
}
