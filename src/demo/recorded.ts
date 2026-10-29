// The recorded dashboard (K5 for the CFO's view): one snapshot of a real run's ledger, for guests who have no viewer
// key, plus the headline figures the landing page shows. Everything is computed from the ledger, nothing is typed in;
// the page says it is a recording and when it was made. The passkey's id and any enrolment are left out.

import type { DB } from "../db/open.js";
import { buildSnapshot, type Snapshot } from "../dashboard/snapshot.js";
import { fromCents } from "../lib/money.js";

export interface RecordedProof {
  /** What the agents did inside their limits, with no person involved. */
  alone: number;
  /** Attempts refused before money moved (chain, policy, card, fraud checks). */
  blocked: number;
  /** EUR approved on a card above the limit that card had at that moment: must be 0.00. */
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
  snapshot: Snapshot;
  proof: RecordedProof;
}

type Row = { seq: number; actor: string; event: string; payload_json: string };

/** Each approved card charge against the per-purchase limit its card had when the charge was made. */
function overLimitCents(db: DB): number {
  const rows = db.prepare("SELECT seq, actor, event, payload_json FROM audit_log WHERE event IN ('card.issued', 'card.adopted', 'card.limits_synced', 'card.charge_approved') ORDER BY seq").all() as Row[];
  const limit = new Map<string, number>();
  const perTx = (s: string) => Math.round(Number((s.split(" / ")[0] ?? "").replace(/[^\d.]/g, "")) * 100);
  let over = 0;
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as { agent?: string; limits?: string; to?: string; amount?: string; merged?: boolean };
    const agent = p.agent ?? r.actor;
    if (r.event === "card.issued" || r.event === "card.adopted") limit.set(agent, perTx(p.limits ?? ""));
    else if (r.event === "card.limits_synced") limit.set(agent, perTx(p.to ?? ""));
    else {
      const amount = Math.round(Number(p.amount ?? "0") * 100);
      const max = limit.get(agent);
      if (max !== undefined && amount > max) over += amount - max;
    }
  }
  return over;
}

export function buildRecorded(db: DB, run: string, now = new Date()): Recorded {
  const snap = buildSnapshot(db, now);
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const snapshot: Snapshot = {
    ...snap,
    passkey: { credential: null, label: snap.passkey.label, enrolled_at: snap.passkey.enrolled_at, enrolment_open: false },
  };
  return {
    recorded_at: now.toISOString(),
    run,
    snapshot,
    proof: {
      alone: snap.counts.alone,
      blocked: snap.counts.blocked,
      over_limit_eur: fromCents(overLimitCents(db)),
      fake_invoices: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'invoice.fraud_suspected'"),
      ai_tricks: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'document.injection_flagged'"),
      face_id: count("SELECT COUNT(*) AS n FROM approvals WHERE method = 'passkey' AND decision = 'APPROVED'"),
      card_declines: count("SELECT COUNT(*) AS n FROM card_transactions WHERE approved = 0"),
      chain_refusals: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.refused' AND payload_json LIKE '%mandate_%'"),
      clearing_receipts: count("SELECT COUNT(*) AS n FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'"),
    },
  };
}
