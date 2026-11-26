// The CFO's emergency stop in Purser Cloud (26 Nov): the runner had one (src/policy/holds.ts, the payment executors'
// refuseIfHeld, test/stop-mid-execution.test.ts); a company's engine in the Cloud had no way to pull it. Now it is the
// same policy setting ("freeze", src/policy/emergencyStop.ts) through the same policy change, which the CFO approves
// with the passkey to pull it and again to lift it, both audited (policy.changed). Test money, stand-in banks; no network.
// It holds, through the cloud's routes and inside a /try company's Durable Object (cloud/src/engine/hostWorker.ts):
//   - asking changes nothing; only the CFO's passkey pulls or lifts it, and a key cannot even ask;
//   - stopped, a proposal is still filed but nothing is sent: an approved payment fails before any create, the agent
//     pays nothing alone, and nothing is asked of the Airwallex sandbox;
//   - a stop set between the approval and the send refuses the send before the create (transfers unchanged);
//   - the rail asks once more immediately before every create, at either bank, and audits its refusal; an executor held
//     back there closes the payout row it wrote, so nothing is left counting as money under way;
//   - no agent card is issued, unfrozen, raised or tested while it is on;
//   - every change is in the audit log and told to every owner; lifted, the failed payment pays on a retry.
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { D1Like } from "../cloud/src/store.js";
import type { PayoutAnswerIn } from "../cloud/src/engine/livePayout.js";
import { sandboxPayout } from "../cloud/src/engine/livePayout.js";
import { HeldBeforeCreate, RoutedRail, type ActGuard, type Rails3 } from "../src/airwallex/routedRail.js";
import type { Transfer } from "../src/airwallex/port.js";
import { openDb, type DB } from "../src/db/open.js";
import { railStop, STOP_WORDS } from "../src/policy/emergencyStop.js";
import { BLOCKED_EVENT } from "../src/policy/blocked.js";
import { decide } from "../src/policy/approvals.js";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { SEEDED_SUPPLIERS } from "../src/engine/tryWorld.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { setSetting } from "../src/world/settings.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { sqliteDoStorage } from "./support/doStorage.js";
import { ORIGIN as CLOUD_ORIGIN, RP as CLOUD_RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

// pdfkit's browser build, which the Worker bundles, takes its standard fonts from registerStdFonts; Node's has none.
vi.mock("pdfkit", async (orig) => ({ ...(await orig<object>()), registerStdFonts: () => undefined }));
const { openHost } = await import("../cloud/src/engine/hostWorker.js");

type V = string | number | null;
function d1(db: Database.Database): D1Like {
  const stmt = (sql: string, params: V[] = []) => ({
    sql, params,
    bind: (...v: V[]) => stmt(sql, v),
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    first: async <T>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    run: async () => { const s = db.prepare(sql); return { meta: { changes: s.reader ? (s.all(...params), 0) : s.run(...params).changes } }; },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (s: unknown[]) => { db.transaction(() => { for (const x of s as { sql: string; params: V[] }[]) db.prepare(x.sql).run(...x.params); })(); return []; },
    exec: async (sql: string) => { db.exec(sql); return {}; },
  } as unknown as D1Like;
}

const TENANT = "t_try_stop0001";
const RP = "cloud.test", ORIGIN = `https://${RP}`;
// The sample invoice is due 16 Nov 2026 and the engine reads the real date: the date is held at a day before it.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

/** A /try company's Durable Object in plain Node, its sandbox payout switched on and answered by a stand-in. */
function world() {
  const cloud = new Database(":memory:");
  for (const f of readdirSync("cloud/migrations").sort()) cloud.exec(readFileSync(`cloud/migrations/${f}`, "utf8"));
  cloud.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, 'Stop Co', 'en', '2026-11-01')").run(TENANT, "stop-co");
  cloud.prepare("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_payout', 'on', '2026-11-01')").run();
  const object = new Database(":memory:");
  const storage = { ...sqliteDoStorage(object), deleteAll: async () => undefined };
  storage.sql.exec("CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  const asked: unknown[] = [];
  const AWX_FX = {
    quote: async () => ({ ok: false as const, reason: "switched_off" as const }),
    payout: async (a: { amount: string; currency: string; terms_sha256: string }): Promise<PayoutAnswerIn> => {
      asked.push(a);
      return { ok: true, transfer_id: `tr-${a.terms_sha256.slice(0, 12)}`, status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: `req-${a.terms_sha256.slice(0, 8)}` };
    },
    payoutSimulate: async () => ({ ok: false as const, reason: "no_transfer" }),
  };
  return { object, asked, env: { RP_ID: RP, ORIGIN, DB: d1(cloud), AWX_FX } as never, ctx: { storage } as never };
}

describe("the emergency stop inside a company's engine (its Durable Object)", () => {
  it("pulled with the passkey it stops every payment, also one approved before it; lifted with the passkey, the payment goes", async () => {
    const w = world();
    const { api } = await openHost(w.ctx, w.env, TENANT);
    const phone = new FakeAuthenticator();
    let counter = 0;
    const sign = (a: FakeAuthenticator, p: { challenge: string }) => a.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
    const st = await api.passkeyStart({ rpId: RP, origin: ORIGIN });
    expect(await api.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "CFO", person: "u_cfo" })).toMatchObject({ ok: true });
    const transfers = () => (w.object.prepare("SELECT COUNT(*) AS n FROM transfers WHERE transfer_id IS NOT NULL").get() as { n: number }).n;

    // Approved and held for the one pay route BEFORE the stop: the stop lands between the approval and the send.
    const up = await api.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf", mime: "application/pdf" });
    const big = await api.propose(up.invoice!.id);
    if (!big.ok) throw new Error(big.reason);
    const bigSig = sign(phone, big.proposal);
    expect(await api.approve({ proposal_id: big.proposal.id, terms_sha256: big.proposal.terms_sha256, credential: bigSig, hold: true })).toMatchObject({ status: "approved", held: true });

    // Asking for the stop changes nothing; the CFO's passkey on the policy change pulls it.
    expect((await api.status()).emergency_stop).toEqual({ on: false, since: null, proposal_id: null });
    const pull = await api.emergencyStop(true);
    if (!pull.ok) throw new Error(pull.reason);
    expect(pull.proposal).toMatchObject({ kind: "policy_change", status: "PENDING_APPROVAL" });
    expect((await api.status()).emergency_stop?.on).toBe(false);
    expect(await api.approve({ proposal_id: pull.proposal.id, terms_sha256: pull.proposal.terms_sha256, credential: sign(phone, pull.proposal) })).toMatchObject({ status: "approved" });
    expect((await api.status()).emergency_stop).toMatchObject({ on: true, proposal_id: pull.proposal.id });
    expect(await api.emergencyStop(true)).toEqual({ ok: false, reason: "the emergency stop is already on" });

    // The send after the stop: refused before any create, the bank untouched, the sandbox not asked.
    const before = transfers();
    const terms = (await api.terms(big.proposal.id))!;
    const sent = await api.paySigned(big.proposal.id, terms.terms as unknown as Record<string, unknown>, bigSig);
    expect(sent).toMatchObject({ outcome: "failed", transfers_before: before, transfers_after: before });
    expect(sent).not.toHaveProperty("airwallex_payout");
    // The approval stands, blocked with its reason (src/policy/blocked.ts): nothing was paid.
    expect((await api.proposal(big.proposal.id))!.status).toBe("APPROVED");
    const blocked = w.object.prepare("SELECT payload_json FROM audit_log WHERE subject = ? AND event = ?").all(big.proposal.id, BLOCKED_EVENT) as { payload_json: string }[];
    expect(blocked.map((r) => (JSON.parse(r.payload_json) as { reason: string }).reason)).toEqual([expect.stringMatching(/emergency stop/)]);
    expect(transfers()).toBe(before);

    // Within the limit to pay alone: nothing is filed to be paid while the stop is on, so nothing is paid alone either.
    const small = await api.compose({ supplier_key: "bergtex", invoice_no: "INV-STOP-1", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
    if ("refused" in small) throw new Error(small.refused.message);
    expect(await api.propose(small.invoice!.id)).toEqual({ ok: false, reason: expect.stringMatching(/emergency stop/) });
    expect(w.asked).toEqual([]);
    expect(transfers()).toBe(before);

    // Lifting it needs the passkey too: an unknown key's signature is refused and the stop stands.
    const lift = await api.emergencyStop(false);
    if (!lift.ok) throw new Error(lift.reason);
    const stranger = new FakeAuthenticator();
    expect((await api.approve({ proposal_id: lift.proposal.id, terms_sha256: lift.proposal.terms_sha256, credential: sign(stranger, lift.proposal) })).status).toBe("refused");
    expect((await api.status()).emergency_stop?.on).toBe(true);
    expect(await api.approve({ proposal_id: lift.proposal.id, terms_sha256: lift.proposal.terms_sha256, credential: sign(phone, lift.proposal) })).toMatchObject({ status: "approved" });
    expect((await api.status()).emergency_stop).toMatchObject({ on: false, proposal_id: lift.proposal.id });

    // Lifted: the payment approved before the stop is sent now, once, and only now asked of the sandbox.
    expect(await api.paySigned(big.proposal.id, terms.terms as unknown as Record<string, unknown>, bigSig)).toMatchObject({ outcome: "paid", airwallex_payout: { source: "airwallex-sandbox" } });
    expect(transfers()).toBe(before + 1);
    expect(w.asked).toHaveLength(1);

    // The audit log: both changes with their proposals, the chain intact.
    const changed = (await api.events(0, 500)).items.filter((e) => e.event === "policy.changed" && e.subject === "freeze");
    expect(changed.map((e) => e.fields)).toEqual([{ key: "freeze", from: "off", to: "on" }, { key: "freeze", from: "on", to: "off" }]);
    const rows = w.object.prepare("SELECT payload_json FROM audit_log WHERE event = 'policy.changed' AND subject = 'freeze' ORDER BY seq").all() as { payload_json: string }[];
    expect(rows.map((r) => (JSON.parse(r.payload_json) as { proposal_id: string }).proposal_id)).toEqual([pull.proposal.id, lift.proposal.id]);
    expect((await api.status()).chains).toEqual({ audit: true, ledger: true });
  });
});

describe("the emergency stop through Purser Cloud's routes", () => {
  let c: TestCloud, A: TestTenant, counter = 0;
  const phone = new FakeAuthenticator("platform");
  interface Proposal { id: string; kind: string; status: string; terms_sha256: string; challenge: string }
  const signed = (a: FakeAuthenticator, p: Proposal) => a.sign({ challenge: p.challenge, origin: CLOUD_ORIGIN, rpId: CLOUD_RP, counter: ++counter });
  const approve = (p: Proposal, a: FakeAuthenticator) => c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: A.session, body: { terms_sha256: p.terms_sha256, credential: signed(a, p) } });
  const proposal = async (id: string) => (await c.req("GET", `/v1/engine/proposals/${id}`, { key: A.session })).json.proposal as Proposal;
  const stop = async () => (await c.req("GET", "/v1/engine", { key: A.session })).json.emergency_stop as { on: boolean; proposal_id: string | null };
  const told = async () => ((await c.req("GET", "/v1/security/events", { key: A.session })).json.items as { kind: string }[]).map((e) => e.kind).filter((k) => k.startsWith("emergency_stop."));

  beforeAll(async () => {
    c = testCloud({ engine: true });
    A = await c.tenant("northwind");
    expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
    const start = await c.req("POST", "/v1/engine/passkey/start", { key: A.session });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: start.json.code, credential: phone.register({ challenge: start.json.challenge as string, origin: CLOUD_ORIGIN, rpId: CLOUD_RP }) } })).status).toBe(200);
  });
  afterAll(() => c.close());

  it("a key cannot ask; the CFO's request changes nothing until the passkey signs it, then pay is refused before anything is sent", async () => {
    // Filed before the stop: its approval comes after it.
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } })).status).toBe(200);
    const filed = await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const p = filed.json.proposal as Proposal;

    expect((await c.req("POST", "/v1/engine/emergency-stop", { key: A.key, body: { on: true } })).status).toBe(403);
    expect((await c.req("POST", "/v1/engine/emergency-stop", { key: A.session, body: { on: "yes" } })).status).toBe(400);
    const r = await c.req("POST", "/v1/engine/emergency-stop", { key: A.session, body: { on: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const pull = r.json.proposal as Proposal;
    expect(pull).toMatchObject({ kind: "policy_change", status: "PENDING_APPROVAL" });
    expect(await stop()).toMatchObject({ on: false });
    expect((await approve(pull, phone)).json).toMatchObject({ status: "approved" });
    expect(await stop()).toMatchObject({ on: true, proposal_id: pull.id });
    expect((await c.req("POST", "/v1/engine/emergency-stop", { key: A.session, body: { on: true } })).status).toBe(409);

    // No agent card is issued, unfrozen, raised or tested while it is on; a freeze is never stopped by it.
    for (const kind of ["issue", "unfreeze", "limits", "test", "edge"]) {
      const card = await c.req("POST", "/v1/cards/actions", { key: A.session, body: { kind, agent: "sourcing" } });
      expect({ kind, status: card.status, error: card.json.error }).toEqual({ kind, status: 409, error: expect.stringMatching(/emergency stop is on/) });
    }
    expect((await c.req("POST", "/v1/cards/actions", { key: A.session, body: { kind: "freeze", agent: "sourcing" } })).json.error ?? "").not.toMatch(/emergency stop/);

    // The CFO's approval of a payment filed before the stop pays nothing: the executor refuses before any create.
    const out = await approve(p, phone);
    expect(out.json).toMatchObject({ status: "approved", settled: { error: expect.stringMatching(/emergency stop/) } });
    expect((await proposal(p.id)).status).toBe("APPROVED");
    const events = ((await c.req("GET", "/v1/engine/events?limit=200", { key: A.session })).json.items as { event: string }[]).map((e) => e.event);
    expect(events).not.toContain("transfer.created");
    expect(await told()).toEqual(expect.arrayContaining(["emergency_stop.requested", "emergency_stop.on"]));

    // Lifted only with the passkey: a stranger's signature is refused, the stop stands; the CFO's lifts it.
    const lift = (await c.req("POST", "/v1/engine/emergency-stop", { key: A.session, body: { on: false } })).json.proposal as Proposal;
    expect((await approve(lift, new FakeAuthenticator("platform"))).json).toMatchObject({ status: "refused" });
    expect(await stop()).toMatchObject({ on: true });
    expect((await approve(lift, phone)).json).toMatchObject({ status: "approved" });
    expect(await stop()).toMatchObject({ on: false, proposal_id: lift.id });
    expect(await told()).toEqual(expect.arrayContaining(["emergency_stop.lift_requested", "emergency_stop.lifted"]));
    // The approval signed during the stop is blocked, not lost: lifted, it is run with every check asked again, once.
    expect((await approve(p, phone)).json).toMatchObject({ status: "already" });
    expect((await c.req("POST", `/v1/engine/proposals/${p.id}/retry`, { key: A.session })).json).toMatchObject({ status: "retried" });
    expect(["EXECUTED", "EXECUTING"]).toContain((await proposal(p.id)).status);
    const after = ((await c.req("GET", "/v1/engine/events?limit=200", { key: A.session })).json.items as { event: string }[]).map((e) => e.event);
    expect(after.filter((e) => e === "transfer.created")).toHaveLength(1);
    expect((await c.req("POST", `/v1/engine/proposals/${p.id}/retry`, { key: A.session })).status).toBe(409);
  });
});

describe("the rail asks the stop once more, immediately before every create", () => {
  /** A stand-in bank recording its creates; payee ids in the simulated bank's shape (ben_1) or Airwallex's. */
  function bank(prefix: string) {
    const creates: string[] = [];
    const rail = {
      createTransfer: async (t: { requestId: string; amountCents: number; currency: string; beneficiaryId: string }) => { creates.push(`transfer ${t.requestId}`); return { id: `${prefix}tr_1`, requestId: t.requestId, status: "PROCESSING", amountCents: t.amountCents, currency: t.currency, beneficiaryId: t.beneficiaryId } as Transfer; },
      createConversion: async (a: { requestId: string }) => { creates.push(`conversion ${a.requestId}`); return { conversionId: `${prefix}conv_1`, requestId: a.requestId, status: "SETTLED", buyAmountCents: 1, sellAmountCents: 1 }; },
    };
    return { rail: rail as unknown as Rails3, creates };
  }
  function setup() {
    const db: DB = openDb(":memory:");
    const sim = bank(""), awx = bank("AWX-");
    const routes = new Map<string, { bank: "airwallex" | "simulated"; twin: string | null }>();
    const spent: string[] = [], released: string[] = [];
    const guard: ActGuard = { blocked: async () => null, spend: async (a) => { spent.push(a.key); }, release: async (k) => { released.push(k); } };
    const rail = new RoutedRail(awx.rail, sim.rail, { get: (k) => routes.get(k) ?? null, set: (k, v) => { routes.set(k, v); } }, guard, undefined, () => undefined, railStop(db));
    const held = () => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'transfer.held_before_create'").all() as { subject: string; payload_json: string }[]).map((r) => ({ subject: r.subject, ...JSON.parse(r.payload_json) as object }));
    return { db, sim, awx, rail, spent, released, held, stopNow: () => setSetting(db, "human", "freeze", "on") };
  }
  const t = (requestId: string, beneficiaryId: string) => ({ requestId, beneficiaryId, amountCents: 5_000, currency: "EUR" as const, sourceCurrency: "EUR" as const, reference: "INV-1", reason: "goods", approvalSha256: "a".repeat(64) });
  const quote = { quoteId: "q_1", buyCurrency: "EUR" as const, sellCurrency: "USD" as const, buyAmountCents: 100, sellAmountCents: 110, clientRate: "1.1", validFrom: "", validTo: "" };

  it("with no stop it creates; with the stop set after the executor's own check, nothing reaches either bank and the refusal is audited", async () => {
    const s = setup();
    await s.rail.createTransfer(t("req-ok", "ben_1"));
    expect(s.sim.creates).toEqual(["transfer req-ok"]);
    s.stopNow();
    await expect(s.rail.createTransfer(t("req-sim", "ben_1"))).rejects.toBeInstanceOf(HeldBeforeCreate);
    await expect(s.rail.createConversion({ requestId: "conv-sim", quote, approvalSha256: "a".repeat(64) })).rejects.toThrow(STOP_WORDS);
    // At the Airwallex sandbox: what the caps spoke for is freed again, since nothing was sent.
    await expect(s.rail.within("airwallex", () => s.rail.createTransfer(t("req-awx", "BEN-awx-1")))).rejects.toBeInstanceOf(HeldBeforeCreate);
    expect(s.sim.creates).toEqual(["transfer req-ok"]);
    expect(s.awx.creates).toEqual([]);
    expect(s.spent).toEqual(["req-awx"]);
    expect(s.released).toEqual(["req-awx"]);
    expect(s.held()).toEqual([
      expect.objectContaining({ subject: "req-sim", before: "transfer", reason: STOP_WORDS, request_id: "req-sim", checked: "rail" }),
      expect.objectContaining({ subject: "conv-sim", before: "conversion", reason: STOP_WORDS, request_id: "conv-sim", checked: "rail" }),
      expect.objectContaining({ subject: "req-awx", before: "transfer", reason: STOP_WORDS, request_id: "req-awx", checked: "rail" }),
    ]);
  });
});

describe("an executor on the routed rail, the stop landing after its own last check", () => {
  it("nothing is created, the payout row is closed (not left under way), the holds are released and the payment FAILED", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const bill = readFileSync("fixtures/bergtex-invoice-BTX-2026-11.txt", "utf8");
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(bill), bill);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const id = out.proposal.proposal_id;
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" });
    // The stop lands at the very moment the payout reaches the rail: after the executor's own refuseIfHeld.
    const asked = railStop(db);
    const stop = (what: "conversion" | "transfer" | "batch", ref: string) => { if (what === "transfer") setSetting(db, "human", "freeze", "on"); return asked(what, ref); };
    const guard: ActGuard = { blocked: async () => null, spend: async () => undefined, release: async () => undefined };
    const routes = new Map<string, { bank: "airwallex" | "simulated"; twin: string | null }>();
    const rail = new RoutedRail(awx as unknown as Rails3, awx as unknown as Rails3, { get: (k) => routes.get(k) ?? null, set: (k, v) => { routes.set(k, v); } }, guard, undefined, () => undefined, stop);
    await expect(executeInvoicePayment(db, rail, awx, id)).rejects.toBeInstanceOf(HeldBeforeCreate);
    expect(awx.calls.filter((c) => /^create(Transfer|PayoutTransfer)$/.test(c))).toEqual([]);
    expect(awx.transfers).toEqual([]);
    expect(db.prepare("SELECT status, failure_type FROM transfers").all()).toEqual([{ status: "CANCELLED", failure_type: "held_by_purser" }]);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status).toBe("FAILED");
    expect((db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE proposal_id = ? AND status = 'HELD'").get(id) as { n: number }).n).toBe(0);
    const held = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.held_before_create'").all() as { payload_json: string }[];
    expect(held.map((r) => JSON.parse(r.payload_json) as object)).toEqual([expect.objectContaining({ before: "transfer", checked: "rail", reason: STOP_WORDS })]);
  });
});

describe("/try's sandbox mirror of a paid payment asks the stop last", () => {
  it("while the stop is on, nothing is sent to the Airwallex sandbox and the skip is audited", async () => {
    const db = openDb(":memory:");
    const kept = new Map<string, string>();
    const asked: unknown[] = [];
    const sha = "c".repeat(64);
    const note = await sandboxPayout({
      company: TENANT, proposalId: "P-0001", termsSha256: sha, terms: { amount: "10.00", currency: "EUR", reference: "INV-1" }, db,
      source: { payout: async (a) => { asked.push(a); return { ok: true, transfer_id: "tr-0000000001", status: "IN_APPROVAL", amount: "10.00", currency: "EUR", request_id: "r" }; }, payoutSimulate: async () => ({ ok: false, reason: "no_transfer" }) },
      allowed: async () => true, stopped: () => true, keep: { get: (k) => kept.get(k) ?? null, set: (k, v) => { kept.set(k, v); } },
    });
    expect(note).toEqual({ source: "simulated", reason: "emergency_stop", terms_sha256: sha });
    expect(asked).toEqual([]);
    expect(db.prepare("SELECT event, payload_json FROM audit_log WHERE subject = 'P-0001'").all()).toEqual([{ event: "airwallex.payout_skipped", payload_json: JSON.stringify({ reason: "emergency_stop" }) }]);
  });
});
