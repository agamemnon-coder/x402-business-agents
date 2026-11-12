// The demo world (src/demoworld): three test companies built offline by the real engine and loaded into Purser Cloud
// through its own push code. These tests read the world the way a visitor does (the demo's read routes) and the way an
// auditor does (the cloud's rows, the runner's own checks), and hold it to what it says: it verifies, it reconciles to
// the cent, every state is there, nothing in it is real, everything is labelled, and two builds are the same bytes.
// No network: the engine runs on the in-memory stand-in for the rail and the parser reads the invoices.
import { createECDH, createHash, createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle } from "../cloud/src/app.js";
import { sqliteSql } from "../cloud/src/node.js";
import { verifyChains } from "../cloud/src/restore.js";
import { SCHEMA } from "../cloud/src/schema.js";
import { docBlobKey, vaultIndexKey } from "../cloud/src/sync.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { CLOSED_MONTH, WORLD_AS_OF, type DemoState } from "../src/demoworld/build.js";
import { bundleFolder, localDemo, writeBundle, type LocalDemo } from "../src/demoworld/bundle.js";
import { DEMO_OWNER, PROVENANCE, STAND_IN_SUFFIX, VAULT_YEAR, worldObjects, worldSql } from "../src/demoworld/cloud.js";
import { DEMO_COMPANIES, type Supplier } from "../src/demoworld/companies.js";
import { fixed } from "../src/demoworld/fixed.js";
import { signP256, testPasskey } from "../src/demoworld/passkey.js";
import { WORLD } from "../src/e2e/world.js";
import { closedThrough, ledgerRows, verifyLedger } from "../src/ledger/core.js";
import { trialBalance } from "../src/ledger/reports.js";
import { verifyVault, type YearIndex } from "../src/vault/build.js";
import { LocalSink } from "../src/vault/sink.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { CN, TR, UK, US } from "./fakes/fxInvoices.js";

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "demo-world-"));

let dir: string;
let demo: LocalDemo;
beforeAll(async () => {
  dir = tmp();
  demo = await localDemo(dir);
}, 120_000);
afterAll(() => { demo?.close(); rmSync(dir, { recursive: true, force: true }); });

const res = (path: string) => handle(new Request(`${demo.env.origin}${path}`), demo.env);
async function get<T = Record<string, unknown>>(path: string): Promise<T> {
  const r = await res(path);
  if (r.status !== 200) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return await r.json() as T;
}

interface Invoice { id: string; vendor: string; invoice_no: string; currency: string; total: string; status: string; doc_kind: string; doc_sha256: string; paid_at: string | null; proposal_id: string | null; credit_accepted_at: string | null; provenance: string; read_by: string; findings: { code: string }[] }
interface Tx { id: string; rail: string; rail_label: string; currency: string; amount: string; moved: boolean; direction: string; eur_equivalent: string | null; proof: string | null; reconciliation: string; approval: { method: string | null; decision: string | null; terms_sha256: string | null }; invoice: { ap_id: string | null } | null }
interface TrialRow { account: string; currency: string; debit_cents: number; credit_cents: number; balance_cents: number }
const cents = (s: string) => Math.round(Number(s) * 100);

describe("the demo world, as a visitor reads it", () => {
  it("lists three test companies, in English, each named a test company", async () => {
    const list = await get<{ test_world: boolean; read_only: boolean; companies: { slug: string; name: string; language: string; counts: Record<string, number> }[] }>("/v1/demo/companies");
    expect(list.test_world).toBe(true);
    expect(list.read_only).toBe(true);
    expect(list.companies.map((c) => c.slug)).toEqual(DEMO_COMPANIES.map((c) => c.slug));
    expect(list.companies).toHaveLength(3);
    for (const c of list.companies) {
      expect(c.name).toMatch(/ \(test company\)$/);
      expect(c.language).toBe("en");
      expect(c.counts.invoices).toBeGreaterThanOrEqual(8);
      expect(c.counts.invoices).toBeLessThanOrEqual(12);
    }
    expect(new Set(DEMO_COMPANIES.map((c) => `${c.a.name}|${c.foreign.currency}|${c.eurFloor}`)).size).toBe(3); // three profiles, not one three times
    expect((await get<{ demo_companies: number }>("/v1/health")).demo_companies).toBe(3);
  });

  it("shows every state in every company: paid, waiting for the CFO, held as fraud, duplicate, new supplier, foreign currency with FX, credit note", async () => {
    for (const c of demo.companies) {
      const invoices = (await get<{ items: Invoice[] }>(`/v1/demo/${c.slug}/invoices`)).items;
      const txs = (await get<{ items: Tx[] }>(`/v1/demo/${c.slug}/transactions`)).items;
      const of = (s: DemoState) => invoices.find((i) => i.id === c.states[s])!;
      const codes = (i: Invoice) => i.findings.map((f) => f.code);
      expect(new Set(Object.values(c.states)).size).toBe(8);

      expect(of("paid").status).toBe("paid");
      expect(of("paid_closed_month").status).toBe("paid");
      expect(of("paid_closed_month").paid_at!.slice(0, 7)).toBe(CLOSED_MONTH);
      expect(of("paid").paid_at!.slice(0, 7) > CLOSED_MONTH).toBe(true);

      const fx = of("paid_foreign_currency");
      expect(fx.status).toBe("paid");
      expect(fx.currency).not.toBe("EUR");
      const legs = txs.filter((t) => t.rail === "airwallex_fx");
      expect(legs.map((t) => t.currency).sort()).toEqual(["EUR", fx.currency].sort());
      for (const leg of legs) expect(leg.eur_equivalent).toMatch(/^\d+\.\d{2}$/);
      expect(legs.find((t) => t.currency === fx.currency)!.amount).toBe(fx.total);
      expect(txs.find((t) => t.invoice?.ap_id === fx.id)).toMatchObject({ rail: "airwallex_transfer", currency: fx.currency, amount: fx.total, moved: true });

      expect(of("waiting_for_cfo")).toMatchObject({ status: "waiting_cfo", proposal_id: expect.stringMatching(/^P-\d+$/) });
      expect(of("held_possible_fraud").status).toBe("blocked");
      expect(codes(of("held_possible_fraud"))).toContain("possible_fraud");
      expect(of("duplicate_refused").status).toBe("blocked");
      expect(codes(of("duplicate_refused"))).toContain("duplicate");
      expect(of("new_supplier").status).toBe("needs_vendor");
      expect(codes(of("new_supplier"))).toContain("new_supplier");
      expect(of("credit_note")).toMatchObject({ doc_kind: "credit_note", credit_accepted_at: expect.stringMatching(/^2026-11-/) });
      // Nothing that was refused or is waiting was paid: only the five paid invoices have a payment.
      const paid = invoices.filter((i) => i.status === "paid").map((i) => i.id).sort();
      expect(paid).toHaveLength(5);
      expect(txs.filter((t) => t.rail === "airwallex_transfer").map((t) => t.invoice!.ap_id).sort()).toEqual(paid);
    }
  });

  it("serves every invoice's own PDF, with the bytes its hash names", async () => {
    for (const c of demo.companies) {
      for (const i of (await get<{ items: Invoice[] }>(`/v1/demo/${c.slug}/invoices`)).items) {
        const r = await res(`/v1/demo/${c.slug}/invoices/${i.id}/document`);
        expect(r.status).toBe(200);
        const bytes = new Uint8Array(await r.arrayBuffer());
        expect(sha256(bytes)).toBe(i.doc_sha256);
        expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
        expect(r.headers.get("content-type")).toBe("application/pdf");
      }
    }
  });

  it("every payment was approved with the company's test passkey over its exact terms, and the engine verified the signature", async () => {
    for (const [n, c] of demo.companies.entries()) {
      const built = demo.built[n]!;
      const txs = (await get<{ items: Tx[] }>(`/v1/demo/${c.slug}/transactions`)).items;
      expect(txs.length).toBeGreaterThan(0);
      for (const t of txs) expect(t.approval).toMatchObject({ method: "passkey", decision: "APPROVED", terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      // In the runner's own ledger: one enrolled passkey (this company's), and no approval by any other method.
      const keys = built.db.prepare("SELECT credential_id FROM passkeys").all() as { credential_id: string }[];
      expect(keys.map((k) => k.credential_id)).toEqual([built.passkey.credential_id]);
      expect(built.passkey.label).toContain("test passkey");
      const approvals = built.db.prepare("SELECT method, COUNT(*) AS n FROM approvals GROUP BY method").all() as { method: string; n: number }[];
      expect(approvals).toEqual([{ method: "passkey", n: expect.any(Number) }]);
      expect(approvals[0]!.n).toBeGreaterThanOrEqual(8); // the policy, three suppliers, five payments (the sixth waits)
    }
    expect(new Set(demo.built.map((b) => b.passkey.credential_id)).size).toBe(3);
  });
});

describe("the demo world, checked the way the product checks itself", () => {
  it("both hash chains verify, in the runner's ledger and in the cloud's copy, and they are the same chains", async () => {
    for (const [n, c] of demo.companies.entries()) {
      const built = demo.built[n]!;
      expect(verifyLedger(built.db)).toMatchObject({ ok: true });
      expect(verifyAuditChain(built.db)).toMatchObject({ ok: true });
      const audit_rows = await demo.env.sql.all("SELECT seq, ts, actor, event, subject, payload_json, prev_hash, row_hash FROM audit_rows WHERE tenant_id = ? ORDER BY seq", [c.tenant_id]);
      const ledger_entries = await demo.env.sql.all<{ entry_id: number; entry_hash: string }>("SELECT entry_id, entry_json, prev_hash, entry_hash FROM ledger_entries WHERE tenant_id = ? ORDER BY entry_id", [c.tenant_id]);
      expect(await verifyChains({ audit_rows, ledger_entries })).toBeNull();
      const own = ledgerRows(built.db);
      expect(ledger_entries.map((e) => e.entry_hash)).toEqual(own.map((e) => e.entry_hash));
      expect(audit_rows).toHaveLength((built.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n);
    }
  });

  it("the books balance to the cent, and payables, payments and the ledger agree", async () => {
    for (const [n, c] of demo.companies.entries()) {
      const at = `/v1/demo/${c.slug}`;
      const trial = (await get<{ rows: TrialRow[] }>(`${at}/reports/trial`)).rows;
      // Debits equal credits in every currency, and the cloud's trial balance is the runner's own.
      for (const cur of new Set(trial.map((r) => r.currency))) {
        const rows = trial.filter((r) => r.currency === cur);
        expect(rows.reduce((s, r) => s + r.debit_cents, 0), `${c.slug} ${cur}`).toBe(rows.reduce((s, r) => s + r.credit_cents, 0));
      }
      const pick = (rows: TrialRow[]) => rows.map((r) => [r.account, r.currency, r.debit_cents, r.credit_cents]).sort();
      expect(pick(trial)).toEqual(pick(trialBalance(demo.built[n]!.db)));
      const balance = (await get<{ by_currency: Record<string, { balanced: boolean }> }>(`${at}/reports/balance`)).by_currency;
      for (const b of Object.values(balance)) expect(b.balanced).toBe(true);

      const invoices = (await get<{ items: Invoice[] }>(`${at}/invoices`)).items;
      const payments = (await get<{ items: { status: string; currency: string; amount: string }[] }>(`${at}/payments`)).items;
      const txs = (await get<{ items: Tx[] }>(`${at}/transactions`)).items;
      const currencies = new Set(invoices.map((i) => i.currency));
      for (const cur of currencies) {
        const paidInvoices = invoices.filter((i) => i.status === "paid" && i.currency === cur).reduce((s, i) => s + cents(i.total), 0);
        const paidPayments = payments.filter((p) => p.currency === cur).reduce((s, p) => s + cents(p.amount), 0);
        const moved = txs.filter((t) => t.rail === "airwallex_transfer" && t.currency === cur).reduce((s, t) => s + cents(t.amount), 0);
        const payable = trial.find((r) => r.account === "2100" && r.currency === cur);
        // What was paid: the invoices, the payments, the rail's movements and the debit side of accounts payable.
        expect(paidPayments, `${c.slug} ${cur} payments`).toBe(paidInvoices);
        expect(moved, `${c.slug} ${cur} moved`).toBe(paidInvoices);
        expect(payable?.debit_cents ?? 0, `${c.slug} ${cur} ledger`).toBe(paidInvoices);
      }
      expect(payments.every((p) => p.status === "PAID")).toBe(true);
      // What is still owed in the books: the one invoice that waits for the CFO, in the payables report and on 2100.
      const waiting = invoices.find((i) => i.id === c.states.waiting_for_cfo)!;
      const open = await get<{ items: { open_cents: number; currency: string }[]; totals: Record<string, Record<string, number>> }>(`${at}/reports/payables`);
      expect(open.items.map((i) => [i.currency, i.open_cents])).toEqual([["EUR", cents(waiting.total)]]);
      expect(-trial.find((r) => r.account === "2100" && r.currency === "EUR")!.balance_cents).toBe(cents(waiting.total));
      // Every movement is booked, proven by the (stand-in) rail's id and approved: the register's own check is clean.
      const summary = await get<{ check: { rows: number; moved: number; unreconciled: number; without_approval: string[]; without_booking: string[]; without_proof: string[]; amount_mismatch: string[] } }>(`${at}/transactions/summary`);
      expect(summary.check).toEqual({ rows: txs.length, moved: txs.length, unreconciled: 0, without_approval: [], without_booking: [], without_proof: [], amount_mismatch: [] });
      expect(txs.every((t) => t.reconciliation === "matched")).toBe(true);
    }
  });

  it("one month is closed in every company's books, with entries on both sides of it", async () => {
    for (const [n, c] of demo.companies.entries()) {
      expect(closedThrough(demo.built[n]!.db)).toBe(CLOSED_MONTH);
      const months = (await demo.env.sql.all<{ m: string }>("SELECT DISTINCT substr(posting_date, 1, 7) AS m FROM ledger_entries WHERE tenant_id = ? ORDER BY m", [c.tenant_id])).map((r) => r.m);
      expect(months).toEqual([CLOSED_MONTH, "2026-11"]);
    }
  });

  it("the vault's hashes match: every filed PDF is in the document store under its own hash, and is served", async () => {
    for (const [n, c] of demo.companies.entries()) {
      const built = demo.built[n]!;
      expect(await verifyVault(new LocalSink(built.vaultDir), built.spec.name, [VAULT_YEAR])).toMatchObject({ bad: [] });
      const index = JSON.parse(Buffer.from((await demo.env.blobs.get(vaultIndexKey(c.tenant_id, VAULT_YEAR)))!).toString()) as YearIndex;
      expect(index.company).toBe(c.name);
      expect(index.files).toHaveLength(c.counts.vault_files);
      const kinds = index.files.map((f) => f.kind);
      expect(new Set(kinds)).toEqual(new Set(["invoice", "receipt", "month", "suppliers"]));
      expect(kinds.filter((k) => k === "receipt")).toHaveLength(5); // one receipt per paid invoice
      expect(kinds.filter((k) => k === "invoice")).toHaveLength(10); // every document that came in, blocked ones too
      expect(index.files.find((f) => f.kind === "month")!.path).toContain(CLOSED_MONTH);
      for (const f of index.files) {
        const stored = await demo.env.blobs.get(docBlobKey(c.tenant_id, f.sha256));
        expect(stored && sha256(stored), f.path).toBe(f.sha256);
        expect(stored!.length).toBe(f.bytes);
        const r = await res(`/v1/demo/${c.slug}/documents/${f.sha256}`);
        expect(r.status, f.path).toBe(200);
        expect(sha256(new Uint8Array(await r.arrayBuffer()))).toBe(f.sha256);
      }
      // The invoices in the vault are the invoices in the inbox: the same bytes.
      const invoices = (await get<{ items: Invoice[] }>(`/v1/demo/${c.slug}/invoices`)).items;
      expect(index.files.filter((f) => f.kind === "invoice").map((f) => f.sha256).sort()).toEqual(invoices.map((i) => i.doc_sha256).sort());
    }
  });
});

describe("the demo world holds nothing real and says what it is", () => {
  /** Every invoice text the repository's fixtures hold: the only source of a supplier's name and bank details. */
  const fixtures = [
    EN, NL, DE, US, CN, UK, TR, ...WORLD.flatMap((c) => c.invoices.map((i) => i.text)),
    ...["fixtures", "fixtures/hard"].flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".txt")).map((f) => readFileSync(join(d, f), "utf8"))),
  ].join("\n");
  const fixtureLines = new Set(fixtures.split("\n").map((l) => l.trim()));

  it("every supplier's name, address, VAT id and bank details come from the test fixtures, word for word", () => {
    const suppliers = new Map<string, Supplier>();
    for (const c of DEMO_COMPANIES) for (const s of [c.a, c.b, c.c]) suppliers.set(s.name, s);
    expect(suppliers.size).toBeGreaterThanOrEqual(6);
    for (const s of suppliers.values()) {
      expect(fixtureLines.has(s.name), s.name).toBe(true);
      for (const v of [s.iban, s.bic, ...(s.address ? [s.address] : []), ...(s.vatId ? [s.vatId] : [])]) expect(fixtures.includes(v), `${s.name}: ${v}`).toBe(true);
    }
    for (const c of DEMO_COMPANIES) {
      expect(fixtures.includes(c.forged.iban), c.forged.iban).toBe(true);
      // A foreign supplier's invoice is its fixture, with only the two dates filled in.
      for (const line of c.foreign.text({ date: "2 November 2026", due: "30 November 2026" }).split("\n").filter((l) => !/^(Invoice|Due) date:/.test(l))) expect(fixtureLines.has(line), line).toBe(true);
    }
  });

  it("the cloud holds no full account number, no e-mail address, one role as its only person, and nothing to sign in with", async () => {
    const ids = demo.companies.map((c) => c.tenant_id);
    const sql = await worldSql(demo.env.sql, ids);
    for (const c of DEMO_COMPANIES) {
      for (const iban of [c.a.iban, c.b.iban, c.c.iban, c.forged.iban, "TR33 0006 1005 1978 6457 8413 26"]) {
        expect(sql.includes(iban), iban).toBe(false);
        expect(sql.includes(iban.replace(/ /g, "")), iban).toBe(false);
      }
    }
    expect(sql).not.toMatch(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,}/); // nothing shaped like an IBAN
    expect(sql).not.toContain("@");
    expect(sql).not.toMatch(/\/dev\/shm|\/tmp\/|\/home\//); // no path of the machine that built it
    expect(await demo.env.sql.all("SELECT DISTINCT id, display_name, email, role FROM users")).toEqual([{ id: DEMO_OWNER.id, display_name: DEMO_OWNER.display_name, email: null, role: "owner" }]);
    for (const table of ["credentials", "api_keys", "enrolments", "challenges", "webhooks", "inbound_mail", "push_log", "awx_accounts", "exports", "security_events"]) {
      expect((await demo.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n, table).toBe(0);
    }
  });

  it("every row says how it was made: stand-in, never sandbox; read by the parser, never by a model", async () => {
    for (const c of demo.companies) {
      const at = `/v1/demo/${c.slug}`;
      for (const list of ["invoices", "vendors", "payments"]) {
        const items = (await get<{ items: { provenance?: string }[] }>(`${at}/${list}`)).items;
        expect(items.length).toBeGreaterThan(0);
        for (const i of items) expect(i.provenance, list).toBe(PROVENANCE);
      }
      const txs = (await get<{ items: Tx[] }>(`${at}/transactions`)).items;
      for (const t of txs) {
        expect(t.rail_label.endsWith(STAND_IN_SUFFIX), t.rail_label).toBe(true);
        expect(t.proof).toMatch(/^(tr|conv)_\d+$/); // the stand-in's own counters, not an id any real rail gave
      }
      for (const i of (await get<{ items: Invoice[] }>(`${at}/invoices`)).items) expect(i.read_by).toBe("parser");
    }
    expect(PROVENANCE).toBe("stand-in");
    const sql = await worldSql(demo.env.sql, demo.companies.map((c) => c.tenant_id));
    expect(sql).not.toMatch(/sandbox/i);
    expect(sql).not.toMatch(/claude|anthropic/i);
    expect(sql).toContain("stand-in test money, no real account");
  });

  it("every document is a PDF the demo can serve", async () => {
    const docs = await demo.env.sql.all<{ mime: string; size: number }>("SELECT mime, size FROM documents");
    expect(docs.length).toBe(demo.companies.reduce((s, c) => s + c.counts.documents, 0));
    for (const d of docs) {
      expect(d.mime).toBe("application/pdf");
      expect(d.size).toBeLessThan(5 * 1024 * 1024);
    }
  });
});

describe("the demo world, built twice", () => {
  it("gives the same bytes: the same SQL and the same objects, whatever folder and moment it is built in", async () => {
    const other = tmp();
    const again = await localDemo(other);
    try {
      const ids = demo.companies.map((c) => c.tenant_id);
      expect(await worldSql(again.env.sql, ids)).toBe(await worldSql(demo.env.sql, ids));
      const sums = async (d: LocalDemo) => (await worldObjects(d.env.sql, d.env.blobs, ids)).map((o) => `${o.key} ${sha256(o.bytes)} ${o.content_type}`);
      expect(await sums(again)).toEqual(await sums(demo));
      expect(again.companies).toEqual(demo.companies);
    } finally {
      again.close();
      rmSync(other, { recursive: true, force: true });
    }
    // Nothing in the world is dated after its own last moment: the clock of the machine that built it is not in it.
    const stamps = (await worldSql(demo.env.sql, demo.companies.map((c) => c.tenant_id))).match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g) ?? [];
    expect(stamps.length).toBeGreaterThan(500);
    expect(stamps.filter((s) => Date.parse(s) > Date.parse(WORLD_AS_OF))).toEqual([]);
  }, 120_000);

  it("the fixed clock and randomness end with the build: afterwards the real ones are back", async () => {
    const before = Date.now();
    const first = await fixed("a seed", "2026-10-01T08:00:00Z", async (clock) => {
      expect(new Date().toISOString()).toBe("2026-10-01T08:00:00.000Z");
      expect(Date.now()).toBe(Date.parse("2026-10-01T08:00:00Z"));
      expect(new Date("2026-01-02T03:04:05Z").toISOString()).toBe("2026-01-02T03:04:05.000Z"); // a given time stays that time
      clock.tick(90);
      expect(new Date().toISOString()).toBe("2026-10-01T09:30:00.000Z");
      expect(clock.now() instanceof Date).toBe(true);
      expect(() => clock.set("2026-09-30T00:00:00Z")).toThrow(/only moves forward/);
      await expect(fixed("nested", "2026-10-01T08:00:00Z", async () => 1)).rejects.toThrow(/one at a time/);
      return [randomUUID(), randomBytes(8).toString("hex"), crypto.randomUUID(), Math.random()];
    });
    expect(first[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await fixedValues()).toEqual(await fixedValues()); // the same seed, the same values
    expect(await fixedValues()).not.toEqual(first); // another seed, other values
    // Afterwards: the real clock, real randomness.
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    expect(Date.now()).toBeLessThan(before + 60_000);
    expect(randomUUID()).not.toBe(randomUUID());
    expect(crypto.randomUUID()).not.toBe(crypto.randomUUID());
    await expect(fixed("s", "2026-10-01T08:00:00Z", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(Math.abs(Date.now() - before)).toBeLessThan(60_000); // put back after a throw too
    expect(randomBytes(8).equals(randomBytes(8))).toBe(false);
  });

  it("the test passkey signs the same message the same way every time, and its signatures verify as ES256", async () => {
    const a = testPasskey("one company");
    const b = testPasskey("one company");
    const other = testPasskey("another company");
    expect(a.credentialId).toBe(b.credentialId);
    expect(a.spkiSha256).toBe(b.spkiSha256);
    expect(other.spkiSha256).not.toBe(a.spkiSha256);
    const ceremony = { challenge: "Y2hhbGxlbmdl", origin: "https://demo-world.purser.test", rpId: "demo-world.purser.test", counter: 1 };
    const s1 = a.sign(ceremony);
    expect(b.sign(ceremony).response.signature).toBe(s1.response.signature);
    expect(a.sign({ ...ceremony, counter: 2 }).response.signature).not.toBe(s1.response.signature);
    const signed = Buffer.concat([Buffer.from(s1.response.authenticatorData, "base64url"), createHash("sha256").update(Buffer.from(s1.response.clientDataJSON, "base64url")).digest()]);
    const key = createPublicKey({ format: "jwk", key: a.publicJwk });
    expect(createVerify("sha256").update(signed).verify(key, Buffer.from(s1.response.signature, "base64url"))).toBe(true);
    // Many messages, each verified by OpenSSL: the plain-arithmetic signer is a correct ES256 signer.
    for (let i = 0; i < 12; i++) {
      const msg = Buffer.from(`message ${i}`);
      const d = BigInt(`0x${createHash("sha256").update(`key ${i}`).digest("hex")}`) % (2n ** 255n) + 1n;
      const pub = testPublic(d);
      expect(createVerify("sha256").update(msg).verify(pub, signP256(d, msg)), `message ${i}`).toBe(true);
    }
  });
});

/** Four "random" values under one fixed seed. */
async function fixedValues(): Promise<unknown[]> {
  return fixed("another seed", "2026-10-01T08:00:00Z", async () => {
    return [randomUUID(), randomBytes(8).toString("hex"), crypto.randomUUID(), Math.random()];
  });
}

/** The public key of a P-256 private scalar, by OpenSSL (not by the code under test). */
function testPublic(d: bigint) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(d.toString(16).padStart(64, "0"), "hex"));
  const q = ecdh.getPublicKey();
  return createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: q.subarray(1, 33).toString("base64url"), y: q.subarray(33).toString("base64url") } });
}

describe("the demo world as a bundle for a deployment", () => {
  it("the SQL loads into an empty database that holds the schema, loads again over itself, and is the same world", async () => {
    const ids = demo.companies.map((c) => c.tenant_id);
    const text = await worldSql(demo.env.sql, ids);
    const lines = text.trim().split("\n");
    for (const l of lines) {
      expect(l).toMatch(/^(-- |INSERT INTO [a-z_]+ \(|DELETE FROM [a-z_]+ WHERE (tenant_id|id) IN \()/); // one statement a line, no transaction
      expect(Buffer.byteLength(l)).toBeLessThan(90_000); // D1 takes statements up to 100 KB
    }
    const fresh = sqliteSql(":memory:");
    try {
      await fresh.exec(SCHEMA);
      await fresh.exec(text);
      expect(await worldSql(fresh, ids)).toBe(text);
      await fresh.exec(text); // seeding again replaces the world, it does not double it
      expect(await worldSql(fresh, ids)).toBe(text);
      // A company that is not the demo's is left alone by a re-seed.
      await fresh.run("INSERT INTO tenants (id, slug, name, created_at) VALUES ('t_other', 'other', 'Other', '2026-01-01T00:00:00Z')");
      await fresh.exec(text);
      expect((await fresh.first<{ n: number }>("SELECT COUNT(*) AS n FROM tenants"))!.n).toBe(4);
    } finally {
      fresh.close();
    }
    await expect(worldSql(demo.env.sql, ["t_other"])).rejects.toThrow(/only the demo world's own companies/);
  });

  it("writes seed.sql, every object under its key, the put script and a manifest whose hashes match the files; nothing else stays behind", async () => {
    const out = join(tmp(), "bundle");
    try {
      const m = await writeBundle(out);
      expect(readdirSync(out).sort()).toEqual(["manifest.json", "r2", "r2-put.sh", "seed.sql"]);
      const ids = demo.companies.map((c) => c.tenant_id);
      expect(readFileSync(join(out, "seed.sql"), "utf8")).toBe(await worldSql(demo.env.sql, ids));
      expect(m.sql.sha256).toBe(sha256(readFileSync(join(out, "seed.sql"))));
      expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toEqual(m);
      expect(m.demo_slugs).toBe(DEMO_COMPANIES.map((c) => c.slug).join(","));
      expect(m.provenance).toBe("stand-in");
      expect(m.companies).toEqual(demo.companies);
      // 17 documents and one vault index per company.
      expect(m.objects).toHaveLength(demo.companies.reduce((s, c) => s + c.counts.documents + 1, 0));
      const script = readFileSync(join(out, "r2-put.sh"), "utf8");
      for (const o of m.objects) {
        expect(o.key).toMatch(/^t\/t_demo_[a-z_]+\/(docs\/[0-9a-f]{64}|vault\/2026\/index\.json)$/);
        expect(sha256(readFileSync(join(out, o.file)))).toBe(o.sha256);
        expect(script).toContain(`r2 object put "$BUCKET"/'${o.key}' --file '${o.file}' --content-type '${o.content_type}' --remote "$@"`);
      }
      expect(script.split("\n").filter((l) => l.includes("r2 object put"))).toHaveLength(m.objects.length);
      // No ledger file, no key file, no working folder.
      const all = readdirSync(out, { recursive: true }) as string[];
      expect(all.filter((f) => /\.(db|sqlite|pem|key)$|ledger/.test(f))).toEqual([]);
      expect(existsSync(join(out, "work"))).toBe(false);
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  }, 120_000);

  it("is never written inside the repository", () => {
    expect(() => bundleFolder("data/demo-bundle")).toThrow(/inside the repository/);
    expect(() => bundleFolder(".")).toThrow(/inside the repository/);
    expect(() => bundleFolder(join(process.cwd(), "anything", "deeper"))).toThrow(/inside the repository/);
    expect(bundleFolder(join(tmpdir(), "purser-demo-bundle"))).toContain("purser-demo-bundle");
  });

  it("docs/cloud.md gives the command, the companies and the two loading commands as the code has them", () => {
    const doc = readFileSync("docs/cloud.md", "utf8").replace(/\s+/g, " ");
    expect(doc).toContain("npm run cloud:seed-demo -- --out");
    for (const c of DEMO_COMPANIES) {
      expect(doc).toContain(`\`${c.slug}\``);
      expect(doc).toContain(c.name);
    }
    for (const c of DEMO_COMPANIES) expect(doc).toContain(`keeps EUR ${c.eurFloor} in reserve; buys in ${c.foreign.currency}`);
    expect(CLOSED_MONTH).toBe("2026-10");
    expect(doc).toContain("October 2026 is closed");
    expect(new Date(WORLD_AS_OF).toUTCString()).toBe("Tue, 10 Nov 2026 09:30:00 GMT");
    expect(doc).toContain("the world's last moment is 10 November 2026, 09:30 UTC");
    expect(doc).toContain(`\`${vaultIndexKey("<tenant>", VAULT_YEAR)}\``);
    expect(doc).toContain(`provenance: "${PROVENANCE}"`);
    expect(doc).toContain("wrangler d1 execute");
    expect(doc).toContain("sh r2-put.sh");
    expect(doc).toContain(`DEMO_SLUGS=${DEMO_COMPANIES.map((c) => c.slug).join(",")}`);
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["cloud:seed-demo"]).toBe("tsx src/cli/cloudSeedDemo.ts");
  });
});
