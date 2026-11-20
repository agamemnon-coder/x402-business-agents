// A /try company's engine in its Durable Object (cloud/src/engine/hostWorker.ts openHost), walked through every action
// of its interface in plain Node: the object's storage is the stand-in of test/support/doStorage.ts, the cloud's database
// a D1 stand-in over better-sqlite3 with the cloud's migrations, its archive an R2 stand-in in memory, and kit11's
// AwxFx binding a stand-in that answers the quote and the sandbox payout. What is asserted is what the visitor and the
// records see: the signed payment paid once on the simulated bank and asked of the sandbox with the signed hash, the
// agent's own payment within the limit asked the same way, the archive's files under the company in R2, the records'
// exports, and each refusal in the engine's own words.
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { D1Like, R2Like } from "../cloud/src/store.js";
import type { PayoutAnswerIn, SimulateIn } from "../cloud/src/engine/livePayout.js";
import { SEEDED_SUPPLIERS } from "../src/engine/tryWorld.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { sqliteDoStorage } from "./support/doStorage.js";

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

/** An R2 bucket in memory: what the archive and the read model's documents are put in when the deployment has one. */
function r2(): R2Like & { keys(): string[] } {
  const kept = new Map<string, Uint8Array>();
  return {
    put: async (k, v) => { kept.set(k, new Uint8Array(v)); },
    get: async (k) => { const b = kept.get(k); return b ? { arrayBuffer: async () => b.slice().buffer } : null; },
    head: async (k) => (kept.has(k) ? {} : null),
    delete: async (k) => { kept.delete(k); },
    list: async ({ prefix }) => ({ objects: [...kept.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    keys: () => [...kept.keys()],
  };
}

const TENANT = "t_try_walk0001";
const RP = "cloud.test", ORIGIN = `https://${RP}`;
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

function world(o: { payout?: boolean } = {}) {
  const cloud = new Database(":memory:");
  for (const f of readdirSync("cloud/migrations").sort()) cloud.exec(readFileSync(`cloud/migrations/${f}`, "utf8"));
  cloud.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, 'Walk Co', 'en', '2026-11-01')").run(TENANT, "walk-co");
  if (o.payout) cloud.prepare("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_payout', 'on', '2026-11-01')").run();
  const object = new Database(":memory:");
  const storage = { ...sqliteDoStorage(object), deleteAll: async () => undefined };
  storage.sql.exec("CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  const asked: { what: string; a: unknown }[] = [];
  const AWX_FX = {
    quote: async (a: unknown) => { asked.push({ what: "quote", a }); return { ok: false as const, reason: "switched_off" as const }; },
    payout: async (a: { amount: string; currency: string; terms_sha256: string }): Promise<PayoutAnswerIn> => {
      asked.push({ what: "payout", a });
      return { ok: true, transfer_id: `tr-${a.terms_sha256.slice(0, 12)}`, status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: `req-${a.terms_sha256.slice(0, 8)}` };
    },
    payoutSimulate: async (a: { terms_sha256: string }): Promise<SimulateIn> => { asked.push({ what: "simulate", a }); return { ok: true, transfer_id: `tr-${a.terms_sha256.slice(0, 12)}`, status: "PAID" }; },
  };
  const bucket = r2();
  return { cloud, storage, asked, bucket, env: { RP_ID: RP, ORIGIN, DB: d1(cloud), DOCS: bucket, AWX_FX, ENGINE_CLAUDE: "on" } as never, ctx: { storage } as never };
}

describe("a /try company's engine through its interface", () => {
  it("a signed payment is paid once and asked of the sandbox with its hash; the records, the archive in R2 and the exports follow", async () => {
    const w = world({ payout: true });
    const { api } = await openHost(w.ctx, w.env, TENANT);
    // ENGINE_CLAUDE on, but no key: the parser reads.
    expect(await api.status()).toMatchObject({ mode: "test_money" });
    await api.seed();
    expect((await api.suppliers()).map((s) => s.key)).toEqual(SEEDED_SUPPLIERS.map((s) => s.key));

    // An invoice through the inbox, then the visitor's approval passkey.
    const up = await api.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf", mime: "application/pdf" });
    expect(up).toMatchObject({ kind: "invoice", invoice: { vendor: "Bergtex Textil GmbH", total: "1850.00" } });
    const id = up.invoice!.id;
    expect(await api.invoice(id)).toMatchObject({ id, status: "ready" });
    expect(await api.invoice("AP-9999")).toBeNull();
    const phone = new FakeAuthenticator();
    const st = await api.passkeyStart({ rpId: RP, origin: ORIGIN });
    const fin = await api.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "Visitor", person: "u_visitor" });
    expect(fin).toMatchObject({ ok: true, how: "first" });

    // Filed for the visitor's signature (over the company's limit to pay alone), approved and held for the one pay route.
    const p = await api.propose(id);
    if (!p.ok) throw new Error(p.reason);
    expect(p).not.toHaveProperty("alone");
    expect(await api.proposal(p.proposal.id)).toMatchObject({ id: p.proposal.id, status: "PENDING_APPROVAL" });
    const credential = phone.sign({ challenge: p.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    expect(await api.approve({ proposal_id: p.proposal.id, terms_sha256: p.proposal.terms_sha256, credential, hold: true })).toMatchObject({ status: "approved", held: true });
    const terms = (await api.terms(p.proposal.id))!;
    const paid = await api.paySigned(p.proposal.id, terms.terms as unknown as Record<string, unknown>, credential);
    expect(paid).toMatchObject({ outcome: "paid", airwallex_payout: { source: "airwallex-sandbox", status: "IN_APPROVAL", amount: "1850.00", currency: "EUR", terms_sha256: p.proposal.terms_sha256 } });
    expect(w.asked.filter((x) => x.what === "payout").map((x) => x.a)).toEqual([expect.objectContaining({ company: TENANT, terms_sha256: p.proposal.terms_sha256, amount: "1850.00", currency: "EUR" })]);
    // Again: paid once, the kept note, the sandbox not asked a second time.
    const again = await api.paySigned(p.proposal.id, terms.terms as unknown as Record<string, unknown>, credential);
    expect(again).toMatchObject({ outcome: "paid_once", airwallex_payout: { source: "airwallex-sandbox" } });
    expect(w.asked.filter((x) => x.what === "payout")).toHaveLength(1);
    // Changed terms are not paid, and the sandbox is not asked.
    const bad = await api.paySigned(p.proposal.id, { ...terms.terms as unknown as Record<string, unknown>, amount: "1.00" }, credential);
    expect(bad).not.toHaveProperty("airwallex_payout");
    expect(await api.paySigned("P-9999", {}, credential)).toBeNull();
    // The sandbox's simulation moves the transfer to PAID; the note says so.
    expect(await api.payoutSimulate(p.proposal.id)).toMatchObject({ ok: true, note: { status: "PAID" } });
    expect(await api.retry(p.proposal.id)).toMatchObject({ status: "nothing_to_retry" });

    // The records: the events, the archive (in the R2 bucket, under the company), the exports.
    const ev = await api.events(0, 200);
    expect(ev.items.length).toBeGreaterThan(3);
    const synced = await api.sync();
    expect(synced).toMatchObject({ fed: true, error: null });
    const files = await api.vaultFiles();
    expect(files.length).toBeGreaterThan(0);
    const pdf = files.find((f) => f.path.endsWith(".pdf"))!;
    expect(Buffer.from((await api.vaultFile(pdf.path))!).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await api.vaultFile("not/in/the/index.pdf")).toBeNull();
    expect(w.bucket.keys().some((k) => k.startsWith(`t/${TENANT}/vault/`))).toBe(true);
    expect(w.bucket.keys().every((k) => k.startsWith(`t/${TENANT}/`))).toBe(true);
    // Nothing went to D1's blob table: with R2 at hand it is never even made.
    expect(w.cloud.prepare("SELECT name FROM sqlite_master WHERE name = 'cloud_blobs'").get()).toBeUndefined();
    const batch = await api.exportBatch();
    expect(batch).toMatchObject({ format: "purser.cloud-sync/v1" });
    expect(Buffer.from(await api.exportPdf()).subarray(0, 5).toString()).toBe("%PDF-");

    // The visitor erased: their approval key is revoked.
    expect(await api.forgetPasskey("u_visitor")).toEqual({ revoked: 1 });
  });

  it("the agent's own payment within the company's limit is paid alone and asked of the sandbox; off, it says why not", async () => {
    for (const on of [true, false]) {
      const w = world({ payout: on });
      const { api } = await openHost(w.ctx, w.env, TENANT);
      const up = await api.compose({ supplier_key: "bergtex", invoice_no: "INV-4321", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
      if ("refused" in up) throw new Error(up.refused.message);
      const p = await api.propose(up.invoice!.id);
      if (!p.ok) throw new Error(p.reason);
      expect(p, `payout ${on}`).toMatchObject({ alone: expect.anything(), proposal: { status: "EXECUTED" } });
      expect(p.airwallex_payout).toEqual(on
        ? expect.objectContaining({ source: "airwallex-sandbox", amount: "321.00", currency: "EUR" })
        : expect.objectContaining({ source: "simulated", reason: "switched_off" }));
    }
  });

  it("what the engine will not do comes back in its own words", async () => {
    const w = world();
    const { api } = await openHost(w.ctx, w.env, TENANT);
    const typed = await api.compose({ supplier_key: "nobody", invoice_no: "INV-1", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
    expect(typed).toMatchObject({ refused: { field: "supplier_key" } });
    expect(await api.clearHold("AP-0001")).toMatchObject({ ok: false });
    expect(await api.rejectHold("AP-0001")).toMatchObject({ ok: false });
    expect(await api.negotiated("AP-0042", { original_id: null, original_invoice_no: "X-1", original_amount: "1.00", agreement_sha256: "0".repeat(64), turns: 1 })).toMatchObject({ ok: false });
    expect(await api.addSupplier("AP-0001", { by: "Visitor", how: "called them on the number we have on file", address: { street: "Main St 1", city: "Utrecht", postcode: "3511 AA" } })).toMatchObject({ ok: false });
    expect(await api.proposeBatch(["AP-0042"])).toMatchObject({ ok: false });
    expect(await api.proposeSecondKey([{ key: "approval.second_key_eur", to: "5000" }])).toHaveProperty("ok");
    expect(await api.securityKeyStart({ label: "Visitor", rp: { rpId: RP, origin: ORIGIN } })).toMatchObject({ ok: false });
    expect(await api.securityKeyFinish({ label: "Visitor", credential: {} })).toMatchObject({ ok: false });
    // Money in on the simulated bank (no gateway): recorded and booked.
    expect(await api.depositIn({ amountCents: 2_500, reference: "PURSER-IN-TEST", payer: "Test customer (simulation)" })).toMatchObject({ ok: true, amount: "25.00", currency: "USD" });
    // No transfer at the sandbox for a proposal that was never paid there.
    expect(await api.payoutSimulate("P-0001")).toMatchObject({ ok: false, reason: "no_transfer" });
  });
});
