// npm run books:month [-- --dry | --pdf-only]: a month of a test company's books, run through the hands-on demo's engine (src/engine/
// host.ts, the class the try deployment runs) on its simulated bank, with Claude reading and booking each invoice LIVE,
// and written to one run record: docs/runs/2026-11-13-books-month.json, which /books shows (src/redesign/booksPage.ts).
//
// The company and every supplier are fictional; every IBAN is one the repository's fixtures already use (published
// example IBANs and the test world's own); the bank is the in-memory stand-in (src/engine/standInBank.ts), so no money
// moves anywhere: test company, test money. The invoices are dated in October 2026; the engine runs on the real clock.
//
// Claude: the cloud's own access and caps (cloud/src/engine/claudeAccess.ts over cloud/src/engine/spend.ts), on a local
// SQLite copy of its tables, with the caps below: each action reserves its ceiling first, reads within it, and is
// settled to what it cost; refused, the parser reads and the record says so. The run stops taking new invoices when
// the company's spend comes within 20% of its cap. --dry: no key, no Claude (the parser reads, code books); nothing is
// written to docs/.
//
// For each invoice: upload (Claude reads it; the Checker and the Coder decide, the accrual is booked); a new supplier
// is requested, verified by a person (the test world says how), approved with the CFO's test passkey and added; the
// payment is proposed (the Payer agent plans), approved with the passkey and paid on the stand-in bank, booked and
// archived. Then the ledger is checked (hash chain, audit chain, balance) and the record written.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { pdfOf } from "../src/e2e/documents.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { actionBudget } from "../src/engine/budget.js";
import type { Asker } from "../src/ap/read.js";
import type Anthropic from "@anthropic-ai/sdk";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { isBank } from "../src/ledger/accounts.js";
import { verifyLedger } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { processAssertion } from "../src/passkey/process.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { yearData } from "../src/vault/data.js";
import { setSetting } from "../src/world/settings.js";
import type { VaultSink } from "../src/vault/sink.js";
import { statementPdf, statementView, type BooksStatementFile } from "../src/vault/statementPdf.js";
import { claudeAccess, READER_MODELS } from "../cloud/src/engine/claudeAccess.js";
import { ensureSchema } from "../cloud/src/app.js";
import { sqliteSql } from "../cloud/src/node.js";
import { createHash } from "node:crypto";

const DRY = process.argv.includes("--dry");
export const RUN_DAY = "2026-11-13";
const RECORD = `docs/runs/${RUN_DAY}-books-month.json`;
const OUT = "docs/assets/books";
const PDF_NAME = `books-month-${RUN_DAY}.pdf`;
const COMPANY = "Studio Noorderlicht B.V. (test company)";
const RP = "books-month.invalid", ORIGIN = `https://${RP}`;
/** The caps of this run, in micro-USD at list price (the cloud's switches, cloud/src/engine/spend.ts). */
const CAPS = { claude: "on", cap_action_micros: 250_000, cap_company_micros: 4_000_000, cap_day_micros_smoke: 4_000_000, cap_all_micros: 4_000_000, max_inflight: 1 };
const STOP_AT = 0.8;
/**
 * Live attempts before the one recorded, said here so their Claude spend is not hidden. 13 Nov 05:33 UTC: all 20 read by
 * Claude, 16 paid, books balanced; but the 14 invoices of new suppliers were booked after their supplier was added, a
 * step this script then ran without Claude, so code (not the Coder) chose their accounts. Discarded; that step now runs
 * with Claude under the same caps.
 */
const EARLIER_ATTEMPTS = [{ started_at: "2026-11-13T05:33Z", spent_micros: 580_843, why_discarded: "the 14 new-supplier invoices were booked by code, not by the Coder agent: the step after a supplier is added ran without Claude" }];
/** The stand-in bank's EUR before the run: enough above the treasury's EUR floor (src/config/policy.ts) for a month. */
const OPENING_EUR_CENTS = 6_000_000;

// ---------- the month's invoices (fictional suppliers; IBANs from the repository's fixtures) ----------

interface Supplier { name: string; street: string; city: string; vatId: string; iban: string; bic: string; lang: "nl" | "en" }
interface Line { what: string; netCents: number }
interface Inv { s: Supplier; no: string; date: string; due: string; lines: Line[]; vat: "21" | "9" | "rc-eu" | "outside-eu"; currency: "EUR" | "GBP" }

const S = (name: string, street: string, city: string, vatId: string, iban: string, bic: string, lang: "nl" | "en" = "nl"): Supplier => ({ name, street, city, vatId, iban, bic, lang });
const SUP = {
  rent: S("Vastgoed Grachtzijde B.V.", "Prinsengracht 412", "1016 JC Amsterdam", "NL861247035B01", "NL91ABNA0417164300", "ABNANL2A"),
  power: S("Energie Polder N.V.", "Dijkweg 90", "1619 HG Andijk", "NL853017264B01", "NL13INGB0002267549", "INGBNL2A"),
  water: S("Waterbedrijf Amstelrand N.V.", "Spaarndammerdijk 2", "1014 AA Amsterdam", "NL809163550B01", "NL26RABO0158823604", "RABONL2U"),
  fibre: S("Glasvezel Noord B.V.", "Kanaalweg 17", "8011 AB Zwolle", "NL857401226B01", "NL32RABO0312748819", "RABONL2U"),
  books: S("Rekenwerk Online B.V.", "Vredenburg 40", "3511 BD Utrecht", "NL862215098B01", "NL56INGB0009315862", "INGBNL2A"),
  wholesale: S("Groothandel De Haven B.V.", "Havenstraat 120", "3024 SN Rotterdam", "NL858830412B01", "NL66INGB0004286135", "INGBNL2A"),
  pack: S("Verpakkingshuis Noord B.V.", "Industrieweg 8", "9723 BZ Groningen", "NL854117309B01", "NL80INGB0007731420", "INGBNL2A"),
  print: S("Drukkerij Lindeboom B.V.", "Lindengracht 55", "1015 KC Amsterdam", "NL860392147B01", "NL82ABNA0611447023", "ABNANL2A"),
  shop: S("Boekhandel Het Plein B.V.", "Plein 1813 nr. 5", "2514 JN Den Haag", "NL851239460B01", "NL86ABNA0583921746", "ABNANL2A"),
  courier: S("Fietskoerier Mokum B.V.", "Czaar Peterstraat 30", "1018 PR Amsterdam", "NL863015772B01", "NL90RABO0119284573", "RABONL2U"),
  accountant: S("Accountantskantoor Van Dijk B.V.", "Stationsweg 3", "2312 AS Leiden", "NL855672318B01", "NL92ABNA0247158396", "ABNANL2A"),
  cleaning: S("Schoonmaakbedrijf Glans B.V.", "Wibautstraat 150", "1091 GR Amsterdam", "NL859904516B01", "NL95RABO0346612907", "RABONL2U"),
  bergtex: S("Bergtex Textil GmbH", "Textilweg 4", "72760 Reutlingen, Germany", "DE811427395", "DE89370400440532013000", "COBADEFFXXX", "en"),
  fair: S("Messe Partner Köln GmbH", "Deutz-Mülheimer Str. 51", "50679 Köln, Germany", "DE298417736", "DE75512108001245126199", "BELADEBEXXX", "en"),
  coffee: S("Koffiebranderij Schelde BV", "Kaai 14", "2000 Antwerpen, Belgium", "BE0712345874", "BE48068248567183", "GKCCBEBB", "en"),
  lamps: S("Atelier Lumière SARL", "12 rue des Arts", "69002 Lyon, France", "FR41812345678", "FR1420041010050500013M02606", "PSSTFRPPLYO", "en"),
  cloud: S("Shannon Data Tools Ltd", "8 Quay Street", "Galway H91, Ireland", "IE4816253KH", "IE29AIBK93115212345678", "AIBKIE2D", "en"),
  design: S("Fjordlys Design AS", "Bryggen 7", "5003 Bergen, Norway", "NO918273645MVA", "NO9386011117947", "DNBANOKKXXX", "en"),
  media: S("Thames Media Ltd", "41 Southwark Street", "London SE1 9HL, United Kingdom", "GB384751926", "GB29NWBK60161331926819", "NWBKGB2L", "en"),
};

export const MONTH: Inv[] = [
  { s: SUP.rent, no: "VG-2026-10", date: "2026-10-01", due: "2026-10-15", lines: [{ what: "Huur bedrijfsruimte oktober 2026 (Prinsengracht 412)", netCents: 245_000 }], vat: "21", currency: "EUR" },
  { s: SUP.power, no: "EP-8841207", date: "2026-10-31", due: "2026-11-21", lines: [{ what: "Elektriciteit oktober 2026, 1.412 kWh", netCents: 18_640 }], vat: "21", currency: "EUR" },
  { s: SUP.water, no: "WA-551903", date: "2026-10-28", due: "2026-11-25", lines: [{ what: "Drinkwater oktober 2026, 14 m3", netCents: 3_850 }], vat: "9", currency: "EUR" },
  { s: SUP.fibre, no: "GN-102638", date: "2026-10-01", due: "2026-10-31", lines: [{ what: "Zakelijk glasvezel 1 Gbit/s, oktober 2026", netCents: 6_900 }], vat: "21", currency: "EUR" },
  { s: SUP.books, no: "RO-26-4471", date: "2026-10-02", due: "2026-10-16", lines: [{ what: "Boekhoudsoftware, abonnement oktober 2026", netCents: 4_500 }], vat: "21", currency: "EUR" },
  { s: SUP.wholesale, no: "GDH-77120", date: "2026-10-06", due: "2026-11-05", lines: [{ what: "Linnen theedoeken, 400 stuks", netCents: 152_000 }, { what: "Keramische mokken, 300 stuks", netCents: 230_000 }], vat: "21", currency: "EUR" },
  { s: SUP.pack, no: "VHN-26-3390", date: "2026-10-08", due: "2026-11-07", lines: [{ what: "Verzenddozen en vulmateriaal", netCents: 61_200 }], vat: "21", currency: "EUR" },
  { s: SUP.print, no: "DL-14522", date: "2026-10-09", due: "2026-11-08", lines: [{ what: "Catalogus najaar, 1.000 exemplaren", netCents: 38_000 }], vat: "21", currency: "EUR" },
  { s: SUP.shop, no: "HP-90317", date: "2026-10-12", due: "2026-10-26", lines: [{ what: "Vakboeken interieur en ontwerp", netCents: 8_400 }], vat: "9", currency: "EUR" },
  { s: SUP.courier, no: "FKM-2026-1088", date: "2026-10-31", due: "2026-11-14", lines: [{ what: "Fietskoeriersritten oktober 2026, 52 ritten", netCents: 15_600 }], vat: "21", currency: "EUR" },
  { s: SUP.accountant, no: "AVD-26-0412", date: "2026-10-15", due: "2026-11-14", lines: [{ what: "Kwartaalrapportage Q3 en btw-aangifte", netCents: 75_000 }], vat: "21", currency: "EUR" },
  { s: SUP.cleaning, no: "SG-6620", date: "2026-10-31", due: "2026-11-14", lines: [{ what: "Schoonmaak winkel en atelier, oktober 2026", netCents: 22_000 }], vat: "21", currency: "EUR" },
  { s: SUP.bergtex, no: "BTX-2026-34", date: "2026-10-07", due: "2026-11-06", lines: [{ what: "Linen fabric, 600 m, natural", netCents: 240_000 }], vat: "rc-eu", currency: "EUR" },
  { s: SUP.fair, no: "MPK-26-1187", date: "2026-10-14", due: "2026-11-13", lines: [{ what: "Trade fair stand 12 m2, Interior Days Cologne", netCents: 180_000 }], vat: "rc-eu", currency: "EUR" },
  { s: SUP.coffee, no: "KBS-4410", date: "2026-10-16", due: "2026-11-15", lines: [{ what: "Coffee beans for the shop's coffee corner, 24 kg", netCents: 42_000 }], vat: "rc-eu", currency: "EUR" },
  { s: SUP.lamps, no: "AL-2026-209", date: "2026-10-20", due: "2026-11-19", lines: [{ what: "Table lamps for resale, 40 pieces", netCents: 152_000 }], vat: "rc-eu", currency: "EUR" },
  { s: SUP.cloud, no: "SDT-10871", date: "2026-10-01", due: "2026-10-15", lines: [{ what: "Web shop analytics, October seats", netCents: 29_000 }], vat: "rc-eu", currency: "EUR" },
  { s: SUP.design, no: "FD-2026-77", date: "2026-10-23", due: "2026-11-22", lines: [{ what: "Product photography, autumn collection", netCents: 95_000 }], vat: "outside-eu", currency: "EUR" },
  { s: SUP.media, no: "TM-55120", date: "2026-10-05", due: "2026-11-04", lines: [{ what: "Social media campaign, October", netCents: 60_000 }], vat: "outside-eu", currency: "GBP" },
  { s: SUP.media, no: "TM-55187", date: "2026-10-26", due: "2026-11-25", lines: [{ what: "Newsletter design and send, October", netCents: 24_000 }], vat: "outside-eu", currency: "GBP" },
];

const nlMoney = (c: number) => `€ ${Math.floor(c / 100).toLocaleString("nl-NL")},${String(c % 100).padStart(2, "0")}`;
const enMoney = (cur: string, c: number) => `${cur} ${Math.floor(c / 100).toLocaleString("en-GB")}.${String(c % 100).padStart(2, "0")}`;
const nlDate = (iso: string) => iso.split("-").reverse().join("-");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const enDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return `${d} ${MONTHS[m - 1]} ${y}`; };
const ibanGroups = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

/** The invoice's net, VAT and total in cents: VAT at 21% or 9% per line, rounded on the total; none on a reverse charge. */
export function amounts(i: Inv): { net: number; vat: number; total: number } {
  const net = i.lines.reduce((n, l) => n + l.netCents, 0);
  const vat = i.vat === "21" ? Math.round(net * 0.21) : i.vat === "9" ? Math.round(net * 0.09) : 0;
  return { net, vat, total: net + vat };
}

/** The invoice's text, in the supplier's own layout: Dutch for a Dutch supplier, English otherwise. */
export function invoiceText(i: Inv): string {
  const a = amounts(i), s = i.s;
  if (s.lang === "nl") {
    return [s.name, `${s.street}, ${s.city}`, `BTW-nummer: ${s.vatId}`, "Factuur", `Factuurnummer: ${i.no}`, `Factuurdatum: ${nlDate(i.date)}`, `Vervaldatum: ${nlDate(i.due)}`,
      `Aan: ${COMPANY.replace(" (test company)", "")}, Haarlemmerstraat 70, 1013 EW Amsterdam`,
      "Omschrijving                                   Bedrag", ...i.lines.map((l) => `${l.what}  ${nlMoney(l.netCents)}`),
      `Subtotaal ${nlMoney(a.net)}`, `BTW ${i.vat}% ${nlMoney(a.vat)}`, `Totaal te betalen ${nlMoney(a.total)}`,
      `IBAN: ${ibanGroups(s.iban)}`, `BIC: ${s.bic}`, `Betalingskenmerk: ${i.no}`].join("\n");
  }
  const vatLine = i.vat === "rc-eu" ? "VAT reverse charge: the customer accounts for the VAT (intra-EU supply)." : "No VAT charged: supplier outside the EU; the customer accounts for any VAT.";
  return [s.name, s.street, s.city, `VAT: ${s.vatId}`, `INVOICE ${i.no}`, `Invoice date: ${enDate(i.date)}`, `Due date: ${enDate(i.due)}`,
    `Bill to: ${COMPANY.replace(" (test company)", "")}, Haarlemmerstraat 70, 1013 EW Amsterdam, Netherlands, VAT NL004719326B01`,
    "Description                                   Amount", ...i.lines.map((l) => `${l.what}  ${enMoney(i.currency, l.netCents)}`),
    `Total due ${enMoney(i.currency, a.total)}`, vatLine, `IBAN: ${ibanGroups(s.iban)}`, `BIC: ${s.bic}`, `Payment reference: ${i.no}`].join("\n");
}

// ---------- the run ----------

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return { put: (s, bytes) => { kept.set(`mem:${s}`, Buffer.from(bytes)); return `mem:${s}`; }, get: (p) => { const b = kept.get(p); if (!b) throw new Error(`no document at ${p}`); return b; } };
}
function memoryVault(): VaultSink & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    name: "memory", files,
    stat: async (p) => { const b = files.get(p); return b ? { sha256: sha(b), bytes: b.length } : null; },
    create: async (p, bytes) => { if (files.has(p)) throw new Error(`${p} is already in the vault`); files.set(p, bytes); },
    readIndex: async (p) => files.get(p)?.toString("utf8") ?? null,
    writeIndex: async (p, text) => { files.set(p, Buffer.from(text)); },
    read: async (p) => files.get(p) ?? null,
  };
}

interface Step { at: string; step: string; ok: boolean; detail: Record<string, unknown> }
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const key = process.env.KIT11_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!DRY && !key) throw new Error("no Anthropic key: run with --dry, or set KIT11_ANTHROPIC_API_KEY");
  const db: DB = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const bankStore = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
  const bank = standInBank(bankStore);
  bank.bal.EUR.availableCents = OPENING_EUR_CENTS;
  const vault = memoryVault();
  const spendSql = sqliteSql();
  await ensureSchema(spendSql);
  const tenantId = "t_books_month";
  const access = DRY ? undefined : claudeAccess({ engineClaude: "on", key, sql: spendSql, tenantId, switches: async () => CAPS });
  const host = new EngineHost({
    db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => bankStore.save(bankToText(bank)),
    rp: { rpId: RP, origin: ORIGIN }, company: { name: COMPANY, lang: "en" }, vault, feed: null, ...(access ? { claude: access } : {}), reviewNoteOnPay: false,
  });
  const phone = new FakeAuthenticator();
  let counter = 0;
  const steps: Step[] = [];
  const step = (s: string, ok: boolean, detail: Record<string, unknown>) => { steps.push({ at: new Date().toISOString(), step: s, ok, detail }); log(`${ok ? "ok " : "NO "} ${s} ${JSON.stringify(detail).slice(0, 220)}`); };
  const spent = async () => (access ? (await access.status()).spent_micros ?? 0 : 0);
  const lastSeq = () => (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
  const costSince = (from: number) => (db.prepare("SELECT payload_json FROM audit_log WHERE seq > ? AND event IN ('claude.read', 'agent.run')").all(from) as { payload_json: string }[])
    .reduce((n, r) => { try { const c = (JSON.parse(r.payload_json) as { cost_usd_micros?: unknown }).cost_usd_micros; return n + (typeof c === "number" && c > 0 ? c : 0); } catch { return n; } }, 0);
  /** One step outside the host that may ask Claude: its ceiling reserved first, settled to what it cost (as the host's own). */
  const withClaude = async <T>(task: string, run: (deps: { now: () => Date; reader?: Asker; claude?: Anthropic | null; coder?: Anthropic | null; agents?: boolean }) => Promise<T>): Promise<T> => {
    if (!access) return run({ now: () => new Date() });
    const got = await access.reserve();
    if (!got.ok) { step(`claude capped for ${task}`, false, { reason: got.reason }); return run({ now: () => new Date(), reader: parserOnly, claude: null, coder: null, agents: true }); }
    const budget = actionBudget(got.reservation.micros), from = lastSeq();
    try {
      const client = access.agents?.(budget) ?? null;
      return await run({ now: () => new Date(), reader: access.reader(db, budget), claude: client, coder: client, agents: true });
    } finally {
      await got.reservation.settle(Math.min(got.reservation.micros, Math.max(costSince(from), got.reservation.micros - budget.left())));
    }
  };

  const started = new Date();
  // This test company has no other EUR obligations this month: the treasury keeps its EUR floor, and the rest is free to pay suppliers.
  setSetting(db, "treasury", "eur_obligations", "0.00");
  await host.seed();
  const st = await host.passkeyStart();
  const enrolled = await host.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "CFO's test passkey (software authenticator)" });
  if (!enrolled.ok) throw new Error(`passkey: ${enrolled.reason}`);
  step("set up", true, { company: COMPANY, opening_eur: (OPENING_EUR_CENTS / 100).toFixed(2), status: await host.status() });

  const rows: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  for (const inv of MONTH) {
    const used = await spent();
    if (!DRY && used >= STOP_AT * CAPS.cap_company_micros) { stopped = `Claude spend ${used} micro-USD reached ${STOP_AT * 100}% of the company cap ${CAPS.cap_company_micros}: no more invoices taken`; break; }
    const filename = `${inv.s.name.split(/\s+/)[0]!.toLowerCase()}-${inv.no}.pdf`;
    const bytes = await pdfOf(invoiceText(inv));
    const before = await spent();
    const up = await host.upload({ bytes, filename });
    const id = up.invoice?.id;
    if (!id) { step(`upload ${inv.no}`, false, { kind: up.kind }); rows.push({ number: inv.no, outcome: `not an invoice (${up.kind})` }); continue; }
    const a0 = apInvoice(db, id)!;
    step(`upload ${inv.no}`, true, { id, read_by: up.invoice!.read_by, status: a0.status, vendor: a0.vendor, total: `${a0.currency} ${a0.total}`, findings: a0.findings.map((f) => f.code) });
    let supplierAdded: Record<string, unknown> | null = null;
    if (a0.status === "needs_vendor") {
      const req = requestPayeeAddForInvoice(db, id, "treasury", new Date());
      recordPayeeAddVerification(db, req.add_id, { by: "the CFO (test world)", how: "test world: the fictional supplier's bank details as on its own invoice; no real supplier exists to call", actor: "human", address: { street: inv.s.street, city: inv.s.city.replace(/^\S+( [A-Z]{2})? /, ""), postcode: inv.s.city.split(" ")[0]! } }, new Date());
      const p = proposePayeeAdd(db, req.add_id, "treasury", new Date());
      const cred = phone.sign({ challenge: challengeFor(p.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++counter });
      const out = await processAssertion(db, { ticket: "books-month", kind: "assertion", proposal_id: null, body: JSON.stringify({ proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: cred }), received_at: new Date().toISOString() }, new Date());
      if (out.status !== "approved") { step(`supplier ${inv.s.name}`, false, { proposal: p.proposal_id, status: out.status, message: out.message }); rows.push({ number: inv.no, outcome: `supplier not approved: ${out.message}` }); continue; }
      // The invoice is checked again and booked once its supplier is on file: the Checker and the Coder run there, with
      // Claude under the same caps as the engine's own actions (src/engine/host.ts withClaude).
      await withClaude(`books-month.payee_add:${p.proposal_id}`, (deps) => executePayeeAdd(db, bank, p.proposal_id, deps as Parameters<typeof executePayeeAdd>[3], new Date()));
      bankStore.save(bankToText(bank));
      supplierAdded = { proposal: p.proposal_id, terms_sha256: p.terms_sha256, approved_with: "the CFO's test passkey (software authenticator)" };
      step(`supplier ${inv.s.name}`, true, { ...supplierAdded, invoice_status: apInvoice(db, id)!.status });
    }
    const a1 = apInvoice(db, id)!;
    let payment: Record<string, unknown> | null = null;
    if (a1.status === "ready") {
      const pr = await host.propose(id);
      if (!pr.ok) { step(`propose ${inv.no}`, false, { reason: pr.reason }); }
      else {
        const cred = phone.sign({ challenge: pr.proposal.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
        const ap = await host.approve({ proposal_id: pr.proposal.id, terms_sha256: pr.proposal.terms_sha256, credential: cred });
        const t = db.prepare("SELECT transfer_id, amount, currency, method, fee_actual, status FROM transfers WHERE approval_sha256 = ? ORDER BY updated_at DESC").get(pr.proposal.terms_sha256) as { transfer_id: string | null; amount: string; currency: string; method: string; fee_actual: string | null; status: string } | undefined;
        payment = { proposal: pr.proposal.id, kind: pr.proposal.kind, terms_sha256: pr.proposal.terms_sha256, approval: ap.status, invoice_status: ap.settled?.invoice_status ?? null, transfer: t ?? null, error: ap.settled?.error ?? null };
        step(`pay ${inv.no}`, ap.status === "approved" && !ap.settled?.error, payment);
      }
    }
    const coding = db.prepare("SELECT coding_json, source, status, model FROM ap_codings WHERE invoice_id = ?").get(id) as { coding_json: string; source: string; status: string; model: string | null } | undefined;
    const a2 = apInvoice(db, id)!;
    rows.push({
      id, file: filename, doc_sha256: a2.doc_sha256, supplier: a2.vendor, number: a2.invoice_no, issue_date: a2.issue_date, due_date: a2.due_date, currency: a2.currency, net: a2.subtotal, vat: a2.tax, total: a2.total,
      expected: (() => { const x = amounts(inv); return { net: (x.net / 100).toFixed(2), vat: (x.vat / 100).toFixed(2), total: (x.total / 100).toFixed(2), currency: inv.currency, vat_rule: inv.vat }; })(),
      read_by: up.invoice!.read_by, status: a2.status, findings: a2.findings.map((f) => ({ level: f.level, code: f.code })),
      coding: coding ? { source: coding.source, status: coding.status, model: coding.model, ...JSON.parse(coding.coding_json) as Record<string, unknown> } : null,
      supplier_added: supplierAdded, payment, claude_micros: (await spent()) - before,
    });
  }
  await host.sync();
  syncLedger(db, new Date());
  const ended = new Date();

  // The books, from the ledger: the year's statement, and the bank balance after each entry that moved it.
  const year = yearData(db, 2026);
  const moves = db.prepare(`SELECT e.entry_id AS id, e.posting_date AS day, e.description AS what, l.account AS account, l.currency AS currency, l.debit_cents - l.credit_cents AS cents
    FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.entry_id ORDER BY e.posting_date, e.entry_id, l.line_no`).all() as { id: number; day: string; what: string; account: string; currency: string; cents: number }[];
  const cash: { day: string; what: string; currency: string; balance_cents: number }[] = [];
  let bal = 0;
  for (const m of moves.filter((x) => isBank(x.account) && x.currency === "EUR")) { bal += m.cents; const last = cash.at(-1); if (last && last.what === m.what && last.day === m.day) last.balance_cents = bal; else cash.push({ day: m.day, what: m.what, currency: m.currency, balance_cents: bal }); }
  const vaultFiles = [...vault.files.keys()].filter((p) => p.endsWith(".pdf")).sort();
  const books: BooksStatementFile = {
    company: COMPANY, day: RUN_DAY, record: RECORD, pdf: PDF_NAME,
    invoices_checked: rows.filter((r) => r.payment).length,
    balance: year.balance, pnl: year.pnl, cash,
    sorted: {
      eval: RECORD, ran_at: started.toISOString(),
      rows: rows.filter((r) => (r.coding as { source?: string } | null)?.source === "claude").map((r) => {
        const c = r.coding as { model: string | null; lines?: { account: string; vat_code: string | null; cost_centre: string | null }[]; reason?: string };
        const l = c.lines?.[0];
        const mine = vaultFiles.filter((p) => p.includes(String(r.number)));
        const path = mine.find((p) => p.includes("/Purchase invoices/")) ?? mine[0] ?? "";
        return { case: String(r.id), model: c.model ?? "", path: path.split("/").slice(1), supplier: String(r.supplier), number: String(r.number), date: String(r.issue_date), currency: String(r.currency), total: String(r.total), account: l?.account ?? "", vat: l?.vat_code ?? null, cost_centre: l?.cost_centre ?? null, reason: c.reason ?? null };
      }),
    },
  };
  const view = statementView(books);
  const ledger = verifyLedger(db), chain = verifyAuditChain(db);
  const record = {
    label: "test company, test money: a month of supplier invoices through the hands-on demo's engine, on its simulated bank, read and booked by Claude live",
    company: COMPANY, run_day: RUN_DAY, started_at: started.toISOString(), ended_at: ended.toISOString(), dry: DRY,
    how: "npm run books:month (scripts/books-month.ts): the engine of the try deployment (src/engine/host.ts) in Node, the stand-in bank in memory (no money moves), the CFO's approvals signed by a software passkey; Claude through the cloud's own access and caps (cloud/src/engine/claudeAccess.ts, spend.ts) on a local SQLite copy of the cap tables.",
    claude: { on: !DRY, reader_models: READER_MODELS, caps: CAPS, stop_at_share: STOP_AT, spent_micros: await spent(), stopped, earlier_attempts: EARLIER_ATTEMPTS },
    bank: { opening_eur: (OPENING_EUR_CENTS / 100).toFixed(2), eur_obligations: "0.00", note: "the stand-in bank's EUR before the run and the treasury's EUR obligations, both set by this script (the treasury keeps its own EUR floor); the treasury's own seed adds test USD" },
    invoices: rows,
    checks: { ledger_chain: ledger, audit_chain: chain, balanced: view?.balances ?? false, invoices: rows.length, paid: rows.filter((r) => (r.payment as { invoice_status?: string } | null)?.invoice_status === "paid").length, coded_by_claude: books.sorted.rows.length },
    vault: vaultFiles,
    books,
    steps,
  };
  log(`\n${rows.length} invoices; paid ${record.checks.paid}; coded by Claude ${record.checks.coded_by_claude}; balanced ${record.checks.balanced}; ledger ${JSON.stringify(ledger).slice(0, 80)}; Claude ${record.claude.spent_micros} micro-USD`);
  if (DRY) { mkdirSync("tmp", { recursive: true }); writeFileSync(join("tmp", "books-month-dry.json"), `${JSON.stringify(record, null, 2)}\n`); log("dry run: wrote tmp/books-month-dry.json only"); return; }
  if (!view?.balances) throw new Error("the books do not balance: nothing written");
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, PDF_NAME), await statementPdf(view));
  log(`wrote ${RECORD} and ${OUT}/${PDF_NAME}`);
}

/** --pdf-only: the PDF again from the record already written (no engine, no Claude). */
async function pdfOnly() {
  const { readFileSync } = await import("node:fs");
  const view = statementView((JSON.parse(readFileSync(RECORD, "utf8")) as { books: BooksStatementFile }).books);
  if (!view?.balances) throw new Error(`${RECORD} does not balance`);
  writeFileSync(join(OUT, PDF_NAME), await statementPdf(view));
  log(`wrote ${OUT}/${PDF_NAME} from ${RECORD}`);
}

await (process.argv.includes("--pdf-only") ? pdfOnly() : main());
