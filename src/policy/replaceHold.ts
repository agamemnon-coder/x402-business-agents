// dry-179, item 8: while a mandate-replace proposal is open for an agent's mandate, nothing that agent controls may
// spend from that mandate. The replacement's terms carry what the agent had spent when it was proposed
// (spent_at_proposal), and the executor refuses it when that moved ("spent moved … a new one is needed",
// src/executors/mandateReplace.ts). In dry-179 Treasury swept 0.45 from its own mandate ten seconds after proposing
// P-0002/P-0003; the CFO and the second approver then approved P-0002, and it failed on that check. The check stays as
// strict as it is; this hold keeps the agent from moving its own spend while the CFO decides.
//
// Open: waiting for approval (also with 1 of 2 signatures) or approved and not yet run, within its time; or being run
// (EXECUTING), whatever its time: a restart resumes a replace a crash cut off without looking at its expiry, so the hold
// stays until a restart resumes and finishes it (ops/health raises action_stuck for it meanwhile); and FAILED within its
// time once a step of it ran (a DONE or STARTED execution row): the mandates are half replaced and a retry carries on
// (ops/health raises replace_half_run once a step is DONE). The hold lifts by itself when the proposal is executed,
// rejected, superseded, expires, or fails. A replace its executor's guard refuses (dry-179: "spent moved … a new one is
// needed") is closed as NEEDS_REAPPROVAL with the reason, and so are the other options of the same change that the same
// facts refuse (src/executors/mandateReplace.ts): before, it stayed APPROVED until its expiry and held for nothing. A
// chain read that failed before the guard closes nothing: that replace can still run, so the hold stays.
// Purser checks it before signing on every Metal path of the three agents (src/policy/holds.ts): Sourcing's purchases,
// the record pull and the one let-through, Support's refunds, Treasury's sweeps. Card purchases at Airwallex do not
// spend from the Metal mandate and are not held.

import type { DB } from "../db/open.js";

const OPEN_STATUSES = ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number] | "FAILED";

export interface OpenReplace { proposal_id: string; status: OpenStatus; expires_at: string }

/** The agents a mandate_replace's steps name; terms code cannot read hold every agent (fail closed). */
function agentsOf(termsJson: string): string[] | "all" {
  try {
    const steps = (JSON.parse(termsJson) as { steps?: { agent?: unknown }[] }).steps;
    if (!Array.isArray(steps)) return "all";
    return steps.map((s) => (typeof s?.agent === "string" ? s.agent : "")).filter(Boolean);
  } catch {
    return "all";
  }
}

/** The open mandate-replace proposals that name this agent's mandate, oldest first. */
export function openReplacesFor(db: DB, agent: string, now = new Date()): OpenReplace[] {
  // A ledger from before proposals (opened read-only by an old page) has none.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proposals'").get()) return [];
  const rows = db.prepare(`SELECT proposal_id, status, expires_at, terms_json FROM proposals p WHERE kind = 'mandate_replace' AND (status IN (${OPEN_STATUSES.map(() => "?").join(", ")})
      OR (status = 'FAILED' AND EXISTS (SELECT 1 FROM executions e WHERE e.proposal_id = p.proposal_id AND e.status IN ('DONE', 'STARTED')))) ORDER BY created_at, proposal_id`)
    .all(...OPEN_STATUSES) as { proposal_id: string; status: OpenStatus; expires_at: string; terms_json: string }[];
  return rows
    // Compared as instants, as the approvals do (src/policy/approvals.ts expireIfDue: an unreadable time is expired there,
    // so such a proposal can never be approved or run, and holds nothing here).
    .filter((r) => r.status === "EXECUTING" || Date.parse(r.expires_at) > now.getTime())
    .filter((r) => { const a = agentsOf(r.terms_json); return a === "all" || a.includes(agent); })
    .map(({ proposal_id, status, expires_at }) => ({ proposal_id, status, expires_at }));
}

const ids = (open: OpenReplace[]) => (open.length === 1 ? open[0]!.proposal_id : `${open.slice(0, -1).map((o) => o.proposal_id).join(", ")} and ${open.at(-1)!.proposal_id}`);

/**
 * Purser's refusal of a payment under the agent's mandate while a replace of it is open, or null. The code is
 * replace_pending (never mandate_…: it is not a refusal against the mandate's own limits, and the dashboard counts
 * those apart).
 */
export function replaceHoldRefusal(db: DB, agent: string, now = new Date()): string | null {
  const open = openReplacesFor(db, agent, now);
  if (!open.length) return null;
  return `replace_pending: mandate replace ${ids(open)} pending; spending waits until it is executed or closed`;
}

const STATUS_WORDS: Record<OpenStatus, string> = { PENDING_APPROVAL: "waiting for approval", APPROVED: "approved, not yet carried out", EXECUTING: "being carried out", FAILED: "partly carried out, then stopped" };
const hhmm = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toISOString().slice(11, 16));

/** The hold as a fact, for the agent's own situation at every wake (so it does not retry blindly); null without one. */
export function replaceHoldFact(db: DB, agent: string, now = new Date()): string | null {
  const open = openReplacesFor(db, agent, now);
  if (!open.length) return null;
  const which = open.map((o) => `${o.proposal_id} (${STATUS_WORDS[o.status]}, expires ${hhmm(o.expires_at)} UTC)`).join(", ");
  return `Your mandate is on hold: mandate replace ${which} would replace it. Code refuses every payment under your mandate before signing until that replace is executed or closed (approved and run, rejected, expired or failed); trying again before then changes nothing. Payments wait; nothing is lost.`;
}
