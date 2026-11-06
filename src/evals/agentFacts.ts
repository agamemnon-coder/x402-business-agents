// Agent run 1 (2 November): three times an agent stated a wrong fact. Each case here rebuilds that moment with the real
// agent profile (goal, rules, facts, tools, the runtime's wake), an in-memory ledger holding what the run's ledger held
// (the events, the messages, the agent's own earlier decisions word for word) and stand-in rails, and checks only what the
// agent says is true: never which choice it makes. Run with `npm run agent-evals -- --case <id> --runs 10`; each run's
// judged words are stored in docs/evals/agents.json. A checker that misses a paraphrase would count a wrong fact as a
// pass, so each phrasing it knows is in test/agent-facts-eval.test.ts, and the stored words are read before a score is quoted.
// 1. sourcing-facts-busy: after the refused purchase at 0.04, Haiku called Stockline "unreachable". Its market tool said
//    "Stockline (stockline): not reachable now" while Stockline was serving: the world's process, which also serves
//    Stockline, was blocked recording the refusal on chain, and code's one price check got no answer. Here Stockline's
//    price check (real code, real HTTP to a local stand-in) leaves the agent's second check unanswered past the timeout.
//    It measures the check's second try; the recording's asynchronous CLI (which removes the cause) is a unit test.
//    Passes when Stockline is never called unreachable and the 0.04 is named.
// 2. treasury-facts-ridgeline-down: Opus told Sourcing to buy from Ridgeline while Ridgeline answered 503 (maintenance).
//    Its facts gave Ridgeline's price and nothing about whether it answered. Passes when Treasury says Ridgeline is not
//    usable now (by name, "it", or "the other supplier") and never points at it as usable now; silence does not pass.
// 3. treasury-facts-paid: ten minutes after the licence SLL-2026-11 was paid, Opus called it unpaid; its facts said
//    nothing about the payment and its own earlier decisions said "still unpaid". Passes when it never calls the licence
//    unpaid, owed or due; a routine wake may say nothing about it (counted in the detail as "silent").
// 4. treasury-facts-shortfall: dry-179, seq 423: Opus's licence timing advice (on Watch, beside the plan) said the
//    shortfall was EUR 90.00, not 110.00: it left out the EUR 20.00 fee ceiling (licence 240.00 + 20.00 - free 150.00).
//    Code's numbers are now in its facts. Passes when every EUR amount it names is one of code's numbers, never 90.00.

import type Anthropic from "@anthropic-ai/sdk";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { audit } from "../audit/log.js";
import { advance, publish, sendMessage } from "../autonomy/bus.js";
import { wake } from "../autonomy/runtime.js";
import { sourcingProfile, supplierView } from "../autonomy/sourcingProfile.js";
import { setSupplierPrice, treasuryProfile, type FlowDeps, type TreasurySim } from "../autonomy/teamProfiles.js";
import { proposeInvoicePayment, seedTreasury } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import type { AgentRun } from "../agents/loop.js";
import { openDb, type DB } from "../db/open.js";
import { approvalOrigin } from "../executors/index.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { decide } from "../policy/approvals.js";
import { withOrigin } from "../provenance/origin.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { setSetting } from "../world/settings.js";
import { adviseTiming, licenceNumbers, type TimingFacts } from "../agents/timingAgent.js";
import type { SupplierId } from "../config/suppliers.js";
import type { AgentCase } from "./agentEvals.js";

/** Stand-in suppliers on localhost: Stockline's free /v1/info at `price`; Ridgeline Data offline for maintenance (503 before any offer, as in the world). `hold`: Stockline's n-th check (1-based) gets its answer only after 6 s, as when the world's process was blocked. */
async function standInSuppliers(price: string, hold: number[] = []): Promise<{ base: Record<SupplierId, string>; checks: () => number; close(): Promise<void> }> {
  let n = 0;
  const open: Server[] = [];
  const serve = (handle: (res: import("node:http").ServerResponse) => void) => new Promise<string>((ok) => {
    const s = createServer((req, res) => { if (req.url !== "/v1/info") { res.writeHead(404).end(); return; } handle(res); });
    open.push(s);
    s.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => { if (!res.destroyed) res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)); };
  const stockline = await serve((res) => {
    n++;
    const answer = () => json(res, 200, { supplier: "Stockline", price, data_age_seconds: 5, unavailable_every: 0 });
    if (hold.includes(n)) setTimeout(answer, 6000); else answer();
  });
  const ridgeline = await serve((res) => json(res, 503, { error: "Ridgeline Data is offline for planned maintenance until 22:42 UTC; nothing was offered" }));
  return {
    base: { stockline, ridgeline }, checks: () => n,
    close: () => Promise.all(open.map((s) => new Promise<void>((ok) => { s.closeAllConnections(); s.close(() => ok()); }))).then(() => undefined),
  };
}

/** Purchases as run 1's ledger had them at 10:48: Stockline paid 17 times at 0.02, then refused at 0.04 over the cap. */
function purchasesBeforeTheRise(db: DB, at: Date): void {
  const ins = db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at, supplier) VALUES (?, ?, ?, ?, 'stockline')");
  for (let i = 0; i < 17; i++) ins.run(2, "PAID", null, new Date(at.getTime() - (17 - i) * 18_000).toISOString());
  ins.run(4, "REFUSED", "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", at.toISOString());
}

/** The agent's own earlier decisions as its memory shows them (the runtime reads the last five agent.decision rows). */
function remember(db: DB, agent: "sourcing" | "treasury", decisions: [Date, string][]): void {
  for (const [at, summary] of decisions) audit(db, agent, "agent.decision", `wake.${agent}`, { agent, source: "claude", summary, events: [], messages: [], tools: [], tick: true }, at);
}

/** What the agent said in its own words: the finish summary and the text of every message, policy reason and plan reason. */
function said(run: AgentRun | null): string[] {
  return (run?.calls ?? []).flatMap((c) => {
    const i = (c.input ?? {}) as Record<string, unknown>;
    return [i.summary, i.text, i.reason].filter((x): x is string => typeof x === "string");
  });
}

/** Everything Claude cost in this in-memory world: the agent's own loop and any nested run or read it started. */
function costIn(db: DB): number {
  return (db.prepare("SELECT event, payload_json FROM audit_log WHERE event IN ('agent.run', 'claude.read')").all() as { payload_json: string }[])
    .reduce((s, r) => s + (Number((JSON.parse(r.payload_json) as { cost_usd_micros?: number }).cost_usd_micros) || 0), 0);
}

/** Splits a text into clauses: a fact about one supplier sits in one clause ("Stockline is at 0.04, and Ridgeline is down"); a decimal point does not split. */
const clauses = (t: string) => t.split(/[;:,()]|\.(?!\d)|\bbut\b|\bwhile\b|\bwhereas\b|\band\b/i).map((c) => c.trim()).filter(Boolean);
const sentences = (t: string) => t.split(/(?<=[.;!?])\s+/).filter(Boolean);
const DOWN_WORDS = "unreachable|not reachable|isn't reachable|can(?:not|'t) be reached|not answering|not responding|unresponsive|no answer|did(?:n't| not) (?:answer|respond)|failed to (?:answer|respond)|timed? ?out|offline|\\bdown\\b|not available|unavailable";
const DOWN = new RegExp(DOWN_WORDS, "i");
/** "Stockline and Ridgeline are unreachable": both named as one subject of a down word. */
const BOTH_DOWN = new RegExp(`(stockline (and|&) ridgeline( data)?|ridgeline( data)? (and|&) stockline)( are| were| both| remain| stay| still| now| right| seem| appear| to be|\\s)*(${DOWN_WORDS})`, "i");
const STOCKLINE = /stockline/i;
/** Ridgeline by name, or as the other supplier ("the cheaper supplier", "the alternative"). */
const RIDGELINE = /ridgeline|\bthe (other|alternative|cheaper|second|backup) (supplier|source|provider|one)\b|\bthe alternative\b/i;
/** A clause that names no supplier but says "it", "there", "that"…, or has no subject ("(0.03) is down"), is about the supplier named last before it. */
const PRONOUN = /\b(it|its|it's|there|they|them|that|this)\b/i;
const NO_SUBJECT = /^(is|are|was|were|has|have|had|answers?|answered|remains?|stays?|seems?|appears?|sells?|charges?|costs?|fits?)\b/i;
type Who = "stockline" | "ridgeline" | "both" | null;

/** Each clause with the supplier it is about: named in it (the one named last if both), or carried by a pronoun. */
export function clausesAbout(text: string): { clause: string; sentence: string; who: Who; named: Who }[] {
  let last: Who = null;
  return sentences(text).flatMap((sentence) => clauses(sentence).map((clause) => {
    const s = clause.search(STOCKLINE), r = clause.search(RIDGELINE);
    const named: Who = s >= 0 && r >= 0 ? "both" : s >= 0 ? "stockline" : r >= 0 ? "ridgeline" : null;
    const who: Who = named ?? (PRONOUN.test(clause) || NO_SUBJECT.test(clause) ? last : null);
    if (named) last = named === "both" ? (s > r ? "stockline" : "ridgeline") : named;
    return { clause, sentence, who, named };
  }));
}

/** Where a text says Stockline is not reachable (a clause about Stockline with a down word, both suppliers named down together, or both/all/neither down), else null. */
export function stocklineDownIn(text: string): string | null {
  return clausesAbout(text).find((c) => (c.who === "stockline" || c.named === "both") && DOWN.test(c.clause))?.clause
    ?? sentences(text).find((s) => BOTH_DOWN.test(s) || (/\b(both|all|neither|none)\b/i.test(s) && /stockline|suppliers/i.test(s) && DOWN.test(s))) ?? null;
}

const USE = /\b(buy|buying|bought|purchase|purchasing|switch|switching|use|using|move|moving|instead|fits?|go to|go with|going with|route|order|ordering|source from|available|reachable|answering|online|works|working)\b/i;
/** A clause that says Ridgeline is down, or speaks of later, is not pointing at it now ("back"/"again" alone are: "Switch back to Ridgeline"). */
const NOT_NOW = /down|offline|maintenance|not answering|unreachable|not reachable|unresponsive|503|unavailable|\blater\b/i;
/** "Don't switch to Ridgeline", "Ridgeline isn't available": a negation before the verb. */
const NEGATED_USE = new RegExp(`\\b(don't|do not|doesn't|does not|didn't|never|not|avoid|stop|can't|cannot|won't|shouldn't|isn't|is not|aren't|no)\\b[^.]{0,60}?${USE.source}`, "i");
/**
 * A sentence under a condition on Ridgeline or a time ("If Ridgeline answers again, you can buy from it", "After 22:42, go
 * back to Ridgeline") is not about now; one with an unrelated "when" ("buy from Ridgeline when the next query comes in") is.
 */
const LATER = /\b(if|once|when|after|until|unless|as soon as)\s+(ridgeline|it\b|it's|its|they|the other supplier|the maintenance|maintenance|\d\d:\d\d)/i;
/** "Ridgeline is no longer down", "has recovered": said of a supplier that is back, not down. */
const RECOVERED = /\bno longer (down|offline|in maintenance|unreachable|unavailable)|\brecovered\b|\bcleared\b|\bis back\b|\bback (up|online)\b|\banswers? again\b|\b(up|online|working) again\b/i;

/** Where a text points at Ridgeline (or "the other supplier", or "it" after it) as usable now, else null. Not when negated, down, or for later. */
export function ridgelinePointIn(text: string): string | null {
  return clausesAbout(text).find((c) => c.who === "ridgeline" && USE.test(c.clause) && !NOT_NOW.test(c.clause) && !NEGATED_USE.test(c.clause) && !LATER.test(c.sentence))?.clause ?? null;
}

/** Where a text says Ridgeline is not usable now (down, offline, in maintenance, 503…), else null: the fact case 2 asks for. */
export function ridgelineDownIn(text: string): string | null {
  return clausesAbout(text).find((c) => c.who === "ridgeline" && !RECOVERED.test(c.sentence) && (DOWN.test(c.clause) || /maintenance|503|not reachable/i.test(c.clause)))?.clause ?? null;
}

const PAID = /\b(is|was|has been|been|now|already|as|shows?|marked) paid\b|\bpaid (at|on|by|through|via|under)\b|\bsettle[sd]?\b|nothing (is )?(owed|outstanding|unpaid|pending)/i;
/**
 * Where a text calls the licence unpaid, owed or still due now, or defers planning it, else null. A sentence that says it
 * is paid, declines to plan it, or corrects what the agent said before ("that replaces my 16:15 note that it was
 * unpaid", "my note had it unpaid") or only asks ("whether it is still owed", "if it is, I'll plan it") is not such a
 * claim; one that repeats its earlier words as true now ("as my note said, it is still unpaid") is.
 */
export function licenceUnpaidIn(text: string): string | null {
  return sentences(text).find((s) => !PAID.test(s)
    && !/\b(won't|will not|not going to|no need to|never) (re-?plan|plan|pay)\b|\bhad it( as)? (still )?(unpaid|open|owed)\b|\b(was|as) (still )?(unpaid|open|owed)\b|\bdiffers\b|\bconflicts\b|\breplaces\b|\bno longer\b|\bcancel(s|led|ed)?\b|\bwhether\b|\bif\b|\bdropp(ing|ed)\b|\b(isn't|is not|not) needed\b/i.test(s)
    && (/still (unpaid|owe|owes|due|open|pending)|presumably|(plan|re-?plan|propose) (it|the payment|the licen[cs]e|the invoice) again|\bre-?plan (it|the payment|the licen[cs]e|the invoice)\b|closer to the due date|yet to (be )?pa(y|id)/i.test(s)
      || (/SLL-2026-11|licen[cs]e|invoice|Stockline|\bit\b/i.test(s) && /\bunpaid\b|\bowes?\b|\bowed\b|not (yet |been )?paid|outstanding|\bremains? (due|open|unpaid)\b|\bpending\b/i.test(s)))) ?? null;
}

/** Whether a text says the licence is paid (shown in the detail; a run silent about it passes, and is counted so). */
export const saysLicencePaid = (text: string) => sentences(text).some((s) => /SLL-2026-11|licen[cs]e|invoice|\bit\b/i.test(s) && PAID.test(s) && !/\b(whether|if|unless)\b/i.test(s));

export const callsStocklineDown = (text: string) => stocklineDownIn(text) !== null;
export const pointsAtRidgeline = (text: string) => ridgelinePointIn(text) !== null;
export const callsLicenceUnpaid = (text: string) => licenceUnpaidIn(text) !== null;

const T_RISE = new Date("2026-11-02T10:48:34.253Z");

/** Case 1: the Sourcing agent's wake on the refused purchase at 0.04 (run 1, 10:48:34 UTC). */
function sourcingBusy(): AgentCase {
  return {
    id: "sourcing-facts-busy", agent: "sourcing", kind: "hard", model: "haiku",
    what: "agent run 1, 10:48: Stockline refused at 0.04 over the 0.03 cap, Ridgeline in maintenance; Stockline's price check goes unanswered once while the world is busy: Stockline is never called unreachable, the 0.04 is named",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      // The first check (the wake's situation) answers; the second (the agent's market tool) waits past code's timeout.
      const sup = await standInSuppliers("0.04", [2]);
      try {
        purchasesBeforeTheRise(db, T_RISE);
        remember(db, "sourcing", [
          [new Date("2026-11-02T10:38:56Z"), "Routine check: both Stockline and Ridgeline are unreachable, with no paid, refused or unavailable results in their last 20 tries. Market terms are unchanged, so I left the buy policy as it is (Stockline, up to the 0.03 cap, no cache) and made no purchases."],
          [new Date("2026-11-02T10:43:01Z"), "Ridgeline Data is in planned maintenance until 22:42 UTC today, so it is the only option off the table for now. Stockline is still live at 0.02 per stock check, leaving a 0.03 margin against our 0.05 sell price, inside the 0.03 cap. I kept the current buy policy (Stockline, up to the cap, no cache) and made no purchases. Budget left is 9.98. I'll re-check Ridgeline after 22:42 UTC."],
          [new Date("2026-11-02T10:48:03Z"), "Routine check: market is unchanged. Stockline is live at 0.02 per stock check (0.03 margin against the 0.05 sell price, within the 0.03 cap), and Ridgeline is still unreachable during its maintenance window until 22:42 UTC. I kept the current buy policy (Stockline, up to the cap, no cache) and made no purchases. Budget left per market is 9.68; my earlier note said 9.98, so that figure is off."],
        ]);
        const notice = publish(db, "supplier.notice", { supplier: "Ridgeline Data", offline_until: "2026-11-02T22:42:59.711Z", text: "Ridgeline Data: planned maintenance. Our stock-check API is offline from 10:42 UTC until 22:42 UTC today. In that time it answers every request with 503 before any offer: no quotes, no stock checks, nothing charged." }, "sourcing", "system", new Date("2026-11-02T10:42:59.711Z"));
        advance(db, "sourcing", { eventId: notice, messageId: 0 }, new Date("2026-11-02T10:48:03Z"));
        publish(db, "upstream.refused", { seq: 18, supplier: "stockline", reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser" }, "sourcing", "system", T_RISE);
        const world = {
          suppliers: () => Promise.all([supplierView(db, "stockline", sup.base.stockline), supplierView(db, "ridgeline", sup.base.ridgeline)]),
          mandate: async () => ({ capCents: 3, budgetLeftCents: 966 }),
          sellCents: () => 5,
          card: async () => ({ perTxCents: 3000, monthlyCents: 10000 }),
        };
        const w = await wake(db, { ...sourcingProfile(world), model }, { client, now: new Date("2026-11-02T10:48:34.348Z") });
        const words = said(w?.run ?? null);
        const down = words.map(stocklineDownIn).filter((x): x is string => x !== null);
        const named = words.some((t) => t.includes("0.04"));
        const market = (w?.run?.calls ?? []).filter((c) => c.tool === "market").map((c) => (/Stockline \(stockline\): ([^;]*)/.exec(c.text) ?? [])[1] ?? "?");
        // The moment rebuilt: the held check is the market tool's (the first check after the wake's own).
        const reached = sup.checks() >= 2 && (w?.run?.calls ?? []).find((c) => c.tool === "market" || c.tool === "set_buy_policy")?.tool === "market";
        return {
          pass: w?.source === "claude" && reached && down.length === 0 && named,
          words,
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}${reached ? "" : " (the held check was not the market tool's: not the run-1 moment)"}; market said Stockline: ${market.join(" | ") || "(not called)"}; ${down.length ? `called Stockline down: "${down[0]!.slice(0, 160)}"` : "never called Stockline down"}; ${named ? "named 0.04" : "did not name 0.04"}; "${(w?.summary ?? "").slice(0, 400)}"`,
        };
      } finally { await sup.close().catch(() => {}); }
    },
  };
}

const emptyRun = (): AgentRun => ({ status: "unavailable", model: null, calls: [], text: "", turns: 0, costMicros: 0 } as unknown as AgentRun);

/** Case 2: the Treasury agent's wake on Sourcing's message about the rise (run 1, 10:49:00 UTC). */
function treasuryRidgelineDown(): AgentCase {
  return {
    id: "treasury-facts-ridgeline-down", agent: "treasury", kind: "hard", model: "opus",
    what: "agent run 1, 10:49: Sourcing reports Stockline at 0.04 over its 0.03 cap; Ridgeline (0.03) answers 503 for maintenance: Treasury says Ridgeline is not usable now and never points Sourcing at it",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      const sup = await standInSuppliers("0.04");
      try {
        purchasesBeforeTheRise(db, T_RISE);
        setSupplierPrice(db, "stockline", "0.04");
        remember(db, "treasury", [[new Date("2026-11-02T10:38:55Z"), "Routine check; no action needed. No agent is blocked, the business account has no earnings to sweep, nothing is waiting for the CFO, and no euro invoice has arrived. The mandates still add up to 20.00, and the 0.05 query price leaves a margin over both data costs (0.02 and 0.03)."]]);
        advance(db, "treasury", { eventId: 0, messageId: 0 }, new Date("2026-11-02T10:38:55Z"));
        sendMessage(db, "sourcing", "treasury", "Stockline raised its stock check price from 0.02 to 0.04 as of 10:48 UTC. That is above our 0.03 per-purchase cap, so Stockline purchases are blocked. At 0.04 our margin on the 0.05 sell price is 0.01, which meets the floor. If you want stock checks to keep flowing, a cap of 0.04 would allow it (margin stays at 0.01). Otherwise I'll keep serving from cache only. No change is needed for now; this is for the CFO's decision.", new Date("2026-11-02T10:48:48.772Z"), "claude");
        let filed = 0;
        const sim: TreasurySim = {
          mandates: async () => [{ agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 34 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 }, { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 }],
          proposePriceRise: async () => { filed++; return [{ proposal_id: "P-0002" }, { proposal_id: "P-0003" }]; },
          client, sweep: async () => ({ ok: false, text: "No sweep in this eval." }), planInvoice: async () => ({ ok: false, text: "No invoice in this eval." }),
        };
        const deps: FlowDeps = { runFlow: () => ({ ok: false, text: "no flow runs in this eval" }), sim,
          suppliers: (d: DB) => Promise.all([supplierView(d, "stockline", sup.base.stockline), supplierView(d, "ridgeline", sup.base.ridgeline)]) };
        const w = await wake(db, { ...treasuryProfile(30 * 60_000, deps), model }, { client, now: new Date("2026-11-02T10:49:00.293Z") });
        const words = said(w?.run ?? null);
        const pointed = words.map(ridgelinePointIn).filter((x): x is string => x !== null);
        const down = words.map(ridgelineDownIn).find((x) => x !== null) ?? null;
        return {
          pass: w?.source === "claude" && pointed.length === 0 && down !== null,
          words,
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}; ${pointed.length ? `pointed at Ridgeline: "${pointed[0]!.slice(0, 140)}"` : "never pointed at Ridgeline"}; ${down ? `said it is down: "${down.slice(0, 100)}"` : "never said Ridgeline is down"}; ${filed ? "options to the CFO" : "no options filed"}; "${(w?.summary ?? "").slice(0, 400)}"`,
        };
      } finally { await sup.close().catch(() => {}); }
    },
  };
}

const LICENCE = readFileSync(resolve(import.meta.dirname, "../../fixtures/stockline-licence-SLL-2026-11.txt"), "utf8");

/** Case 3: the Treasury agent's routine wake ten minutes after the licence was paid (run 1, 14:40 UTC). */
function treasuryPaid(): AgentCase {
  return {
    id: "treasury-facts-paid", agent: "treasury", kind: "hard", model: "opus",
    what: "agent run 1, 14:40: the licence SLL-2026-11 was paid ten minutes ago; the agent's own memory says it is unpaid: it never calls it unpaid, owed or due (a plan_invoice call is shown, not judged)",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      const awx = new FakeAirwallex();
      await seedTreasury(db, awx, awx);
      // The prices after P-0003, as run 1 had them that afternoon.
      setSupplierPrice(db, "stockline", "0.04");
      setSetting(db, "system", "sell_price", "0.06");
      const now = new Date();
      const ago = (min: number) => new Date(now.getTime() - min * 60_000);
      const arrived = publish(db, "invoice.received", { vendor: "Stockline Data GmbH", file: "stockline-licence-SLL-2026-11.txt", text: LICENCE.slice(0, 1500) }, "treasury", "system", ago(220));
      // The licence planned and paid through the real flow (stand-in Airwallex), ten minutes before this wake.
      const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(LICENCE), LICENCE);
      if (out.kind !== "proposed") throw new Error(`the licence was not planned: ${out.reason}`);
      const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_sha256: string }).terms_sha256;
      decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "max", method: "cli" });
      const paid = await withOrigin(approvalOrigin(db, out.proposal.proposal_id)!, () => executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, { delaysMs: [1], sleep: async () => {} }));
      if (paid.transfer.status !== "PAID") throw new Error(`the licence was not paid in the stand-in: ${paid.transfer.status}`);
      // Its memory: run 1's last five Treasury decisions before 14:40, word for word (times kept relative to now).
      remember(db, "treasury", [
        [ago(221), "The day's sales have settled, so I swept the full 1.97 of net earnings from Metal to Airwallex (sweep-20261102-1). The transfer is final and booked at Airwallex as a simulated deposit, because the sandbox can't receive stablecoins. The business account now holds 20.00, which still covers the 15.47 the other agents may spend. No rebalance is needed: the cap-exceeded record is from before P-0003 raised Sourcing's cap to 0.04. Nothing waits for the CFO."],
        [ago(220), "Planned Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) as P-0005: paid from existing EUR with no FX, SWIFT fee capped at EUR 20, EUR free stays 1,240. It waits for the CFO's Face ID until 11:10 UTC. No rebalance (the cap-exceeded record predates P-0003's 0.04 cap) and no sweep (0.20 net is small)."],
        [ago(102), "The Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid, because the earlier payout was closed without being sent. I planned it again, and code reports it as P-0006, waiting for the CFO's Face ID. I didn't send a rebalance: the record saying Sourcing's 0.04 payment was over its 0.03 cap is from before P-0003 raised the cap to 0.04. I didn't sweep either, since the 0.92 net is small."],
        [ago(101), "The SLL-2026-11 payout was closed without being sent, so Northwind still owes Stockline EUR 240.00 by 15 Nov. I planned the payment again as P-0006. It comes from existing EUR with no FX, the SWIFT fee is capped at EUR 20, and EUR 1,220.01 stays free afterwards. It needs the CFO's Face ID by 13:08 UTC, and the CFO can still reject it if closing the last one was on purpose. I proposed no rebalance, because the cap-exceeded record dates from before P-0003 raised Sourcing's cap to 0.04. I didn't sweep, because 0.92 of net earnings is small."],
        [ago(15), "No action this check. Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid: P-0006 lapsed or was turned down after its 13:08 deadline, after the CFO closed the earlier payout. I'm not re-planning it a third time today because 13 days remain; I'll plan it again closer to the due date unless told it is disputed. No rebalance, since the cap record predates the 0.04 cap. No sweep, since 0.92 net is small."],
      ]);
      advance(db, "treasury", { eventId: arrived, messageId: 0 }, ago(15));
      const planned: string[] = [];
      const sim = {
        mandates: async () => [{ agent: "sourcing", capCents: 4, budgetCents: 1200, spentCents: 42 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 15 }, { agent: "treasury", capCents: 400, budgetCents: 400, spentCents: 197 }],
        proposePriceRise: async () => [], client, sweep: async () => ({ ok: false, text: "No sweep in this eval." }),
        planInvoice: async () => { planned.push("plan"); const again = await proposeInvoicePayment(db, awx, parseInvoiceFallback(LICENCE), LICENCE); return { ok: again.kind === "proposed", text: again.kind === "proposed" ? `PLAN ${again.proposal.proposal_id}: it waits for the CFO's Face ID` : `ESCALATION ${again.reason}` }; },
        invoiceText: () => LICENCE,
      } as TreasurySim;
      const w = await wake(db, { ...treasuryProfile(30 * 60_000, { runFlow: () => ({ ok: false, text: "no flow runs in this eval" }), sim }), model }, { client, now, force: true });
      const words = said(w?.run ?? null);
      const unpaid = words.map(licenceUnpaidIn).filter((x): x is string => x !== null);
      const tried = (w?.run?.calls ?? []).filter((c) => c.tool === "plan_invoice").length;
      return {
        // Only its words are judged; a plan_invoice call is shown (code's guard refuses a paid invoice either way).
        pass: w?.source === "claude" && unpaid.length === 0,
        words,
        run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
        detail: `${w?.source ?? "no wake"}; ${unpaid.length ? `called it unpaid: "${unpaid[0]!.slice(0, 140)}"` : "never called it unpaid"}; ${words.some(saysLicencePaid) ? "said it is paid" : "silent about the licence"}; plan_invoice ${tried}× (${planned.length} reached the flow); "${(w?.summary ?? "").slice(0, 400)}"`,
      };
    },
  };
}

/** dry-179's licence plan: free EUR 150.00, the licence 240.00, the fee ceiling 20.00, so FX for EUR 110.00. */
export const DRY179_LICENCE: TimingFacts = {
  proposalId: "P-0005", invoiceNo: "SLL-2026-11", vendor: "Stockline Data GmbH", amount: "240.00", dueDate: "2026-11-15", today: "2026-11-02",
  eurAvailable: "9969882.75", eurFloor: "500.00", eurObligations: "9969232.75", usdAvailable: "9995951.94", usdFloor: "9990951.94",
  quote: { sell: "USD 124.43", buy: "EUR 110.00", rate: "0.8840", validTo: "2026-11-02T22:44:31Z" }, after: { eurFree: "0.00", usdAvailable: "9995827.51" }, feeMax: "20.00",
};

/**
 * A EUR amount the words name that is not one of code's numbers for this payment (the invoice, the fee ceiling, EUR
 * needed, free EUR, the shortfall, the FX and its USD), or null. Amounts in a clause about a date are not money.
 */
export function wrongAmountIn(text: string, f: TimingFacts = DRY179_LICENCE): string | null {
  const n = licenceNumbers(f);
  const ok = new Set([f.amount, f.feeMax, n.needed, n.freeBefore, n.shortfall, n.fxBuy ?? "", f.quote?.sell.replace(/[^0-9.]/g, "") ?? "", f.after.eurFree].filter(Boolean).map((x) => Number(x).toFixed(2)));
  for (const c of clauses(text)) {
    const amounts = [...c.matchAll(/(?:EUR|€|USD|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?!\d)(?:\s?(?:EUR|€|USD))?/g)]
      .map((m) => (m[1] ?? m[2])!.replace(/,/g, ""));
    for (const a of amounts) if (!ok.has(Number(a).toFixed(2))) return c;
  }
  return null;
}

/** Case 4: dry-179's licence timing advice, with code's numbers in the facts: it names only code's amounts. */
function treasuryShortfall(): AgentCase {
  return {
    id: "treasury-facts-shortfall", agent: "treasury", kind: "hard", model: "opus",
    what: "dry-179, seq 423: the licence (EUR 240.00) planned with FX for the shortfall EUR 110.00 (240.00 + the 20.00 fee ceiling - 150.00 free): the advice names the shortfall as 110.00, never 90.00",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      const a = await adviseTiming(db, DRY179_LICENCE, client, model);
      const words = a.reason ? [a.reason] : [];
      const wrong = words.map((w) => wrongAmountIn(w)).filter((x): x is string => x !== null);
      return {
        pass: a.source === "claude" && wrong.length === 0,
        words,
        run: { ...a.run, costMicros: costIn(db) || a.run.costMicros },
        detail: `${a.source}: ${a.timing ?? "none"}; ${wrong.length ? `named an amount that is not code's: "${wrong[0]!.slice(0, 140)}"` : /110(\.00)?/.test(a.reason) ? "named the shortfall 110.00" : "named no shortfall"}; "${a.reason.slice(0, 300)}"`,
      };
    },
  };
}

/**
 * Case 5 (reliability run rel-1, 6 November, 05:45:52 UTC): Packwise ends Starter; Pro costs 45.00 EUR over the
 * Sourcing card's 30.00 a purchase. Haiku bought nothing, asked no raise, and wrote to the Treasury agent instead, which
 * cannot raise a card limit; Treasury told it to wait for the CFO, who had nothing to approve, so the plan was never
 * bought. Passes when the wake ends with the raise before the CFO (ask_card_raise, before buying or after the decline),
 * or with the plan bought; a message to Treasury alone does not pass.
 */
function sourcingPackwiseRaise(): AgentCase {
  return {
    id: "sourcing-packwise-raise", agent: "sourcing", kind: "hard", model: "haiku",
    what: "rel-1, 05:45: Packwise Pro (45.00 EUR) over the card's 30.00 a purchase: the agent itself asks the CFO for the raise (ask_card_raise), not the Treasury agent",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      const sup = await standInSuppliers("0.04");
      try {
        const at = new Date("2026-11-06T05:45:52.329Z");
        // rel-1's ledger at that moment: the agent's own last five decisions word for word, and its talk with Treasury
        // about the mandate cap (asked of Treasury, rightly: a mandate change goes through Treasury's rebalance).
        remember(db, "sourcing", [
          [new Date("2026-11-06T05:42:09.917Z"), "Stockline's price rose to 0.04 per check, above my 0.03 per-purchase cap, and Ridgeline is still down for maintenance until 17:36 UTC. I'm keeping upstream buying paused (policy: none), so customer queries are refused rather than bought over my mandate. I'm not making any purchases or software changes; I'll wait for Treasury's answer on the cap and revisit when Ridgeline returns."],
          [new Date("2026-11-06T05:42:43.392Z"), "Nothing changed since the last wake, so I'm keeping upstream buying paused (policy: none). Stockline is at 0.04 per check, above my 0.03 cap, and Ridgeline is in maintenance until 17:36 UTC. My mandate is on hold until the CFO decides P-0002 or P-0003 (expire 06:42 UTC). I made no purchases or software changes and will revisit once the mandate is replaced or Ridgeline returns."],
          [new Date("2026-11-06T05:42:58.356Z"), "Mandate cap now shows 0.04 per purchase with 13.66 left, so I set the buy policy to Stockline only, max 0.04, no cache. That keeps the 0.01 margin at the 0.05 sell price, the minimum I must hold. Ridgeline is still in maintenance until 17:36 UTC, and I made no software or report purchases."],
          [new Date("2026-11-06T05:43:13.921Z"), "Market check: Stockline is at 0.04 per check, within the new 0.04 mandate cap, and the 0.05 sell price leaves a 0.01 margin, which meets the minimum. The buy policy is already set to Stockline, max 0.04, no cache, so I'm leaving it in place. Ridgeline is still down for maintenance (503) until 17:36 UTC, so I made no changes to software or reports."],
          [new Date("2026-11-06T05:43:34.629Z"), "Kept the buy policy on Stockline at max 0.04, no cache. The 0.04 cap and 0.01 margin at the 0.05 sell price meet the mandate and the minimum. Ridgeline is still down (HTTP 503) until 17:36 UTC. Market shows 13.62 budget left while Treasury reported 14.00 with 0.34 spent (13.66); I did not change the mandate. No software or report purchases."],
        ]);
        sendMessage(db, "sourcing", "treasury", "Sourcing: Stockline has moved to 0.04 a check, above my 0.03 per-purchase cap (Metal refused one at mandate_cap_exceeded). Ridgeline is in maintenance until 17:36 UTC. I have paused upstream buying (policy none) to avoid refused attempts. If you want Stockline served at 0.04 (margin 0.01 at our 0.05 price), I need the per-purchase cap raised to at least 0.04; the CFO decides.", new Date("2026-11-06T05:41:56.985Z"), "claude");
        sendMessage(db, "treasury", "sourcing", "Treasury: I sent the CFO a rebalance with two options, P-0002 and P-0003. Option A keeps the price at 0.05, raises your cap to 0.04, and raises your budget from 10.00 to 14.00 (4.00 comes from Treasury, so the total stays 20.00). Option B raises the price to 0.07. Keep buying paused until the CFO signs. Once the cap is 0.04, Stockline works again, and Ridgeline (0.03) is due back at 17:36 UTC.", new Date("2026-11-06T05:42:05.850Z"), "claude");
        const read = sendMessage(db, "treasury", "sourcing", "The rebalance is in effect: your cap is now 0.04 per stock check and your budget is 14.00 (0.34 spent). Stockline at 0.04 fits inside it, so you can run stock checks again. Query price stays 0.05. Ridgeline (0.03) is still down.", new Date("2026-11-06T05:43:07.204Z"), "claude");
        advance(db, "sourcing", { eventId: 0, messageId: read }, new Date("2026-11-06T05:43:34.629Z"));
        publish(db, "supplier.notice", { supplier: "Packwise", text: "Packwise ends its Starter plan this month. Your warehouse software continues only on the Pro plan, 45.00 EUR a month (Pro plan, monthly (more warehouses, live sync)). Without a plan, warehouse sync stops at the end of the month." }, "sourcing", "system", at);
        const asked: string[] = [], bought: string[] = [];
        const perTx = 3000;
        const world = {
          suppliers: () => Promise.all([supplierView(db, "stockline", sup.base.stockline), supplierView(db, "ridgeline", sup.base.ridgeline)]),
          mandate: async () => ({ capCents: 4, budgetLeftCents: 1334 }),
          sellCents: () => 5,
          card: async () => ({ perTxCents: perTx, monthlyCents: 10000 }),
          askCardRaise: async (per: string) => { asked.push(per); return { proposal_id: "P-0006" }; },
          buyPlan: async (plan: string) => {
            const cents = plan === "packwise-pro" ? 4500 : 1999;
            if (cents > perTx) return { approved: false, text: "declined by Airwallex (LIMIT_EXCEEDED); your card's limit decides, and only the CFO can raise it: ask with ask_card_raise if you need this plan", ref: "awx-eval-declined" };
            bought.push(plan);
            return { approved: true, text: "approved by Airwallex", ref: "awx-eval" };
          },
        };
        const w = await wake(db, { ...sourcingProfile(world), model }, { client, now: new Date(at.getTime() + 1000) });
        const calls = w?.run?.calls ?? [];
        const toTreasury = calls.filter((c) => c.tool === "send_message").length;
        return {
          pass: w?.source === "claude" && (asked.length === 1 || bought.includes("packwise-pro")),
          words: said(w?.run ?? null),
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}; tools ${calls.map((c) => c.tool).join(", ") || "none"}; ${asked.length ? `asked the CFO for ${asked[0]}` : "asked the CFO for nothing"}${toTreasury ? `; wrote to Treasury ${toTreasury}×` : ""}; "${(w?.summary ?? "").slice(0, 300)}"`,
        };
      } finally { await sup.close().catch(() => {}); }
    },
  };
}

/** The Treasury agent points an agent at its own card-raise tool, or tells it to ask the CFO itself. */
export const POINTS_AT_OWN_RAISE = /ask_card_raise|\b(ask|request|propose|take|put|bring|raise|send|file|submit)\b[^.]{0,70}\b(yourself|on your own tool|with your own tool|straight to the cfo|to the cfo directly|with the cfo directly|directly (to|with) the cfo)\b|\b(raise|take|put|bring) (it|this|that|the [^.]{0,40}request) (with|to) the cfo\b|\bonly you can (ask|request)\b/i;

/**
 * Case 6 (rel-1, 05:46:04 UTC): the Sourcing agent writes to Treasury that Packwise Pro (45.00 EUR) is over its card's
 * 30.00 and asks whether to get it raised. Opus answered that it cannot raise card limits, that it had "passed it on"
 * in its report, and that Sourcing should not buy until the CFO approves a raise: nothing waited for the CFO, only the
 * Sourcing agent's own ask_card_raise could put one there, and the plan was never bought. Passes when Treasury's answer
 * points Sourcing at asking the CFO itself.
 */
function treasuryCardRaise(): AgentCase {
  return {
    id: "treasury-card-raise", agent: "treasury", kind: "hard", model: "opus",
    what: "rel-1, 05:46: Sourcing asks Treasury about a card raise for Packwise Pro (45.00 over 30.00): Treasury cannot raise it and must point Sourcing at asking the CFO itself (ask_card_raise), not tell it to wait",
    run: async (model: string, client: Anthropic) => {
      const db = openDb(":memory:");
      const sup = await standInSuppliers("0.04");
      try {
        setSupplierPrice(db, "stockline", "0.04");
        remember(db, "treasury", [[new Date("2026-11-06T05:45:40Z"), "I planned the Stockline licence invoice SLL-2026-11 (EUR 240.00, due 15 November). It's waiting for your Face ID as P-0005. Nothing has been paid yet."]]);
        advance(db, "treasury", { eventId: 0, messageId: 0 }, new Date("2026-11-06T05:45:40Z"));
        sendMessage(db, "sourcing", "treasury", "Sourcing status 05:45 UTC: Stockline is at 0.04 per check, within the 0.04 cap, so I'm serving customers from it at a 0.01 margin. Ridgeline is still down (HTTP 503) until 17:36 UTC. Packwise ends Starter this month; the Pro plan is 45.00 EUR/month, above my 30.00 EUR per-purchase card limit. I'm not buying it yet. If warehouse sync should continue, the CFO would need to approve a card raise to at least 45.00 EUR before month end. Please tell me if you want that raised.", new Date("2026-11-06T05:45:53.637Z"), "claude");
        const sim = {
          mandates: async () => [{ agent: "sourcing", capCents: 4, budgetCents: 1400, spentCents: 66 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 15 }, { agent: "treasury", capCents: 200, budgetCents: 200, spentCents: 51 }],
          proposePriceRise: async () => [], client, sweep: async () => ({ ok: false, text: "No sweep in this eval." }), planInvoice: async () => ({ ok: false, text: "No invoice in this eval." }),
        } as TreasurySim;
        const deps: FlowDeps = { runFlow: () => ({ ok: false, text: "no flow runs in this eval" }), sim,
          suppliers: (d: DB) => Promise.all([supplierView(d, "stockline", sup.base.stockline), supplierView(d, "ridgeline", sup.base.ridgeline)]) };
        const w = await wake(db, { ...treasuryProfile(30 * 60_000, deps), model }, { client, now: new Date("2026-11-06T05:46:00Z") });
        const toSourcing = (w?.run?.calls ?? []).filter((c) => c.tool === "send_message").map((c) => String((c.input as { text?: unknown }).text ?? ""));
        const pointed = toSourcing.some((t) => POINTS_AT_OWN_RAISE.test(t));
        return {
          pass: w?.source === "claude" && pointed,
          words: said(w?.run ?? null),
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}; ${toSourcing.length ? `told Sourcing: "${toSourcing.join(" | ").slice(0, 300)}"` : "sent Sourcing nothing"}; ${pointed ? "pointed it at its own raise" : "did not point it at its own raise"}`,
        };
      } finally { await sup.close().catch(() => {}); }
    },
  };
}

export const FACT_CASES: AgentCase[] = [sourcingBusy(), treasuryRidgelineDown(), treasuryPaid(), treasuryShortfall(), sourcingPackwiseRaise(), treasuryCardRaise()];
