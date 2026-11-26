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
export type SimulateIn = { ok: true; transfer_id: string; status: string } | { ok: false; reason: string; status?: string };
export interface PayoutSource {
  payout(a: PayoutAskOut): Promise<PayoutAnswerIn>;
  /** The sandbox's simulation of the company's own transfer, to PAID (kit11's AwxFx.payoutSimulate). */
  payoutSimulate(a: { company: string; terms_sha256: string }): Promise<SimulateIn>;
}

export const SIMULATED_REASONS = ["switched_off", "no_binding", "no_key", "day_cap", "company_cap", "over_max", "not_eur", "balance_low", "unavailable", "refused", "ambiguous", "timeout", "bad_answer", "bad_request", "emergency_stop"] as const;
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
 * `stopped`: the company's emergency stop (src/policy/emergencyStop.ts), asked last, immediately before Airwallex is
 * asked: while it is on, nothing is sent to the sandbox (reason emergency_stop), whatever the simulated bank did first.
 */
export async function sandboxPayout(o: {
  company: string; proposalId: string; termsSha256: string; terms: Record<string, unknown>;
  source: PayoutSource | null; allowed: () => Promise<boolean>; db: DB;
  keep: { get(proposalId: string): string | null; set(proposalId: string, note: string): void };
  waitMs?: number;
  stopped?: () => boolean;
}): Promise<PayoutNote> {
  const kept = o.keep.get(o.proposalId);
  if (kept) return JSON.parse(kept) as PayoutNote;
  let note: PayoutNote;
  const simulated = (reason: SimulatedReason): PayoutNote => ({ source: "simulated", reason, terms_sha256: o.termsSha256 });
  const a = asked(o.company, o.termsSha256, o.terms);
  if (!a) note = simulated("bad_request");
  else if (!o.source) note = simulated("no_binding");
  else if (!(await o.allowed().catch(() => false))) note = simulated("switched_off");
  else if (o.stopped?.()) note = simulated("emergency_stop");
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

/**
 * 16 Nov (owner): the agent's own payment within the CFO's limit, paid alone on Pay (src/engine/host.ts propose: alone,
 * the proposal EXECUTED on the simulated bank), is asked of the Airwallex sandbox as the signed one is, with the
 * approval fingerprint of the policy-approved terms (their terms_sha256). Pay's answer carries the note as
 * airwallex_payout, where the pay route's answer has it. Anything else Pay answers is returned as it is.
 */
export async function withAlonePayout<T extends { ok: boolean; proposal?: { id: string; status: string }; alone?: unknown }>(
  out: T, terms: (proposalId: string) => { terms_sha256: string; terms: unknown } | null, payout: (proposalId: string, termsSha256: string, terms: Record<string, unknown>) => Promise<PayoutNote>,
): Promise<T & { airwallex_payout?: PayoutNote }> {
  if (!out.ok || !out.alone || !out.proposal || out.proposal.status !== "EXECUTED") return out;
  const t = terms(out.proposal.id);
  if (!t) return out;
  return { ...out, airwallex_payout: await payout(out.proposal.id, t.terms_sha256, t.terms as Record<string, unknown>) };
}

/** Why "Sandbox: move to PAID" did not move it, as a fixed code. */
export const SIMULATE_REASONS = ["switched_off", "no_binding", "no_key", "no_transfer", "in_approval", "refused", "unavailable", "timeout", "bad_answer", "bad_request"] as const;
export type SimulateReason = (typeof SIMULATE_REASONS)[number];

/**
 * The visitor's "Sandbox: move to PAID" on the Paid step: the sandbox's own simulation (no money anywhere) moves the
 * proposal's Airwallex sandbox transfer to PAID. Only a proposal whose kept note is a live transfer; the note is
 * updated with the status Airwallex answers, and the step is logged (airwallex.simulated).
 */
export async function simulatePayout(o: {
  company: string; proposalId: string; source: PayoutSource | null; allowed: () => Promise<boolean>; db: DB;
  keep: { get(proposalId: string): string | null; set(proposalId: string, note: string): void };
  waitMs?: number;
}): Promise<{ ok: true; note: PayoutNote } | { ok: false; reason: SimulateReason; note: PayoutNote | null }> {
  const kept = o.keep.get(o.proposalId);
  const note = kept ? (JSON.parse(kept) as PayoutNote) : null;
  if (!note || note.source !== "airwallex-sandbox") return { ok: false, reason: "no_transfer", note };
  if (!o.source) return { ok: false, reason: "no_binding", note };
  if (!(await o.allowed().catch(() => false))) return { ok: false, reason: "switched_off", note };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), o.waitMs ?? PAYOUT_WAIT_MS); });
  let ans: SimulateIn | "timeout";
  try { ans = await Promise.race([o.source.payoutSimulate({ company: o.company, terms_sha256: note.terms_sha256 }), late]); } catch { ans = { ok: false, reason: "unavailable" }; } finally { clearTimeout(timer); }
  if (ans === "timeout") return { ok: false, reason: "timeout", note };
  const status = (s: unknown) => (typeof s === "string" && /^[A-Z_]{2,40}$/.test(s) ? s : null);
  if (!ans.ok) {
    const reason = (SIMULATE_REASONS as readonly string[]).includes(ans.reason) ? ans.reason as SimulateReason : "unavailable";
    const now = status(ans.status);
    const next = now ? { ...note, status: now } : note;
    if (now) o.keep.set(o.proposalId, JSON.stringify(next));
    return { ok: false, reason, note: next };
  }
  if (ans.transfer_id !== note.transfer_id || !status(ans.status)) return { ok: false, reason: "bad_answer", note };
  const next: PayoutNote = { ...note, status: ans.status };
  o.keep.set(o.proposalId, JSON.stringify(next));
  audit(o.db, "awx-executor", "airwallex.simulated", o.proposalId, { transfer_id: next.transfer_id, status: next.status });
  return { ok: true, note: next };
}
