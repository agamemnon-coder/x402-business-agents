// awx-1 (Max's item 2.1) on the stand-ins, 0 network: the scenario runs end to end through the same driver and ledger
// code the live run uses, and the record shows a–g; verify and reconcile pass on it. Webhooks go through the relay
// Worker's own code and the runner's sync; the CFO is a labelled virtual test passkey; the decline is met by the agent
// (a scripted Claude that only answers; code bounds what it may ask).
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { accepted, awx1Record, runAwx1, verifyLines, type Awx1Record } from "../src/awx/scenario.js";
import { runnerOnHook, standInDeps, standInGet, standInSources, STAND_IN_HOOK_SECRET, VIRTUAL_PASSKEY_LABEL } from "../src/awx/standIn.js";
import { reconcile } from "../src/finance/reconcile.js";
import { handleAirwallexHook, type RelayedHook } from "../src/policy/cardHooks.js";
import { meetNewDeclines } from "../src/agents/declineTrigger.js";
import { RelayRunner } from "../src/relay/runner.js";
import { Relay, type Sql } from "../worker/src/core.js";
import { routerClient, type Script } from "./fakes/claude-router.js";

// 0 network, whatever this machine's environment holds: no key reaches the code under test, and any fetch fails loudly.
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY"]) delete process.env[k];
beforeAll(() => { vi.stubGlobal("fetch", async (input: unknown) => { throw new Error(`no network in the awx-1 stand-in tests: ${String(input).slice(0, 80)}`); }); });
afterAll(() => { vi.unstubAllGlobals(); });

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
// The real clock: the invoice plan dates its proposal by it (an earlier clock would find it expired).
const t0 = Date.now();

/** The Sourcing and Support agents meeting a decline, as Claude would: read why, then ask for a raise only for a limit. */
const declineAgent: Script = (t) => {
  if (t.role !== "other") return null;
  if (t.turn === 0) return [{ name: "read_decline", input: {} }];
  if (t.turn === 1) {
    return /LIMIT_EXCEEDED/.test(t.results[0] ?? "")
      ? [{ name: "propose_raise", input: { per_purchase: "46.00", per_month: null, reason: "Packwise Pro is the plan our warehouse needs; 46.00 covers it with no headroom." } }]
      : [{ name: "no_raise", input: { reason: "Airwallex refused the merchant category, not the amount; a higher limit would not help. Warehouse software belongs on the Sourcing card." } }];
  }
  return null;
};

function sqlOver(db: Database.Database): Sql {
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}

async function world(o: { faults?: (deps: Awaited<ReturnType<typeof standInDeps>>) => void } = {}) {
  const db = openDb(":memory:");
  let t = t0;
  const now = () => new Date((t += 1000));
  const client = routerClient(declineAgent);
  // The relay Worker's own code, with the stand-in's webhook secret; the runner syncs with it as it does live.
  const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, webhookSecret: STAND_IN_HOOK_SECRET, now });
  const runner = new RelayRunner({
    db, cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => relay.fetch(new Request(input, init))) as typeof fetch,
    execute: async () => undefined, log: () => undefined,
    onHook: (h) => handleAirwallexHook(db, h, STAND_IN_HOOK_SECRET, now()),
  });
  const deliver = async (hooks: RelayedHook[]) => {
    for (const h of hooks) {
      const res = await relay.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": h.ts, "x-signature": h.signature }, body: h.body }));
      expect(res.status).toBe(200);
    }
    await runner.syncOnce();
    await meetNewDeclines(db, { by: "runner", client, now: now(), env: { KIT11_AGENTS: "on" } });
  };
  const w = await standInDeps(db, { client, now, deliver });
  o.faults?.(w);
  return { db, client, now, ...w };
}

async function finish(w: Awaited<ReturnType<typeof world>>): Promise<Awx1Record> {
  const verify = await verifyLines(w.db, standInGet(w.awx));
  const r = await reconcile(w.db, standInSources(w.issuing, w.awx), w.now());
  return awx1Record(w.db, { mode: "stand-in", virtualLabels: [VIRTUAL_PASSKEY_LABEL], verify, reconcile: { checked: r.checked, differences: r.differences.length, skipped: r.skipped } });
}

describe("awx-1 on the stand-ins", () => {
  it("runs end to end and its record shows a–g; verify and reconcile pass", async () => {
    const w = await world();
    await runAwx1(w.deps);
    const rec = await finish(w);
    for (const k of ["a", "b", "c", "d", "e", "f", "g"] as const) expect(rec.checks[k], `${k}: ${rec.checks[k].detail}`).toMatchObject({ ok: true });
    expect(rec.verify.filter((v) => v.level === "FAIL")).toEqual([]);
    expect(rec.reconcile).toMatchObject({ differences: 0 });
    expect(accepted(rec)).toEqual({ ok: true, why: [] });
    expect(rec.mode).toBe("stand-in");
    expect(rec.note).toMatch(/^STAND-IN, not evidence/);
  });

  it("a: one card per agent, each with the policy's limit, MCC, EUR only and an end date, read back from Airwallex", async () => {
    const w = await world();
    await runAwx1(w.deps, { to: "a" });
    const rec = awx1Record(w.db, { mode: "stand-in" });
    expect(rec.cards.map((c) => [c.agent, c.read_back.per_tx, c.read_back.monthly, c.read_back.mccs, c.read_back.currencies])).toEqual([
      ["sourcing", "30.00", "100.00", ["5734"], ["EUR"]],
      ["support", "60.00", "150.00", ["7372"], ["EUR"]],
      ["treasury", "25.00", "50.00", ["5734"], ["EUR"]],
    ]);
    // 90 days from issue (CARD_ACTIVE_DAYS); Airwallex declines everything after.
    for (const c of rec.cards) expect(Date.parse(String(c.read_back.active_to)) - t0).toBeGreaterThan(89 * 86_400_000);
    // The world's own nickname: an Airwallex-only world never adopts an earlier world's card.
    expect(w.issuing.cards.map((c) => c.nickname)).toEqual(expect.arrayContaining([expect.stringMatching(/\(awx-1\)$/)]));
    expect(w.issuing.cards.every((c) => c.nickname.endsWith("(awx-1)"))).toBe(true);
  });

  it("b–d: Airwallex approves within the limit and declines over it (LIMIT_EXCEEDED) and outside the MCC (MERCHANT_CATEGORY_NOT_ALLOWED)", async () => {
    const w = await world();
    await runAwx1(w.deps, { to: "d" });
    const rec = awx1Record(w.db, { mode: "stand-in" });
    expect(rec.card_transactions.map((t) => [t.step, t.agent, t.amount, t.mcc, t.approved, t.decline_code])).toEqual([
      ["b", "sourcing", "19.99", "5734", true, null],
      ["c", "sourcing", "45.00", "5734", false, "LIMIT_EXCEEDED"],
      ["c", "sourcing", "45.00", "5734", true, null],
      ["d", "support", "19.99", "5734", false, "MERCHANT_CATEGORY_NOT_ALLOWED"],
    ]);
  });

  it("e: every card transaction arrives by a signed webhook through the relay; after the decline the agent asks the CFO instead of retrying", async () => {
    const w = await world();
    await runAwx1(w.deps, { to: "d" });
    const rec = awx1Record(w.db, { mode: "stand-in", virtualLabels: [VIRTUAL_PASSKEY_LABEL] });
    expect(rec.card_transactions.every((t) => t.source === "webhook")).toBe(true);
    expect(rec.webhooks.filter((h) => h.object === "card_transaction")).toHaveLength(4);
    expect(rec.webhooks.every((h) => h.agrees !== false)).toBe(true);
    // Both declines met by the agent itself: a raise for the limit, nothing for the merchant category.
    expect(rec.declines_met.map((m) => [m.agent, m.decline_code, m.by, m.proposal_id !== null])).toEqual([
      ["sourcing", "LIMIT_EXCEEDED", "claude", true],
      ["support", "MERCHANT_CATEGORY_NOT_ALLOWED", "claude", false],
    ]);
    const raise = rec.proposals.find((p) => p.proposal_id === rec.declines_met[0]!.proposal_id)!;
    expect(raise).toMatchObject({ kind: "policy_change", created_by: "sourcing", status: "EXECUTED", method: "passkey", virtual_test_passkey: true });
    expect(raise.decided_by).toMatch(new RegExp(`^${VIRTUAL_PASSKEY_LABEL} \\(passkey `));
    // The raise reached the card at Airwallex before the merchant charged again; nothing charged it in between.
    expect(w.issuing.calls.filter((c) => c === "charge")).toHaveLength(4);
    expect(w.issuing.cards.find((c) => c.nickname.startsWith("sourcing"))!.limits).toMatchObject({ perTxCents: 4600 });
    expect(rec.checks.e).toMatchObject({ ok: true });
  });

  it("e, live: a decline met by code's fallback (no Claude) does not pass", async () => {
    const w = await world();
    await runAwx1(w.deps, { to: "d" });
    const rec = awx1Record(w.db, { mode: "stand-in" });
    const fallback = { ...rec, mode: "live" as const, declines_met: rec.declines_met.map((m) => ({ ...m, by: "code" })) };
    const { checkAwx1 } = await import("../src/awx/scenario.js");
    expect(checkAwx1(fallback).e).toMatchObject({ ok: false, detail: expect.stringMatching(/code's fallback/) });
  });

  it("f: with enough free EUR the licence goes without FX; Bergtex then converts only its shortfall, on a quote asked for after the licence was paid", async () => {
    const w = await world();
    await runAwx1(w.deps, { to: "f2" });
    const rec = awx1Record(w.db, { mode: "stand-in" });
    const [licence, bergtex] = rec.invoices;
    expect(licence).toMatchObject({ invoice_no: "SLL-2026-11", plan: "pay_from_eur", free_eur: "1500.00", need_eur: "260.00", quote: null, conversion_id: null, status: "PAID" });
    // 1,500.00 free less the licence and the fee Airwallex charged (13.40): 1,246.60; Bergtex needs 1,850.00 + 20.00.
    expect(bergtex).toMatchObject({ invoice_no: "BTX-2026-11", plan: "convert_shortfall", free_eur: "1246.60", need_eur: "1870.00", status: "PAID" });
    expect(bergtex!.quote!.buy_eur).toBe("623.40");
    expect(bergtex!.planned_at >= licence!.paid_at!).toBe(true);
    // One quote and one conversion in the whole run, both for Bergtex: the licence asked for neither.
    expect(w.awx.calls.filter((c) => c === "createQuote")).toHaveLength(1);
    expect(w.awx.calls.filter((c) => c === "createConversion")).toHaveLength(1);
  });

  it("g: each SWIFT payout ran after the virtual passkey signed its hash, carries that hash in Airwallex's metadata and is PAID", async () => {
    const w = await world();
    await runAwx1(w.deps);
    const rec = await finish(w);
    for (const i of rec.invoices) {
      const tr = w.awx.transfers.find((t) => t.id === i.transfer_id)!;
      expect(tr).toMatchObject({ status: "PAID", metadata: i.approval_sha256 });
      expect(rec.proposals.find((p) => p.proposal_id === i.proposal_id)).toMatchObject({ method: "passkey", virtual_test_passkey: true, status: "EXECUTED" });
      expect(rec.verify).toContainEqual(expect.objectContaining({ level: "ok", what: `${i.proposal_id} transfer ${i.transfer_id}` }));
    }
    // The payouts' webhooks came too, and agree with the ledger.
    expect(rec.webhooks.filter((h) => h.object === "transfer").map((h) => [h.status, h.agrees])).toEqual([["PAID", true], ["PAID", true]]);
  });

  it("keeps a failed attempt in the record with its cause, and the run resumes from that step", async () => {
    let fail = true;
    const w = await world({
      faults: ({ issuing }) => {
        const charge = issuing.simulateCardCharge.bind(issuing);
        issuing.simulateCardCharge = async (a) => {
          if (fail) { fail = false; throw new Error("Airwallex 503 on /simulation/issuing/create (stand-in fault)"); }
          return charge(a);
        };
      },
    });
    await expect(runAwx1(w.deps)).rejects.toThrow(/stand-in fault/);
    await runAwx1(w.deps, { from: "b" });
    const rec = await finish(w);
    expect(rec.attempts.filter((a) => a.step === "b").map((a) => [a.outcome, a.cause])).toEqual([
      ["started", null], ["failed", "Airwallex 503 on /simulation/issuing/create (stand-in fault)"], ["started", null], ["done", null],
    ]);
    expect(accepted(rec).ok).toBe(true);
  });

  it("never asks the sandbox to fail a charge: a simulated charge carries no failure reason", async () => {
    const { IssuingRest } = await import("../src/airwallex/issuing.js");
    const { Airwallex } = await import("../src/airwallex/client.js");
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ card_transaction_id: "ct-1", card_id: "c-1", process_result: "DECLINED", failure_reason: "LIMIT_EXCEEDED", transaction_amount: -45, transaction_currency: "EUR", transacted_at: "2026-11-07T10:00:00Z", merchant: { name: "Packwise", category_code: "5734" } }), { status: 200 });
    }) as typeof fetch;
    const rest = new IssuingRest(new Airwallex({ clientId: "x", apiKey: "y", fetchImpl, minGapMs: 0 }));
    const t = await rest.simulateCardCharge({ cardId: "c-1", amountCents: 4500, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    expect(t).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
    expect(Object.keys(bodies[0] as object).sort()).toEqual(["card_id", "merchant_category_code", "merchant_info", "transaction_amount", "transaction_currency"]);
  });

  it("goes through the runner's own handler when no relay is in between (the CLI's stand-in path)", async () => {
    const db: DB = openDb(":memory:");
    let t = t0;
    const now = () => new Date((t += 1000));
    const w = await standInDeps(db, { client: routerClient(declineAgent), now });
    await runAwx1(w.deps);
    const verify = await verifyLines(db, standInGet(w.awx));
    const r = await reconcile(db, standInSources(w.issuing, w.awx), now());
    const rec = awx1Record(db, { mode: "stand-in", virtualLabels: [VIRTUAL_PASSKEY_LABEL], verify, reconcile: { checked: r.checked, differences: r.differences.length, skipped: r.skipped } });
    expect(accepted(rec)).toEqual({ ok: true, why: [] });
    expect(typeof runnerOnHook).toBe("function");
  });

  it("a bad webhook signature records nothing", async () => {
    const db: DB = openDb(":memory:");
    const body = JSON.stringify({ id: "evt-x", name: "issuing.card_transaction_event.failed", data: {} });
    const ts = String(t0);
    const sig = createHmac("sha256", "not-the-secret").update(ts + body).digest("hex");
    expect(await runnerOnHook(db, { id: "evt-x", ts, signature: sig, body }, STAND_IN_HOOK_SECRET, { client: null, now: new Date(t0) })).toMatch(/bad signature/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM airwallex_events").get()).toEqual({ n: 0 });
  });

  it("is not the live record: the committed record is the live run's, never the stand-in's", () => {
    // docs/demo/airwallex-run.json and docs/runs/2026-11-07-awx-1.md come from the live run only (7 Nov, ACCEPTED).
    const rec = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as Awx1Record;
    expect(rec).toMatchObject({ run: "awx-1", mode: "live", test_money: true });
    expect(rec.proposals.every((p) => !p.virtual_test_passkey)).toBe(true);
    expect(accepted(rec)).toEqual({ ok: true, why: [] });
  });
});
