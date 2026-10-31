// Executes an approved mandate_replace proposal: one `mandate replace` per step, in the approved order,
// each under an idempotency key so a re-run after a crash finishes the job instead of repeating it.

import { readMandateState } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import { TOTAL_BUDGET_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { publicClient } from "../metal/chain.js";
import { activeMandate, credentialFiles, loadCredentialFile, type MandateAgent } from "../metal/mandate.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { setSetting } from "../world/settings.js";
import { refuseAfterResume } from "../policy/pause.js";
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
  const draft = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as MandateReplaceTerms;

  // Read the chain first (async); the guard below re-checks it against the approved terms.
  const facts = new Map<string, { activeHash: string; spentCents: number }>();
  for (const step of draft.steps) {
    const agent = step.agent as MandateAgent;
    const done = await isBound(byHash(agent, step.credential_hash));
    const active = await activeMandate(agent);
    facts.set(step.order, {
      activeHash: active.credentialHash,
      spentCents: baseUnitsToCents((await readMandateState(publicClient(), active.principal, active.reference)).spent),
      ...(done ? { activeHash: step.replaces_credential_hash } : {}),
    });
  }

  const terms = beginExecution<MandateReplaceTerms>(db, proposalId, (t) => {
    if (toCents(t.total_budget) > TOTAL_BUDGET_CENTS) throw new Error(`total ${t.total_budget} exceeds the limit`);
    refuseAfterResume(db, t.steps.map((s) => s.agent));
    for (const step of t.steps) {
      const f = facts.get(step.order)!;
      if (f.activeHash.toLowerCase() !== step.replaces_credential_hash.toLowerCase()) {
        throw new Error(`${step.agent}: the bound mandate is no longer the one this proposal replaces`);
      }
      if (f.spentCents !== toCents(step.spent_at_proposal)) {
        throw new Error(`${step.agent}: spent moved from ${step.spent_at_proposal} to ${fromCents(f.spentCents)} since the proposal; a new one is needed`);
      }
    }
  }, now);

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
