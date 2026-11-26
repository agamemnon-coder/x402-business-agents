// Task mandates in Purser Cloud's engine (26 Nov): the authority lane left the Cloud engine with the stand-in gate that
// fails closed (src/policy/aloneGate.ts failClosed: once a task mandate is on record, nothing is paid alone there),
// because the Worker's bundle was tight. The full gate (src/policy/taskMandates.ts and taskTokens.ts) costs about 5.5 KB
// gzipped in the bundle (test/cloud-engine-bundle.test.ts holds the whole), so the engine's Durable Object now loads it
// as the runner does (cloud/src/engine/hostWorker.ts imports taskMandates.ts, which installs it).
// It holds, inside a company's Durable Object in plain Node (test money, the stand-in bank, no network):
//   - this file loads nothing of the runner's ledger (src/db/open.ts), so only the host can have installed the gate;
//   - a mandate the CFO grants with the passkey is a policy change the engine accepts (the stand-in refused to write one);
//   - inside it the agent pays alone, the approval naming its mandate; to a payee it does not name it does not, the refusal recorded
//     with its reason, and the payment waits for the CFO's Face ID.
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { D1Like } from "../cloud/src/store.js";
import type { PayoutAnswerIn } from "../cloud/src/engine/livePayout.js";
import type { DB } from "../src/db/open.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { aloneGate, failClosed } from "../src/policy/aloneGate.js";
import { canonicalMandate, type TaskMandate } from "../src/policy/taskMandateCore.js";
import { SEEDED_SUPPLIERS } from "../src/engine/tryWorld.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { sqliteDoStorage } from "./support/doStorage.js";

// pdfkit's browser build, which the Worker bundles, takes its standard fonts from registerStdFonts; Node's has none.
vi.mock("pdfkit", async (orig) => ({ ...(await orig<object>()), registerStdFonts: () => undefined }));
// Before the engine's host is loaded: this file's imports carry the stand-in only.
const beforeHost = aloneGate();
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

const TENANT = "t_try_mand0001";
const RP = "cloud.test", ORIGIN = `https://${RP}`;
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

function world() {
  const cloud = new Database(":memory:");
  for (const f of readdirSync("cloud/migrations").sort()) cloud.exec(readFileSync(`cloud/migrations/${f}`, "utf8"));
  cloud.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, 'Mandate Co', 'en', '2026-11-01')").run(TENANT, "mandate-co");
  const object = new Database(":memory:");
  const storage = { ...sqliteDoStorage(object), deleteAll: async () => undefined };
  storage.sql.exec("CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  const AWX_FX = {
    quote: async () => ({ ok: false as const, reason: "switched_off" as const }),
    payout: async (a: { amount: string; currency: string; terms_sha256: string }): Promise<PayoutAnswerIn> => ({ ok: true, transfer_id: `tr-${a.terms_sha256.slice(0, 12)}`, status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: `req-${a.terms_sha256.slice(0, 8)}` }),
    payoutSimulate: async () => ({ ok: false as const, reason: "no_transfer" }),
  };
  return { object, env: { RP_ID: RP, ORIGIN, DB: d1(cloud), AWX_FX } as never, ctx: { storage } as never };
}

const MANDATE: TaskMandate = {
  agent: "treasury", purpose: "November supplier invoices", kinds: ["invoice_payment"], invoice_month: "2026-11",
  currency: "EUR", total: "500.00", payees: ["Bergtex Textil GmbH"], from: "2026-11-01", until: "2026-11-30", status: "active",
};

describe("task mandates in Purser Cloud's engine (its Durable Object)", () => {
  it("the engine's host installs the full gate: before it loads, this file has only the stand-in", () => {
    expect(beforeHost).toBe(failClosed);
    expect(aloneGate()).not.toBe(failClosed);
  });

  it("a mandate the CFO grants with the passkey: inside it the agent pays alone; outside it the payment waits for the CFO", async () => {
    const w = world();
    const { api } = await openHost(w.ctx, w.env, TENANT);
    const phone = new FakeAuthenticator();
    let counter = 0;
    const sign = (p: { challenge: string }) => phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
    const st = await api.passkeyStart({ rpId: RP, origin: ORIGIN });
    expect(await api.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "CFO", person: "u_cfo" })).toMatchObject({ ok: true });

    // The grant: one policy change of task_mandate.nov-suppliers, filed in the company's ledger and signed by the CFO.
    // (The Cloud has no route that files one yet; the engine's own approve route signs it, as it signs the stop.)
    const db = w.object as unknown as DB;
    const value = canonicalMandate(MANDATE);
    const filed = proposePolicyChange(db, { changes: [{ key: "task_mandate.nov-suppliers", to: value }], reason: "task mandate nov-suppliers" }, "human", new Date());
    const grant = (await api.proposal(filed.proposal_id))!;
    expect(await api.approve({ proposal_id: grant.id, terms_sha256: grant.terms_sha256, credential: sign(grant) })).toMatchObject({ status: "approved" });
    expect((db.prepare("SELECT value FROM settings WHERE key = 'task_mandate.nov-suppliers'").get() as { value: string }).value).toBe(value);

    // Inside the mandate: EUR 321.00 to Bergtex, an invoice of November, paid alone; the approval names the mandate.
    const a = await api.compose({ supplier_key: "bergtex", invoice_no: "INV-M-1", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
    if ("refused" in a) throw new Error(a.refused.message);
    const paid = await api.propose(a.invoice!.id);
    if (!paid.ok) throw new Error(paid.reason);
    expect(paid).toMatchObject({ alone: expect.anything(), proposal: { status: "EXECUTED" } });
    const within = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.within_limit' AND subject = ?").get(paid.proposal.id) as { payload_json: string };
    expect(JSON.parse(within.payload_json)).toMatchObject({ mandate: "nov-suppliers" });

    // Outside it: a supplier on file the mandate does not name, within the limit to pay alone and clean otherwise. Not
    // paid alone: the refusal recorded with its reason, and the payment waits for the CFO's Face ID.
    const other = SEEDED_SUPPLIERS.find((x) => x.key !== "bergtex")!;
    const b = await api.compose({ supplier_key: other.key, invoice_no: "INV-M-2", amount: "240.00", issue_date: day(0), due_date: day(14), iban: other.iban });
    if ("refused" in b) throw new Error(b.refused.message);
    const waits = await api.propose(b.invoice!.id);
    if (!waits.ok) throw new Error(waits.reason);
    expect(waits.alone).toBeUndefined();
    expect(waits.proposal.status).toBe("PENDING_APPROVAL");
    const refused = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'task_mandate.refused' AND subject = ?").get(waits.proposal.id) as { payload_json: string } | undefined;
    expect(JSON.parse(refused?.payload_json ?? "{}")).toMatchObject({ mandate: "nov-suppliers", code: "mandate_payee" });
    expect((await api.status()).chains).toEqual({ audit: true, ledger: true });
  });
});
