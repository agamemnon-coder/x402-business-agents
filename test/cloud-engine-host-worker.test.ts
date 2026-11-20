// The engine inside a company's Durable Object (cloud/src/engine/hostWorker.ts openHost), in plain Node: the object's
// storage is the stand-in of test/support/doStorage.ts, the cloud's database a D1 stand-in over better-sqlite3 with the
// cloud's migrations, and Airwallex's quote and payout a stand-in binding. It opens only for a company the cloud has; it
// seeds the stand-in bank once in the object's life and keeps the bank in the object's own table, so an engine opened
// again on the same storage pays from the same bank; a payment's documents go to the cloud's archive under the company;
// a /try company's quote is asked of the binding and its note comes with the terms; without a binding nothing is asked
// and the answer says why. The real engine in a real object runs in test/cloud-engine-workerd.test.ts (npm run test:d1).
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { D1Like } from "../cloud/src/store.js";
import { sqliteDoStorage } from "./support/doStorage.js";

// pdfkit's browser build, which the Worker bundles, takes its standard fonts from registerStdFonts; Node's build reads
// them from disk and has no such function.
const fonts = vi.hoisted(() => ({ registered: 0 }));
vi.mock("pdfkit", async (orig) => ({ ...(await orig<object>()), registerStdFonts: (...f: unknown[]) => { fonts.registered += f.length; } }));

const { openHost } = await import("../cloud/src/engine/hostWorker.js");

type V = string | number | null;
/** D1's interface over better-sqlite3: bind, all, first, run, a batch in one transaction, exec. */
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

function world(tenant: { id: string; name: string; language: "nl" | "en" }) {
  const cloud = new Database(":memory:");
  for (const f of readdirSync("cloud/migrations").sort()) cloud.exec(readFileSync(`cloud/migrations/${f}`, "utf8"));
  cloud.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, ?, '2026-11-01')").run(tenant.id, tenant.id.replace(/_/g, "-"), tenant.name, tenant.language);
  const object = new Database(":memory:");
  let wiped = 0;
  const storage = { ...sqliteDoStorage(object), deleteAll: async () => { wiped++; } };
  // The object's own table (./object.ts makes it before it loads the engine).
  storage.sql.exec("CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  const state = (key: string) => (storage.sql.exec("SELECT value FROM do_state WHERE key = ?", key).toArray()[0]?.value as string | undefined) ?? null;
  return { cloud, storage, state, wiped: () => wiped, ctx: { storage } as never };
}
const ENV = { RP_ID: "cloud.test", ORIGIN: "https://cloud.test" };

describe("a company's engine in its Durable Object", () => {
  it("opens only for a company the cloud has, and touches nothing of the object's storage otherwise", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    await expect(openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_other1")).rejects.toThrow("no such company");
    expect(w.state("seeded")).toBeNull();
    expect(w.state("bank")).toBeNull();
  });

  it("seeds the stand-in bank once in the object's life; opened again on the same storage it keeps that bank", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const env = { ...ENV, DB: d1(w.cloud) };
    const { api } = await openHost(w.ctx, env, "t_acme01");
    expect(fonts.registered).toBe(5); // Helvetica, its bold and oblique, Courier and its bold: once per isolate
    expect(await api.status()).toMatchObject({ mode: "test_money", passkey: null, balances: { USD: "25000.00", EUR: "35000.00" }, chains: { audit: true, ledger: true }, reader: "parser" });
    const seeded = w.state("seeded");
    expect(seeded).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const deposits = (JSON.parse(w.state("bank")!) as { deposits: unknown[] }).deposits;
    expect(deposits).toHaveLength(1);

    // A payment's conversion moves the bank; the object then keeps the bank as it stands.
    const [clean] = (await api.samples()) as { key: string }[];
    expect((await api.uploadSample(clean!.key))!.invoice).toMatchObject({ id: "AP-0001", status: "ready", vendor: "Bergtex Textil GmbH", total: "1850.00" });
    const proposed = await api.propose("AP-0001");
    expect(proposed).toMatchObject({ ok: true, proposal: { id: "P-0001", kind: "invoice_payment", status: "PENDING_APPROVAL" } });
    const bankAfter = w.state("bank");

    // The object is loaded again (a new isolate): the same ledger, the same bank, no second seed.
    const again = (await openHost(w.ctx, env, "t_acme01")).api;
    expect(w.state("seeded")).toBe(seeded);
    expect(w.state("bank")).toBe(bankAfter);
    expect((JSON.parse(w.state("bank")!) as { deposits: unknown[] }).deposits).toHaveLength(1);
    expect((await again.invoices()).map((i) => [i.id, i.status])).toEqual([["AP-0001", "waiting_cfo"]]);
    expect(fonts.registered).toBe(5);
  });

  it("files a payment's documents in the cloud's own archive under the company, with no R2 bucket: in D1", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_acme01");
    const [clean] = (await api.samples()) as { key: string }[];
    await api.uploadSample(clean!.key);
    await api.propose("AP-0001");
    const synced = await api.sync();
    expect(synced).toMatchObject({ fed: true, error: null });
    expect(synced.vault_added).toContain("Acme BV/2026/2026-Q4/Purchase invoices/Bergtex Textil GmbH/2026-11-09 BTX-2026-21 EUR 1850.00.pdf");
    const keys = (w.cloud.prepare("SELECT key FROM cloud_blobs").all() as { key: string }[]).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("t/t_acme01/vault/"))).toBe(true);
    expect(keys.every((k) => k.startsWith("t/t_acme01/"))).toBe(true);
  });

  it("without the Airwallex binding: every action on the simulated bank, labelled, and no payout to simulate", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_acme01");
    const [clean] = (await api.samples()) as { key: string }[];
    await api.uploadSample(clean!.key);
    await api.propose("AP-0001");
    const view = (await api.airwallex()) as { airwallex: unknown; invoices: { invoice_id: string; bank: string; bank_words: string }[] };
    expect(view.airwallex).toEqual({ on: false, why: "this deployment has no Airwallex gateway" });
    expect(view.invoices.map((i) => [i.invoice_id, i.bank, i.bank_words])).toEqual([["AP-0001", "simulated", "Simulated bank · test money"]]);
    expect(await api.payoutSimulate("P-0001")).toEqual({ ok: false, reason: "no_binding", note: null });
    // A company outside /try has no quote note beside its terms.
    expect(await api.terms("P-0001")).not.toHaveProperty("fx_quote");
  });

  it("wipes the object's storage on request", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_acme01");
    await api.wipe();
    expect(w.wiped()).toBe(1);
  });
});

describe("a /try company's engine with the Airwallex binding", () => {
  it("asks the binding for the quote and keeps its note beside the terms: here the recorded rate, and why", async () => {
    const w = world({ id: "t_try_abc123", name: "Try Co", language: "nl" });
    const asked: unknown[] = [];
    const AWX_FX = {
      quote: async (a: unknown) => { asked.push(["quote", a]); return { ok: false as const, reason: "day_cap" as const }; },
      payout: async (a: unknown) => { asked.push(["payout", a]); return { ok: false as const, reason: "switched_off" as const }; },
      payoutSimulate: async (a: unknown) => { asked.push(["simulate", a]); return { ok: false as const, reason: "no_transfer" as const }; },
    };
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud), AWX_FX } as never, "t_try_abc123");
    // A /try company starts with one invoice already paid; the sample comes in as the next.
    const [clean] = (await api.samples()) as { key: string }[];
    await api.uploadSample(clean!.key);
    expect((await api.invoices()).map((i) => [i.id, i.status])).toEqual([["AP-0001", "paid"], ["AP-0002", "ready"]]);
    const proposed = await api.propose("AP-0002");
    expect(proposed).toMatchObject({ ok: true, proposal: { id: "P-0001" } });
    // The facts in the company's language.
    expect((proposed as { proposal: { facts: [string, string][] } }).proposal.facts[0]).toEqual(["Bedrag", "€ 1.850,00"]);
    expect(asked).toEqual([["quote", { company: "t_try_abc123", buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "370.00" }]]);
    const terms = (await api.terms("P-0001")) as unknown as { terms: { conversion: { quote_id: string } }; fx_quote: Record<string, string> };
    expect(terms.fx_quote).toMatchObject({ source: "recorded", quote_id: terms.terms.conversion.quote_id, reason: "day_cap", buy_currency: "EUR", buy_amount: "370.00" });
    // A payment not yet signed has no transfer at the sandbox to move to PAID: said so, and the binding is not asked.
    expect(await api.payoutSimulate("P-0001")).toMatchObject({ ok: false, reason: "no_transfer" });
    expect(asked).toHaveLength(1);
  });
});

describe("the relying party a passkey is made for", () => {
  const enrolmentRp = (w: ReturnType<typeof world>) => w.storage.sql.exec("SELECT rp_id, origin FROM passkey_enrolments WHERE status = 'OPEN'").toArray()[0];

  it("is the object's own, or one of the cloud's known hosts at its own https origin; never one the page names freely", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_acme01");

    await api.passkeyStart(undefined);
    expect(enrolmentRp(w)).toEqual({ rp_id: "cloud.test", origin: "https://cloud.test" });
    // A known host at its own origin is taken (the cloud serves the engine on more than one address).
    await api.passkeyStart({ rpId: "purser-try.max-31b.workers.dev", origin: "https://purser-try.max-31b.workers.dev" });
    expect(enrolmentRp(w)).toEqual({ rp_id: "purser-try.max-31b.workers.dev", origin: "https://purser-try.max-31b.workers.dev" });
    // Anything else, the object's own instead: another host, or a known host at another origin.
    for (const rp of [{ rpId: "evil.example", origin: "https://evil.example" }, { rpId: "purser-try.max-31b.workers.dev", origin: "https://evil.example" }, { rpId: "cloud.test", origin: "http://cloud.test" }]) {
      await api.passkeyStart(rp);
      expect(enrolmentRp(w)).toEqual({ rp_id: "cloud.test", origin: "https://cloud.test" });
    }
  });

  it("a security key needs the person's passkey first, whichever relying party is asked for", async () => {
    const w = world({ id: "t_acme01", name: "Acme BV", language: "en" });
    const { api } = await openHost(w.ctx, { ...ENV, DB: d1(w.cloud) }, "t_acme01");
    for (const rp of [undefined, { rpId: "evil.example", origin: "https://evil.example" }]) {
      expect(await api.securityKeyStart({ label: "Max", rp })).toEqual({ ok: false, reason: "add your passkey (Face ID) first: a security key is your second key" });
    }
    expect(w.storage.sql.exec("SELECT COUNT(*) AS n FROM security_key_windows").toArray()[0]).toEqual({ n: 0 });
  });
});
