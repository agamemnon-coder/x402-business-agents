// What the runner pushes to the relay Worker whenever the ledger changes (tier 2 item 5): the dashboard snapshot,
// and for the phone each waiting proposal's exact canonical terms (the phone hashes them itself), the pinned
// passkey, and an open enrolment window. Nothing in it can approve or move money: no key, no code, no token.

import { createHash } from "node:crypto";
import { buildSnapshot, parseReview, PAYEE_NAMES, type Pending, type Snapshot } from "../dashboard/snapshot.js";
import type { DB } from "../db/open.js";
import { canonicalTerms, type Terms } from "../lib/terms.js";
import { openWindow } from "../passkey/ledger.js";

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
}

export interface RelayEnrolment {
  window_id: string;
  challenge: string;
  user_id: string;
  user_name: string;
  /** Lets the relay refuse a wrong code early; the runner checks the code again itself. */
  code_sha256: string;
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
  };
  enrolment: RelayEnrolment | null;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type PRow = { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; created_by: string; explanation: string | null; expires_at: string; created_at: string };

export function buildRelayState(db: DB, cfg: { rpId: string; label?: string }, now = new Date()): RelayState {
  const rows = db.prepare("SELECT * FROM proposals WHERE status = 'PENDING_APPROVAL' ORDER BY created_at, proposal_id").all() as PRow[];
  const proposals: RelayProposal[] = rows.filter((p) => Date.parse(p.expires_at) > now.getTime()).map((p) => {
    let canonical = p.terms_json;
    let group = p.proposal_id;
    try {
      const terms = JSON.parse(p.terms_json) as Terms;
      canonical = canonicalTerms(terms);
      // Price options are proposed together and change the same mandates in the same steps.
      if (p.kind === "mandate_replace") group = `mandate_replace:${sha256(JSON.stringify(terms.steps ?? null)).slice(0, 16)}`;
    } catch {
      // Unreadable terms go out as stored: the phone's own hash check fails and it refuses to sign them.
    }
    return {
      proposal_id: p.proposal_id, kind: p.kind, group, canonical, terms_sha256: p.terms_sha256, expires_at: p.expires_at,
      created_by: p.created_by, created_at: p.created_at, review: parseReview(p.explanation),
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
    approvals: { proposals, names, passkey: { rp_id: cfg.rpId, credentials } },
    enrolment: w && w.rp_id === cfg.rpId
      ? { window_id: w.window_id, challenge: w.challenge, user_id: w.user_id, user_name: cfg.label ?? "max", code_sha256: w.code_sha256, rp_id: w.rp_id, expires_at: w.expires_at }
      : null,
  };
}

/** Changes only when the ledger does: the build time is left out, so an idle runner pushes nothing new. */
export function stateHash(s: RelayState): string {
  return sha256(JSON.stringify({ ...s, generated_at: null, snapshot: { ...s.snapshot, generated_at: null } }));
}
