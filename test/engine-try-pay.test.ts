// The hands-on demo's one pay route (POST /v1/engine/proposals/{id}/pay, src/engine/host.ts paySigned): the visitor's
// approval is held, then the visitor's terms go through the product's own verifier and executor with the visitor's
// own signature. A change is refused by both layers and moves nothing; the signed terms pay through the same route,
// once. Through HTTP on the Node engine (test money on a simulated bank) with a software authenticator; the expired and
// failed cases on the engine host itself, whose clock and bank a test can move. Nothing reaches the network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { openDb } from "../src/db/open.js";
import { pdfOf } from "../src/e2e/documents.js";
import { EngineHost, parserOnly, type PaySignedResult } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { SAMPLE_SOURCES } from "../src/engine/tryWorld.js";
import { canonicalTerms, termsHash, type Terms } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { SyncBatch } from "../cloud/src/sync.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { importGraph } from "./support/importGraph.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

interface Proposal { id: string; status: string; terms_sha256: string; challenge: string }
interface TermsView { proposal_id: string; status: string; terms: Record<string, unknown>; canonical: string; terms_sha256: string; approved: boolean; expires_at: string }
type Pay = PaySignedResult & { sandbox_calls: number; request_id: string };

let c: TestCloud;
beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
});
afterAll(() => c.close());

let n = 0;
/** A visitor's company with the clean sample filed for approval and the approval passkey set up. */
async function visitor(): Promise<{ s: string; tenant: string; phone: FakeAuthenticator; proposal: Proposal }> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `203.0.113.${++n}` } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  const s = r.json.session as string;
  const up = await c.req("POST", "/v1/engine/samples/clean", { key: s });
  const invoice = (up.json.invoice as { id: string }).id;
  const phone = new FakeAuthenticator();
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
  expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
  const p = await c.req("POST", `/v1/engine/invoices/${invoice}/pay`, { key: s });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  return { s, tenant: r.json.tenant as string, phone, proposal: p.json.proposal as Proposal };
}
const terms = async (s: string, id: string) => (await c.req("GET", `/v1/engine/proposals/${id}/terms`, { key: s })).json as unknown as TermsView;
const transfers = async (s: string) => ((await c.req("GET", "/v1/payments", { key: s })).json.items as unknown[]).length;
const pay = async (s: string, id: string, t: Record<string, unknown>, credential: unknown) => {
  const r = await c.req("POST", `/v1/engine/proposals/${id}/pay`, { key: s, body: { terms: t, credential } });
  return { status: r.status, json: r.json as unknown as Pay & { code?: string; message?: string } };
};

describe("one visitor: approve (held), change and be refused by both layers, then pay the signed terms once", () => {
  let v: Awaited<ReturnType<typeof visitor>>;
  let approval: unknown;
  let signedTerms: Record<string, unknown>;
  let signedCanonical: string;

  beforeAll(async () => {
    v = await visitor();
  });

  it("shows the terms the passkey signs: the object, its canonical text and hash, not yet approved", async () => {
    const t = await terms(v.s, v.proposal.id);
    expect(t).toMatchObject({ proposal_id: v.proposal.id, status: "PENDING_APPROVAL", approved: false, terms_sha256: v.proposal.terms_sha256 });
    expect(t.canonical).toBe(canonicalTerms(t.terms as Terms));
    expect(termsHash(t.terms as Terms)).toBe(t.terms_sha256);
    expect(t.terms).toMatchObject({ kind: "invoice_payment", amount: "1850.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000" });
    signedTerms = t.terms;
    signedCanonical = t.canonical;
    expect((await c.req("GET", "/v1/engine/proposals/P-0404/terms", { key: v.s })).status).toBe(404);
  });

  it("before the approval: not_signed, and nothing else runs", async () => {
    const r = await pay(v.s, v.proposal.id, signedTerms, v.phone.sign({ challenge: v.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: "not_signed", layers: { signature: { verified: null }, executor: { accepted: null } }, transfers_before: 0, transfers_after: 0, settled: null, sandbox_calls: 0 });
  });

  it("holds the approval of a test company: approved, and nothing is paid", async () => {
    approval = v.phone.sign({ challenge: v.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    const r = await c.req("POST", `/v1/engine/proposals/${v.proposal.id}/approve`, { key: v.s, body: { terms_sha256: v.proposal.terms_sha256, credential: approval } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toEqual({ status: "approved", message: expect.any(String), settled: null, held: true });
    expect(await transfers(v.s)).toBe(0);
    expect(await terms(v.s, v.proposal.id)).toMatchObject({ status: "APPROVED", approved: true });
  });

  for (const [key, value] of [["amount", "1850.01"], ["beneficiary_name", "Bergtex Textil GmbH Ltd"], ["iban_last4", "9999"]] as const) {
    it(`refuses ${key} changed, with the approval's own signature, by both layers, and moves nothing`, async () => {
      const sent = { ...signedTerms, [key]: value };
      const r = await pay(v.s, v.proposal.id, sent, approval);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({
        outcome: "refused", changed: [key], signed_sha256: v.proposal.terms_sha256, sent_sha256: termsHash(sent as Terms),
        layers: { signature: { verified: false, reason: "This signature is over other terms than the ones on screen. Nothing was paid." }, executor: { accepted: false, said: expect.stringMatching(/approved hash/) } },
        transfers_before: 0, transfers_after: 0, settled: null, sandbox_calls: 0, request_id: expect.stringMatching(/^req_/),
      });
      expect(r.json.sent_sha256).not.toBe(r.json.signed_sha256);
      // The stored terms are byte for byte as signed, still approved and held.
      const after = await terms(v.s, v.proposal.id);
      expect(after.canonical).toBe(signedCanonical);
      expect(after).toMatchObject({ status: "APPROVED", terms_sha256: v.proposal.terms_sha256 });
    });
  }

  it("a fresh signature over the changed terms, from the same authenticator, passes the signature layer and is refused by the executor's", async () => {
    const sent = { ...signedTerms, amount: "1850.01" };
    const fresh = v.phone.sign({ challenge: challengeFor(termsHash(sent as unknown as Terms)), origin: ORIGIN, rpId: RP, counter: 2 });
    const r = await pay(v.s, v.proposal.id, sent, fresh);
    expect(r.json).toMatchObject({ outcome: "refused", layers: { signature: { verified: true }, executor: { accepted: false, said: expect.stringMatching(/approved hash/) } }, transfers_after: 0 });
    expect((await terms(v.s, v.proposal.id)).canonical).toBe(signedCanonical);
  });

  it("a wrong or missing signature with the signed terms is refused by the signature layer and pays nothing", async () => {
    const other = new FakeAuthenticator().sign({ challenge: v.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    const wrong = await pay(v.s, v.proposal.id, signedTerms, other);
    expect(wrong.json).toMatchObject({ outcome: "refused", changed: [], layers: { signature: { verified: false }, executor: { accepted: true } }, transfers_after: 0 });
    const missing = await pay(v.s, v.proposal.id, signedTerms, {});
    expect(missing.json).toMatchObject({ outcome: "refused", layers: { signature: { verified: false, reason: "This signature could not be read. Nothing was paid." }, executor: { accepted: true } }, transfers_after: 0 });
    expect(await transfers(v.s)).toBe(0);
  });

  it("refuses another key changed, or a shape that does not fit, with a 400", async () => {
    for (const sent of [{ ...signedTerms, bic: "DEUTDEFFXXX" }, { ...signedTerms, extra: "x" }, { ...signedTerms, amount: "1850.1" }, { ...signedTerms, iban_last4: "12" }, { ...signedTerms, beneficiary_name: "x".repeat(141) }]) {
      const r = await pay(v.s, v.proposal.id, sent, approval);
      expect(r.status, JSON.stringify(sent).slice(0, 80)).toBe(400);
      expect(r.json.code).toBe("bad_terms");
    }
    const { amount: _drop, ...without } = signedTerms;
    expect((await pay(v.s, v.proposal.id, without, approval)).status).toBe(400);
    expect((await pay(v.s, v.proposal.id, { ...signedTerms, bic: "DEUTDEFFXXX" }, approval)).json.message).toBe("only the amount, the payee and the account ending can be changed here");
  });

  it("pays the signed terms through the same route: paid on the simulated bank, booked, one transfer more", async () => {
    const r = await pay(v.s, v.proposal.id, signedTerms, approval);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ outcome: "paid", changed: [], signed_sha256: v.proposal.terms_sha256, sent_sha256: v.proposal.terms_sha256,
      layers: { signature: { verified: true }, executor: { accepted: true } }, transfers_before: 0, transfers_after: 1, settled: { invoice_status: "paid", error: null } });
    expect(await transfers(v.s)).toBe(1);
    expect(((await c.req("GET", "/v1/engine/invoices", { key: v.s })).json.items as { status: string }[])[0]!.status).toBe("paid");
    expect(((await c.req("GET", "/v1/ledger/entries", { key: v.s })).json.items as unknown[]).length).toBeGreaterThan(0);
  });

  it("a second send answers paid_once and pays nothing; a change after it is refused", async () => {
    const again = await pay(v.s, v.proposal.id, signedTerms, approval);
    expect(again.json).toMatchObject({ outcome: "paid_once", transfers_before: 1, transfers_after: 1, settled: null });
    const changed = await pay(v.s, v.proposal.id, { ...signedTerms, amount: "1.00" }, approval);
    expect(changed.json).toMatchObject({ outcome: "refused", transfers_after: 1 });
    // Even with a fresh signature over the changed terms: they were never paid, so not "paid once".
    const sent = { ...signedTerms, amount: "9999.00" };
    const fresh = v.phone.sign({ challenge: challengeFor(termsHash(sent as unknown as Terms)), origin: ORIGIN, rpId: RP, counter: 5 });
    expect((await pay(v.s, v.proposal.id, sent, fresh)).json).toMatchObject({ outcome: "refused", layers: { signature: { verified: true } }, transfers_after: 1 });
  });

  it("writes every attempt to the company's own record, with no values", async () => {
    const ev = await c.req("GET", "/v1/engine/events?after=0&limit=200", { key: v.s });
    const tries = (ev.json.items as { event: string }[]).filter((e) => e.event === "try.pay");
    expect(tries.length).toBeGreaterThanOrEqual(8);
  });
});

describe("the pay route's edges", () => {
  it("answers 404 for another company's proposal", async () => {
    const a = await visitor();
    const b = await visitor();
    const t = await terms(a.s, a.proposal.id);
    // B has a P-0001 of its own; A's P-0002 is not B's.
    expect((await pay(b.s, "P-0002", t.terms, {})).status).toBe(404);
    expect((await c.req("GET", "/v1/engine/proposals/P-0002/terms", { key: b.s })).status).toBe(404);
  });

  it("is for a test company only; a company the admin made still pays at once on approve", async () => {
    const T = await c.tenant("console-co");
    const up = await c.req("POST", "/v1/engine/samples/clean", { key: T.session });
    const p = await c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: T.session });
    const proposal = p.json.proposal as Proposal;
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: T.session });
    await c.req("POST", "/v1/engine/passkey/finish", { key: T.session, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    const t = await terms(T.session, proposal.id);
    expect((await pay(T.session, proposal.id, t.terms, {})).status).toBe(403);
    const a = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: T.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } });
    expect(a.json).toMatchObject({ status: "approved", settled: { invoice_status: "paid" } });
    expect(a.json.held).toBeUndefined();
  });

  it("refuses a body over 8 KB and a credential over 4 KB", async () => {
    const v = await visitor();
    const t = await terms(v.s, v.proposal.id);
    expect((await pay(v.s, v.proposal.id, t.terms, { pad: "x".repeat(4_100) })).status).toBe(400);
    expect((await pay(v.s, v.proposal.id, { ...t.terms, pad: "x".repeat(9_000) }, {})).status).toBe(400);
  });
});

describe("the export", () => {
  it("is the product's sync format: it parses, and applySync writes it into a fresh tenant whose invoices and ledger match", async () => {
    const v = await visitor();
    const approval = v.phone.sign({ challenge: v.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    await c.req("POST", `/v1/engine/proposals/${v.proposal.id}/approve`, { key: v.s, body: { terms_sha256: v.proposal.terms_sha256, credential: approval } });
    expect((await pay(v.s, v.proposal.id, (await terms(v.s, v.proposal.id)).terms, approval)).json.outcome).toBe("paid");
    const r = await c.req("GET", "/v1/engine/export", { key: v.s });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-disposition")).toBe('attachment; filename="purser-test-company.json"');
    const doc = r.json as { format: string; company: string; made_at: string; batches: unknown[] };
    expect(doc).toMatchObject({ format: "purser.cloud-sync/v1", company: expect.stringMatching(/\(test\)$/) });
    // No archive files: the documents are the invoices' own, and nothing else.
    const docs = doc.batches.flatMap((b) => ((b as { documents?: { sha256: string; filename: string }[] }).documents ?? []));
    const invoices = ((await c.req("GET", "/v1/invoices", { key: v.s })).json.items as { doc_sha256: string }[]).map((i) => i.doc_sha256);
    expect(docs.map((d) => d.sha256).sort()).toEqual([...invoices].sort());
    expect(docs.map((d) => d.filename).join(" ")).not.toMatch(/vault|receipt/i);
    for (const b of doc.batches) expect(SyncBatch.safeParse(b).success).toBe(true);
    // Into a fresh company of another cloud, with the cloud's own sync route.
    const fresh = testCloud();
    try {
      const T = await fresh.tenant("restored");
      for (const b of doc.batches) expect((await fresh.req("POST", "/v1/sync", { key: T.key, body: b })).status).toBe(200);
      const strip = (items: Record<string, unknown>[]) => items.map((i) => ({ ...i, tenant_id: undefined }));
      for (const path of ["/v1/invoices", "/v1/ledger/entries"]) {
        const mine = (await c.req("GET", path, { key: v.s })).json.items as Record<string, unknown>[];
        const theirs = (await fresh.req("GET", path, { key: T.key })).json.items as Record<string, unknown>[];
        expect(mine.length, path).toBeGreaterThan(0);
        expect(strip(theirs), path).toEqual(strip(mine));
      }
    } finally { fresh.close(); }
  });

  it("is downloaded at most 5 times by a test company", async () => {
    const v = await visitor();
    for (let i = 0; i < 5; i++) expect((await c.req("GET", "/v1/engine/export", { key: v.s })).status).toBe(200);
    expect((await c.req("GET", "/v1/engine/export", { key: v.s })).status).toBe(429);
  });
});

describe("the import graph", () => {
  it("the pay route and the engine host reach the simulated bank only, never the Airwallex sandbox client", async () => {
    for (const entry of ["cloud/src/try/engineRoutes.ts", "src/engine/host.ts", "cloud/src/engine/node.ts"]) {
      const files = [...(await importGraph(entry))];
      expect(files.length, entry).toBeGreaterThan(5);
      expect(files.filter((f) => /src\/rails\/sandboxPayout|cloud\/src\/try\/rail/.test(f)), entry).toEqual([]);
    }
  });
});

describe("on the engine host, whose clock and bank a test moves", () => {
  const RP2 = "engine.example.invalid";
  const ORIGIN2 = `https://${RP2}`;
  function memoryDocs(): DocStore {
    const kept = new Map<string, Buffer>();
    return { put: (sha, bytes) => { kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; }, get: (p) => kept.get(p)! };
  }
  async function held(clock: { now: Date }) {
    const db = openDb(":memory:");
    useDocStore(db, memoryDocs());
    const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
    const bank = standInBank(store);
    const host = new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)), rp: { rpId: RP2, origin: ORIGIN2 },
      company: { name: "Try Co (test)", lang: "en" }, vault: null, feed: null, now: () => clock.now, maxDocuments: 8 });
    await host.seed();
    const up = await host.upload({ bytes: await pdfOf(SAMPLE_SOURCES[0]!.text), filename: "clean.pdf" });
    const phone = new FakeAuthenticator();
    const st = await host.passkeyStart();
    await host.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN2, rpId: RP2 }), label: "Visitor" });
    const p = await host.propose(up.invoice!.id);
    if (!p.ok) throw new Error(p.reason);
    const credential = phone.sign({ challenge: p.proposal.challenge, origin: ORIGIN2, rpId: RP2, counter: 1 });
    const a = await host.approve({ proposal_id: p.proposal.id, terms_sha256: p.proposal.terms_sha256, credential, hold: true });
    expect(a).toMatchObject({ status: "approved", held: true, settled: null });
    return { db, bank, host, proposal: p.proposal, credential, signed: host.terms(p.proposal.id)!.terms as Record<string, unknown> };
  }

  it("reports the signed hash as stored, never one recomputed from terms that may have changed", async () => {
    const clock = { now: new Date() };
    const w = await held(clock);
    // Were the payment instruction ever changed outside the route, the signed hash still says what was signed.
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...w.signed, amount: "1.00" }), w.proposal.id);
    expect(w.host.terms(w.proposal.id)!.terms_sha256).toBe(w.proposal.terms_sha256);
    const out = await w.host.paySigned(w.proposal.id, w.signed, w.credential) as PaySignedResult;
    expect(out.signed_sha256).toBe(w.proposal.terms_sha256);
    // The executor's own gate, run for real, refuses the changed instruction: nothing moves.
    expect(out.outcome).toBe("failed");
    expect(w.bank.transfers).toHaveLength(0);
  });

  it("an expired proposal answers expired, and its stored state is as it was", async () => {
    const clock = { now: new Date() };
    const w = await held(clock);
    clock.now = new Date(clock.now.getTime() + 3 * 86_400_000);
    const out = await w.host.paySigned(w.proposal.id, w.signed, w.credential) as PaySignedResult;
    expect(out).toMatchObject({ outcome: "expired", layers: { signature: { verified: true }, executor: { accepted: false, said: expect.stringMatching(/expired/) } }, transfers_after: 0 });
    expect(w.host.terms(w.proposal.id)!.status).toBe("APPROVED");
    expect(w.bank.transfers).toHaveLength(0);
  });

  it("a proposal whose payment failed answers failed and runs nothing here; the retry route pays it", async () => {
    const clock = { now: new Date() };
    const w = await held(clock);
    w.bank.createTransfer = async () => { throw new Error("the stand-in bank is away"); };
    const first = await w.host.paySigned(w.proposal.id, w.signed, w.credential) as PaySignedResult;
    expect(first).toMatchObject({ outcome: "failed", settled: { error: expect.stringContaining("away") } });
    expect(w.host.terms(w.proposal.id)!.status).toBe("FAILED");
    delete (w.bank as { createTransfer?: unknown }).createTransfer;
    const again = await w.host.paySigned(w.proposal.id, w.signed, w.credential) as PaySignedResult;
    expect(again).toMatchObject({ outcome: "failed", settled: null, transfers_after: 0 });
    expect((await w.host.retry(w.proposal.id)).settled).toMatchObject({ invoice_status: "paid" });
    expect(w.bank.transfers).toHaveLength(1);
  });

  it("held: the approval is stored, and the bank made no transfer", async () => {
    const clock = { now: new Date() };
    const w = await held(clock);
    expect(w.bank.transfers).toHaveLength(0);
    expect(w.host.terms(w.proposal.id)!.approved).toBe(true);
  });
});
