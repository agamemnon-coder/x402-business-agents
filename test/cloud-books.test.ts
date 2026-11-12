// The console's Books and Vault arithmetic (cloud/src/consoleBooks.ts), run as the very text the page runs, over the
// seeded test world (src/demoworld) read through the demo's own routes. The report cards' numbers equal the engine's
// own reports on each company's runner ledger to the cent; the document check finds a tampered byte; the closed month
// and the vault's folders are the ones the engine wrote. No network.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle } from "../cloud/src/app.js";
import { BOOKS_JS } from "../cloud/src/consoleBooks.js";
import { vaultIndex, type BuiltCompany } from "../src/demoworld/build.js";
import { localDemo, type LocalDemo } from "../src/demoworld/bundle.js";
import { pdfText } from "../src/ap/pdfText.js";
import { ageing, balanceSheet, profitAndLoss, trialBalance, vatOverview } from "../src/ledger/reports.js";

interface Cards {
  trial: { by: Record<string, { debit: number; credit: number }>; balanced: boolean; currencies: string[] };
  pnl: { by: Record<string, { revenue: number; expense: number; result: number }>; from: string; to: string };
  balance: { by: Record<string, { assets: number; liabilities: number; equity: number; result: number; balanced: boolean }>; balanced: boolean };
  vat: { quarter: string; owed: number; input: number; balance: number; uncoded: number };
  payables: { by: Record<string, { open: number; overdue: number }>; items: number; as_of: string };
}
interface Agreement { ok: boolean; nothing: boolean; moved: number; unreconciled: number; parts: { k: string; ids: string[] }[] }
interface Folder { name: string; path: string; folders: Folder[]; files: { name: string; path: string }[]; count: number }
interface Books {
  sha256Hex(b: ArrayBuffer | Uint8Array): Promise<string>;
  verifyBytes(b: ArrayBuffer | Uint8Array, expected: string): Promise<{ match: boolean; actual: string; expected: string }>;
  agreement(check: unknown): Agreement;
  reportCards(r: unknown): Cards;
  period(last: string | null, today: string, demo: boolean): { end: string; from: string; quarter: string; as_of: string };
  closedMonths(files: unknown[]): string[];
  vaultTree(files: unknown[]): Folder;
  dutchName(name: string): string | null;
  entryKind(e: unknown): string;
}
// The page's own text, run here as it runs there (crypto.subtle is the same Web Crypto in Node).
const B = new Function(`${BOOKS_JS}\nreturn { sha256Hex, verifyBytes, agreement, reportCards, period, closedMonths, vaultTree, dutchName, entryKind };`)() as Books;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let dir: string;
let demo: LocalDemo;
beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-books-"));
  demo = await localDemo(dir);
}, 120_000);
afterAll(() => { demo?.close(); rmSync(dir, { recursive: true, force: true }); });

const res = (path: string) => handle(new Request(`${demo.env.origin}${path}`), demo.env);
async function get<T>(path: string): Promise<T> {
  const r = await res(path);
  if (r.status !== 200) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return await r.json() as T;
}
const runner = (slug: string): BuiltCompany => demo.built.find((b) => b.spec.slug === slug)!;
interface Entry { entry_id: number; posting_date: string; source_key: string | null; reverses: number | null }

describe("the report cards, against the engine's own reports", () => {
  it("give, for every test company, the engine's numbers to the cent: trial balance, profit and loss, balance sheet, VAT and open payables", async () => {
    for (const c of demo.companies) {
      const at = (p: string) => `/v1/demo/${c.slug}${p}`;
      const entries = (await get<{ items: Entry[] }>(at("/ledger/entries?limit=200"))).items;
      const last = entries.map((e) => e.posting_date).sort().at(-1)!;
      const p = B.period(last, "2026-11-12", true);
      expect(p).toEqual({ end: last, from: "2026-01-01", quarter: "2026Q4", as_of: last });
      const cards = B.reportCards({
        trial: await get(at(`/reports/trial?to=${p.end}`)), pnl: await get(at(`/reports/pnl?from=${p.from}&to=${p.end}`)), balance: await get(at(`/reports/balance?to=${p.end}`)),
        vat: await get(at(`/reports/vat?quarter=${p.quarter}`)), payables: await get(at(`/reports/payables?as_of=${p.as_of}`)),
      });
      const db = runner(c.slug).db;
      // Trial balance: debits and credits per currency, summed from the engine's own rows.
      const trial: Record<string, { debit: number; credit: number }> = {};
      for (const r of trialBalance(db, p.end)) { const t = (trial[r.currency] ??= { debit: 0, credit: 0 }); t.debit += r.debit_cents; t.credit += r.credit_cents; }
      expect(cards.trial.by, c.slug).toEqual(trial);
      expect(cards.trial.balanced).toBe(true);
      expect(cards.trial.currencies[0]).toBe("EUR");
      // Profit and loss for the year to the last booking.
      const pnl = profitAndLoss(db, { from: p.from, to: p.end });
      expect(cards.pnl.by).toEqual(Object.fromEntries(Object.entries(pnl).map(([k, v]) => [k, { revenue: v.revenue_cents, expense: v.expense_cents, result: v.result_cents }])));
      expect(Object.keys(cards.pnl.by).length).toBeGreaterThan(0);
      // Balance sheet: assets, liabilities, equity and result, and that it balances.
      const bal = balanceSheet(db, p.end);
      expect(cards.balance.by).toEqual(Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, { assets: v.assets_cents, liabilities: v.liabilities_cents, equity: v.equity_cents, result: v.result_cents, balanced: v.balanced }])));
      expect(cards.balance.balanced).toBe(true);
      // VAT for the quarter of the last booking.
      const vat = vatOverview(db, p.quarter);
      expect(cards.vat).toEqual({ quarter: p.quarter, owed: vat.owed_5a_cents, input: vat.input_5b_cents, balance: vat.balance_5c_cents, uncoded: vat.uncoded_lines });
      expect(cards.vat.input).toBeGreaterThan(0);
      // Open payables, aged on the world's last booking.
      const age = ageing(db, "payables", p.as_of);
      const open = Object.fromEntries(Object.entries(age.totals).map(([k, b]) => { const sum = Object.values(b).reduce((n, x) => n + x, 0); return [k, { open: sum, overdue: sum - b["not due"] }]; }));
      expect(cards.payables.by).toEqual(open);
      expect(cards.payables.items).toBe(age.items.length);
    }
  });

  it("count a signed-in company's open payables on today, and an empty ledger's period from today", () => {
    expect(B.period("2026-11-09", "2026-11-12", false)).toEqual({ end: "2026-11-09", from: "2026-01-01", quarter: "2026Q4", as_of: "2026-11-12" });
    expect(B.period(null, "2027-02-03", false)).toEqual({ end: "2027-02-03", from: "2027-01-01", quarter: "2027Q1", as_of: "2027-02-03" });
  });
});

describe("books, payments and signatures agree", () => {
  it("in each test company: every payment booked and matched, with the bank's proof and the CFO's approval", async () => {
    for (const c of demo.companies) {
      const s = await get<{ check: unknown }>(`/v1/demo/${c.slug}/transactions/summary`);
      const a = B.agreement(s.check);
      expect(a, c.slug).toMatchObject({ ok: true, nothing: false, unreconciled: 0, parts: [] });
      expect(a.moved).toBeGreaterThan(0);
    }
  });

  it("is computed, so a missing booking, proof or signature says what differs", () => {
    const clean = { rows: 3, moved: 3, unreconciled: 0, without_approval: [], without_booking: [], without_proof: [], amount_mismatch: [] };
    expect(B.agreement(clean).ok).toBe(true);
    const off = B.agreement({ ...clean, unreconciled: 1, without_booking: ["transfer:a"], without_approval: ["transfer:b"], without_proof: [], amount_mismatch: ["transfer:c"] });
    expect(off.ok).toBe(false);
    expect(off.parts).toEqual([{ k: "unbooked", ids: ["transfer:a"] }, { k: "unsigned", ids: ["transfer:b"] }, { k: "differs", ids: ["transfer:c"] }]);
    expect(B.agreement({ ...clean, unreconciled: 2 })).toMatchObject({ ok: false, unreconciled: 2, parts: [] });
    // Nothing moved: nothing to agree on, which is not a green tick.
    expect(B.agreement({ rows: 0, moved: 0, unreconciled: 0 })).toMatchObject({ ok: false, nothing: true });
  });
});

describe("the vault, as the engine filed it", () => {
  it("serves each company's index as the vault wrote it, every file held by the cloud with the bytes its hash says", async () => {
    for (const c of demo.companies) {
      const v = await get<{ years: number[]; year: number; company: string; files: { path: string; sha256: string; kind: string; key: string; stored: boolean }[] }>(`/v1/demo/${c.slug}/vault`);
      const index = await vaultIndex(runner(c.slug));
      expect(v.years).toEqual([2026]);
      expect(v.company).toBe(index.company);
      expect(v.files.map((f) => [f.path, f.sha256, f.kind, f.key])).toEqual(index.files.map((f) => [f.path, f.sha256, f.kind, f.key]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
      expect(v.files.every((f) => f.stored)).toBe(true);
      for (const f of v.files) {
        const r = await res(`/v1/demo/${c.slug}/documents/${f.sha256}`);
        expect(r.status, f.path).toBe(200);
        expect(sha(new Uint8Array(await r.arrayBuffer())), f.path).toBe(f.sha256);
      }
      // The folders, as stored: company, year, quarter, then the vault's own Dutch folder names.
      const tree = B.vaultTree(v.files);
      expect(tree.folders.map((f) => f.name)).toEqual([index.company]);
      const year = tree.folders[0]!.folders[0]!;
      expect(year.name).toBe("2026");
      expect(year.folders.map((f) => f.name)).toEqual(["2026-Q4"]);
      expect(year.folders[0]!.folders.map((f) => f.name).sort()).toEqual(["Betalingen", "Inkoopfacturen", "Rapporten"]);
      expect(tree.count).toBe(v.files.length);
      // The closed month: the one the engine closed and locked.
      const locks = (runner(c.slug).db.prepare("SELECT month FROM ledger_locks ORDER BY month").all() as { month: string }[]).map((r) => r.month);
      expect(B.closedMonths(v.files)).toEqual(locks);
      expect(locks).toEqual(["2026-10"]);
    }
  });

  it("gives an English word for every Dutch name the vault uses, and none for a supplier's own name", () => {
    expect(["Inkoopfacturen", "Betalingen", "Rapporten", "_Geblokkeerd", "2026-10 Maandrapport.pdf", "2026-Q4 Btw-overzicht.pdf", "2026 Jaarrapport.pdf", "Leveranciers 2026-11-10.pdf"].map(B.dutchName))
      .toEqual(["purchase_invoices", "payments", "reports", "blocked", "month_report", "vat_overview", "year_report", "suppliers"]);
    expect(B.dutchName("Bergtex Textil GmbH")).toBeNull();
    expect(B.dutchName("2026-Q4")).toBeNull();
  });

  it("verifies a document: the downloaded bytes match the hash on record, and one changed byte does not", async () => {
    const c = demo.companies[0]!;
    const v = await get<{ files: { path: string; sha256: string; kind: string }[] }>(`/v1/demo/${c.slug}/vault`);
    for (const kind of ["invoice", "receipt", "month"]) {
      const f = v.files.find((x) => x.kind === kind)!;
      const bytes = new Uint8Array(await (await res(`/v1/demo/${c.slug}/documents/${f.sha256}`)).arrayBuffer());
      expect(await B.sha256Hex(bytes)).toBe(sha(bytes));
      expect(await B.verifyBytes(bytes, f.sha256), f.path).toEqual({ match: true, actual: f.sha256, expected: f.sha256 });
      const tampered = bytes.slice();
      const mid = Math.floor(tampered.length / 2);
      tampered[mid] = tampered[mid]! ^ 0x01;
      const r = await B.verifyBytes(tampered, f.sha256);
      expect(r.match, f.path).toBe(false);
      expect(r.actual).toBe(sha(tampered));
      expect(r.expected).toBe(f.sha256);
    }
    const one = new TextEncoder().encode("x");
    expect((await B.verifyBytes(one, "")).match).toBe(false);
    expect((await B.verifyBytes(one, "not a hash")).match).toBe(false);
    expect((await B.verifyBytes(one, sha(one).toUpperCase())).match).toBe(true);
  });

  it("files payment proofs and month reports that say stand-in and test passkey, never sandbox or Face ID", async () => {
    const c = demo.companies[0]!;
    const v = await get<{ files: { sha256: string; kind: string }[] }>(`/v1/demo/${c.slug}/vault`);
    for (const kind of ["receipt", "month"]) {
      const f = v.files.find((x) => x.kind === kind)!;
      const { text } = await pdfText(new Uint8Array(await (await res(`/v1/demo/${c.slug}/documents/${f.sha256}`)).arrayBuffer()));
      expect(text, kind).toMatch(/stand-in for the bank/);
      expect(text, kind).not.toMatch(/sandbox/i);
      if (kind === "receipt") { expect(text).toMatch(/a test passkey/); expect(text).not.toMatch(/Face ID \(passkey\)/); }
    }
  });

  it("matches an invoice's original in the vault to the hash on the invoice's record", async () => {
    const c = demo.companies[0]!;
    const inv = await get<{ doc_sha256: string }>(`/v1/demo/${c.slug}/invoices/${c.states.paid}`);
    const v = await get<{ files: { key: string; sha256: string }[] }>(`/v1/demo/${c.slug}/vault`);
    expect(v.files.find((f) => f.key === `invoice:${c.states.paid}`)!.sha256).toBe(inv.doc_sha256);
  });
});

describe("the bookings, in plain words", () => {
  it("names every booking in the test world by what happened", async () => {
    const kinds = new Set<string>();
    for (const c of demo.companies) for (const e of (await get<{ items: Entry[] }>(`/v1/demo/${c.slug}/ledger/entries?limit=200`)).items) kinds.add(B.entryKind(e));
    expect([...kinds].sort()).toEqual(["converted", "opening", "paid", "received"]);
    expect(B.entryKind({ source_key: "transfer|r1|6800|1200|EUR" })).toBe("fee");
    expect(B.entryKind({ source_key: "transfer|r1|2100|1200|EUR@v2" })).toBe("paid");
    expect(B.entryKind({ source_key: "close-year:2026" })).toBe("closing");
    expect(B.entryKind({ source_key: "ap-accrual|AP-1", reverses: 4 })).toBe("reversal");
  });
});
