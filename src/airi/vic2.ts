// vic-2: what Purser adds around the Airi rail (docs/runs/vic-2-plan.md). No purchase reaches Airi or Airwallex: the
// conductor's Airi client and its checkout take 0 calls, and any call fails the run.
//   D  tampered after signing: the Sourcing agent asks EUR 30.00 (above the CFO's EUR 20.00 limit), the CFO approves
//      with Face ID, then a labelled red-team step of this run rewrites the stored terms in the ledger, as someone with
//      write access to the database could. The executor refuses on its hash check before Airi is asked.
//   E  the CFO locks the Airi rail: a policy change (the test shop blocked for Airi purchases), Face ID. The agent's next
//      purchase within the limit (EUR 12.00) is refused by Purser, PURSER_MERCHANT_NOT_ALLOWED, 0 Airi calls.
//   F  (optional) the CFO lifts the lock with Face ID; the rail is offered again for the same purchase, and the run stops
//      there: no request, no mandate, no tap, no charge.
// `--dry` runs the same code on stand-ins, 0 network, with stand-in approvals that say so.
//
// The runner (npm run relay) takes the CFO's Face IDs and runs the two policy changes. In vic-2 it runs WITHOUT the Airi
// rail and without Airwallex keys, so it cannot run D: D stays approved and unexecuted until the conductor's red-team
// step has altered it, and the conductor then hands it to the executor itself (runnerProblems checks the runner).

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { airiRailOffer } from "../agents/railChoice.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { closeAsStale, expireDue } from "../policy/approvals.js";
import { approvalOrigin } from "../executors/index.js";
import { withOrigin } from "../provenance/origin.js";
import type { RunnerLock } from "../ops/runnerLock.js";
import type { AiriCheckout, AiriClient } from "./client.js";
import { AIRI_CURRENCY, MERCHANT_KEY_PREFIX, airiPolicy } from "./policy.js";
import { decideAiriPurchase, executeAiriPurchase, requestAiriPurchase, type AiriDeps, type AiriOutcome, type AiriPurchaseRequest } from "./purchase.js";
import { MERCHANT, assertNoSecrets, seedPolicy } from "./vic1.js";

export const RUN = "vic-2";
/** The setting the CFO's lock changes: the run's one merchant on the Airi allowlist. */
export const LOCK_KEY = `${MERCHANT_KEY_PREFIX}${MERCHANT.id}`;
export const D_AMOUNT = "30.00";
/** The planted alteration: the amount and the item's price together, so the items still add up, and below the rail's
 *  hard cap of 200.00, so Purser's policy re-check alone would let it through to the CFO route: only the hash stops it. */
export const TAMPERED_AMOUNT = "190.00";
export const E_AMOUNT = "12.00";
/** The terms carry a payment method id; vic-2 never asks Airi for a card, so it names none unless one is given. */
export const NO_CARD = "none: vic-2 never asks Airi for a card";
/** The CFO's time for each Face ID (the Airi purchase's own window is the same 30 minutes). */
export const DECISION_TTL_MS = 30 * 60_000;
/** After the Face ID on a policy change, the runner applies it within seconds; longer than this is a stop. */
export const EXECUTE_GRACE_MS = 90_000;
/** Words that every record and the ledger's own row carry for step D's alteration. */
export const PLANTED = "our own planted attack: a red-team step of the vic-2 conductor rewrote the stored terms in the ledger after the CFO signed, as someone with write access to the database could; no outside attacker was involved";

export type Call = { op: string; by: string };

export class Vic2Stop extends Error {}

/**
 * A client that may not be called at all: every method is refused before it runs, the attempt is recorded (by name,
 * never its arguments), and the run fails. Properties (kind, label) read through.
 */
export function zeroBudget<T extends object>(target: T, by: string, attempts: Call[]): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv) as unknown;
      if (typeof v !== "function" || prop === "constructor") return v;
      return () => {
        attempts.push({ op: String(prop), by });
        throw new Vic2Stop(`vic-2 allows 0 ${by} calls: ${by}.${String(prop)} was refused before it ran, so the run fails`);
      };
    },
  });
}

/** vic-2 has no checkout: Airwallex is never called (the guard above refuses even this object's methods first). */
export const NO_CHECKOUT: AiriCheckout = {
  kind: "stand-in",
  label: "none: vic-2 has no checkout and makes 0 Airwallex calls",
  prepare: () => Promise.reject(new Vic2Stop("vic-2 has no checkout")),
  pay: () => Promise.reject(new Vic2Stop("vic-2 has no checkout")),
  lookup: () => Promise.reject(new Vic2Stop("vic-2 has no checkout")),
};

/** The conductor's rail: the given Airi client and no checkout, each at 0 calls. No link is ever shown. */
export function zeroRail(airi: AiriClient, attempts: Call[], say?: (line: string) => void): AiriDeps {
  return {
    airi: zeroBudget(airi, "airi", attempts),
    checkout: zeroBudget(NO_CHECKOUT, "checkout", attempts),
    showPasskeyUrl: () => { throw new Vic2Stop("vic-2 never shows an Airi link"); },
    ...(say ? { say } : {}),
  };
}

/** What the runner's environment says, read from /proc: only these, never a value but the rail's switch. */
export interface RunnerEnv { rail: string | null; airwallexKeys: boolean; metal: boolean }

export function readRunnerEnv(pid: number): RunnerEnv | null {
  try {
    const out: RunnerEnv = { rail: null, airwallexKeys: false, metal: false };
    for (const kv of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
      if (kv.startsWith("KIT11_AIRI_RAIL=")) out.rail = kv.slice(16);
      else if (/^AIRWALLEX_(CLIENT_ID|API_KEY)=./.test(kv)) out.airwallexKeys = true;
      else if (/^METAL_RPC_URL=./.test(kv)) out.metal = true;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Why the runner beside this run is not the one vic-2 needs (empty: it is). It must hold this ledger's lock on this
 * host, and run without the Airi rail and without Airwallex keys: then it cannot run D (an Airi purchase) by itself,
 * twice over. Pure: the lock and the environment come in.
 */
export function runnerProblems(lock: RunnerLock | null, env: (pid: number) => RunnerEnv | null, host = hostname()): string[] {
  if (!lock) return ["no runner holds this ledger's lock: start it first (npm run relay, as the plan says)"];
  if (lock.host !== host) return [`the runner runs on another host (${lock.host}); its environment cannot be checked from here`];
  const e = env(lock.pid);
  if (!e) return [`the runner's environment (pid ${lock.pid}) cannot be read; start it as the plan says`];
  const out: string[] = [];
  if (e.rail === "on") out.push("the runner has KIT11_AIRI_RAIL=on: it would run D at Airi itself; restart it without the rail");
  if (e.airwallexKeys) out.push("the runner has Airwallex keys: vic-2 makes 0 Airwallex calls; restart it without AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY");
  if (e.metal) out.push("the runner has METAL_RPC_URL: vic-2 makes no Metal call; restart it without");
  return out;
}

export interface Vic2Deps {
  db: DB;
  mode: "dry" | "live";
  /** The conductor's rail: zeroRail, so any outside call fails the run. */
  rail: AiriDeps;
  /** Every refused outside call, by name. Must stay empty. */
  attempts: () => Call[];
  log: (line: string) => void;
  /** Waits for the CFO's decision on `id`; `executed`: and for the runner to run it (a policy change). Returns the status. */
  awaitCfo: (id: string, until: "decided" | "executed") => Promise<string>;
  /** F: lift the lock again with a Face ID, and stop before Airi. */
  withF: boolean;
  /** The agent's Airi payment method id for the terms (no card is ever asked for); NO_CARD when none is given. */
  paymentMethodId?: string;
  /** Where KIT11_AIRI_RAIL is read for the rail choice (default: process.env). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: () => Date;
}

export interface Vic2Record {
  run: string;
  mode: "dry" | "live";
  label: string;
  started_at: string;
  ended_at: string;
  planted_attack: string;
  steps: { D: Json; E: Json; F: Json | null };
  checks: Record<string, { ok: boolean; detail: string }>;
  outside_calls: { airi: number; airwallex: number; refused_attempts: Call[] };
  audit: Json[];
}

const order = (pm: string, amount: string, item: string, description: string): AiriPurchaseRequest => ({
  agent: "sourcing", paymentMethodId: pm, merchantName: MERCHANT.name, merchantUrl: MERCHANT.url, merchantCountry: MERCHANT.country,
  amount, currency: AIRI_CURRENCY, items: [{ name: item, unitPrice: amount, quantity: "1" }], description,
});

const brief = (o: AiriOutcome): Json => JSON.parse(JSON.stringify(o)) as Json;
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status ?? "MISSING";
type Approval = { decision: string; method: string; approver: string; approved_sha256: string; created_at: string };
const approvalOf = (db: DB, id: string) => (db.prepare("SELECT decision, method, approver, approved_sha256, created_at FROM approvals WHERE proposal_id = ?").get(id) as Approval | undefined) ?? null;
const setting = (db: DB, key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;

/** Live: the CFO's passkey (Face ID). Dry: the labelled stand-in, and nothing else. */
function signedBy(mode: "dry" | "live", a: Approval | null): { ok: boolean; how: string } {
  if (!a || a.decision !== "APPROVED") return { ok: false, how: a ? a.decision.toLowerCase() : "no decision" };
  if (mode === "live") return { ok: a.method === "passkey", how: a.method === "passkey" ? `the CFO's Face ID (passkey) at ${a.created_at}` : `method ${a.method}, not a passkey` };
  const stand = a.method === "cli" && a.approver.startsWith("dry-run stand-in");
  return { ok: stand, how: stand ? "a stand-in approval (dry run, not Face ID)" : `method ${a.method} by ${a.approver}` };
}

/**
 * The red-team step of D, labelled: first a ledger row saying it is our own planted attack (append-only, hash-chained),
 * then the alteration itself, done as someone with write access to the database would: the stored terms and the
 * proposal's own terms hash rewritten together. The approval row, with the hash the CFO's passkey signed, is left as it is.
 */
export function plantAlteration(db: DB, proposalId: string, now: Date): { signed_sha256: string; altered_sha256: string; changed: Json } {
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string; terms_sha256: string };
  const t = JSON.parse(p.terms_json) as Terms & { amount: string; items: { name: string; unit_price: string; quantity: string }[] };
  const altered = { ...t, amount: TAMPERED_AMOUNT, items: t.items.map((i) => ({ ...i, unit_price: TAMPERED_AMOUNT })) };
  const alteredSha = termsHash(altered);
  const changed = { amount: { from: t.amount, to: TAMPERED_AMOUNT }, item_price: { from: t.items[0]?.unit_price ?? null, to: TAMPERED_AMOUNT } } as Json;
  audit(db, "system", "vic2.redteam_alteration", proposalId, { run: RUN, label: PLANTED, proposal_id: proposalId, changed, signed_sha256: p.terms_sha256, altered_sha256: alteredSha }, now);
  db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(altered), alteredSha, proposalId);
  return { signed_sha256: p.terms_sha256, altered_sha256: alteredSha, changed };
}

/** Runs D, E and (with withF) F. Stops only on a Vic2Stop: an outside call, or the runner running D itself. */
export async function runVic2(d: Vic2Deps): Promise<Vic2Record> {
  const clock = d.now ?? (() => new Date());
  const started = clock();
  const pm = d.paymentMethodId || NO_CARD;
  const env = d.env ?? process.env;
  const n = () => d.attempts().length;
  seedPolicy(d.db, started, RUN);
  d.log(`policy     the Airi rail: up to 20.00 EUR alone, 3 a day, ${MERCHANT.name} allowed`);

  // ---- D: tampered after signing -----------------------------------------------------------------------------------
  d.log(`D          above the limit: ${D_AMOUNT} EUR, the CFO's Face ID first; then a planted alteration; the executor must refuse before Airi`);
  const dReq = order(pm, D_AMOUNT, "Tent footprint", "vic-2 D: above the CFO's limit; Purser stops before Airi, nothing is paid");
  const dOut = await requestAiriPurchase(d.db, d.rail, dReq, clock());
  let dEnd = dOut.status as string;
  let dApproval: Approval | null = null;
  let alteration: ReturnType<typeof plantAlteration> | null = null;
  let policyAlone: Json = null;
  let refusal: string | null = null;
  let dCalls = 0;
  let dRow: Json = null;
  if (dOut.status === "pending_approval") {
    const id = dOut.proposalId;
    dEnd = await d.awaitCfo(id, "decided");
    dApproval = approvalOf(d.db, id);
    if (dEnd === "APPROVED") {
      // The runner must not have begun it: with the rail off it cannot, and this checks that it did not.
      const begun = d.db.prepare("SELECT 1 FROM audit_log WHERE subject = ? AND event IN ('proposal.executing', 'airi.checkout_prepared', 'airi.mandate_created')").get(id)
        || d.db.prepare("SELECT 1 FROM airi_purchases WHERE proposal_id = ?").get(id);
      if (begun || statusOf(d.db, id) !== "APPROVED") throw new Vic2Stop(`${id} was begun by someone else (the runner has the Airi rail on?); vic-2 stops before its alteration`);
      d.log(`D          RED TEAM   ${id}: ${PLANTED}`);
      alteration = plantAlteration(d.db, id, clock());
      d.log(`D          RED TEAM   ${id}: amount and item price ${D_AMOUNT} -> ${TAMPERED_AMOUNT} EUR in the stored terms (and their hash in the proposal row); the CFO signed ${alteration.signed_sha256.slice(0, 16)}…, the terms now hash to ${alteration.altered_sha256.slice(0, 16)}…`);
      const stored = JSON.parse((d.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as { amount: string; items: { name: string; unit_price: string; quantity: string }[] } & Record<string, unknown>;
      const asReq: AiriPurchaseRequest = { ...dReq, amount: stored.amount, items: stored.items.map((i) => ({ name: i.name, unitPrice: i.unit_price, quantity: i.quantity })) };
      const route = decideAiriPurchase(airiPolicy(d.db), asReq, Number.MAX_SAFE_INTEGER);
      policyAlone = route.route === "refused" ? `refused: ${route.code}` : `passes (route ${route.route}): ${TAMPERED_AMOUNT} EUR is below the rail's hard cap, the items add up and the merchant is allowed, so Purser's policy re-check alone would let the altered terms through with the CFO's approval; only the hash stops them`;
      d.log("D          the executor now runs it, as the runner would after a Face ID");
      const before = n();
      try {
        const origin = approvalOrigin(d.db, id);
        const out = origin ? await withOrigin(origin, () => executeAiriPurchase(d.db, d.rail, id, clock())) : await executeAiriPurchase(d.db, d.rail, id, clock());
        refusal = out.status === "refused" ? `${out.code}: ${out.reason}` : null;
        dEnd = `ran: ${out.status}`;
      } catch (e) {
        if (e instanceof Vic2Stop) throw e;
        refusal = (e as Error).message;
      }
      dCalls = n() - before;
      dRow = (d.db.prepare("SELECT status, code FROM airi_purchases WHERE proposal_id = ?").get(id) as Json | undefined) ?? null;
      d.log(`D          ${refusal ? `refused: ${refusal}` : `NOT refused (${dEnd})`}; Airi calls for D: ${dCalls}`);
      if (refusal && statusOf(d.db, id) === "APPROVED") {
        closeAsStale(d.db, id, { error: `the stored terms no longer hash to what the CFO signed (${RUN}: ${PLANTED})` }, {}, clock());
        dEnd = statusOf(d.db, id);
        d.log(`D          ${id} closed: ${dEnd}; it can never run`);
      }
    } else {
      d.log(`D          ${id} ${dEnd}: no alteration was planted`);
    }
  }

  // ---- E: the CFO locks the Airi rail ------------------------------------------------------------------------------
  d.log(`E          the CFO locks the Airi rail: ${MERCHANT.name} blocked for Airi purchases (policy change, Face ID)`);
  const lock = proposePolicyChange(d.db, { changes: [{ key: LOCK_KEY, to: "blocked" }], reason: `${RUN} E: lock the Airi rail (the test shop blocked for Airi purchases)`, ttlMs: DECISION_TTL_MS }, "human", clock());
  const eEnd = await d.awaitCfo(lock.proposal_id, "executed");
  const eApproval = approvalOf(d.db, lock.proposal_id);
  const lockValue = setting(d.db, LOCK_KEY);
  d.log(`E          ${lock.proposal_id} ${eEnd}; ${LOCK_KEY} = ${lockValue}`);
  let eOut: AiriOutcome | null = null;
  let eCalls = 0;
  let eOffer: Json = null;
  if (eEnd === "EXECUTED") {
    eOffer = airiRailOffer(d.db, { merchantId: MERCHANT.id, item: "Trail map pack", amount: E_AMOUNT, currency: AIRI_CURRENCY }, env) as unknown as Json;
    d.log(`E          the agent's next purchase: ${E_AMOUNT} EUR at ${MERCHANT.name}, within the limit`);
    const before = n();
    eOut = await requestAiriPurchase(d.db, d.rail, order(pm, E_AMOUNT, "Trail map pack", "vic-2 E: within the CFO's limit, after the lock"), clock());
    eCalls = n() - before;
    d.log(`E          ${eOut.status}${"code" in eOut ? ` (${eOut.code}${"by" in eOut ? `, by ${eOut.by}` : ""})` : ""}; Airi calls for E: ${eCalls}`);
  } else {
    d.log("E          the lock is not in force: no purchase is tried");
  }

  // ---- F: the lock lifted, the rail offered again; the run stops before Airi -----------------------------------------
  let f: { id: string; end: string; approval: Approval | null; value: string | null; offer: Json; route: Json; calls: number } | null = null;
  if (d.withF) {
    d.log(`F          the CFO lifts the lock: ${MERCHANT.name} allowed again (policy change, Face ID); then the run stops before Airi`);
    const unlock = proposePolicyChange(d.db, { changes: [{ key: LOCK_KEY, to: "allowed" }], reason: `${RUN} F: lift the lock on the Airi rail (the test shop allowed again)`, ttlMs: DECISION_TTL_MS }, "human", clock());
    const end = await d.awaitCfo(unlock.proposal_id, "executed");
    f = { id: unlock.proposal_id, end, approval: approvalOf(d.db, unlock.proposal_id), value: setting(d.db, LOCK_KEY), offer: null, route: null, calls: 0 };
    d.log(`F          ${unlock.proposal_id} ${end}; ${LOCK_KEY} = ${f.value}`);
    if (end === "EXECUTED") {
      const before = n();
      f.offer = airiRailOffer(d.db, { merchantId: MERCHANT.id, item: "Trail map pack", amount: E_AMOUNT, currency: AIRI_CURRENCY }, env) as unknown as Json;
      const route = decideAiriPurchase(airiPolicy(d.db), order(pm, E_AMOUNT, "Trail map pack", "vic-2 F"), 0);
      f.route = route.route === "refused" ? `refused: ${route.code}` : route.route;
      f.calls = n() - before;
      d.log(`F          the rail is offered again (${(f.offer as { offered: boolean }).offered ? "offered" : "NOT offered"}; Purser's route: ${f.route}); the run stops here: no request, no mandate, no Airi tap, no charge`);
    }
  }

  const ids = [dOut.status === "pending_approval" ? dOut.proposalId : null, lock.proposal_id, f?.id ?? null].filter((x): x is string => !!x);
  const auditRows = (d.db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'airi.%' OR event LIKE 'vic2.%' OR event = 'policy.changed' OR (event LIKE 'proposal.%' AND subject IN (${ids.map(() => "?").join(", ")})) ORDER BY seq`).all(...ids) as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[])
    .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));

  const dSigned = signedBy(d.mode, dApproval);
  const eSigned = signedBy(d.mode, eApproval);
  const total = d.attempts();
  const checks: Vic2Record["checks"] = {
    d_cfo_signed: {
      ok: dOut.status === "pending_approval" && dSigned.ok && !!dApproval && dApproval.approved_sha256 === dOut.termsSha256,
      detail: dOut.status === "pending_approval" ? `D (${dOut.proposalId}, ${D_AMOUNT} EUR) approved by ${dSigned.how}${dApproval ? ` over terms ${dApproval.approved_sha256.slice(0, 16)}…` : ""}` : `D did not ask the CFO (${dOut.status})`,
    },
    d_refused_hash_mismatch_0_airi_calls: {
      ok: !!alteration && !!refusal && /terms do not match the approved hash/.test(refusal) && dCalls === 0 && dRow === null,
      detail: alteration ? `after the planted alteration (${D_AMOUNT} -> ${TAMPERED_AMOUNT} EUR): ${refusal ? `refused, "${refusal}"` : "NOT refused"}; ${dCalls} Airi call(s); ${dRow === null ? "no purchase row" : `a purchase row ${JSON.stringify(dRow)}`}` : "no alteration was planted (D was not approved)",
    },
    e_lock_signed_with_face_id: {
      ok: eEnd === "EXECUTED" && eSigned.ok && lockValue === "blocked",
      detail: `${lock.proposal_id} (${LOCK_KEY} allowed -> blocked) ${eEnd}, approved by ${eSigned.how}; now ${lockValue}`,
    },
    e_refused_by_purser_0_airi_calls: {
      ok: !!eOut && eOut.status === "refused" && eOut.by === "purser" && eOut.code === "PURSER_MERCHANT_NOT_ALLOWED" && eCalls === 0,
      detail: eOut ? `E (${E_AMOUNT} EUR, within the limit): ${eOut.status}${"code" in eOut ? ` ${eOut.code}` : ""}${"by" in eOut ? ` by ${eOut.by}` : ""}; ${eCalls} Airi call(s)` : "E was not tried (the lock was not in force)",
    },
  };
  if (f) {
    const fSigned = signedBy(d.mode, f.approval);
    checks.f_unlock_signed_with_face_id = { ok: f.end === "EXECUTED" && fSigned.ok && f.value === "allowed", detail: `${f.id} (${LOCK_KEY} blocked -> allowed) ${f.end}, approved by ${fSigned.how}; now ${f.value}` };
    checks.f_offered_again_stopped_before_airi = {
      ok: !!f.offer && (f.offer as { offered: boolean }).offered && f.route === "alone" && f.calls === 0,
      detail: f.offer ? `${E_AMOUNT} EUR at the test shop: ${(f.offer as { offered: boolean }).offered ? "offered" : "not offered"}, Purser's route ${f.route}; the run stopped before any request: ${f.calls} Airi call(s), no mandate, no tap, no charge` : "the lock was not lifted",
    };
  }
  checks.no_outside_calls = { ok: total.length === 0, detail: `${total.filter((c) => c.by === "airi").length} Airi and ${total.filter((c) => c.by === "checkout").length} checkout (Airwallex) call(s) tried in the whole run (each would have been refused)` };

  const record: Vic2Record = {
    run: RUN, mode: d.mode,
    label: d.mode === "dry"
      ? "DRY RUN on stand-ins: the CFO's approvals are stand-in decisions (not Face ID) and the policy changes run in-process; no Airi, no Airwallex, no card; not the run's evidence"
      : `live: the CFO's Face ID on the relay; Airi (${d.rail.airi.label}) and Airwallex each at a budget of 0 calls`,
    started_at: started.toISOString(), ended_at: clock().toISOString(),
    planted_attack: PLANTED,
    steps: {
      D: {
        request: { amount: D_AMOUNT, currency: AIRI_CURRENCY, merchant: MERCHANT.name },
        outcome: brief(dOut), end: dEnd,
        approval: dApproval ? { method: dApproval.method, at: dApproval.created_at, approved_sha256: dApproval.approved_sha256 } : null,
        alteration: alteration ? { label: PLANTED, ...alteration } as Json : null,
        policy_alone_on_the_altered_terms: policyAlone,
        executor: refusal ? { refused: refusal, by: "purser (the executor's hash check, before any Airi call)" } : null,
        airi_calls: dCalls, purchase_row: dRow,
      },
      E: {
        lock: { proposal_id: lock.proposal_id, change: `${LOCK_KEY}: allowed -> blocked`, end: eEnd, approval: eApproval ? { method: eApproval.method, at: eApproval.created_at } : null, value_after: lockValue },
        offer_after_lock: eOffer,
        purchase: eOut ? { amount: E_AMOUNT, currency: AIRI_CURRENCY, outcome: brief(eOut) } : null,
        airi_calls: eCalls,
      },
      F: f ? {
        unlock: { proposal_id: f.id, change: `${LOCK_KEY}: blocked -> allowed`, end: f.end, approval: f.approval ? { method: f.approval.method, at: f.approval.created_at } : null, value_after: f.value },
        offer: f.offer, purser_route: f.route, stopped: "before any request to Airi: no mandate, no tap, no charge", airi_calls: f.calls,
      } : null,
    },
    checks,
    outside_calls: { airi: total.filter((c) => c.by === "airi").length, airwallex: total.filter((c) => c.by === "checkout").length, refused_attempts: total },
    audit: auditRows,
  };
  assertNoSecrets(JSON.stringify(record));
  return record;
}

/**
 * Live waiting for the CFO. `decided`: until the proposal leaves PENDING_APPROVAL (or its time runs out). `executed`:
 * then also until the runner has run it, at most EXECUTE_GRACE_MS after the approval. A notice every minute, no link.
 */
export async function pollDecision(db: DB, id: string, until: "decided" | "executed", o: { sleep: (ms: number) => Promise<void>; now: () => Date; log: (line: string) => void; everyMs?: number }): Promise<string> {
  const every = o.everyMs ?? 1000;
  let notice = o.now().getTime() + 60_000;
  let approvedAt: number | null = null;
  for (;;) {
    const now = o.now();
    expireDue(db, now);
    const s = statusOf(db, id);
    if (s === "PENDING_APPROVAL") {
      if (now.getTime() >= notice) {
        const exp = Date.parse((db.prepare("SELECT expires_at FROM proposals WHERE proposal_id = ?").get(id) as { expires_at: string }).expires_at);
        o.log(`FACE ID    still waiting for the CFO's Face ID on ${id}, about ${Math.max(0, Math.round((exp - now.getTime()) / 60_000))} min left`);
        notice = now.getTime() + 60_000;
      }
    } else if (until === "decided" || !["APPROVED", "EXECUTING"].includes(s)) {
      return s;
    } else {
      approvedAt ??= now.getTime();
      if (now.getTime() - approvedAt >= EXECUTE_GRACE_MS) return s;
    }
    await o.sleep(every);
  }
}

/**
 * After a crash: vic-2 calls nothing outside, so nothing is open at Airi or Airwallex. A D whose stored terms no longer
 * match what the CFO signed is closed (NEEDS_REAPPROVAL) so nothing could ever run it; the rest is reported.
 */
export function recoverVic2(db: DB, now = new Date()): string[] {
  const out: string[] = [];
  const rows = db.prepare("SELECT proposal_id, kind, status, terms_json, terms_sha256 FROM proposals WHERE terms_json LIKE '%vic-2 %' ORDER BY proposal_id").all() as { proposal_id: string; kind: string; status: string; terms_json: string; terms_sha256: string }[];
  for (const r of rows) {
    const a = approvalOf(db, r.proposal_id);
    const altered = !!a && termsHash(JSON.parse(r.terms_json) as Terms) !== a.approved_sha256;
    if (r.kind === "airi_purchase" && altered && ["APPROVED", "FAILED"].includes(r.status)) {
      closeAsStale(db, r.proposal_id, { error: `the stored terms no longer hash to what the CFO signed (${RUN}: ${PLANTED})` }, {}, now);
      out.push(`${r.proposal_id} ${r.kind}: altered after signing; closed ${statusOf(db, r.proposal_id)}`);
    } else {
      out.push(`${r.proposal_id} ${r.kind}: ${r.status}${altered ? " (altered after signing)" : ""}`);
    }
  }
  const held = db.prepare("SELECT action_id, status FROM airi_purchases WHERE status NOT IN ('SETTLED', 'RELEASED')").all() as { action_id: string; status: string }[];
  for (const h of held) out.push(`purchase ${h.action_id} ${h.status}: the guard refused its outside call, so nothing reached Airi or Airwallex; left for a person to release`);
  out.push(`${LOCK_KEY} = ${setting(db, LOCK_KEY) ?? "(not set)"}`);
  return out;
}
