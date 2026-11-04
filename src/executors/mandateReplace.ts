// Executes an approved mandate_replace proposal: one `mandate replace` per step, in the approved order,
// each under an idempotency key so a re-run after a crash finishes the job instead of repeating it.

import { autonomyOn } from "../config/agents.js";
import { publish } from "../autonomy/bus.js";
import { readMandateState } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import { TOTAL_BUDGET_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { publicClient } from "../metal/chain.js";
import { activeMandate, credentialFiles, loadCredentialFile, type MandateAgent } from "../metal/mandate.js";
import { beginExecution, closeAsStale, finishExecution, resuming } from "../policy/approvals.js";
import { setSetting } from "../world/settings.js";
import { checkCarried } from "../policy/pause.js";
import type { MandateReplaceTerms } from "../agents/treasury.js";
import { replaceMandate } from "./ownerSigner.js";

function byHash(agent: MandateAgent, hash: string) {
  for (const path of credentialFiles(agent)) {
    const m = loadCredentialFile(agent, path);
    if (m.credentialHash.toLowerCase() === hash.toLowerCase()) return m;
  }
  throw new Error(`${agent}: no credential file with hash ${hash}`);
}

export async function executeMandateReplace(db: DB, proposalId: string, now = new Date()): Promise<void> {
  // A chain read that fails (a network blip) throws here with nothing recorded: the replace can still run.
  const facts = await chainFacts(db, proposalId);
  let terms: MandateReplaceTerms;
  try {
    terms = guard(db, proposalId, facts, now);
  } catch (err) {
    if (err instanceof GuardRefusal) {
      // The guard's reason is what is thrown, whatever recording it did; a failure to record is still left a trace.
      try { stopped(db, proposalId, facts, err); } catch (e) {
        console.error(`${proposalId}: the guard's refusal could not be recorded: ${(e as Error).message}`);
        try { audit(db, "system", "proposal.guard_refusal_unrecorded", proposalId, { error: err.message.slice(0, 300), why: (e as Error).message.slice(0, 300) }); } catch { /* the console line stands */ }
      }
    }
    throw err;
  }
  await run(db, proposalId, terms);
}

/**
 * The guard's own refusal of the terms against the chain as it is (as strict as ever); other errors are not this.
 * permanent: the terms can never run (a spend above the one at proposal, another bound mandate, the total, Block 6). A
 * spend read LOWER than at proposal is refused just the same, but proves nothing (spent only goes up: a stale node).
 */
class GuardRefusal extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message); }
}

/**
 * dry-179: the guard refused an approved replace ("spent moved … a new one is needed"). Its transaction rolled back, so
 * before this the proposal stayed APPROVED with no row in the ledger, Treasury never learnt it failed, and its other
 * option stayed waiting though it could never run either. Now: the replace is closed (NEEDS_REAPPROVAL, terminal) with
 * the reason; each other replace still open that the same chain facts refuse is closed with it; Treasury is woken with
 * the facts (it may plan a new one, from the spend as it is now); the hold on the agents' spending lifts
 * (src/policy/replaceHold.ts). Not for a second call while another run executes it (that run goes on), nor for one not
 * approved: closeAsStale closes only from approved or failed, or from executing on a restart's resume.
 */
function stopped(db: DB, proposalId: string, facts: Facts, err: GuardRefusal): void {
  const reason = err.message;
  const resume = resuming.has(proposalId);
  // Never closed as "not run" once a step ran or may have (a DONE or STARTED execution row: a FAILED retry, a resume
  // after a crash mid-step), nor on a read that proves nothing: the refusal is recorded, the proposal stays as it is
  // (still holding while open) for a person or a later run. Review 2 of fix-dry179.
  const stepsRun = (db.prepare("SELECT COUNT(*) AS n FROM executions WHERE proposal_id = ? AND status IN ('DONE', 'STARTED')").get(proposalId) as { n: number }).n;
  if (stepsRun > 0 || !err.permanent) {
    const status = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string } | undefined)?.status ?? "";
    if (["APPROVED", "FAILED"].includes(status) || (status === "EXECUTING" && resume)) {
      audit(db, "system", "proposal.guard_refused", proposalId, { error: reason.slice(0, 300), steps_started: stepsRun, status, ...(err.permanent ? {} : { inconclusive: "a spend read lower than at the proposal: a stale chain read, not a move" }) });
    }
    return;
  }
  if (!closeAsStale(db, proposalId, { error: reason, stopped: resume ? "on resume" : "before its first step" }, { resuming: resume })) return;
  const closed: string[] = [];
  try {
  const open = db.prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'mandate_replace' AND status IN ('PENDING_APPROVAL', 'APPROVED', 'FAILED') AND proposal_id != ? ORDER BY proposal_id").all(proposalId) as { proposal_id: string; terms_json: string }[];
  for (const o of open) {
    const t = JSON.parse(o.terms_json) as MandateReplaceTerms;
    // Only another option of the same change (it replaces a credential this one replaces), and only when the same
    // facts refuse it too: one that could still run stays open for the CFO.
    if (!t.steps.some((s) => facts.has(stepKey(s)))) continue;
    let why: string | null = null;
    // Only a refusal that proves the sibling can never run closes it; one filed later from the spend as it is stays.
    try { preconditions(db, t, facts, true); } catch (e) { why = e instanceof GuardRefusal && e.permanent ? e.message : null; }
    if (why && closeAsStale(db, o.proposal_id, { error: `${why} (found when ${proposalId}, another option of the same change, was run)`, sibling_of: proposalId })) closed.push(o.proposal_id);
  }
  } catch (e) {
    // Closing the others is best effort: the main proposal is closed with its reason whatever happens here.
    audit(db, "system", "proposal.siblings_not_checked", proposalId, { error: (e as Error).message.slice(0, 300) });
  }
  if (autonomyOn()) publish(db, "mandate_replace.stopped", { proposal_id: proposalId, reason, closed }, "treasury", "system");
}

type Facts = Map<string, { activeHash: string; spentCents: number }>;
/** A step's facts are keyed by the agent and the credential it replaces (the options of one change share them). */
const stepKey = (s: { agent: string; replaces_credential_hash: string }) => `${s.agent}:${s.replaces_credential_hash.toLowerCase()}`;

/** What the chain says now, for each step: the bound mandate and what it spent. */
async function chainFacts(db: DB, proposalId: string): Promise<Facts> {
  const draft = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as MandateReplaceTerms;

  // Read the chain first (async); the guard below re-checks it against the approved terms.
  const facts = new Map<string, { activeHash: string; spentCents: number }>();
  for (const step of draft.steps) {
    const agent = step.agent as MandateAgent;
    const done = await isBound(byHash(agent, step.credential_hash));
    const active = await activeMandate(agent);
    facts.set(stepKey(step), {
      activeHash: active.credentialHash,
      spentCents: baseUnitsToCents((await readMandateState(publicClient(), active.principal, active.reference)).spent),
      ...(done ? { activeHash: step.replaces_credential_hash } : {}),
    });
  }
  return facts;
}

/** The execution guard (beginExecution) against the chain facts: from here the proposal is EXECUTING. */
function guard(db: DB, proposalId: string, facts: Facts, now: Date): MandateReplaceTerms {
  return beginExecution<MandateReplaceTerms>(db, proposalId, (t) => preconditions(db, t, facts), now);
}

/**
 * Block 6 and the chain: the terms still fit the chain as it is now; otherwise a GuardRefusal, with why. `onlyRead`:
 * for another option of the same change, a step whose mandate was not read here proves nothing and is skipped.
 */
function preconditions(db: DB, t: MandateReplaceTerms, facts: Facts, onlyRead = false): void {
  try {
    if (toCents(t.total_budget) > TOTAL_BUDGET_CENTS) throw new Error(`total ${t.total_budget} exceeds the limit`);
    // Block 6: the chain budgets were set for the spend carried at proposal; a resume since would make them wrong.
    checkCarried(db, t.steps);
    for (const step of t.steps) {
      const f = facts.get(stepKey(step));
      if (!f && onlyRead) continue;
      if (!f) throw new Error(`${step.agent}: the chain was not read for this step`);
      if (f.activeHash.toLowerCase() !== step.replaces_credential_hash.toLowerCase()) {
        throw new Error(`${step.agent}: the bound mandate is no longer the one this proposal replaces`);
      }
      if (f.spentCents !== toCents(step.spent_at_proposal)) {
        throw new GuardRefusal(`${step.agent}: spent moved from ${step.spent_at_proposal} to ${fromCents(f.spentCents)} since the proposal; a new one is needed`, f.spentCents > toCents(step.spent_at_proposal));
      }
    }
  } catch (e) {
    throw e instanceof GuardRefusal ? e : new GuardRefusal((e as Error).message, true);
  }
}

/** The steps, in the approved order, each once (keyed); then the new price and the siblings superseded. */
async function run(db: DB, proposalId: string, terms: MandateReplaceTerms): Promise<void> {
  try {
    for (const step of [...terms.steps].sort((a, b) => Number(a.order) - Number(b.order))) {
      const agent = step.agent as MandateAgent;
      const key = `${proposalId}:${step.order}`;
      const prior = db.prepare("SELECT status, external_ref FROM executions WHERE idempotency_key = ?").get(key) as { status: string } | undefined;
      if (prior?.status === "DONE") continue;
      if (!prior) {
        db.prepare("INSERT INTO executions (proposal_id, step_no, idempotency_key, status, request_redacted, updated_at) VALUES (?, ?, ?, 'STARTED', ?, ?)")
          .run(proposalId, Number(step.order), key, JSON.stringify({ agent, cap: step.cap, budget: step.budget, credential_hash: step.credential_hash }), new Date().toISOString());
      }
      const next = byHash(agent, step.credential_hash);
      let tx: string | null = null;
      if (!(await isBound(next))) {
        const old = byHash(agent, step.replaces_credential_hash);
        tx = replaceMandate(next.credentialPath, old.credentialPath).tx;
      }
      db.prepare("UPDATE executions SET status = 'DONE', external_ref = ?, updated_at = ? WHERE idempotency_key = ?").run(tx, new Date().toISOString(), key);
      audit(db, "owner-signer", "mandate.replaced", agent, { proposal_id: proposalId, step: step.order, cap: step.cap, budget: step.budget, credential_hash: step.credential_hash, tx });
    }
    setSetting(db, "treasury", "sell_price", terms.query_price);
    supersedeSiblings(db, proposalId, terms);
    finishExecution(db, proposalId, "EXECUTED", { steps: terms.steps.length, query_price: terms.query_price });
    // D19: the agents hear of their new mandates (the Sourcing agent may go back to the supplier it prefers).
    if (autonomyOn()) publish(db, "mandate.replaced", { proposal_id: proposalId, query_price: terms.query_price, steps: terms.steps.map((s) => ({ agent: s.agent, cap: s.cap, budget: s.budget })) }, null, "owner-signer");
  } catch (err) {
    finishExecution(db, proposalId, "FAILED", { error: (err as Error).message });
    throw err;
  }
}

async function isBound(m: ReturnType<typeof loadCredentialFile>): Promise<boolean> {
  const s = await readMandateState(publicClient(), m.principal, m.reference);
  return s.boundBlock > 0n && !s.revoked;
}

/** The other options for the same change can no longer run: their credentials are now bound or obsolete. */
function supersedeSiblings(db: DB, proposalId: string, terms: MandateReplaceTerms): void {
  const rows = db.prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'mandate_replace' AND status = 'PENDING_APPROVAL' AND proposal_id != ?").all(proposalId) as { proposal_id: string; terms_json: string }[];
  for (const r of rows) {
    const t = JSON.parse(r.terms_json) as MandateReplaceTerms;
    if (t.steps.some((s) => terms.steps.some((x) => x.replaces_credential_hash === s.replaces_credential_hash))) {
      db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ? AND status = 'PENDING_APPROVAL'").run(r.proposal_id);
      audit(db, "system", "proposal.superseded", r.proposal_id, { by: proposalId });
    }
  }
}
