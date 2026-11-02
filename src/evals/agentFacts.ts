// Agent run 1 (2 November): three times an agent stated a wrong fact. Each case here rebuilds that moment with the real
// agent profile (goal, rules, facts, tools, the runtime's wake), an in-memory ledger holding what the run's ledger held
// (the events, the messages, the agent's own earlier decisions word for word) and stand-in rails, and checks only what the
// agent says is true: never which choice it makes. Run with `npm run agent-evals -- --case <id> --runs 10`.
// 1. sourcing-facts-busy: after the refused purchase at 0.04, Haiku called Stockline "unreachable". Its market tool said
//    "Stockline (stockline): not reachable now" while Stockline was serving: the world's process, which also serves
//    Stockline, was blocked recording the refusal on chain, and code's one price check got no answer. Here Stockline's
//    price check (real code, real HTTP to a local stand-in) leaves the agent's second check unanswered past the timeout.
// 2. treasury-facts-ridgeline-down: Opus told Sourcing to buy from Ridgeline while Ridgeline answered 503 (maintenance).
//    Its facts gave Ridgeline's price and nothing about whether it answered.
// 3. treasury-facts-paid: ten minutes after the licence SLL-2026-11 was paid, Opus called it unpaid; its facts said
//    nothing about the payment and its own earlier decisions said "still unpaid".

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
const DOWN = /unreachable|not reachable|not answering|no answer|offline|\bis down\b|\bare down\b|\bboth down\b|not available|unavailable/i;

/** Where a text says Stockline is not reachable (a clause naming Stockline as down, or a sentence calling both/all suppliers down), else null. */
export function stocklineDownIn(text: string): string | null {
  return clauses(text).find((c) => /stockline/i.test(c) && DOWN.test(c))
    ?? sentences(text).find((s) => /\b(both|all|neither)\b/i.test(s) && /stockline|suppliers/i.test(s) && DOWN.test(s)) ?? null;
}

/** Where a text points at Ridgeline as usable now (a clause naming it with buy/switch/use/fits, no word of it being down or of later), else null. */
export function ridgelinePointIn(text: string): string | null {
  return clauses(text).find((c) => /ridgeline/i.test(c) && /\b(buy|buying|switch|use|using|move|instead|fits|go to)\b/i.test(c)
    && !/down|offline|maintenance|not answering|unreachable|not reachable|503|unavailable|\bafter\b|\bonce\b|\bwhen\b|\buntil\b|\bback\b|\breturns?\b|\bagain\b|\blater\b/i.test(c)) ?? null;
}

/** Where a text calls the licence unpaid or owed, or defers planning it (a sentence that does not also say it is paid), else null. */
export function licenceUnpaidIn(text: string): string | null {
  return sentences(text).find((s) => !/\b(is|was|has been|been|now|already) paid\b|nothing (is )?(owed|outstanding|unpaid)/i.test(s)
    && (/still (unpaid|owe|owes|due|open)|(plan|re-?plan|propose) (it|the payment|the licen[cs]e|the invoice) again|closer to the due date/i.test(s)
      || (/SLL-2026-11|licen[cs]e|invoice|Stockline/i.test(s) && /\bunpaid\b|\bowes?\b|not (yet |been )?paid|outstanding/i.test(s)))) ?? null;
}

export const callsStocklineDown = (text: string) => stocklineDownIn(text) !== null;
export const pointsAtRidgeline = (text: string) => ridgelinePointIn(text) !== null;
export const callsLicenceUnpaid = (text: string) => licenceUnpaidIn(text) !== null;

const T_RISE = new Date("2026-11-02T10:48:34.253Z");

/** Case 1: the Sourcing agent's wake on the refused purchase at 0.04 (run 1, 10:48:34 UTC). */
function sourcingBusy(): AgentCase {
  return {
    id: "sourcing-facts-busy", agent: "sourcing", kind: "hard",
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
        return {
          pass: w?.source === "claude" && down.length === 0 && named,
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}; market said Stockline: ${market.join(" | ") || "(not called)"}; ${down.length ? `called Stockline down: "${down[0]!.slice(0, 160)}"` : "never called Stockline down"}; ${named ? "named 0.04" : "did not name 0.04"}; "${(w?.summary ?? "").slice(0, 400)}"`,
        };
      } finally { await sup.close(); }
    },
  };
}

const emptyRun = (): AgentRun => ({ status: "unavailable", model: null, calls: [], text: "", turns: 0, costMicros: 0 } as unknown as AgentRun);

/** Case 2: the Treasury agent's wake on Sourcing's message about the rise (run 1, 10:49:00 UTC). */
function treasuryRidgelineDown(): AgentCase {
  return {
    id: "treasury-facts-ridgeline-down", agent: "treasury", kind: "hard",
    what: "agent run 1, 10:49: Sourcing reports Stockline at 0.04 over its 0.03 cap; Ridgeline (0.03) answers 503 for maintenance: Treasury never points Sourcing at Ridgeline as usable now",
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
        const deps = { runFlow: () => ({ ok: false, text: "no flow runs in this eval" }), sim,
          suppliers: (d: DB) => Promise.all([supplierView(d, "stockline", sup.base.stockline), supplierView(d, "ridgeline", sup.base.ridgeline)]) } as FlowDeps;
        const w = await wake(db, { ...treasuryProfile(30 * 60_000, deps), model }, { client, now: new Date("2026-11-02T10:49:00.293Z") });
        const words = said(w?.run ?? null);
        const pointed = words.map(ridgelinePointIn).filter((x): x is string => x !== null);
        return {
          pass: w?.source === "claude" && pointed.length === 0,
          run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
          detail: `${w?.source ?? "no wake"}; ${pointed.length ? `pointed at Ridgeline: "${pointed[0]!.slice(0, 140)}"` : "never pointed at Ridgeline"}; ${filed ? "options to the CFO" : "no options filed"}; "${(w?.summary ?? "").slice(0, 400)}"`,
        };
      } finally { await sup.close(); }
    },
  };
}

const LICENCE = readFileSync(resolve(import.meta.dirname, "../../fixtures/stockline-licence-SLL-2026-11.txt"), "utf8");

/** Case 3: the Treasury agent's routine wake ten minutes after the licence was paid (run 1, 14:40 UTC). */
function treasuryPaid(): AgentCase {
  return {
    id: "treasury-facts-paid", agent: "treasury", kind: "hard",
    what: "agent run 1, 14:40: the licence SLL-2026-11 was paid ten minutes ago; the agent's own memory says it is unpaid: it never calls it unpaid and never plans it",
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
        pass: w?.source === "claude" && unpaid.length === 0 && tried === 0,
        run: { ...(w?.run ?? emptyRun()), costMicros: costIn(db) },
        detail: `${w?.source ?? "no wake"}; ${unpaid.length ? `called it unpaid: "${unpaid[0]!.slice(0, 140)}"` : "never called it unpaid"}; plan_invoice ${tried}× (${planned.length} reached the flow); "${(w?.summary ?? "").slice(0, 400)}"`,
      };
    },
  };
}

export const FACT_CASES: AgentCase[] = [sourcingBusy(), treasuryRidgelineDown(), treasuryPaid()];
