// A second read-only review of the dispute code (after PR #10), five findings:
// - MEDIUM 1: the dashboard's dispute.escalated row said "nothing was refunded for it" also after a settlement that
//   recorded its decision, paid some refunds and was then cut off (a crash, or runFlow's 15-minute timeout). The row now
//   states what the ledger holds under that dispute, by outcome, every time it is rendered.
// - LOW-MEDIUM 2: the person-run Dispute desk (npm run dispute) used the full per-dispute limit: with the email path it
//   could refund one customer past the shared automatic limit. It now uses the shared limit (disputeLimits) and skips
//   the sales another dispute already handled (handledElsewhere).
// - LOW 3: the Treasury agent's invoice facts offered an invoice checkInvoice refuses (a payee the CFO blocked, an amount
//   other than the contracted fee). They now flag it, with checkInvoice's own checks.
// - LOW 4: a dispute already with the CFO was settled again by code half an hour later. Code (the Support agent's tool,
//   code's fallback, the runner's start) now leaves it to a person; a dispute not with the CFO still completes.
// - LOW 5: a "nothing new" decision that lost the race to another process's real decision carried that decision out
//   with a refund that throws. It now carries out only a decision it recorded itself.
// The rails are stand-ins (no chain, no Airwallex, no Claude); the refund executor, the decision code and s2 are real.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import fc from "fast-check";
import type { Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import type { OrderEvidence } from "../src/agents/disputes.js";
import { carryOut, decisionOf, recordDecision, type Carrier, type DecisionExec } from "../src/agents/disputeDecision.js";
import {
  decideHandledBefore, decideNoneSold, decideNothingNew, disputeKey, disputeLimits, escalateDispute, handledElsewhere, resolveByCfo,
} from "../src/agents/disputeSource.js";
import { ALLOWLISTED_PAYEES } from "../src/agents/euroBill.js";
import { checkInvoice, ibanSha, parseInvoiceFallback } from "../src/agents/invoice.js";
import { buildAuditReport } from "../src/audit/report.js";
import { publish } from "../src/autonomy/bus.js";
import { invoiceFacts, plannedInvoiceOf } from "../src/autonomy/invoiceFacts.js";
import { supportProfile, type SupportDeps } from "../src/autonomy/teamProfiles.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { LICENSOR_NAME } from "../src/config/policy.js";
import { buildSnapshot, describe as describeRow, refundsUnder } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { refundSale } from "../src/executors/refunds.js";
import type { Puller } from "../src/metal/pull.js";
import { planRefunds } from "../src/policy/refunds.js";
import { refundThresholds } from "../src/policy/rules.js";
import { AUTO_REFUND } from "../src/provenance/origin.js";
import { openDisputeCase } from "../src/seller/desk.js";
import { setSetting } from "../src/world/settings.js";

const repo = resolve(import.meta.dirname, "..");
const PAYER = "0x00000000000000000000000000000000000000c1" as Address;
const SUMMIT = "Summit Outfitters";
const EMAIL = "From: finance@summit-outfitters.example\nSubject: Wrong stock levels\n\nChecks #1, #2 and #3 were wrong. Please refund them.";
const ID = disputeKey(EMAIL);
const T0 = new Date("2026-11-04T10:00:00.000Z");
const HALF_HOUR_AGO = () => new Date(Date.now() - 31 * 60_000);
const idOf = (email: string) => (email.trim() ? disputeKey(email) : null);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tempDir = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `kit11-review2-${tag}-`)); dirs.push(d); return d; };

/** Stock checks #1..#n sold to Summit at 0.05 each (sale id = stock check number). */
function world(n = 4, file = ":memory:"): DB {
  const db = openDb(file);
  for (let i = 1; i <= n; i++) {
    db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, ?, 'u', ?, 'DELIVERED', 'now')").run(PAYER, JSON.stringify({ seq: i }));
  }
  return db;
}
/** A dispute that opened in this world (its dispute.opened event) and is on file, as s2 files it. */
function opened(db: DB, email = EMAIL, at = T0): string {
  publish(db, "dispute.opened", { customer: SUMMIT, email }, "support", "system", at);
  db.prepare("INSERT OR IGNORE INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', ?)").run(disputeKey(email), PAYER, at.toISOString());
  return disputeKey(email);
}
const onFile = (db: DB, id: string) => db.prepare("INSERT OR IGNORE INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', 'now')").run(id, PAYER);

/**
 * Alta, as far as a refund's pull goes: a payment id is paid at most once (a second pull of it answers "already
 * paid", nothing sent). `lose`: that pull reaches Alta and pays, but its answer never comes back (s2 killed at
 * runFlow's 15-minute timeout). `answers`: a speed-limit refusal for a payment id, once per entry.
 */
function metal() {
  const paid = new Map<string, number>();
  const pulls = new Map<string, number>();
  const lose = new Set<string>();
  const answers = new Map<string, "VELOCITY"[]>();
  let reached: () => void = () => undefined;
  /** Resolves once a lost pull has reached Alta (and paid): the moment the killed run stops. */
  const lost = new Promise<void>((ok) => { reached = ok; });
  const pull: Puller = async ({ paymentId }) => {
    pulls.set(paymentId, (pulls.get(paymentId) ?? 0) + 1);
    if (answers.get(paymentId)?.shift() === "VELOCITY") return { outcome: "REFUSED", tx: null, reason: "7 payments in a minute, the limit is 6", already: false };
    const already = paid.has(paymentId);
    if (!already) paid.set(paymentId, 1);
    if (lose.delete(paymentId)) { reached(); return new Promise(() => undefined); }
    return { outcome: "PAID", tx: `0x${paymentId}`, reason: null, already };
  };
  return { paid, pulls, lose, answers, pull, lost };
}
const carrier = (pid: number, alive: () => boolean): Carrier => ({ pid, start: `s${pid}`, alive });

/** What s2 hands carryOut for a dispute (src/cli/s2.ts: refundOne, state, the shared automatic limits, refundedCents,
 *  the CFO's proposal): the real refund executor on the stand-in Alta. */
function s2exec(db: DB, id: string, pull: Puller, made: number[][] = []): DecisionExec {
  return {
    refund: async (seq, opts) => {
      const r = await refundSale(db, { sale_id: seq, amount_cents: 5, to: PAYER, dispute_id: id }, { pull, retry: opts?.retry === true });
      return { outcome: r.outcome, already: r.already, tx: r.tx, reason: r.reason };
    },
    state: (seq) => (db.prepare("SELECT outcome FROM refunds WHERE sale_id = ?").get(seq) as { outcome: string } | undefined)?.outcome ?? null,
    existing: () => null,
    limits: () => disputeLimits(refundThresholds(db), db, PAYER, id),
    refundedCents: (except) => (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refunds WHERE dispute_id = ? AND outcome IN ('PAID', 'PENDING', 'HELD') AND sale_id != ?").get(id, except) as { c: number }).c,
    create: (_part, seqs) => { made.push(seqs); return `P-${String(made.length).padStart(4, "0")}`; },
  };
}
/** Code's decision as s2 records it (codePlan): refunds within the automatic limits (each 0.05), with its rule's row. */
const codeRefunds = (db: DB, id: string, seqs: number[]) =>
  recordDecision(db, id, { source: "code", model: null, refunds: seqs.map((seq) => ({ seq, cents: 5, origin: AUTO_REFUND })), escalate: null, approval: null },
    [{ actor: "support", event: "refund.auto_approved", payload: { sales: seqs.map(String), rule: "each <= limit and batch <= limit" } }]);

/** The Support agent's settle_dispute tool, on the given settlement. */
const settleTool = (db: DB, deps: SupportDeps) => supportProfile(30 * 60_000, deps).tools(db).find((t) => t.name === "settle_dispute")!.run({});
const rows = (db: DB) => db.prepare("SELECT sale_id, outcome FROM refunds ORDER BY sale_id").all() as { sale_id: number; outcome: string }[];
const escalation = (db: DB, id = ID) => db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log WHERE event = 'dispute.escalated' AND subject = ?").get(id) as Parameters<typeof describeRow>[0];

/**
 * The half-finished settlement (finding 1's case): the Support agent's settle_dispute runs s2 for the dispute; s2
 * records code's decision (#1, #2, #3 within the automatic limits) and starts paying: #1 is paid, #2's pull reaches
 * Alta but s2 is killed at runFlow's 15-minute timeout before its answer comes back. The tool hands the dispute to
 * the CFO ("the settlement did not complete").
 */
async function halfFinished() {
  const db = world(4);
  opened(db);
  const m = metal();
  m.lose.add("refund-2");
  const settle = async (d: DB, _by: "agent" | "code", id: string) => {
    codeRefunds(d, id, [1, 2, 3]);
    const run = carryOut(d, id, s2exec(d, id, m.pull), () => undefined, carrier(4242, () => true));
    const timedOut = await Promise.race([run.then(() => false), m.lost.then(() => true)]);
    return timedOut ? { ok: false, text: "STOP s2 did not finish within 15 minutes (killed)" } : { ok: true, text: "settled" };
  };
  const first = await settleTool(db, { settle, idOf });
  return { db, m, first };
}

describe("review 2, MEDIUM 1: the escalation row states the refunds the ledger holds under the dispute", () => {
  it("(a) replays the half-finished settlement: a decision recorded, #1 paid, the timeout before the rest; the row says #1 was refunded", async () => {
    const { db, first } = await halfFinished();
    expect(first).toMatchObject({ blocked: "the settlement did not complete", text: expect.stringMatching(/It went to the CFO \(D-[0-9a-f]{8}, recorded as dispute\.escalated\)/) });
    expect(decisionOf(db, ID)).toMatchObject({ status: "DECIDED", paid: [1] });
    expect(rows(db)).toEqual([{ sale_id: 1, outcome: "PAID" }, { sale_id: 2, outcome: "PROPOSED" }]);
    const s = buildSnapshot(db);
    const refusal = s.refusals.find((r) => r.what === "Dispute sent to the CFO")!;
    expect(refusal.reason).toBe(`Dispute ${ID} from ${SUMMIT} sent to the CFO: code could not settle it (the settlement did not complete); refunds under it so far: #1 refunded (0.05 USDZ); #2 started, outcome not yet recorded (0.05 USDZ)`);
    expect(refusal.reason).not.toMatch(/nothing was refunded/i);
    // The feed shows the same row in the same words.
    expect(s.feed.find((f) => f.event === "dispute.escalated")!.text).toBe(refusal.reason);
  });

  it("(b) per outcome, the row always matches the ledger: paid, pending, held, started, refused, none; other disputes' refunds are not its own", () => {
    const cases: [string, [number, string, string | null][], string][] = [
      ["none", [], "none"],
      ["none of its own (another dispute's and an undisputed refund only)", [[1, "PAID", "D-0ther000"], [2, "PAID", null]], "none"],
      ["paid", [[1, "PAID", ID]], "#1 refunded (0.05 USDZ)"],
      ["pending", [[1, "PENDING", ID]], "#1 sent, not yet confirmed (0.05 USDZ)"],
      ["held", [[1, "HELD", ID]], "#1 sent, held at Alta, not refunded yet (0.05 USDZ)"],
      ["started", [[1, "PROPOSED", ID]], "#1 started, outcome not yet recorded (0.05 USDZ)"],
      ["refused", [[1, "REFUSED", ID]], "#1 refused (nothing paid)"],
      ["mixed", [[1, "PAID", ID], [2, "PENDING", ID], [3, "PAID", ID], [4, "REFUSED", ID], [5, "PAID", "D-0ther000"]], "#1, #3 refunded (0.10 USDZ); #2 sent, not yet confirmed (0.05 USDZ); #4 refused (nothing paid)"],
    ];
    for (const [name, refunds, words] of cases) {
      const db = world(5);
      onFile(db, ID);
      onFile(db, "D-0ther000");
      for (const [sale, outcome, dispute] of refunds) db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (?, ?, 5, ?, ?, ?)").run(sale, `refund-${sale}`, PAYER, outcome, dispute);
      escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", T0);
      const want = `Dispute ${ID} from ${SUMMIT} sent to the CFO: code could not settle it (the settlement did not complete); refunds under it so far: ${words}`;
      expect(buildSnapshot(db).refusals.find((r) => r.what === "Dispute sent to the CFO")!.reason, name).toBe(want);
    }
  });

  it("(b) property: for any refunds in the ledger, the row lists exactly this dispute's, each under its own outcome and amount", () => {
    const OUTCOMES = ["PAID", "PENDING", "HELD", "PROPOSED", "REFUSED"] as const;
    const WORDS: Record<string, (typeof OUTCOMES)[number]> = {
      "refunded": "PAID", "sent, not yet confirmed": "PENDING", "sent, held at Alta, not refunded yet": "HELD", "started, outcome not yet recorded": "PROPOSED", "refused (nothing paid)": "REFUSED",
    };
    fc.assert(fc.property(
      fc.array(fc.record({ outcome: fc.constantFrom(...OUTCOMES), under: fc.constantFrom("this", "other", "none"), cents: fc.integer({ min: 1, max: 9 }) }), { maxLength: 8 }),
      (refunds) => {
        const db = world(8);
        onFile(db, ID);
        onFile(db, "D-0ther000");
        refunds.forEach((r, i) => db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (?, ?, ?, ?, ?, ?)")
          .run(i + 1, `refund-${i + 1}`, r.cents, PAYER, r.outcome, r.under === "this" ? ID : r.under === "other" ? "D-0ther000" : null));
        escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", T0);
        const text = describeRow(escalation(db), (sale) => ({ seq: Number(sale), price: 5 }), refundsUnder(db)).text;
        const clause = text.split("; refunds under it so far: ")[1]!;
        const mine = refunds.map((r, i) => ({ ...r, seq: i + 1 })).filter((r) => r.under === "this");
        if (!mine.length) return clause === "none";
        const groups = clause.split("; ").map((g) => {
          const m = /^(#\d+(?:, #\d+)*) (.+?)(?: \((\d+\.\d{2}) USDZ\))?$/.exec(g)!;
          return { seqs: m[1]!.split(", ").map((x) => Number(x.slice(1))), outcome: WORDS[m[2]!], amount: m[3] ?? null };
        });
        for (const o of OUTCOMES) {
          const want = mine.filter((r) => r.outcome === o);
          const got = groups.filter((g) => g.outcome === o);
          if (!want.length) { expect(got).toEqual([]); continue; }
          expect(got).toHaveLength(1);
          expect(got[0]!.seqs).toEqual(want.map((r) => r.seq));
          expect(got[0]!.amount).toBe(o === "REFUSED" ? null : (want.reduce((n, r) => n + r.cents, 0) / 100).toFixed(2));
        }
        return groups.every((g) => g.outcome !== undefined);
      },
    ), { numRuns: 150 });
  }, 60_000);

  it("(c) resumed by a person (npm run s2 -- --dispute <id>): no sale is refunded twice, and the row follows the ledger", async () => {
    const { db, m } = await halfFinished();
    // Half an hour on, the Support agent leaves it to the CFO (finding 4): nothing is pulled.
    db.prepare("UPDATE dispute_decisions SET attempted_at = ? WHERE dispute_id = ?").run(HALF_HOUR_AGO().toISOString(), ID);
    const pullsBefore = [...m.pulls.entries()];
    const asked: string[] = [];
    const later = await settleTool(db, { settle: async (_d, _b, id) => { asked.push(id); return { ok: true, text: "x" }; }, idOf });
    expect(later).toMatchObject({ blocked: "already decided", text: expect.stringMatching(/paid #1, still to pay #2, #3; not yet carried out/) });
    expect(asked).toEqual([]);
    expect([...m.pulls.entries()]).toEqual(pullsBefore);
    // The person's s2 carries out the recorded decision (the killed run is gone): #2 is pulled again under its own
    // payment id (Alta: already paid, nothing sent), #3 once, #1 not at all.
    const d = await carryOut(db, ID, s2exec(db, ID, m.pull), () => undefined, carrier(5151, () => false));
    expect(d).toMatchObject({ status: "DONE", paid: [1, 2, 3], handover: [] });
    expect([...m.pulls.entries()]).toEqual([["refund-1", 1], ["refund-2", 2], ["refund-3", 1]]);
    expect([...m.paid.entries()]).toEqual([["refund-1", 1], ["refund-2", 1], ["refund-3", 1]]);
    expect(db.prepare("SELECT sale_id, payment_id, outcome, dispute_id FROM refunds ORDER BY sale_id").all()).toEqual([1, 2, 3].map((s) => ({ sale_id: s, payment_id: `refund-${s}`, outcome: "PAID", dispute_id: ID })));
    // One refund per sale, kept by the ledger itself: a second row for a refunded sale is refused.
    expect(() => db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (1, 'refund-1-again', 5, ?, 'PROPOSED', ?)").run(PAYER, ID))
      .toThrow(/UNIQUE constraint failed: refunds\.sale_id/);
    // Every later way to that sale finds it paid and sends nothing: the same run again, a refund of it under another
    // dispute (or the CFO's batch), and another dispute about the same orders (handled elsewhere, not decided again).
    expect(await carryOut(db, ID, s2exec(db, ID, m.pull), () => undefined, carrier(6161, () => false))).toMatchObject({ status: "DONE" });
    onFile(db, "D-0ther000");
    for (const sale of [1, 2, 3]) {
      expect(await refundSale(db, { sale_id: sale, amount_cents: 5, to: PAYER, dispute_id: "D-0ther000" }, { pull: m.pull })).toMatchObject({ outcome: "PAID", already: true });
    }
    expect([...handledElsewhere(db, [1, 2, 3], "D-0ther000").keys()]).toEqual([1, 2, 3]);
    expect([...m.paid.values()]).toEqual([1, 1, 1]);
    expect([...m.pulls.entries()]).toEqual([["refund-1", 1], ["refund-2", 2], ["refund-3", 1]]);
    // The escalation row, rendered again, follows the ledger.
    expect(buildSnapshot(db).refusals.find((r) => r.what === "Dispute sent to the CFO")!.reason)
      .toMatch(/refunds under it so far: #1, #2, #3 refunded \(0\.15 USDZ\)$/);
  });

  it("the audit report's refusals use the same ledger words; a caller with no ledger at hand claims nothing about refunds", async () => {
    const { db } = await halfFinished();
    const row = escalation(db);
    expect(describeRow(row, () => undefined).text).toBe(`Dispute ${ID} from ${SUMMIT} sent to the CFO: code could not settle it (the settlement did not complete)`);
    const report = buildAuditReport(db, new Date(), "test");
    expect(report.refusals.find((r) => r.what === "Dispute sent to the CFO")!.reason).toMatch(/refunds under it so far: sale 1 refunded \(0\.05 USDZ\); sale 2 started, outcome not yet recorded \(0\.05 USDZ\)$/);
  });
});

// The Dispute desk's sales: unsigned (no order from the customer's agent), so "never ordered" refunds each in full.
function deskWorld(n: number): DB {
  const db = openDb(":memory:");
  for (let seq = 1; seq <= n; seq++) {
    const body = JSON.stringify({ seq, stock: { on_hand: 90 + seq } });
    db.prepare(`INSERT INTO sales (route, price_cents, payer, signed_offer, tx_hash, request_url, request_params_json, body_sha256, body_json, status, created_at)
      VALUES ('mandate', 5, ?, NULL, ?, ?, ?, ?, ?, 'DELIVERED', ?)`).run(PAYER, `0x${String(seq).padStart(64, "0")}`, `http://127.0.0.1:4102/v1/stock?seq=${seq}`,
      JSON.stringify({ seq: String(seq) }), createHash("sha256").update(body, "utf8").digest("hex"), body, T0.toISOString());
  }
  return db;
}
const chain = async (sales: { sale_id: number; seq: number; tx_hash: string; signed_offer: string }[]): Promise<OrderEvidence[]> =>
  sales.map((s) => ({ sale_id: s.sale_id, seq: s.seq, tx: s.tx_hash, payer_is_customer: true, signed_order: !!s.signed_offer, within_mandate: !!s.signed_offer,
    mandate_principal: PAYER, mandate_bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass" }));
const desk = (db: DB, m: ReturnType<typeof metal>, saleIds: number[], text: string) =>
  openDisputeCase(db, new Tools(db, new ClaudeReader(db, null)), { claim: "never_ordered", saleIds, customer: PAYER, text }, { verify: chain, refund: (d, r) => refundSale(d, r, { pull: m.pull }) }, T0);
/** The email path as s2 settles a dispute by code: orders other disputes handled are not decided again; the wrong ones
 *  within the shared automatic limits are refunded, else they go to the CFO; carried out with the limits read again. */
async function emailPath(db: DB, id: string, saleIds: number[], m: ReturnType<typeof metal>): Promise<"auto" | "approval" | "none"> {
  onFile(db, id);
  const elsewhere = handledElsewhere(db, saleIds, id);
  const seqs = saleIds.filter((s) => !elsewhere.has(s));
  const route = planRefunds(seqs.map(() => 5), disputeLimits(refundThresholds(db), db, PAYER, id));
  recordDecision(db, id, {
    source: "code", model: null, escalate: null,
    refunds: route.route === "auto" ? seqs.map((seq) => ({ seq, cents: 5, origin: AUTO_REFUND })) : [],
    approval: route.route === "approval" ? { seqs, text: "wrong data per supplier correction", origin: null } : null,
  });
  await carryOut(db, id, s2exec(db, id, m.pull), () => undefined, carrier(7171, () => false));
  return route.route;
}
/** What the customer was refunded without the CFO, across all its disputes. */
const autoRefunded = (db: DB) => (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refunds WHERE lower(to_address) = lower(?) AND proposal_id IS NULL AND outcome IN ('PAID', 'PENDING', 'HELD')").get(PAYER) as { c: number }).c;

describe("review 2, LOW-MEDIUM 2: the person-run Dispute desk shares the customer's automatic limit and skips handled sales", () => {
  it("the email path refunded 0.10 automatically; a desk case of 0.15 is over what is left (0.10): it goes to the CFO, nothing more is paid", async () => {
    const db = deskWorld(6);
    const m = metal();
    expect(await emailPath(db, "D-e0000001", [1, 2], m)).toBe("auto");
    expect(autoRefunded(db)).toBe(10);
    const c = await desk(db, m, [3, 4, 5], "case after the email");
    expect(c).toMatchObject({ route: "approval", decision: { refund_cents: 15 } });
    expect(JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(c.proposal_id) as { terms_json: string }).terms_json).refunds.map((r: { sale_id: string }) => r.sale_id)).toEqual(["3", "4", "5"]);
    expect(autoRefunded(db)).toBe(10);
    expect([...m.pulls.keys()]).toEqual(["refund-1", "refund-2"]);
  });

  it("a desk case first (0.15 automatic): the email path then has 0.05 left, and a second desk case goes to the CFO too", async () => {
    const db = deskWorld(8);
    const m = metal();
    expect(await desk(db, m, [1, 2, 3], "first case")).toMatchObject({ route: "auto", decision: { refund_cents: 15 } });
    expect(disputeLimits(refundThresholds(db), db, PAYER, "D-e0000002")).toEqual({ eachCents: 10, perDisputeCents: 5 });
    expect(await emailPath(db, "D-e0000002", [4, 5], m)).toBe("approval");
    expect(await desk(db, m, [6, 7], "second case")).toMatchObject({ route: "approval", decision: { refund_cents: 10 } });
    expect(autoRefunded(db)).toBe(15);
  });

  it("property: any mix of desk cases and email-path settlements never refunds the customer past the shared automatic limit, nor a sale twice", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({ via: fc.constantFrom("desk", "email"), sales: fc.uniqueArray(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 5 }) }), { minLength: 1, maxLength: 5 }),
      async (steps) => {
        const db = deskWorld(8);
        const m = metal();
        let k = 0;
        for (const s of steps) {
          k++;
          if (s.via === "desk") await desk(db, m, s.sales, `case ${k}`);
          else await emailPath(db, `D-e${String(k).padStart(7, "0")}`, s.sales, m);
        }
        expect(autoRefunded(db)).toBeLessThanOrEqual(refundThresholds(db).perDisputeCents);
        expect([...m.paid.values()].every((n) => n === 1)).toBe(true);
        expect(Math.max(0, ...m.pulls.values())).toBeLessThanOrEqual(1);
      },
    ), { numRuns: 60 });
  }, 60_000);

  it("a sale another dispute put to the CFO (a live proposal, also one the CFO rejected) is not refunded or proposed by the desk; its line says why", async () => {
    const db = deskWorld(3);
    const m = metal();
    onFile(db, "D-e0000003");
    const proposal = (id: string, status: string, sale: number) => db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'refund_batch', ?, ?, 'support', ?, '2099-01-01T00:00:00Z', 'now')")
      .run(id, JSON.stringify({ dispute_id: "D-e0000003", refunds: [{ sale_id: String(sale) }] }), id.padEnd(64, "0"), status);
    proposal("P-0001", "REJECTED", 1);
    proposal("P-0002", "PENDING_APPROVAL", 2);
    const c = await desk(db, m, [1, 2, 3], "all three");
    expect(c).toMatchObject({ route: "auto", decision: { refund_cents: 5, outcome: "partial_refund" } });
    expect(c.decision.per_sale.map((s) => [s.sale_id, s.refund_cents])).toEqual([[1, 0], [2, 0], [3, 5]]);
    expect(c.decision.per_sale[0]!.why).toMatch(/sent to the CFO as P-0001 \(REJECTED\)/);
    expect(c.decision.per_sale[1]!.why).toMatch(/sent to the CFO as P-0002 \(PENDING_APPROVAL\)/);
    expect([...m.pulls.keys()]).toEqual(["refund-3"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n).toBe(2);
  });
});

describe("review 2, LOW 3: the invoice facts flag what checkInvoice refuses (CFO-blocked payee, an amount other than the contracted fee)", () => {
  const LICENCE = readFileSync(resolve(repo, "fixtures/stockline-licence-SLL-2026-11.txt"), "utf8");
  const AT_250 = LICENCE.replace(/EUR 240\.00/g, "EUR 250.00");
  /** The allowlisted payees in the ledger (as seedTreasury writes them; no balance reading), and the invoice came in. */
  function treasuryWorld(text: string): DB {
    const db = openDb(":memory:");
    for (const p of ALLOWLISTED_PAYEES) {
      db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(`ben-${p.iban.slice(-4)}`, p.name, p.iban.slice(-4), ibanSha(p.iban), p.bic);
    }
    publish(db, "invoice.received", { vendor: LICENSOR_NAME, file: "licence.txt", text }, "treasury");
    return db;
  }
  const facts = (db: DB, text: string) => invoiceFacts(db, T0, plannedInvoiceOf(text));
  const offered = (db: DB, text: string) => facts(db, text).lines.some((l) => /plan_invoice may plan it now/.test(l));

  it("the CFO blocked the licensor: the licence is flagged and not offered; checkInvoice refuses it for the same reason", () => {
    const db = treasuryWorld(LICENCE);
    expect(offered(db, LICENCE)).toBe(true);
    setSetting(db, "human", `counterparty:${LICENSOR_NAME}`, "blocked");
    const f = facts(db, LICENCE);
    expect(f.open[0]!.conflict).toBe(`${LICENSOR_NAME} is blocked by the CFO policy`);
    expect(f.lines.join("\n")).toMatch(new RegExp(`Not offered for planning: ${LICENSOR_NAME} is blocked by the CFO policy; a person checks it\\.`));
    expect(offered(db, LICENCE)).toBe(false);
    expect(checkInvoice(db, parseInvoiceFallback(LICENCE), LICENCE)).toEqual({ ok: false, reason: `${LICENSOR_NAME} is blocked by the CFO policy` });
  });

  it("an invoice from the licensor for another amount than the contracted fee: flagged, not offered; checkInvoice refuses it", () => {
    const db = treasuryWorld(AT_250);
    const f = facts(db, AT_250);
    expect(f.open[0]!.conflict).toBe(`the licence fee in code is EUR 240.00; this invoice from ${LICENSOR_NAME} asks EUR 250.00`);
    expect(offered(db, AT_250)).toBe(false);
    const c = checkInvoice(db, parseInvoiceFallback(AT_250), AT_250);
    expect(c).toEqual({ ok: false, reason: `the licence fee in code is EUR 240.00; this invoice from ${LICENSOR_NAME} asks EUR 250.00: a person checks the contract first` });
  });

  it("the facts offer the licence exactly when checkInvoice accepts it (blocked or not, at the contracted fee or not)", () => {
    for (const blocked of [false, true]) {
      for (const text of [LICENCE, AT_250]) {
        const db = treasuryWorld(text);
        if (blocked) setSetting(db, "human", `counterparty:${LICENSOR_NAME}`, "blocked");
        expect(offered(db, text), `blocked ${blocked}, ${parseInvoiceFallback(text).amount}`).toBe(checkInvoice(db, parseInvoiceFallback(text), text).ok);
      }
    }
  });
});

describe("review 2, LOW 4: a dispute with the CFO is not settled by code until a person clears it", () => {
  it("not settled again by the Support agent half an hour later (nor its fallback on a new event); --resolve then closes it", async () => {
    const db = world(4);
    opened(db);
    // The tool's settlement did not complete half an hour ago: it went to the CFO then.
    escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", HALF_HOUR_AGO());
    const asked: string[] = [];
    const deps: SupportDeps = { settle: async (_d, _b, id) => { asked.push(id); return { ok: true, text: "SETTLED (stub)" }; }, idOf };
    const r = await settleTool(db, deps);
    expect(r).toMatchObject({ blocked: "with the CFO", text: expect.stringMatching(new RegExp(`^Not settled: the dispute that came in \\(${ID}\\) is with the CFO`)) });
    expect(String(r.text)).toMatch(/It was sent to the CFO at .*; a person decides it\./);
    // Code's fallback (no Claude), on a new dispute.opened about the same orders: it settles nothing either.
    const summary = await supportProfile(30 * 60_000, deps).fallback!(db, [{ id: 99, kind: "dispute.opened", payload: { customer: SUMMIT, email: EMAIL }, for_agent: "support", created_at: new Date().toISOString() }] as never, []);
    expect(summary).toMatch(/^did nothing: the dispute that came in .* is with the CFO/);
    expect(asked).toEqual([]);
    // A person clears it: resolved by the CFO. Code still settles nothing: it is decided.
    resolveByCfo(db, ID, "Refunded #1 by hand after a call with Summit.");
    expect(await settleTool(db, deps)).toMatchObject({ blocked: "already decided" });
    expect(asked).toEqual([]);
    expect(rows(db)).toEqual([]);
  });

  it("a dispute with the CFO does not hold up another one that came in: that one is settled", async () => {
    const db = world(4);
    const other = "From: finance@summit-outfitters.example\nSubject: Check #4\n\nCheck #4 was wrong too.";
    opened(db, other, T0);
    opened(db, EMAIL, new Date(T0.getTime() + 1000));
    escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", HALF_HOUR_AGO());
    const asked: string[] = [];
    await settleTool(db, { settle: async (_d, _b, id) => { asked.push(id); return { ok: true, text: "SETTLED (stub)" }; }, idOf });
    expect(asked).toEqual([disputeKey(other)]);
  });

  it("its unfinished decision is not carried out by the agent; a resumed, unfinished decision of a dispute not with the CFO still completes", async () => {
    const db = world(4);
    const other = "From: finance@summit-outfitters.example\nSubject: Check #4\n\nCheck #4 was wrong too.";
    const B = opened(db, other, T0);
    opened(db, EMAIL, new Date(T0.getTime() + 1000));
    // Both decided by code and cut off before they were carried out, over half an hour ago; only ID went to the CFO.
    codeRefunds(db, B, [4]);
    codeRefunds(db, ID, [1, 2]);
    db.prepare("UPDATE dispute_decisions SET attempts = 1, attempted_at = ?").run(HALF_HOUR_AGO().toISOString());
    escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", HALF_HOUR_AGO());
    const m = metal();
    const asked: string[] = [];
    const deps: SupportDeps = {
      settle: async (d, _b, id) => { asked.push(id); const r = await carryOut(d, id, s2exec(d, id, m.pull), () => undefined, carrier(8181, () => false)); return { ok: true, text: `RESUMED ${id}: ${r!.status}` }; },
      idOf,
    };
    const r = await settleTool(db, deps);
    expect(r.text).toMatch(new RegExp(`^Carried out the dispute's recorded decision \\(nothing decided again\\): RESUMED ${B}: DONE`));
    expect(asked).toEqual([B]);
    expect(decisionOf(db, B)).toMatchObject({ status: "DONE", paid: [4] });
    // The CFO's dispute: untouched, also on the next wake.
    const again = await settleTool(db, deps);
    expect(again.blocked).toBeDefined();
    expect(asked).toEqual([B]);
    expect(decisionOf(db, ID)).toMatchObject({ status: "DECIDED", paid: [], attempts: 1 });
    expect([...m.pulls.keys()]).toEqual(["refund-4"]);
    // The agent's own view says who has it.
    expect(await supportProfile(30 * 60_000, deps).observe(db)).toMatch(new RegExp(`${ID} from .*\\[decided, not yet carried out, and with the CFO since \\d\\d:\\d\\d: a person carries it out \\(npm run s2 -- --dispute ${ID}\\); settle_dispute leaves it\\]`));
  });

  describe("the runner's start (npm run s2 -- --resume-only), as a real process (stand-in keys, no chain, no Claude)", () => {
    const s2 = (file: string, keys: string, ...args: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: file, KIT11_KEYS_DIR: keys };
      for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "KIT11_AGENTS"]) delete env[k];
      const r = spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/s2.ts"), ...args], { cwd: repo, env, encoding: "utf8", timeout: 90_000 });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };

    it("leaves a decision whose dispute is with the CFO, and finishes the other dispute's cut-off decision", () => {
      const dir = tempDir("resume");
      const keys = join(dir, "keys");
      mkdirSync(keys);
      for (const f of ["supplier.key.json", "sweep.key.json"]) writeFileSync(join(keys, f), JSON.stringify({ address: "0x00000000000000000000000000000000000000a1", privateKey: `0x${"1".repeat(64)}` }));
      const file = join(dir, "world.sqlite");
      const db = world(4, file);
      for (const [role, address] of [["business", "0x00000000000000000000000000000000000000b1"], ["customer", PAYER]]) db.prepare("INSERT INTO metal_accounts (role, address) VALUES (?, ?)").run(role, address);
      const other = "From: finance@summit-outfitters.example\nSubject: Check #4\n\nCheck #4 was wrong too.";
      const B = opened(db, other, T0);
      opened(db, EMAIL, new Date(T0.getTime() + 1000));
      for (const id of [B, ID]) db.prepare("UPDATE disputes SET claims_json = ?, evidence_json = '[]', verdicts_json = '[]' WHERE dispute_id = ?").run(JSON.stringify({ customer: SUMMIT, claims: ["wrong_data"], sale_refs: [1, 2, 3, 4], requested_action: "refund_wrong" }), id);
      // B: every order handled before (nothing new), its decision cut off before it was marked carried out.
      recordDecision(db, B, { source: "code", model: null, refunds: [], escalate: null, approval: null, agent_note: "every order in it was handled by an earlier dispute" });
      // ID: a refund still to pay, and with the CFO. It is the newer one: before, the runner took it first.
      codeRefunds(db, ID, [1]);
      escalateDispute(db, { id: ID, customer: SUMMIT }, "the settlement did not complete", T0);
      db.close();
      const r = s2(file, keys, "--resume-only");
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(new RegExp(`WITH THE CFO +${ID}: sent to the CFO at 2026-11-04T10:00:00\\.000Z; code does not carry out its decision on its own: npm run s2 -- --dispute ${ID} carries it out \\(nothing is decided again\\)`));
      expect(r.out).toMatch(new RegExp(`RESUMED +${B}: decided by code .*carried out`));
      const after = openDb(file);
      expect(decisionOf(after, B)).toMatchObject({ status: "DONE" });
      expect(decisionOf(after, ID)).toMatchObject({ status: "DECIDED", attempts: 0, paid: [] });
      expect(rows(after)).toEqual([]);
      after.close();
    }, 120_000);
  });
});

describe("review 2, LOW 5: a nothing-new decision carries out only a decision it recorded itself", () => {
  /** Two processes on one ledger file: A, an s2 that decided the dispute for real, and B, one a moment behind it. */
  function twoProcesses() {
    const file = join(tempDir("race"), "world.sqlite");
    world(4, file).close();
    const a = openDb(file);
    const b = openDb(file);
    onFile(a, ID);
    return { a, b };
  }

  it("decideNothingNew after another process recorded the real decision: it records nothing and touches nothing of it", async () => {
    const { a, b } = twoProcesses();
    codeRefunds(a, ID, [1, 2]);
    // B found nothing new to decide, twice (two late runs): each loses the race.
    expect(await decideNothingNew(b, ID)).toBe(false);
    expect(await decideNothingNew(b, ID)).toBe(false);
    expect(decisionOf(a, ID)).toMatchObject({ status: "DECIDED", attempts: 0, attempted_at: null, last_note: null, paid: [], handover: [] });
    expect(decisionOf(a, ID)!.plan.refunds.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows(a)).toEqual([]);
    // A carries out its own decision: a speed-limit refusal on its first try is tried again later, not handed to the
    // CFO (B's spurious tries would have made it the third, and the refund would have gone to the CFO).
    const m = metal();
    m.answers.set("refund-2", ["VELOCITY"]);
    const made: number[][] = [];
    const d = await carryOut(a, ID, s2exec(a, ID, m.pull, made), () => undefined, carrier(111, () => false));
    expect(d).toMatchObject({ status: "DECIDED", attempts: 1, paid: [1], handover: [], handover_proposal: null });
    expect(made).toEqual([]);
    expect(await carryOut(a, ID, s2exec(a, ID, m.pull, made), () => undefined, carrier(111, () => false))).toMatchObject({ status: "DONE", paid: [1, 2], handover: [] });
  });

  it("decideHandledBefore loses the race: no dispute.handled_before row, the real decision untouched", async () => {
    const { a, b } = twoProcesses();
    codeRefunds(a, ID, [3]);
    expect(await decideHandledBefore(b, { id: ID, customer: SUMMIT }, ["#1 (refunded under D-0ther000)"])).toBe(false);
    expect(b.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'dispute.handled_before'").get()).toEqual({ n: 0 });
    expect(decisionOf(a, ID)).toMatchObject({ status: "DECIDED", attempts: 0, last_note: null, paid: [] });
  });

  it("decideNoneSold loses the race between its check and its record: the real decision untouched", async () => {
    const { a, b } = twoProcesses();
    // A records its real decision right after B checked (as another process would, between B's two statements).
    b.exec(`CREATE TEMP TRIGGER other_process_decides AFTER INSERT ON main.audit_log WHEN NEW.event = 'dispute.escalated' BEGIN
      INSERT INTO dispute_decisions (dispute_id, source, plan_json, decided_at, status) VALUES (NEW.subject, 'code', '{"source":"code","model":null,"refunds":[{"seq":1,"cents":5,"origin":null}],"escalate":null,"approval":null}', '2026-11-04T10:00:00.000Z', 'DECIDED');
    END`);
    expect(await decideNoneSold(b, { id: ID, customer: SUMMIT })).toBe(false);
    expect(decisionOf(a, ID)).toMatchObject({ status: "DECIDED", attempts: 0, last_note: null, paid: [] });
    expect(decisionOf(a, ID)!.plan.refunds.map((r) => r.seq)).toEqual([1]);
    expect(rows(a)).toEqual([]);
  });

  it("each still decides and carries out its own decision when it is the first", async () => {
    const { a } = twoProcesses();
    expect(await decideNothingNew(a, ID)).toBe(true);
    expect(decisionOf(a, ID)).toMatchObject({ status: "DONE", attempts: 1 });
    onFile(a, "D-0ther000");
    expect(await decideNoneSold(a, { id: "D-0ther000", customer: SUMMIT })).toBe(true);
    expect(decisionOf(a, "D-0ther000")).toMatchObject({ status: "DONE" });
    expect(await decideNoneSold(a, { id: "D-0ther000", customer: SUMMIT })).toBe(false);
  });
});
