// /try's live sandbox payout (step 2, 14 Nov), on the engine's side: after the one pay route has verified the visitor's
// passkey signature and the simulated bank has paid (outcome "paid"), the same signed payment is asked of the Airwallex
// SANDBOX as one transfer (test money), through the kit11 Worker's AwxFx entrypoint, which holds the payout key and
// the caps (worker/src/awxPayout.ts). Airwallex's request_id comes from the signed terms' hash and its metadata carries
// the hash itself, so the same terms never pay twice.
//
// Off unless the deployment's switch awx_payout is on (POST /v1/try/admin; missing is off). When it is off, or Airwallex
// says no, is slow or capped, the payment stands on the simulated bank and the note says so: { source: "simulated", reason }.
import { audit } from "../../../src/audit/log.js";
import type { DB } from "../../../src/db/open.js";

export const PAYOUT_WAIT_MS = 8_000;

export interface PayoutAskOut { company: string; terms_sha256: string; amount: string; currency: string; reference: string }
export type PayoutAnswerIn =
  | { ok: true; transfer_id: string; status: string; amount: string; currency: string; request_id: string; again?: boolean }
  | { ok: false; reason: string };
export interface PayoutSource { payout(a: PayoutAskOut): Promise<PayoutAnswerIn> }

export const SIMULATED_REASONS = ["switched_off", "no_binding", "no_key", "day_cap", "company_cap", "over_max", "not_eur", "balance_low", "unavailable", "refused", "ambiguous", "timeout", "bad_answer", "bad_request"] as const;
export type SimulatedReason = (typeof SIMULATED_REASONS)[number];

/** What the pay and paid steps show, and the records keep. */
export type PayoutNote =
  | { source: "airwallex-sandbox"; transfer_id: string; status: string; amount: string; currency: string; request_id: string; terms_sha256: string }
  | { source: "simulated"; reason: SimulatedReason; terms_sha256: string };

/** The signed terms' amount, currency and reference, as the pay route paid them. */
function asked(company: string, sha: string, terms: Record<string, unknown>): PayoutAskOut | null {
  const amount = typeof terms.amount === "string" ? terms.amount : null;
  const currency = typeof terms.currency === "string" ? terms.currency : null;
  const reference = typeof terms.reference === "string" && terms.reference ? terms.reference : typeof terms.proposal_id === "string" ? terms.proposal_id : "";
  if (!amount || !currency || !/^[0-9a-f]{64}$/.test(sha)) return null;
  // Airwallex's reference: printable ASCII, at most 140 characters.
  return { company, terms_sha256: sha, amount, currency, reference: reference.replace(/[^\x20-\x7e]/g, "?").slice(0, 140) };
}

/**
 * The payout for one signed payment, once: a note kept by proposal id (`keep`) is the answer for the same proposal
 * again; otherwise Airwallex is asked (or why not), the note kept and the step written to the audit log.
 */
export async function sandboxPayout(o: {
  company: string; proposalId: string; termsSha256: string; terms: Record<string, unknown>;
  source: PayoutSource | null; allowed: () => Promise<boolean>; db: DB;
  keep: { get(proposalId: string): string | null; set(proposalId: string, note: string): void };
  waitMs?: number;
}): Promise<PayoutNote> {
  const kept = o.keep.get(o.proposalId);
  if (kept) return JSON.parse(kept) as PayoutNote;
  let note: PayoutNote;
  const simulated = (reason: SimulatedReason): PayoutNote => ({ source: "simulated", reason, terms_sha256: o.termsSha256 });
  const a = asked(o.company, o.termsSha256, o.terms);
  if (!a) note = simulated("bad_request");
  else if (!o.source) note = simulated("no_binding");
  else if (!(await o.allowed().catch(() => false))) note = simulated("switched_off");
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), o.waitMs ?? PAYOUT_WAIT_MS); });
    try {
      const ans = await Promise.race([o.source.payout(a), late]);
      if (ans === "timeout") note = simulated("timeout");
      else if (!ans || typeof ans !== "object") note = simulated("bad_answer");
      else if (!ans.ok) note = simulated((SIMULATED_REASONS as readonly string[]).includes(ans.reason) ? ans.reason as SimulatedReason : "unavailable");
      else if (typeof ans.transfer_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(ans.transfer_id) || typeof ans.status !== "string" || !/^[A-Z_]{2,40}$/.test(ans.status)
        || ans.amount !== a.amount || ans.currency !== a.currency) note = simulated("bad_answer");
      else note = { source: "airwallex-sandbox", transfer_id: ans.transfer_id, status: ans.status, amount: ans.amount, currency: ans.currency, request_id: String(ans.request_id), terms_sha256: o.termsSha256 };
    } catch {
      note = simulated("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  // A timeout or an unclear answer is not kept: the same proposal asked again asks again (Airwallex's request_id is the
  // same, so it never pays twice). Every other answer is final for this proposal.
  if (!(note.source === "simulated" && (note.reason === "timeout" || note.reason === "ambiguous" || note.reason === "unavailable"))) o.keep.set(o.proposalId, JSON.stringify(note));
  if (note.source === "airwallex-sandbox") {
    audit(o.db, "awx-executor", "airwallex.transfer", o.proposalId, { transfer_id: note.transfer_id, status: note.status, amount: `${note.currency} ${note.amount}`, request_id: note.request_id, approval_sha256: o.termsSha256 });
  } else {
    audit(o.db, "awx-executor", "airwallex.payout_skipped", o.proposalId, { reason: note.reason });
  }
  return note;
}
