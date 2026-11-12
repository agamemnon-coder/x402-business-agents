// vic-3: the Sourcing agent (Claude Haiku) chooses the Airi rail from three; the CFO-signed terms hash is read back from
// Airi's mandate and from Airwallex's PaymentIntent record; and a negative test asks whether Airi or the Airwallex
// sandbox refuse a credential used for another order (docs/runs/vic-3-plan.md). Seven purchases, in order:
//   A   within the CFO's limit (12.00 EUR): the agent chooses the rail and the purchase runs alone (one tap in Airi).
//   B   above the limit (45.00 EUR): the agent chooses the rail; the CFO's Face ID; then this conductor executes it: the
//       terms hash goes into the mandate's description and is read back from Airi BEFORE the credential is asked for
//       (src/airi/purchase.ts), the hash goes into the PaymentIntent's metadata and is read back from Airwallex.
//   C   over the hard cap (250.00 EUR): refused by Purser, 0 Airi and 0 Airwallex calls.
//   D   a merchant not on the CFO's allowlist: refused by Purser, 0 Airi and 0 Airwallex calls.
//   E   terms changed after the Face ID (our own planted change in the ledger): refused by the executor's hash check,
//       0 Airi and 0 Airwallex calls.
//   F1  our own planted misuse: a new 10.00 EUR mandate (the agent chooses the rail; one tap in Airi), whose credential
//       this conductor (not Purser's executor, which never does this) tries on a 40.00 EUR PaymentIntent.
//   F2  our own planted misuse: B's credential, already used once, tried once more on a new PaymentIntent, in this same
//       process, before it is deleted.
// For F1 and F2 the record keeps exactly what Airi and Airwallex answered, whatever it is: an accepted F is a PASS of the
// test with the finding NOT_REFUSED_FINDING. Nothing here says Visa refused or approved anything: the answers come from
// Airi and from Airwallex's PaymentIntent record.
//
// Hard call budgets, counted before each call is sent: Anthropic 6, Airwallex 20, airi-cli 24. A call over budget is not
// sent; the run stops and the record says why. `--dry` runs the same code on the labelled stand-ins: STAND-IN, not live.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostname } from "node:os";
import type Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { z } from "zod";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { runAgent } from "../agents/loop.js";
import { AIRI_RAIL_WORDS, airiRailOffer } from "../agents/railChoice.js";
import { RAIL_WORDS, type Rail } from "../config/policy.js";
import { MODELS } from "../claude/reader.js";
import { approvalOrigin } from "../executors/index.js";
import { closeAsStale } from "../policy/approvals.js";
import { currentOrigin, withOrigin } from "../provenance/origin.js";
import type { RunnerLock } from "../ops/runnerLock.js";
import { AirwallexBudgetSpent } from "../airwallex/callBudget.js";
import { CREDENTIAL_DIR_MODE, CREDENTIAL_FILE_NAME } from "./cardData.js";
import { AiriRefusal, AiriWaitTimeout, CheckoutOutcomeUnknown, scrubText, type AiriCheckout, type AiriClient, type CheckoutAnswer } from "./client.js";
import { AIRI_CURRENCY, airiPolicy } from "./policy.js";
import { AIRI_RAIL, decideAiriPurchase, executeAiriPurchase, requestAiriPurchase, type AiriDeps, type AiriOutcome, type AiriPurchaseRequest } from "./purchase.js";
import { readBackTerms, type IntentMetadataReader, type TermsReadBack } from "./termsMetadata.js";
import { MERCHANT, NOT_ALLOWED_URL, assertNoSecrets, preflight, seedPolicy } from "./vic1.js";
import { readRunnerEnv, type RunnerEnv } from "./vic2.js";

export { readRunnerEnv };
export const RUN = "vic-3";
/** The hard call budgets (the owner approves these numbers before the live run). */
export const BUDGETS = { anthropic: 6, airwallex: 20, airi: 24 } as const;
export type Budgeted = keyof typeof BUDGETS;

export const AMOUNTS = { A: "12.00", B: "45.00", C: "250.00", D: "5.00", E: "30.00", E_TAMPERED: "190.00", F1_MANDATE: "10.00", F1_INTENT: "40.00" } as const;
export const STEPS = ["A", "B", "C", "D", "E", "F1", "F2"] as const;
export type Step = (typeof STEPS)[number];

export const NOT_REFUSED_FINDING = "not refused by Airi/Airwallex sandbox; only Purser enforces the binding here";
export const STAND_IN = "STAND-IN";
export const DRY_LABEL = "STAND-IN dry run, not live: stand-ins for airi-cli, the checkout and Claude; stand-in approvals, not the CFO's Face ID; no Airi, no Airwallex, no Anthropic call, no card";
export const PLANTED_E = "our own planted change: a red-team step of the vic-3 conductor rewrote the stored terms in the ledger after the CFO signed, as someone with write access to the database could; no outside attacker was involved";
export const PLANTED_F1 = "our own planted misuse: the vic-3 conductor, not Purser's executor (which never does this), tried the credential of a 10.00 EUR mandate on a 40.00 EUR PaymentIntent";
export const PLANTED_F2 = "our own planted misuse: the vic-3 conductor, not Purser's executor (which never does this), tried B's credential, already used once, on a new PaymentIntent";
/** The stand-in model's name: never a Claude model id, so nothing reads it as Claude. */
export const STAND_IN_MODEL = "stand-in-model-not-claude";

export class Vic3Stop extends Error {
  /** The rail choice in progress when the stop came, so the record keeps it. */
  choice?: RailChoiceRecord;
}

/** A call budget: counted before each call is sent; past it the call is not sent, `over` says why, and the run stops. */
export class Budget {
  readonly calls: { op: string; by: Budgeted }[] = [];
  over: string | null = null;
  constructor(readonly by: Budgeted, readonly max: number = BUDGETS[by]) {}
  take(op: string): void {
    if (this.calls.length >= this.max) {
      this.over ??= `the ${this.by} call budget of ${this.max} is spent; ${this.by}.${op} was not sent`;
      throw new Vic3Stop(this.over);
    }
    this.calls.push({ op, by: this.by });
  }
  get n(): number { return this.calls.length; }
}

/** Wraps a client so every method call takes one from the budget first (by name, never its arguments). */
export function budgeted<T extends object>(target: T, budget: Budget): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv) as unknown;
      if (typeof v !== "function" || prop === "constructor") return v;
      return (...args: unknown[]) => {
        budget.take(String(prop));
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}

/** An Anthropic client whose every messages.create takes one from the budget first. withOptions keeps the count. */
export function budgetedClaude(client: Anthropic, budget: Budget): Anthropic {
  const wrap = (c: Anthropic): Anthropic => ({
    withOptions: (o: unknown) => wrap(c.withOptions ? (c.withOptions as (o: unknown) => Anthropic)(o) : c),
    beta: { messages: { create: (params: unknown) => { budget.take("messages.create"); return (c.beta.messages.create as (p: unknown) => unknown)(params); } } },
  }) as unknown as Anthropic;
  return wrap(client);
}

/** The stand-in model of a dry run: it names the Airi rail, says it is a stand-in, and is not Claude. */
export function standInClaude(): Anthropic {
  let n = 0;
  return {
    withOptions() { return this; },
    beta: { messages: { create: async () => {
      n += 1;
      return { id: `standin-msg-${n}`, model: STAND_IN_MODEL, role: "assistant", stop_reason: "tool_use", _request_id: `standin-req-${n}`,
        usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ type: "tool_use", id: `standin-tu-${n}`, name: "pay", input: { rail: AIRI_RAIL, reason: "STAND-IN answer, not Claude: the merchant takes only the Airi rail" } }] };
    } } },
  } as unknown as Anthropic;
}

export const HTTP_BUDGET_SPENT = "the approved Airwallex call budget (AIRWALLEX_CALL_BUDGET, counted per HTTP request) is spent";

/**
 * The checkout under the owner's HTTP budget (src/airwallex/callBudget.ts): a call it refuses comes back as an answer
 * (NOT_SUBMITTED, CALL_BUDGET_SPENT) or an error, not as a stop. Either one marks the conductor's Airwallex budget as
 * spent, so the run stops at its next step instead of going on to Airi and Claude.
 */
export function watchHttpBudget<T extends object>(target: T, budget: Budget): T {
  const mark = () => { budget.over ??= HTTP_BUDGET_SPENT; };
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv) as unknown;
      if (typeof v !== "function" || prop === "constructor") return v;
      return async (...args: unknown[]) => {
        try {
          const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(t, args);
          if (out && typeof out === "object" && (out as { code?: unknown }).code === "CALL_BUDGET_SPENT") mark();
          return out;
        } catch (e) {
          if (e instanceof AirwallexBudgetSpent || /call budget is spent/.test((e as Error)?.message ?? "")) mark();
          throw e;
        }
      };
    },
  });
}

/** Removes the run's credential root on SIGINT, SIGTERM or SIGHUP (a `finally` does not run on a signal), then exits. */
export function removeOnSignal(root: string, proc: Pick<NodeJS.Process, "once" | "exit"> = process): void {
  const go = () => { rmSync(root, { recursive: true, force: true }); proc.exit(130); };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) proc.once(sig, go);
}

/** The checkout's PaymentIntent read-back, where the checkout has one. */
type Checkout = AiriCheckout & Partial<IntentMetadataReader>;

export interface Vic3Deps {
  db: DB;
  mode: "dry" | "live";
  /** airi-cli (live) or the stand-in, NOT yet budgeted: the conductor wraps it. */
  airi: AiriClient & { version?: () => Promise<string> };
  /** The Airwallex checkout (live) or the stand-in, NOT yet budgeted: the conductor wraps it. */
  checkout: Checkout;
  /** Claude (live) or the stand-in model, NOT yet budgeted. Null: no key; each choice falls back to code, labelled. */
  claude: Anthropic | null;
  model?: string;
  /** Shows Airi's one-time link on the operator console only, never a log or a record. */
  showPasskeyUrl: AiriDeps["showPasskeyUrl"];
  clearPasskeyUrl?: AiriDeps["clearPasskeyUrl"];
  log: (line: string) => void;
  /** Waits for the CFO's decision on proposal `id` (live: Face ID on the relay; dry: a labelled stand-in). Returns the status. */
  awaitCfo: (id: string) => Promise<string>;
  /** Where the credential directories go (default: the OS temp dir). */
  tmpRoot?: string;
  /** Where KIT11_AIRI_RAIL is read for the rail offer (default: process.env). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Budgets other than the defaults (tests only; the CLI uses BUDGETS). */
  budgets?: Partial<Record<Budgeted, number>>;
}

export interface RailChoiceRecord {
  by: "claude" | "code" | "stand-in";
  model: string | null;
  request_id: string | null;
  /** The rails offered to the agent, in the order offered. */
  menu: { rail: string; words: string }[];
  /** Purser's offer of the Airi rail for this purchase, and why. */
  offer: Json;
  chosen: string | null;
  reason: string | null;
  /** Wrong rails the agent tried first, refused by code before anything was paid. */
  refused: { rail: string; why: string }[];
  cost_usd_micros: number;
  note?: string;
}

export interface Vic3Purchase {
  step: Step;
  what: string;
  request: { amount: string; currency: string; merchant: string } | null;
  rail_choice: RailChoiceRecord | null;
  proposal_id: string | null;
  mandate_id: string | null;
  payment_intent_id: string | null;
  terms_sha256: string | null;
  read_back: {
    mandate: { terms_sha256_in_mandate: string | null; equal: boolean; before_credential: boolean } | null;
    payment_intent: TermsReadBack | null;
  };
  outcome: Json;
  calls: Record<Budgeted, number>;
  /** F1 and F2: what Airi and Airwallex answered, as they answered it. */
  negative_test?: { label: string; airi: Json; airwallex: Json; result: "PASS"; finding: string };
  /** Every attempt that did not end as planned, kept. */
  failed_attempts: Json[];
}

export interface Vic3Record {
  run: string;
  mode: "dry" | "live";
  label: string;
  started_at: string;
  ended_at: string;
  budgets: Record<Budgeted, { max: number; used: number }>;
  stopped: string | null;
  preflight: Json;
  purchases: Vic3Purchase[];
  checks: Record<string, { ok: boolean; detail: string }>;
  credential_deleted: boolean;
  audit: Json[];
}

const MENU: { rail: string; words: string }[] = [
  ...(Object.keys(RAIL_WORDS) as Rail[]).map((r) => ({ rail: r, words: RAIL_WORDS[r] })),
  { rail: AIRI_RAIL, words: AIRI_RAIL_WORDS },
];

const SYSTEM = [
  "You are the Sourcing agent of Northwind Outdoor. You pay each purchase on one of three rails: metal_x402 (a stablecoin payment under your own on-chain mandate), airwallex_card (your Airwallex company card, software merchants only), or airi_vic (a single-use card credential from Airwallex's Airi wallet, for merchants on the CFO's Airi allowlist).",
  "Pay the purchase once with pay, on the rail its merchant accepts, with a short reason. Code refuses a rail the merchant does not accept, before anything is paid. Purser checks the purchase again before Airi is asked; above the CFO's limit it waits for the CFO's Face ID.",
].join("\n");

const order = (pm: string, p: { amount: string; item: string; url?: string; name?: string; description: string; price?: string }): AiriPurchaseRequest => ({
  agent: "sourcing", paymentMethodId: pm, merchantName: p.name ?? MERCHANT.name, merchantUrl: p.url ?? MERCHANT.url, merchantCountry: MERCHANT.country,
  amount: p.amount, currency: AIRI_CURRENCY, items: [{ name: p.item, unitPrice: p.price ?? p.amount, quantity: "1" }], description: p.description,
});

const brief = (o: unknown): Json => JSON.parse(JSON.stringify(o ?? null)) as Json;

/**
 * The Sourcing agent chooses the rail for one purchase: one Claude call (a second only if it picked a rail the merchant
 * does not accept), the three rails on its menu. On the Airi rail `pay` runs; any other rail is refused by code, nothing
 * paid. Without Claude (no key, an API failure, a refusal), code's fallback pays on the Airi rail, labelled by: "code".
 */
export async function chooseRail<T>(d: { db: DB; claude: Anthropic | null; model: string; mode: "dry" | "live"; env?: Vic3Deps["env"] }, item: { item: string; amount: string }, pay: () => Promise<T>): Promise<{ choice: RailChoiceRecord; paid: T | null }> {
  const offer = airiRailOffer(d.db, { merchantId: MERCHANT.id, item: item.item, amount: item.amount, currency: AIRI_CURRENCY }, d.env ?? process.env);
  const choice: RailChoiceRecord = { by: "code", model: null, request_id: null, menu: MENU, offer: brief(offer), chosen: null, reason: null, refused: [], cost_usd_micros: 0 };
  if (!offer.offered) {
    choice.note = `the Airi rail was not offered: ${offer.why}`;
    return { choice, paid: null };
  }
  let paid: T | null = null;
  let done = false;
  let stop: Vic3Stop | null = null;
  const run = await runAgent(d.db, {
    agent: "sourcing", task: "purchase.rail.vic3", model: d.model, system: SYSTEM, maxTurns: 2, effort: "low", retryDelayMs: d.mode === "dry" ? 0 : undefined,
    prompt: `One purchase is due at ${MERCHANT.name}: ${item.item}, ${item.amount} ${AIRI_CURRENCY}. Its checkout is Airwallex's hosted checkout and accepts only ${AIRI_RAIL} (${AIRI_RAIL_WORDS}); the cardholder confirms it in Airi with a passkey. Purser: ${offer.why}. Your rails: ${MENU.map((m) => `${m.rail} (${m.words})`).join("; ")}. Pick the rail and pay it once.`,
    tools: [{
      name: "pay", description: "Pays this purchase once, on the rail you pick. Code refuses a rail the merchant does not accept, before anything is paid.",
      input: z.strictObject({ rail: z.enum(MENU.map((m) => m.rail) as [string, ...string[]]), reason: z.string().describe("Why this rail, in one short sentence") }),
      run: async ({ rail, reason }: { rail: string; reason: string }) => {
        if (done) return { text: "Not paid: this purchase was already paid once.", blocked: "paid already", final: true };
        if (rail !== AIRI_RAIL) {
          const why = `${MERCHANT.name} accepts only ${AIRI_RAIL}, not ${rail}`;
          choice.refused.push({ rail, why });
          return { text: `Not paid: ${why}. Nothing was charged; pick the rail it accepts.`, blocked: "merchant's rails" };
        }
        const o = currentOrigin();
        done = true;
        choice.by = d.mode === "dry" ? "stand-in" : o?.actor === "agent" ? "claude" : "code";
        if (o?.actor === "agent") { choice.model = o.model; choice.request_id = o.request_id; }
        choice.chosen = rail;
        choice.reason = scrubText(reason).slice(0, 300);
        try {
          paid = await pay();
        } catch (e) {
          // A stop (a spent budget) must not reach runAgent: it would hand it to Claude and ask again. Kept, rethrown below.
          if (!(e instanceof Vic3Stop)) throw e;
          stop = e;
        }
        return { text: "Handed to Purser's Airi rail.", final: true };
      },
    }],
  }, d.claude);
  choice.cost_usd_micros = run.costMicros;
  const halted = stop as Vic3Stop | null; // set inside the tool (TypeScript cannot see it)
  if (halted) { halted.choice = choice; throw halted; }
  if (!done) {
    choice.note = `code's fallback, labelled: the agent did not pay on the Airi rail (${run.status}${run.note ? `: ${scrubText(run.note).slice(0, 200)}` : ""})`;
    return { choice, paid: null };
  }
  return { choice, paid };
}

/** Why the runner beside a live vic-3 is not the one it needs: it must not hold the Airi rail or Airwallex keys, so
 *  that only this conductor runs B and E (it reads B's PaymentIntent back and plants E's change). */
export function vic3RunnerProblems(lock: RunnerLock | null, env: (pid: number) => RunnerEnv | null, host = hostname()): string[] {
  if (!lock) return ["no runner holds this ledger's lock: start it first (npm run relay, as the plan says)"];
  if (lock.host !== host) return [`the runner runs on another host (${lock.host}); its environment cannot be checked from here`];
  const e = env(lock.pid);
  if (!e) return [`the runner's environment (pid ${lock.pid}) cannot be read; start it as the plan says`];
  const out: string[] = [];
  if (e.rail === "on") out.push("the runner has KIT11_AIRI_RAIL=on: it would run B and E itself; restart it without the rail");
  if (e.airwallexKeys) out.push("the runner has Airwallex keys: in vic-3 only the conductor calls Airwallex; restart it without AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY");
  if (e.metal) out.push("the runner has METAL_RPC_URL: vic-3 makes no Metal call; restart it without");
  return out;
}

/** E's planted change, labelled first in the ledger, then the stored terms and their hash rewritten together. */
export function plantChange(db: DB, proposalId: string, now: Date): { signed_sha256: string; altered_sha256: string } {
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string; terms_sha256: string };
  const t = JSON.parse(p.terms_json) as Terms & { amount: string; items: { unit_price: string }[] };
  const altered = { ...t, amount: AMOUNTS.E_TAMPERED, items: t.items.map((i) => ({ ...i, unit_price: AMOUNTS.E_TAMPERED })) };
  const alteredSha = termsHash(altered);
  audit(db, "system", "vic3.redteam_change", proposalId, { run: RUN, label: PLANTED_E, proposal_id: proposalId, amount: { from: t.amount, to: AMOUNTS.E_TAMPERED }, signed_sha256: p.terms_sha256, altered_sha256: alteredSha }, now);
  db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(altered), alteredSha, proposalId);
  return { signed_sha256: p.terms_sha256, altered_sha256: alteredSha };
}

type AuditRow = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload: Record<string, Json> };
const auditOf = (db: DB, subject: string): AuditRow[] => (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE subject = ? ORDER BY seq").all(subject) as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[])
  .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Record<string, Json> }));

/** The mandate read-back as the executor recorded it, and whether it came before the credential. */
function mandateReadBack(db: DB, subject: string): Vic3Purchase["read_back"]["mandate"] {
  const rows = auditOf(db, subject);
  const back = rows.find((r) => r.event === "airi.mandate_read_back" || r.event === "airi.mandate_read_back_failed");
  if (!back) return null;
  const cred = rows.find((r) => r.event === "airi.credential_received");
  const sha = (back.payload.terms_sha256_in_mandate as string | undefined) ?? null;
  return { terms_sha256_in_mandate: sha, equal: back.event === "airi.mandate_read_back" && sha === back.payload.order_sha256, before_credential: !cred || back.seq < cred.seq };
}

const rowOf = (db: DB, where: string, id: string) => db.prepare(`SELECT action_id, mandate_id, checkout_ref, order_sha256, status, outcome, code FROM airi_purchases WHERE ${where} = ?`).get(id) as { action_id: string; mandate_id: string | null; checkout_ref: string | null; order_sha256: string; status: string; outcome: string | null; code: string | null } | undefined;

/** A checkout that keeps a copy of the credential it is given, in the conductor's own 0700 directory (B, for F2). */
function keeping(checkout: Checkout, keep: { file: string | null; dir: string }): Checkout {
  return new Proxy(checkout, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv) as unknown;
      if (prop !== "pay" || typeof v !== "function") return v;
      return (reference: string, ref: string, credentialFile: string) => {
        const to = join(keep.dir, CREDENTIAL_FILE_NAME);
        copyFileSync(credentialFile, to);
        chmodSync(to, 0o600);
        keep.file = to;
        return (v as AiriCheckout["pay"]).call(t, reference, ref, credentialFile);
      };
    },
  });
}

/** What a checkout answered, as a record keeps it: outcome, code, reference; never more. */
const answerOf = (a: CheckoutAnswer | { outcome: "UNKNOWN"; reason: string }): Json => brief(a);

/** Runs A, B, C, D, E, F1 and F2. Stops on a spent budget (recorded) or a Vic3Stop; deletes B's kept credential always. */
export async function runVic3(d: Vic3Deps): Promise<Vic3Record> {
  const clock = d.now ?? (() => new Date());
  const started = clock();
  const b = {
    anthropic: new Budget("anthropic", d.budgets?.anthropic ?? BUDGETS.anthropic),
    airwallex: new Budget("airwallex", d.budgets?.airwallex ?? BUDGETS.airwallex),
    airi: new Budget("airi", d.budgets?.airi ?? BUDGETS.airi),
  };
  const airi = budgeted(d.airi, b.airi);
  const checkout = budgeted(watchHttpBudget(d.checkout, b.airwallex), b.airwallex);
  const claude = d.claude ? budgetedClaude(d.claude, b.anthropic) : null;
  const model = d.model ?? MODELS.classify;
  const tmpRoot = d.tmpRoot ?? tmpdir();
  const rail = (co: Checkout): AiriDeps => ({ airi, checkout: co, showPasskeyUrl: d.showPasskeyUrl, ...(d.clearPasskeyUrl ? { clearPasskeyUrl: d.clearPasskeyUrl } : {}), say: d.log, tmpRoot, ...(d.sleep ? { sleep: d.sleep } : {}) });
  const keep = { file: null as string | null, dir: mkdtempSync(join(tmpRoot, "purser-vic3-keep-")) };
  chmodSync(keep.dir, CREDENTIAL_DIR_MODE);
  const purchases: Vic3Purchase[] = [];
  const counts = () => ({ anthropic: b.anthropic.n, airwallex: b.airwallex.n, airi: b.airi.n });
  const diff = (from: Record<Budgeted, number>): Record<Budgeted, number> => { const now = counts(); return { anthropic: now.anthropic - from.anthropic, airwallex: now.airwallex - from.airwallex, airi: now.airi - from.airi }; };
  const spent = () => b.anthropic.over ?? b.airwallex.over ?? b.airi.over;
  /** A budget spent inside the executor comes back as a refusal; the run stops here all the same. */
  const stopIfSpent = () => { const s = spent(); if (s) throw new Vic3Stop(s); };
  const blank = (step: Step, what: string, request: Vic3Purchase["request"]): Vic3Purchase => ({ step, what, request, rail_choice: null, proposal_id: null, mandate_id: null, payment_intent_id: null, terms_sha256: null, read_back: { mandate: null, payment_intent: null }, outcome: null, calls: { anthropic: 0, airwallex: 0, airi: 0 }, failed_attempts: [] });
  const say = (p: Vic3Purchase, line: string) => d.log(`${p.step.padEnd(3)}        ${line}`);
  /** A stop inside a step: the step keeps its rail choice and whatever its purchase row holds, then the stop goes on. */
  const keepOnStop = async <T,>(p: Vic3Purchase, from: Record<Budgeted, number>, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Vic3Stop) {
        p.rail_choice = e.choice ?? p.rail_choice;
        const row = d.db.prepare("SELECT action_id, mandate_id, checkout_ref, order_sha256, status, code FROM airi_purchases ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { action_id: string; mandate_id: string | null; checkout_ref: string | null; order_sha256: string; status: string; code: string | null } | undefined;
        const mine = row && !purchases.some((q) => q !== p && q.mandate_id && q.mandate_id === row.mandate_id);
        if (row && mine) Object.assign(p, { mandate_id: row.mandate_id, payment_intent_id: row.checkout_ref, terms_sha256: row.order_sha256 });
        p.outcome = brief({ status: "stopped", why: e.message, ...(row && mine ? { row: { status: row.status, code: row.code } } : {}) });
        p.failed_attempts.push(p.outcome);
        p.calls = diff(from);
      }
      throw e;
    }
  };
  let stopped: string | null = null;
  let pf: Json = null;
  let pm = "";
  let bProposal: string | null = null;
  let bIntent: string | null = null;

  try {
    const p0 = await preflight({ db: d.db, mode: d.mode, rail: rail(checkout), airi, log: d.log, awaitCfo: async () => "", now: clock });
    pf = { cli: p0.cli, session_expires: p0.sessionExpires, card: p0.method.display };
    pm = p0.method.paymentMethodId;
    seedPolicy(d.db, started, RUN);
    stopIfSpent();

    // ---- A: within the limit; the agent chooses the rail ---------------------------------------------------------
    {
      const p = blank("A", "within the CFO's limit: the agent alone, one tap in Airi", { amount: AMOUNTS.A, currency: AIRI_CURRENCY, merchant: MERCHANT.name });
      purchases.push(p);
      const from = counts();
      say(p, `${AMOUNTS.A} EUR at ${MERCHANT.name}: the Sourcing agent chooses the rail from three`);
      const r = await keepOnStop(p, from, () => chooseRail({ db: d.db, claude, model, mode: d.mode, env: d.env }, { item: "Trail map pack", amount: AMOUNTS.A }, () => requestAiriPurchase(d.db, rail(checkout), order(pm, { amount: AMOUNTS.A, item: "Trail map pack", description: "vic-3 A: within the CFO's limit" }), clock())));
      p.rail_choice = r.choice;
      const o: AiriOutcome | null = r.paid;
      p.outcome = brief(o ?? { status: "not_paid", why: r.choice.note ?? "the agent did not pay" });
      if (o && "actionId" in o && o.actionId) {
        const row = rowOf(d.db, "action_id", o.actionId);
        p.mandate_id = row?.mandate_id ?? null; p.payment_intent_id = row?.checkout_ref ?? null; p.terms_sha256 = row?.order_sha256 ?? null;
        p.read_back.mandate = mandateReadBack(d.db, o.actionId);
      }
      if (!o || o.status !== "succeeded") p.failed_attempts.push(p.outcome);
      p.calls = diff(from);
      say(p, `${o ? o.status : "not paid"}${o && "code" in o && o.code ? ` (${o.code})` : ""}; rail chosen by ${r.choice.by}${r.choice.request_id ? `, request ${r.choice.request_id}` : ""}`);
      stopIfSpent();
    }

    // ---- B: above the limit; Face ID; hash in mandate and PaymentIntent, both read back --------------------------
    {
      const p = blank("B", "above the CFO's limit: Face ID, then the terms hash in Airi's mandate and in Airwallex's PaymentIntent record, both read back", { amount: AMOUNTS.B, currency: AIRI_CURRENCY, merchant: MERCHANT.name });
      purchases.push(p);
      const from = counts();
      say(p, `${AMOUNTS.B} EUR at ${MERCHANT.name}: the Sourcing agent chooses the rail from three; then the CFO's Face ID`);
      const r = await keepOnStop(p, from, () => chooseRail({ db: d.db, claude, model, mode: d.mode, env: d.env }, { item: "Field repair kit", amount: AMOUNTS.B }, () => requestAiriPurchase(d.db, rail(checkout), order(pm, { amount: AMOUNTS.B, item: "Field repair kit", description: "vic-3 B: above the CFO's limit" }), clock())));
      p.rail_choice = r.choice;
      const asked: AiriOutcome | null = r.paid;
      if (asked?.status === "pending_approval") {
        bProposal = asked.proposalId;
        p.proposal_id = asked.proposalId; p.terms_sha256 = asked.termsSha256;
        const decided = await d.awaitCfo(asked.proposalId);
        say(p, `${asked.proposalId} ${decided}`);
        if (decided === "APPROVED") {
          const origin = approvalOrigin(d.db, asked.proposalId);
          const run = () => executeAiriPurchase(d.db, rail(keeping(checkout, keep)), asked.proposalId, clock());
          const o = origin ? await withOrigin(origin, run) : await run();
          p.outcome = brief(o);
          const row = rowOf(d.db, "proposal_id", asked.proposalId);
          p.mandate_id = row?.mandate_id ?? null; p.payment_intent_id = row?.checkout_ref ?? null;
          p.read_back.mandate = mandateReadBack(d.db, asked.proposalId);
          if (o.status !== "succeeded") p.failed_attempts.push(p.outcome);
          stopIfSpent();
          if (row?.checkout_ref && checkout.readMetadata) {
            bIntent = row.checkout_ref;
            p.read_back.payment_intent = await readBackTerms(checkout as IntentMetadataReader, row.checkout_ref, { termsSha256: asked.termsSha256, proposalId: asked.proposalId });
            if (!p.read_back.payment_intent.equal) p.failed_attempts.push(brief({ what: "PaymentIntent read-back not equal", ...p.read_back.payment_intent }));
            stopIfSpent();
          }
        } else {
          p.outcome = brief({ status: "not_run", decision: decided });
          p.failed_attempts.push(p.outcome);
        }
      } else {
        p.outcome = brief(asked ?? { status: "not_paid", why: r.choice.note ?? "the agent did not pay" });
        p.failed_attempts.push(p.outcome);
      }
      p.calls = diff(from);
      say(p, `${JSON.stringify(p.outcome && typeof p.outcome === "object" && "status" in p.outcome ? p.outcome.status : p.outcome)}; mandate read back ${p.read_back.mandate ? (p.read_back.mandate.equal ? "equal" : "NOT equal") : "—"}; PaymentIntent read back ${p.read_back.payment_intent ? (p.read_back.payment_intent.equal ? "equal" : "NOT equal") : "—"}`);
    }

    // ---- C, D: refused by Purser, straight to requestAiriPurchase, 0 rail calls ----------------------------------
    for (const [step, what, req] of [
      ["C", "over the hard cap: refused by Purser", order(pm, { amount: AMOUNTS.C, item: "Expedition tent", description: "vic-3 C: over the hard cap" })],
      ["D", "a merchant not on the CFO's allowlist: refused by Purser", order(pm, { amount: AMOUNTS.D, item: "Sticker", url: NOT_ALLOWED_URL, name: "Example shop (not allowed)", description: "vic-3 D: a merchant the CFO does not allow" })],
    ] as const) {
      const p = blank(step, what, { amount: req.amount, currency: AIRI_CURRENCY, merchant: req.merchantName });
      purchases.push(p);
      const from = counts();
      const o = await requestAiriPurchase(d.db, rail(checkout), req, clock());
      p.outcome = brief(o);
      p.calls = diff(from);
      if (!(o.status === "refused" && o.by === "purser")) p.failed_attempts.push(p.outcome);
      say(p, `${o.status}${"code" in o ? ` (${o.code})` : ""}; calls: Airi ${p.calls.airi}, Airwallex ${p.calls.airwallex}, Anthropic ${p.calls.anthropic}`);
    }

    // ---- E: terms changed after the Face ID; the executor's hash check refuses, 0 rail calls ---------------------
    {
      const p = blank("E", "terms changed after the Face ID (our own planted change): refused by the executor's hash check", { amount: AMOUNTS.E, currency: AIRI_CURRENCY, merchant: MERCHANT.name });
      purchases.push(p);
      const from = counts();
      const o = await requestAiriPurchase(d.db, rail(checkout), order(pm, { amount: AMOUNTS.E, item: "Tent footprint", description: "vic-3 E: above the CFO's limit; changed after the Face ID" }), clock());
      if (o.status === "pending_approval") {
        p.proposal_id = o.proposalId; p.terms_sha256 = o.termsSha256;
        const decided = await d.awaitCfo(o.proposalId);
        say(p, `${o.proposalId} ${decided}`);
        if (decided === "APPROVED") {
          const begun = d.db.prepare("SELECT 1 FROM airi_purchases WHERE proposal_id = ?").get(o.proposalId);
          if (begun) throw new Vic3Stop(`${o.proposalId} was begun by someone else (the runner has the Airi rail on?); vic-3 stops before E's change`);
          say(p, `RED TEAM   ${PLANTED_E}`);
          const ch = plantChange(d.db, o.proposalId, clock());
          let refusal: string | null = null;
          try {
            const origin = approvalOrigin(d.db, o.proposalId);
            const run = () => executeAiriPurchase(d.db, rail(checkout), o.proposalId, clock());
            const out = origin ? await withOrigin(origin, run) : await run();
            refusal = out.status === "refused" ? `${out.code}: ${out.reason}` : null;
            if (!refusal) p.failed_attempts.push(brief(out));
          } catch (e) {
            if (e instanceof Vic3Stop) throw e;
            refusal = scrubText((e as Error).message);
          }
          if (refusal && (d.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(o.proposalId) as { status: string }).status === "APPROVED") {
            closeAsStale(d.db, o.proposalId, { error: `the stored terms no longer hash to what the CFO signed (${RUN}: ${PLANTED_E})` }, {}, clock());
          }
          p.outcome = brief({ status: refusal ? "refused" : "NOT refused", by: "purser (the executor's hash check, before any Airi call)", refusal, change: { label: PLANTED_E, ...ch } });
        } else {
          p.outcome = brief({ status: "not_run", decision: decided });
          p.failed_attempts.push(p.outcome);
        }
      } else {
        p.outcome = brief(o);
        p.failed_attempts.push(p.outcome);
      }
      p.calls = diff(from);
      say(p, `${JSON.stringify((p.outcome as { status?: Json }).status ?? null)}; calls: Airi ${p.calls.airi}, Airwallex ${p.calls.airwallex}, Anthropic ${p.calls.anthropic}`);
    }

    // ---- F1: a 10.00 mandate's credential on a 40.00 PaymentIntent ------------------------------------------------
    {
      const p = blank("F1", "negative test: a 10.00 EUR mandate's credential tried on a 40.00 EUR PaymentIntent", { amount: AMOUNTS.F1_MANDATE, currency: AIRI_CURRENCY, merchant: MERCHANT.name });
      purchases.push(p);
      const from = counts();
      say(p, `${AMOUNTS.F1_MANDATE} EUR at ${MERCHANT.name}: the Sourcing agent chooses the rail from three; then ${PLANTED_F1}`);
      // Filled as F1 goes, so a stop midway still leaves its mandate and answers in the record.
      const partial: F1Result = { mandate_id: null, payment_intent_id: null, terms_sha256: null, mandate_read_back: null, outcome: null, airi: null, airwallex: null, failed: null };
      let r: Awaited<ReturnType<typeof chooseRail<F1Result>>>;
      try {
        r = await chooseRail({ db: d.db, claude, model, mode: d.mode, env: d.env }, { item: "Spare tent pegs", amount: AMOUNTS.F1_MANDATE }, () => misuseF1(d.db, airi, checkout, d, pm, tmpRoot, clock, partial));
      } catch (e) {
        if (e instanceof Vic3Stop) {
          p.rail_choice = e.choice ?? null;
          Object.assign(p, { mandate_id: partial.mandate_id, payment_intent_id: partial.payment_intent_id, terms_sha256: partial.terms_sha256 });
          p.read_back.mandate = partial.mandate_read_back;
          p.outcome = brief({ status: "stopped", why: e.message, airi: partial.airi, airwallex: partial.airwallex });
          p.failed_attempts.push(p.outcome);
          p.calls = diff(from);
        }
        throw e;
      }
      p.rail_choice = r.choice;
      const f = r.paid;
      if (f) {
        Object.assign(p, { mandate_id: f.mandate_id, payment_intent_id: f.payment_intent_id, terms_sha256: f.terms_sha256 });
        p.read_back.mandate = f.mandate_read_back;
        p.outcome = f.outcome;
        p.negative_test = negative(PLANTED_F1, f.airi, f.airwallex);
        if (f.failed) p.failed_attempts.push(f.failed);
      } else {
        p.outcome = brief({ status: "not_run", why: r.choice.note ?? "the agent did not pay" });
        p.failed_attempts.push(p.outcome);
      }
      p.calls = diff(from);
      say(p, `the checkout answered ${JSON.stringify(p.negative_test?.airwallex ?? null)}; ${p.negative_test?.finding ?? "not run"}`);
      stopIfSpent();
    }

    // ---- F2: B's used credential once more on a new PaymentIntent ------------------------------------------------
    {
      const p = blank("F2", "negative test: B's credential, already used once, tried on a new PaymentIntent", { amount: AMOUNTS.B, currency: AIRI_CURRENCY, merchant: MERCHANT.name });
      purchases.push(p);
      const from = counts();
      if (!keep.file || !existsSync(keep.file)) {
        p.outcome = brief({ status: "not_run", why: "B did not receive a credential in this process" });
        p.failed_attempts.push(p.outcome);
      } else {
        say(p, `RED TEAM   ${PLANTED_F2}`);
        const ref = `vic3-F2-${(bProposal ?? "B").slice(0, 20)}-${clock().getTime().toString(36)}`;
        const prepared = await checkout.prepare({ ref, amount: AMOUNTS.B, currency: AIRI_CURRENCY, description: "vic-3 F2: B's credential again" });
        if ("outcome" in prepared) {
          p.outcome = answerOf(prepared);
          p.negative_test = negative(PLANTED_F2, { credential: "B's, issued once for B's mandate", mandate_id: purchases[1]?.mandate_id ?? null }, answerOf(prepared));
          p.failed_attempts.push(p.outcome);
        } else {
          p.payment_intent_id = prepared.reference;
          let a: CheckoutAnswer | { outcome: "UNKNOWN"; reason: string };
          try {
            a = await checkout.pay(prepared.reference, ref, keep.file);
          } catch (e) {
            if (e instanceof Vic3Stop) throw e;
            a = { outcome: "UNKNOWN", reason: scrubText(e instanceof CheckoutOutcomeUnknown ? e.message : (e as Error).message ?? "") };
          }
          p.outcome = answerOf(a);
          p.negative_test = negative(PLANTED_F2, { credential: "B's, issued once for B's mandate", mandate_id: purchases[1]?.mandate_id ?? null, used_first_on: bIntent }, answerOf(a));
        }
      }
      // B's credential is deleted now, whatever happened.
      rmSync(keep.dir, { recursive: true, force: true });
      p.calls = diff(from);
      say(p, `the checkout answered ${JSON.stringify(p.negative_test?.airwallex ?? p.outcome)}; ${p.negative_test?.finding ?? "not run"}; B's credential deleted`);
      stopIfSpent();
    }
  } catch (e) {
    if (!(e instanceof Vic3Stop)) throw e;
    stopped = scrubText(e.message);
    d.log(`STOP       ${stopped}`);
  } finally {
    rmSync(keep.dir, { recursive: true, force: true });
  }

  // A dry run's F answers came from the stand-in checkout: said so on each finding.
  if (d.mode === "dry") for (const p of purchases) if (p.negative_test) p.negative_test.finding = `${STAND_IN} (the stand-in checkout's answer, not the Airwallex sandbox's): ${p.negative_test.finding}`;
  const record = buildRecord(d, { started, ended: clock(), b, stopped, pf, purchases, credentialDeleted: !existsSync(keep.dir) });
  assertNoSecrets(JSON.stringify(record));
  return record;
}

function negative(label: string, airi: Json, airwallex: Json): NonNullable<Vic3Purchase["negative_test"]> {
  const a = (airwallex ?? {}) as { outcome?: string; code?: string };
  const finding = a.outcome === "SUCCEEDED" ? NOT_REFUSED_FINDING
    : a.outcome === "DECLINED" ? `the Airwallex sandbox declined it: ${a.code ?? "no code"}`
    : a.outcome === "NOT_SUBMITTED" ? `not submitted at the Airwallex sandbox checkout: ${a.code ?? "no code"}`
    : "the outcome at the Airwallex sandbox is not known; see the answer kept here";
  return { label, airi, airwallex, result: "PASS", finding };
}

interface F1Result { mandate_id: string | null; payment_intent_id: string | null; terms_sha256: string | null; mandate_read_back: Vic3Purchase["read_back"]["mandate"]; outcome: Json; airi: Json; airwallex: Json; failed: Json | null }

/**
 * F1, our own planted misuse: Purser decides the 10.00 purchase (it would run alone), then this conductor, not the
 * executor, creates a 10.00 mandate, reads it back, takes the credential after the owner's tap, and tries it on a 40.00
 * PaymentIntent. Every answer is kept. The credential directory is removed in every case.
 */
async function misuseF1(db: DB, airi: AiriClient, checkout: Checkout, d: Vic3Deps, pm: string, tmpRoot: string, clock: () => Date, out: F1Result): Promise<F1Result> {
  const req = order(pm, { amount: AMOUNTS.F1_MANDATE, item: "Spare tent pegs", description: "vic-3 F1: our own planted misuse (negative test)" });
  const route = decideAiriPurchase(airiPolicy(db), req, 0);
  const now = clock();
  // F1 has no proposal: its own hash over what the mandate is created from, so the read-back is checked as for any purchase.
  const sha = createHash("sha256").update(JSON.stringify({ run: RUN, step: "F1", amount: req.amount, currency: req.currency, merchant: req.merchantUrl, items: req.items })).digest("hex");
  const description = `vic-3 F1 negative test [vic3-F1 terms:${sha}]`;
  audit(db, "system", "vic3.redteam_misuse", "F1", { run: RUN, label: PLANTED_F1, purser_route: route.route, mandate_amount: AMOUNTS.F1_MANDATE, intent_amount: AMOUNTS.F1_INTENT }, now);
  out.terms_sha256 = sha;
  const airiAnswers: Record<string, Json> = { purser_route_for_10_00: route.route };
  out.airi = airiAnswers;
  let mandate;
  try {
    mandate = await airi.createMandate({ source: "Purser sourcing agent", paymentMethodId: pm, merchantName: req.merchantName, merchantUrl: req.merchantUrl, merchantCountry: req.merchantCountry, totalAmount: req.amount, currency: req.currency, items: req.items, description });
  } catch (e) {
    if (e instanceof Vic3Stop) throw e;
    airiAnswers.mandate_create = e instanceof AiriRefusal ? { refused: e.code } : { error: scrubText((e as Error).message ?? "") };
    out.airi = airiAnswers; out.outcome = brief({ status: "not_run", at: "mandate create" }); out.failed = out.outcome;
    return out;
  }
  out.mandate_id = mandate.mandateId;
  airiAnswers.mandate_create = { mandate_id: mandate.mandateId, amount: AMOUNTS.F1_MANDATE };
  try {
  const stored = await airi.readMandate(mandate.mandateId, new Date(now.getTime() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")).catch((e: unknown) => { if (e instanceof Vic3Stop) throw e; return null; });
  const tag = stored?.description ? /terms:([0-9a-f]{64})\]$/.exec(stored.description)?.[1] ?? null : null;
  out.mandate_read_back = { terms_sha256_in_mandate: tag, equal: tag === sha, before_credential: true };
  airiAnswers.mandate_read_back = stored ? { status: scrubText(stored.status), equal: tag === sha } : null;
  if (tag !== sha) {
    await airi.cancelMandate(mandate.mandateId).catch(() => {});
    out.airi = airiAnswers; out.outcome = brief({ status: "not_run", at: "mandate read-back", why: "the mandate did not read back with its hash; no credential asked" }); out.failed = out.outcome;
    return out;
  }
  const dir = mkdtempSync(join(tmpRoot, "purser-vic3-f1-"));
  try {
    chmodSync(dir, CREDENTIAL_DIR_MODE);
    const file = join(dir, CREDENTIAL_FILE_NAME);
    d.showPasskeyUrl(mandate.passkeyUrl, { actionId: "vic3-F1", merchant: req.merchantName, amount: req.amount, currency: req.currency });
    try {
      const receipt = await airi.getCredential(mandate.mandateId, file);
      airiAnswers.credential = { status: scrubText(receipt.status), token_type: scrubText(receipt.tokenType) };
    } catch (e) {
      if (e instanceof Vic3Stop) throw e;
      airiAnswers.credential = e instanceof AiriRefusal ? { refused: e.code } : e instanceof AiriWaitTimeout ? { no_tap: true } : { error: scrubText((e as Error).message ?? "") };
      await airi.cancelMandate(mandate.mandateId).catch(() => {});
      out.airi = airiAnswers; out.outcome = brief({ status: "not_run", at: "credential" }); out.failed = out.outcome;
      return out;
    } finally {
      d.clearPasskeyUrl?.("vic3-F1");
    }
    const ref = `vic3-F1-${clock().getTime().toString(36)}`;
    const prepared = await checkout.prepare({ ref, amount: AMOUNTS.F1_INTENT, currency: AIRI_CURRENCY, description: "vic-3 F1: 40.00 on a 10.00 mandate" });
    if ("outcome" in prepared) {
      out.airwallex = answerOf(prepared);
      await airi.cancelMandate(mandate.mandateId).catch(() => {});
      out.airi = airiAnswers; out.outcome = out.airwallex; out.failed = out.outcome;
      return out;
    }
    out.payment_intent_id = prepared.reference;
    let a: CheckoutAnswer | { outcome: "UNKNOWN"; reason: string };
    try {
      a = await checkout.pay(prepared.reference, ref, file);
    } catch (e) {
      if (e instanceof Vic3Stop) throw e;
      a = { outcome: "UNKNOWN", reason: scrubText(e instanceof CheckoutOutcomeUnknown ? e.message : (e as Error).message ?? "") };
    }
    out.airwallex = { ...(answerOf(a) as Record<string, Json>), amount: AMOUNTS.F1_INTENT };
    // Airi is told what the checkout said, as for any purchase: SUCCEEDED or DECLINED; nothing for an unknown outcome.
    if (a.outcome === "SUCCEEDED" || a.outcome === "DECLINED") {
      await airi.reportResult(mandate.mandateId, a.outcome, a.outcome === "DECLINED" ? a.code : undefined).catch((e: unknown) => { if (e instanceof Vic3Stop) throw e; });
      airiAnswers.result_reported = a.outcome;
    } else if (a.outcome === "NOT_SUBMITTED") {
      await airi.cancelMandate(mandate.mandateId).catch(() => {});
    }
    out.airi = airiAnswers;
    out.outcome = out.airwallex;
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  } catch (e) {
    // A stop (a spent budget) after the mandate exists: the mandate is cancelled if the Airi budget still allows it, so
    // no mandate with an issued credential is left open; then the stop goes on.
    if (e instanceof Vic3Stop && !airiAnswers.result_reported) await airi.cancelMandate(mandate.mandateId).catch(() => {});
    throw e;
  }
}

function buildRecord(d: Vic3Deps, r: { started: Date; ended: Date; b: Record<Budgeted, Budget>; stopped: string | null; pf: Json; purchases: Vic3Purchase[]; credentialDeleted: boolean }): Vic3Record {
  const by = (s: Step) => r.purchases.find((p) => p.step === s);
  const zero = (p: Vic3Purchase | undefined) => !!p && p.calls.airi === 0 && p.calls.airwallex === 0 && p.calls.anthropic === 0;
  const st = (p: Vic3Purchase | undefined) => (p?.outcome && typeof p.outcome === "object" && !Array.isArray(p.outcome) ? (p.outcome as Record<string, Json>) : {});
  const A = by("A"), B = by("B"), C = by("C"), D = by("D"), E = by("E"), F1 = by("F1"), F2 = by("F2");
  const chose = (p: Vic3Purchase | undefined) => !!p?.rail_choice && p.rail_choice.chosen === AIRI_RAIL && p.rail_choice.by === (d.mode === "dry" ? "stand-in" : "claude");
  const checks: Vic3Record["checks"] = {
    a_rail_chosen_by_the_agent: { ok: chose(A), detail: `A: rail ${A?.rail_choice?.chosen ?? "none"} chosen by ${A?.rail_choice?.by ?? "nobody"} from ${A?.rail_choice?.menu.length ?? 0}` },
    a_paid: { ok: st(A).status === "succeeded", detail: `A: ${String(st(A).status ?? "not run")}` },
    b_rail_chosen_by_the_agent: { ok: chose(B), detail: `B: rail ${B?.rail_choice?.chosen ?? "none"} chosen by ${B?.rail_choice?.by ?? "nobody"}` },
    b_mandate_read_back_equal_before_credential: { ok: !!B?.read_back.mandate?.equal && B.read_back.mandate.before_credential, detail: `B: ${B?.read_back.mandate ? `${B.read_back.mandate.equal ? "equal" : "NOT equal"}, ${B.read_back.mandate.before_credential ? "before" : "AFTER"} the credential` : "not read back"}` },
    b_payment_intent_read_back_equal: { ok: !!B?.read_back.payment_intent?.equal, detail: `B: ${B?.read_back.payment_intent ? `${B.read_back.payment_intent.equal ? "equal" : "NOT equal"}${B.read_back.payment_intent.error ? ` (${B.read_back.payment_intent.error})` : ""}` : "not read back"}` },
    b_paid: { ok: st(B).status === "succeeded", detail: `B: ${String(st(B).status ?? "not run")}` },
    c_refused_by_purser_0_calls: { ok: st(C).status === "refused" && st(C).code === "PURSER_ABOVE_HARD_CAP" && zero(C), detail: `C: ${String(st(C).status ?? "not run")} ${String(st(C).code ?? "")}; calls ${JSON.stringify(C?.calls ?? null)}` },
    d_refused_by_purser_0_calls: { ok: st(D).status === "refused" && st(D).code === "PURSER_MERCHANT_NOT_ALLOWED" && zero(D), detail: `D: ${String(st(D).status ?? "not run")} ${String(st(D).code ?? "")}; calls ${JSON.stringify(D?.calls ?? null)}` },
    e_refused_by_hash_check_0_calls: { ok: st(E).status === "refused" && /terms do not match the approved hash/.test(String(st(E).refusal ?? "")) && zero(E), detail: `E: ${String(st(E).status ?? "not run")}; calls ${JSON.stringify(E?.calls ?? null)}` },
    f1_rail_chosen_by_the_agent: { ok: chose(F1), detail: `F1: rail ${F1?.rail_choice?.chosen ?? "none"} chosen by ${F1?.rail_choice?.by ?? "nobody"}` },
    f1_answer_recorded: { ok: !!F1?.negative_test?.airwallex, detail: `F1: ${F1?.negative_test?.finding ?? "no answer recorded"}` },
    f2_answer_recorded: { ok: !!F2?.negative_test?.airwallex, detail: `F2: ${F2?.negative_test?.finding ?? "no answer recorded"}` },
    credential_deleted: { ok: r.credentialDeleted, detail: r.credentialDeleted ? "B's kept credential and its directory are deleted" : "B's kept credential is still on disk" },
    within_budgets: { ok: !r.stopped, detail: r.stopped ?? `Anthropic ${r.b.anthropic.n}/${r.b.anthropic.max}, Airwallex ${r.b.airwallex.n}/${r.b.airwallex.max}, airi-cli ${r.b.airi.n}/${r.b.airi.max}` },
  };
  const subjects = r.purchases.flatMap((p) => [p.proposal_id]).filter((x): x is string => !!x);
  const auditRows = (d.db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'airi.%' OR event LIKE 'vic3.%' OR (event LIKE 'proposal.%' AND subject IN (${subjects.map(() => "?").join(", ") || "''"})) ORDER BY seq`).all(...subjects) as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[])
    // A dry run's rail choices were made by the stand-in model: its ledger rows say "claude" (the executor reads the
    // origin of the call), the record says what it was.
    .map((x) => ({ seq: x.seq, ts: x.ts, actor: x.actor, event: x.event, subject: x.subject, payload: JSON.parse(d.mode === "dry" ? x.payload_json.replaceAll('"by":"claude"', '"by":"stand-in (not Claude)"') : x.payload_json) as Json }));
  return {
    run: RUN, mode: d.mode,
    label: d.mode === "dry" ? DRY_LABEL : `live: airi-cli and the Airwallex sandbox (test money, Airi's test card); checkout: ${d.checkout.label}`,
    started_at: r.started.toISOString(), ended_at: r.ended.toISOString(),
    budgets: { anthropic: { max: r.b.anthropic.max, used: r.b.anthropic.n }, airwallex: { max: r.b.airwallex.max, used: r.b.airwallex.n }, airi: { max: r.b.airi.max, used: r.b.airi.n } },
    stopped: r.stopped, preflight: r.pf, purchases: r.purchases, checks, credential_deleted: r.credentialDeleted, audit: auditRows,
  };
}

/** Why a live vic-3 command may not start (empty: it may). Nothing is called before this is empty. Values are never read
 *  out, only whether they are set (and the call budget's number). */
export function vic3LiveRefusals(cmd: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (!["preflight", "live", "recover"].includes(cmd)) why.push(`unknown command ${JSON.stringify(cmd.slice(0, 20))}`);
  if (env.KIT11_AIRI_RAIL !== "on") why.push("KIT11_AIRI_RAIL=on (the conductor's rail; the runner runs without it)");
  if (env.VIC3_GO !== "yes") why.push("VIC3_GO=yes (the owner's go)");
  if (!/vic-3[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB must be this world's own ledger (data/vic-3*.sqlite)");
  if (!/\/vic-3[^/]*$/.test(env.KIT11_KEYS_DIR ?? "")) why.push("KIT11_KEYS_DIR must be this world's own keys folder (…/vic-3*)");
  if (env.METAL_RPC_URL) why.push("METAL_RPC_URL must be unset: vic-3 makes no Metal call");
  if (!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) why.push("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set (the Airwallex sandbox keys)");
  const budget = env.AIRWALLEX_CALL_BUDGET;
  if (!budget || !/^\d+$/.test(budget) || Number(budget) < 1 || Number(budget) > BUDGETS.airwallex || !env.AIRWALLEX_CALL_LOG) why.push(`AIRWALLEX_CALL_BUDGET (a whole number from 1 to ${BUDGETS.airwallex}, the number the owner approved) and AIRWALLEX_CALL_LOG must be set`);
  if (cmd === "live" && !env.KIT11_ANTHROPIC_API_KEY) why.push("KIT11_ANTHROPIC_API_KEY must be set: in vic-3 the Sourcing agent (Claude Haiku) chooses the rail");
  return why;
}

const cell = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v).replace(/\|/g, "\\|"));
const shortSha = (s: string | null | undefined) => (s ? `${s.slice(0, 16)}…` : "—");

/** The record as a page (docs/runs): every value read from the record. A dry record says STAND-IN on every row. */
export function vic3Markdown(r: Vic3Record): string {
  const dry = r.mode === "dry";
  const tag = dry ? `${STAND_IN} ` : "";
  const outcome = (p: Vic3Purchase) => {
    const o = (p.outcome ?? {}) as Record<string, Json>;
    return [o.status ?? o.outcome, o.code, o.by ? `by ${String(o.by)}` : null].filter((x) => x !== undefined && x !== null).join(", ");
  };
  const lines: string[] = [
    `# vic-3${dry ? `: ${STAND_IN} dry run, not live` : ""}`,
    "",
    `**${r.label}.**`,
    ...(dry ? ["", `${STAND_IN}: every row below comes from the stand-ins (src/airi/standIn.ts) and a stand-in model that is not Claude. No Airi, Airwallex or Anthropic call was made, no card was used, and no approval is the CFO's Face ID. It is not the run's evidence: the live run is the owner's.`] : []),
    "",
    `Run ${r.started_at} to ${r.ended_at}. Mode: ${r.mode}.${r.stopped ? ` Stopped: ${r.stopped}.` : ""}`,
    "",
    "## Purchases",
    "",
    "| | Step | Amount | Rail chosen (by, request id) | Mandate | PaymentIntent | Terms hash | Mandate read-back | PaymentIntent read-back | Outcome | Calls (Anthropic / Airwallex / airi-cli) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...r.purchases.map((p) => `| ${tag}${p.step} | ${cell(p.what)} | ${p.request ? `${p.request.amount} ${p.request.currency}` : "—"} | ${p.rail_choice ? `${cell(p.rail_choice.chosen)} (${p.rail_choice.by}, ${cell(p.rail_choice.request_id)}; ${p.rail_choice.menu.length} rails offered)` : "—"} | ${cell(p.mandate_id)} | ${cell(p.payment_intent_id)} | ${shortSha(p.terms_sha256)} | ${p.read_back.mandate ? (p.read_back.mandate.equal ? "equal" : "not equal") + (p.read_back.mandate.before_credential ? ", before the credential" : ", AFTER the credential") : "—"} | ${p.read_back.payment_intent ? (p.read_back.payment_intent.equal ? "equal" : "not equal") : "—"} | ${cell(outcome(p))} | ${p.calls.anthropic} / ${p.calls.airwallex} / ${p.calls.airi} |`),
    "",
    "## Negative test (F1, F2)",
    "",
    ...r.purchases.filter((p) => p.negative_test).flatMap((p) => [`- ${tag}**${p.step}**: ${p.negative_test!.label}. ${dry ? "The stand-in checkout answered" : "The Airwallex sandbox answered"} \`${JSON.stringify(p.negative_test!.airwallex)}\`; ${dry ? "the stand-in for Airi" : "Airi"}: \`${JSON.stringify(p.negative_test!.airi)}\`. Result: ${p.negative_test!.result}, finding: ${p.negative_test!.finding}.`]),
    "",
    "## Checks",
    "",
    "| Check | | Detail |",
    "|---|---|---|",
    ...Object.entries(r.checks).map(([k, c]) => `| ${tag}${k} | ${c.ok ? "ok" : "FAIL"} | ${cell(c.detail)} |`),
    "",
    "## Calls",
    "",
    `${tag}Anthropic ${r.budgets.anthropic.used} of ${r.budgets.anthropic.max}; Airwallex ${r.budgets.airwallex.used} of ${r.budgets.airwallex.max}; airi-cli ${r.budgets.airi.used} of ${r.budgets.airi.max}. ${dry ? "Each of these was a call to a stand-in, not to the service." : ""}`,
    "",
    `Failed attempts kept: ${r.purchases.reduce((n, p) => n + p.failed_attempts.length, 0)}. B's credential deleted: ${r.credential_deleted ? "yes" : "NO"}.`,
    "",
  ];
  return lines.join("\n");
}
