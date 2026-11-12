// One company's engine as a set of actions on a ledger handle (src/engine/host.ts): the class the Node tests and the
// Durable Object share. Here it runs on better-sqlite3 in memory, with no payables folder: the documents are in a
// memory store, the bank is the stand-in (test money, kept as text in a memory store), the parser reads (no model),
// the vault is a sink in memory and the CFO's phone is a software passkey. Nothing reaches the network.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { pdfText } from "../src/ap/pdfText.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { publicEvent, type EngineEvent } from "../src/engine/events.js";
import { EngineHost, parserOnly, type EngineDeps } from "../src/engine/host.js";
import { bankFromText, bankToText, standInBank, type BankStore } from "../src/engine/standInBank.js";
import { verifyLedger } from "../src/ledger/core.js";
import { sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import type { VaultSink } from "../src/vault/sink.js";
import { EN } from "./fakes/apInvoices.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";

const RP = "engine.example.invalid";
const ORIGIN = `https://${RP}`;
const IBAN = "DE89370400440532013000";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const count = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** The ledger's documents in memory: no file is written anywhere. */
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

/** The vault in memory: files created once, a year's index rewritten. */
function memoryVault(): VaultSink & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    name: "memory", files,
    stat: async (path) => { const b = files.get(path); return b ? { sha256: sha256(b), bytes: b.length } : null; },
    create: async (path, bytes) => { if (files.has(path)) throw new Error(`${path} is already in the vault`); files.set(path, bytes); },
    readIndex: async (path) => files.get(path)?.toString("utf8") ?? null,
    writeIndex: async (path, text) => { files.set(path, Buffer.from(text)); },
    read: async (path) => files.get(path) ?? null,
  };
}

interface World { db: DB; bankStore: BankStore & { text: string | null }; bank: FakeAirwallex; vault: ReturnType<typeof memoryVault>; host: EngineHost; phone: FakeAuthenticator; hostOn(over?: Partial<EngineDeps>): { host: EngineHost; bank: FakeAirwallex } }

/** A company's ledger with nothing in it yet, and a host over it. `hostOn` makes another host over the same ledger and bank store. */
function world(over: Partial<EngineDeps> = {}): World {
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const bankStore = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
  const vault = memoryVault();
  const hostOn = (more: Partial<EngineDeps> = {}) => {
    const bank = standInBank(bankStore);
    const host = new EngineHost({
      db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => bankStore.save(bankToText(bank)),
      rp: { rpId: RP, origin: ORIGIN }, company: { name: "Engine Test Co", lang: "en" }, vault, feed: null, ...over, ...more,
    });
    return { host, bank };
  };
  const { host, bank } = hostOn();
  return { db, bankStore, bank, vault, host, phone: new FakeAuthenticator(), hostOn };
}

/** Seeded, the passkey set up, pdfOf(EN) uploaded and proposed: everything up to the CFO's signature. */
async function proposed(w: World) {
  await w.host.seed();
  const bytes = await pdfOf(EN);
  const up = await w.host.upload({ bytes, filename: "bergtex-BTX-2026-21.pdf" });
  const start = await w.host.passkeyStart();
  const enrolled = await w.host.passkeyFinish({ code: start.code, credential: w.phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: "Test Owner" });
  const out = await w.host.propose(up.invoice!.id);
  if (!out.ok) throw new Error(out.reason);
  return { bytes, up, start, enrolled, proposal: out.proposal };
}
const signed = (w: World, p: { id: string; terms_sha256: string }, challenge: string, counter: number) =>
  ({ proposal_id: p.id, terms_sha256: p.terms_sha256, credential: w.phone.sign({ challenge, origin: ORIGIN, rpId: RP, counter }) });

describe("the chain: one supplier invoice from upload to paid, booked and archived", () => {
  it("reads and checks the upload, files the payment, refuses a signature over other terms, and pays on the right one", async () => {
    const w = world();
    const { bytes, up, start, enrolled, proposal } = await proposed(w);

    // The upload: read by the parser, checked, ready with nothing found.
    expect(up).toMatchObject({ kind: "invoice", sha256: sha256(bytes) });
    expect(up.invoice).toEqual({
      id: "AP-0001", status: "ready", status_words: "Ready to pay", payable: true, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", total: "1850.00",
      due_date: "2026-11-16", read_by: "parser", findings: [], doc_sha256: sha256(bytes), proposal: null,
    });

    // The passkey: created against the engine's own challenge, and confirmed by the host itself.
    expect(start.exclude).toEqual([]);
    expect(enrolled).toEqual({ ok: true, credential_id: w.phone.credentialId });
    expect((await w.host.status()).passkey).toEqual({ credential_id: w.phone.credentialId, label: "Test Owner" });

    // The proposal: the exact terms' hash, the challenge the passkey signs, and the facts the phone page shows.
    expect(proposal).toMatchObject({ id: "P-0001", kind: "invoice_payment", status: "PENDING_APPROVAL", terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), warnings: [] });
    expect(proposal.challenge).toBe(challengeFor(proposal.terms_sha256));
    expect(proposal.facts).toEqual(expect.arrayContaining([["Amount", "EUR 1,850.00"], ["Payee", "Bergtex Textil GmbH, IBAN …3000"], ["On the invoice", "“Total due EUR 1,850.00”"], ["Reason", "Goods purchased"]]));
    expect(proposal.facts.flat().join(" ")).not.toMatch(/\bph\.[a-z_]+/);
    expect(w.host.proposal("P-0001")).toEqual(proposal);
    expect(w.host.invoice("AP-0001")).toMatchObject({ status: "waiting_cfo", payable: false, proposal });

    // A signature over other terms: refused, and nothing runs.
    const wrong = await w.host.approve(signed(w, proposal, challengeFor(sha256Hex("other terms")), 1));
    expect(wrong).toMatchObject({ status: "refused", settled: null });
    expect(w.bank.transfers).toHaveLength(0);
    expect(w.host.proposal("P-0001")!.status).toBe("PENDING_APPROVAL");
    expect(count(w.db, "SELECT COUNT(*) AS n FROM transfers")).toBe(0);

    // The right one: approved, run on the stand-in bank, followed, booked and archived.
    const right = await w.host.approve(signed(w, proposal, proposal.challenge, 2));
    expect(right.status).toBe("approved");
    expect(right.settled).toMatchObject({ invoice_status: "paid", transfer_status: "PAID", ledger_entries: 7, fed: false, error: null });
    expect(right.settled!.vault_added).toHaveLength(3);
    expect(w.bank.transfers).toHaveLength(1);
    expect(w.host.invoice("AP-0001")).toMatchObject({ status: "paid", status_words: "Paid", payable: false, proposal: { id: "P-0001", status: "EXECUTED" } });
    expect(w.host.invoices().map((i) => `${i.id} ${i.status}`)).toEqual(["AP-0001 paid"]);

    // Both chains verify, by the engine's own verifiers and in the host's status.
    expect(verifyAuditChain(w.db).ok).toBe(true);
    expect(verifyLedger(w.db).ok).toBe(true);
    const status = await w.host.status();
    expect(status).toMatchObject({ mode: "test_money", chains: { audit: true, ledger: true } });
    expect(status.balances.USD).toMatch(/^\d+\.\d{2}$/);

    // The archive: the original bytes, the payment's receipt and the suppliers list; only what the index lists is served.
    const files = await w.host.vaultFiles();
    expect(files.map((f) => f.kind).sort()).toEqual(["invoice", "receipt", "suppliers"]);
    expect(files.map((f) => f.path).sort()).toEqual([...right.settled!.vault_added].sort());
    const original = files.find((f) => f.kind === "invoice")!;
    expect(original).toMatchObject({ sha256: sha256(bytes), bytes: bytes.length, added_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(Buffer.from((await w.host.vaultFile(original.path))!).equals(bytes)).toBe(true);
    const index = [...w.vault.files.keys()].find((p) => p.endsWith("index.json"))!;
    expect(index).toBeTruthy();
    expect(await w.host.vaultFile(index)).toBeNull();
    expect(await w.host.vaultFile("Engine Test Co/2026/nothing.pdf")).toBeNull();

    // The receipt names the bank it ran on: test money on the stand-in bank, never the Airwallex sandbox or its fee.
    const receipt = files.find((f) => f.kind === "receipt")!;
    const { text } = await pdfText(Buffer.from((await w.host.vaultFile(receipt.path))!));
    expect(text).toContain("Test money (stand-in bank)");
    expect(text).toContain("Fee (set by the stand-in bank)");
    expect(text.replace(/, not Airwallex;|, niet Airwallex;/g, "")).not.toMatch(/Airwallex|npm run verify/);
  });

  it("seeds the treasury once, however often it is asked", async () => {
    const w = world();
    await w.host.seed();
    const first = (await w.host.status()).balances;
    await w.host.seed();
    expect((await w.host.status()).balances).toEqual(first);
    expect(first).toEqual({ USD: "25000.00", EUR: "35000.00" });
    expect(count(w.db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'treasury.seeded'")).toBe(1);
  });

  it("refuses a ledger with no document store of its own: the host has no payables folder to write to", () => {
    const db = openDb(":memory:");
    const bank = new FakeAirwallex();
    expect(() => new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, rp: { rpId: RP, origin: ORIGIN }, company: { name: "X", lang: "en" }, vault: null, feed: null })).toThrow(/document store/);
  });
});

describe("the catches, by the engine's own checks", () => {
  it("the same bytes again are a duplicate document; a renumbered copy needs a person and is not filed for payment", async () => {
    const w = world();
    await w.host.seed();
    const bytes = await pdfOf(EN);
    const first = await w.host.upload({ bytes, filename: "bergtex.pdf" });
    const again = await w.host.upload({ bytes, filename: "bergtex (copy).pdf" });
    expect(again).toMatchObject({ kind: "duplicate_document", sha256: first.sha256, invoice: { id: "AP-0001" } });
    expect(w.host.invoices()).toHaveLength(1);

    const copy = await w.host.upload({ bytes: await pdfOf(EN.replace(/BTX-2026-21/g, "BTX-2026-17")), filename: "bergtex-BTX-2026-17.pdf" });
    expect(copy.invoice).toMatchObject({ id: "AP-0002", status: "needs_review", status_words: "Needs a person", payable: false });
    expect(copy.invoice!.findings).toEqual([expect.objectContaining({ code: "possible_duplicate", level: "review", message: expect.stringContaining("AP-0001") })]);

    const out = await w.host.propose("AP-0002");
    expect(out).toEqual({ ok: false, reason: expect.stringMatching(/^AP-0002 is needs review, not ready to pay: /) });
    expect(count(w.db, "SELECT COUNT(*) AS n FROM proposals")).toBe(0);
    expect(await w.host.propose("AP-0404")).toEqual({ ok: false, reason: "no payables invoice AP-0404" });
    expect(w.host.invoice("AP-0404")).toBeNull();
    expect(w.host.proposal("P-0404")).toBeNull();
  });

  it("takes an e-mail with the invoice attached, as the inbox does", async () => {
    const w = world();
    await w.host.seed();
    const eml = emlWith(await pdfOf(EN), "bergtex.pdf");
    const out = await w.host.upload({ bytes: eml, filename: "invoice.eml" });
    expect(out).toMatchObject({ kind: "email", sha256: sha256(eml), invoice: { id: "AP-0001", status: "ready", invoice_no: "BTX-2026-21" } });
  });

  it("refuses what is not an invoice as the inbox does", async () => {
    const w = world();
    await expect(w.host.upload({ bytes: Buffer.from("not a pdf"), filename: "note.txt" })).rejects.toThrow(/is not a PDF/);
    expect(count(w.db, "SELECT COUNT(*) AS n FROM ap_documents")).toBe(0);
  });
});

describe("sync: follow the payments, book, archive, feed", () => {
  it("is safe to repeat: the second adds nothing", async () => {
    const fed: Date[] = [];
    const w = world({ feed: async (db, now) => { expect(db).toBe(w.db); fed.push(now); } });
    const { proposal } = await proposed(w);
    const paid = await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    expect(paid.settled).toMatchObject({ invoice_status: "paid", ledger_entries: 7, fed: true, error: null });
    const rows = count(w.db, "SELECT COUNT(*) AS n FROM audit_log");
    const files = w.vault.files.size;
    const one = await w.host.sync();
    const two = await w.host.sync();
    for (const s of [one, two]) expect(s).toEqual({ invoice_status: null, transfer_status: null, ledger_entries: 7, vault_added: [], fed: true, error: null });
    expect(count(w.db, "SELECT COUNT(*) AS n FROM audit_log")).toBe(rows);
    expect(w.vault.files.size).toBe(files);
    expect(w.bank.transfers).toHaveLength(1);
    expect(fed).toHaveLength(3);
  });

  it("hands back an error of the feed in settled.error; the approval and the payment stay", async () => {
    const w = world({ feed: async () => { throw new Error("the read model is away"); } });
    const { proposal } = await proposed(w);
    const paid = await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    expect(paid.status).toBe("approved");
    expect(paid.settled).toMatchObject({ invoice_status: "paid", transfer_status: "PAID", ledger_entries: 7, fed: false, error: expect.stringContaining("the read model is away") });
    expect(paid.settled!.vault_added).toHaveLength(3);
  });

  it("hands back an error of the host's own hook after the payment; the payment is still followed, booked and archived", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    const second = w.hostOn({ afterMoney: () => { throw new Error("the bank's state could not be kept"); } });
    const out = await second.host.approve(signed(w, proposal, proposal.challenge, 1));
    expect(out.status).toBe("approved");
    expect(out.settled).toMatchObject({ invoice_status: "paid", transfer_status: "PAID", ledger_entries: 7, error: "after the payment: the bank's state could not be kept" });
    expect(out.settled!.vault_added).toHaveLength(3);
  });

  it("hands back an error of the executor in settled.error; the approval stays and nothing is booked as paid", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    w.bank.createTransfer = async () => { throw new Error("the stand-in bank is away"); };
    const out = await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    expect(out.status).toBe("approved");
    expect(out.settled!.error).toContain("the stand-in bank is away");
    // The engine's own answer to a payout that may or may not be at the bank: the invoice is not offered again.
    expect(out.settled).toMatchObject({ invoice_status: "waiting_cfo", transfer_status: "SUBMITTING", fed: false });
    expect(w.host.invoice("AP-0001")).toMatchObject({ status: "waiting_cfo", payable: false, proposal: { status: "FAILED" } });
    expect(count(w.db, "SELECT COUNT(*) AS n FROM approvals WHERE proposal_id = 'P-0001' AND decision = 'APPROVED'")).toBe(1);
    expect(count(w.db, "SELECT COUNT(*) AS n FROM transfers WHERE status = 'PAID'")).toBe(0);
    expect(verifyAuditChain(w.db).ok).toBe(true);
  });
});

describe("a second host on the same ledger and bank store (as after the object's memory was dropped)", () => {
  it("shows the same balances, and its sync changes nothing", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    const before = await w.host.status();
    const rows = count(w.db, "SELECT COUNT(*) AS n FROM audit_log");

    const second = w.hostOn();
    expect(second.bank).not.toBe(w.bank);
    expect(await second.host.status()).toEqual(before);
    expect(await second.host.sync()).toEqual({ invoice_status: null, transfer_status: null, ledger_entries: 7, vault_added: [], fed: false, error: null });
    expect(count(w.db, "SELECT COUNT(*) AS n FROM audit_log")).toBe(rows);
    expect(second.bank.transfers).toHaveLength(1);
    expect(second.host.invoices().map((i) => i.status)).toEqual(["paid"]);
    await second.host.seed();
    expect((await second.host.status()).balances).toEqual(before.balances);
  });

  it("pays a proposal the first host filed: the bank's quote came back from the store", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    const second = w.hostOn();
    const out = await second.host.approve(signed(w, proposal, proposal.challenge, 1));
    expect(out).toMatchObject({ status: "approved", settled: { invoice_status: "paid", transfer_status: "PAID", error: null } });
    expect(second.bank.transfers).toHaveLength(1);
  });
});

describe("one engine action at a time", () => {
  it("two approvals at once run one after the other and make one transfer", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    const [a, b] = await Promise.all([
      w.host.approve(signed(w, proposal, proposal.challenge, 1)),
      w.host.approve(signed(w, proposal, proposal.challenge, 2)),
    ]);
    expect(a).toMatchObject({ status: "approved", settled: { invoice_status: "paid", transfer_status: "PAID" } });
    // The second began only after the first had run to its end: it finds the proposal executed.
    expect(b).toEqual({ status: "already", message: "P-0001 is already EXECUTED", settled: null });
    expect(w.bank.transfers).toHaveLength(1);
    expect(count(w.db, "SELECT COUNT(*) AS n FROM transfers")).toBe(1);
    expect(count(w.db, "SELECT COUNT(*) AS n FROM approvals")).toBe(1);
  });

  it("a write that fails does not hold up the next one, and the reads do not wait", async () => {
    const w = world();
    await w.host.seed();
    const bad = w.host.upload({ bytes: Buffer.from("not a pdf"), filename: "note.txt" });
    const good = w.host.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(w.host.invoices()).toEqual([]);
    await expect(bad).rejects.toThrow(/is not a PDF/);
    expect((await good).invoice).toMatchObject({ id: "AP-0001", status: "ready" });
  });
});

describe("the engine's events", () => {
  it("page by seq, carry a short list of fields per event, and never the invoice's IBAN", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    const rows = count(w.db, "SELECT COUNT(*) AS n FROM audit_log");

    const first = w.host.events(0, 5);
    expect(first.items.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(first.next).toBe(5);
    const all: EngineEvent[] = [...first.items];
    for (let after = first.next; ;) {
      const page = w.host.events(after, 7);
      if (!page.items.length) { expect(page.next).toBe(after); break; }
      expect(page.items.length).toBeLessThanOrEqual(7);
      expect(page.items[0]!.seq).toBe(after + 1);
      all.push(...page.items);
      after = page.next;
    }
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: rows }, (_, i) => i + 1));
    expect(w.host.events(0).items.length).toBe(Math.min(rows, 100));
    expect(w.host.events(0, 100_000).items.length).toBeLessThanOrEqual(200);

    const by = (event: string) => all.filter((e) => e.event === event);
    expect(by("ap.received")[0]).toMatchObject({ actor: "system", subject: "AP-0001", fields: { status: "ready", read_by: "parser", amount: "1850.00", currency: "EUR", findings: "" } });
    expect(by("ap.status").map((e) => e.fields.status)).toEqual(["waiting_cfo", "paid"]);
    expect(by("proposal.created")[0]!.fields).toEqual({ kind: "invoice_payment" });
    expect(by("proposal.approved")[0]!.fields).toEqual({ method: "passkey" });
    expect(by("transfer.created")[0]!.fields).toMatchObject({ amount: "1850.00", currency: "EUR", status: "PROCESSING" });
    expect(by("transfer.fee")[0]!.fields).toEqual({ amount: "13.40", currency: "EUR" });
    expect(by("vault.filed")[0]!.fields).toEqual({ files: 3, corrections: 0 });
    // An event that is not on the list says that it happened and nothing else.
    expect(by("setting.changed")[0]).toMatchObject({ subject: null, fields: {} });
    for (const e of all) {
      expect(Object.keys(e).sort()).toEqual(["actor", "event", "fields", "seq", "subject", "ts"]);
      for (const v of Object.values(e.fields)) expect(["string", "number", "boolean"].includes(typeof v) || v === null).toBe(true);
    }
    // The ledger holds the IBAN (the reading, the payee); the events never do, whole or in groups of four.
    const text = JSON.stringify(all);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain("DE89 3704");
    expect(text).not.toContain(IBAN.slice(4, 18));
  });

  it("a Claude call shows its model, source, request id and cost, never what was read", () => {
    const row = (event: string, payload: unknown) => ({ seq: 9, ts: "2026-11-12T10:00:00.000Z", actor: "treasury", event, subject: "ap.read:a72f0ce87b064fea", payload_json: JSON.stringify(payload) });
    expect(publicEvent(row("claude.read", { model: "claude-sonnet-5-5", request_id: "req_1", input_sha256: "ab", output: { iban: IBAN, vendor: "Bergtex" }, usage: { input: 10 }, latency_ms: 900, cost_usd_micros: 4200 })))
      .toEqual({ seq: 9, ts: "2026-11-12T10:00:00.000Z", actor: "treasury", event: "claude.read", subject: "ap.read:a72f0ce87b064fea", fields: { source: "claude", model: "claude-sonnet-5-5", request_id: "req_1", cost_usd_micros: 4200 } });
    expect(publicEvent(row("claude.fallback", { model: "claude-sonnet-5-5", input_sha256: "ab", note: "call failed: API 401", output: { iban: IBAN } })).fields).toEqual({ source: "fallback", model: "claude-sonnet-5-5" });
    expect(publicEvent(row("something.new", { iban: IBAN, status: "x" }))).toMatchObject({ event: "something.new", subject: null, fields: {} });
    // A field of the wrong shape (an object where text is expected) is left out, and a broken payload carries nothing.
    expect(publicEvent(row("transfer.status", { status: { nested: IBAN } })).fields).toEqual({});
    expect(publicEvent({ ...row("transfer.status", {}), payload_json: "not json" }).fields).toEqual({});
  });
});

describe("the stand-in bank kept as text", () => {
  it("comes back with every field: balances, quotes (a Map), transfers", async () => {
    const w = world();
    const { proposal } = await proposed(w);
    await w.host.approve(signed(w, proposal, proposal.challenge, 1));
    const text = bankToText(w.bank);
    expect(w.bankStore.text).toBe(text);
    expect(text).not.toContain("=>");
    const back = bankFromText(text);
    expect(back).toBeInstanceOf(FakeAirwallex);
    expect(back).not.toBe(w.bank);
    expect(back.quotes).toBeInstanceOf(Map);
    expect([...back.quotes.keys()]).toEqual([...w.bank.quotes.keys()]);
    expect(back.transfers).toEqual(w.bank.transfers);
    expect(await back.balances()).toEqual(await w.bank.balances());
    expect(typeof back.clock()).toBe("number");
    const calls = back.calls.length;
    expect(JSON.parse(bankToText(back))).toEqual({ ...JSON.parse(text), calls: expect.any(Array) });
    expect(calls).toBeGreaterThan(0);
  });

  it("starts a new bank when the store holds none, and saves nothing by itself", () => {
    const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
    const bank = standInBank(store);
    expect(bank).toBeInstanceOf(FakeAirwallex);
    expect(bank.transfers).toEqual([]);
    expect(store.text).toBeNull();
  });
});
