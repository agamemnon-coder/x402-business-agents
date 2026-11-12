// The engine's actions as routes of the cloud's API (cloud/src/engine/routes.ts), behind the cloud's own gates. Here
// the engine is the Node one (cloud/src/engine/node.ts: an EngineHost per company on better-sqlite3 in memory, the
// stand-in bank on test money, the parser as reader); the Durable Object answers the same routes through the same
// interface (cloud/src/engine/api.ts). The CFO's phone is a software passkey. Nothing reaches the network.
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { sessionToken } from "../cloud/src/auth.js";
import { blobVault, vaultKey } from "../cloud/src/engine/vaultR2.js";
import { sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const IBAN = "DE89370400440532013000";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
/** A renumbered copy of the same invoice: the engine holds it for a person (possible duplicate). */
const EN_COPY = EN.replace(/BTX-2026-21/g, "BTX-2026-21A");
const ENGINE_ROUTES = ROUTES.filter((r) => r.path === "/v1/engine" || r.path.startsWith("/v1/engine/"));
const at = (path: string) => path.replace("{id}", "AP-0001");

interface Proposal { id: string; kind: string; status: string; terms_sha256: string; challenge: string; facts: [string, string][]; warnings: string[] }
interface Invoice { id: string; status: string; payable: boolean; vendor: string; total: string; findings: { code: string }[]; doc_sha256: string; proposal: Proposal | null }
interface Settled { invoice_status: string | null; transfer_status: string | null; ledger_entries: number; vault_added: string[]; fed: boolean; error: string | null }

let c: TestCloud;
let A: TestTenant;
let B: TestTenant;
let viewer: string;
let reader: string;
let bytes: Buffer;
const phone = new FakeAuthenticator();

beforeAll(async () => {
  c = testCloud({ engine: true });
  A = await c.tenant("northwind");
  B = await c.tenant("bravo");
  // The engine speaks the company's language; this company's is English.
  expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
  const v = await c.req("POST", "/v1/users", { key: A.session, body: { display_name: "Vera Viewer", role: "viewer" } });
  viewer = await sessionToken(c.env.sessionSecret, { tenantId: A.id, userId: v.json.id as string, role: "viewer", gen: 0 }, c.clock.now);
  reader = (await c.req("POST", "/v1/keys", { key: A.session, body: { name: "read only", scopes: ["read"] } })).json.api_key as string;
  bytes = await pdfOf(EN);
});
afterAll(() => c.close());

describe("the route table", () => {
  it("holds the engine's twelve routes, each with what it needs", () => {
    expect(ENGINE_ROUTES.map((r) => `${r.method} ${r.path} ${r.need}`)).toEqual([
      "GET /v1/engine read",
      "POST /v1/engine/documents admin",
      "GET /v1/engine/invoices read",
      "POST /v1/engine/invoices/{id}/pay admin",
      "GET /v1/engine/proposals/{id} read",
      "POST /v1/engine/passkey/start admin",
      "POST /v1/engine/passkey/finish admin",
      "POST /v1/engine/proposals/{id}/approve admin",
      "POST /v1/engine/sync admin",
      "GET /v1/engine/events read",
      "GET /v1/engine/vault read",
      "GET /v1/engine/vault/file read",
    ]);
    // One block: nothing else stands between them.
    const first = ROUTES.indexOf(ENGINE_ROUTES[0]!);
    expect(ROUTES.slice(first, first + ENGINE_ROUTES.length)).toEqual(ENGINE_ROUTES);
  });
});

describe("one supplier invoice, from upload to paid, booked and archived, over HTTP with an owner's session", () => {
  let proposal: Proposal;

  it("says where the engine stands: test money, no passkey yet, both chains whole", async () => {
    const r = await c.req("GET", "/v1/engine", { key: A.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mode: "test_money", passkey: null, chains: { audit: true, ledger: true } });
    expect(Number((r.json.balances as Record<string, string>).EUR)).toBeGreaterThan(0);
  });

  it("takes the upload: read by the parser, checked, ready to pay", async () => {
    const r = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: b64(bytes) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ kind: "invoice", sha256: sha256(bytes) });
    expect(r.json.invoice).toMatchObject({ id: "AP-0001", status: "ready", status_words: "Ready to pay", payable: true, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", total: "1850.00", read_by: "parser", findings: [], doc_sha256: sha256(bytes), proposal: null });
    const list = await c.req("GET", "/v1/engine/invoices", { key: A.session });
    expect(list.status).toBe(200);
    expect((list.json.items as Invoice[]).map((i) => `${i.id} ${i.status}`)).toEqual(["AP-0001 ready"]);
  });

  it("files the payment for approval: the exact terms' hash, what the passkey signs, and the facts a person reads", async () => {
    const r = await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    proposal = r.json.proposal as Proposal;
    expect(proposal).toMatchObject({ id: "P-0001", kind: "invoice_payment", status: "PENDING_APPROVAL", terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), warnings: [] });
    expect(proposal.challenge).toBe(challengeFor(proposal.terms_sha256));
    expect(proposal.facts).toEqual(expect.arrayContaining([["Amount", "EUR 1,850.00"], ["Payee", "Bergtex Textil GmbH, IBAN …3000"]]));

    const one = await c.req("GET", "/v1/engine/proposals/P-0001", { key: A.session });
    expect(one.status).toBe(200);
    expect(one.json).toEqual({ proposal });
    expect((await c.req("GET", "/v1/engine/proposals/P-0999", { key: A.session })).status).toBe(404);

    // Filed once: a second time the engine says why not.
    const twice = await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session });
    expect(twice.status).toBe(409);
    expect(twice.json.error).toMatch(/^AP-0001 is waiting cfo, not ready to pay/);
    expect((await c.req("POST", "/v1/engine/invoices/AP-0404/pay", { key: A.session })).status).toBe(404);
  });

  it("sets up the approval passkey of the signed-in person, on the cloud's own relying party", async () => {
    const start = await c.req("POST", "/v1/engine/passkey/start", { key: A.session });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    expect(start.json).toEqual({
      challenge: expect.stringMatching(/^[A-Za-z0-9_-]{20,}$/), code: expect.any(String), rp: { id: RP, name: "Purser" },
      user: { id: A.owner, name: "Owner", displayName: "Owner" }, exclude: [],
    });
    // A passkey made for another challenge is refused, in the engine's words.
    const other = await c.req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: start.json.code, credential: new FakeAuthenticator().register({ challenge: "bm90LXRoZS1jaGFsbGVuZ2U", origin: ORIGIN, rpId: RP }) } });
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("conflict");

    const again = await c.req("POST", "/v1/engine/passkey/start", { key: A.session });
    const done = await c.req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: again.json.code, credential: phone.register({ challenge: again.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json).toEqual({ credential_id: phone.credentialId });
    // The label is the signed-in person's name, never something the request says.
    expect((await c.req("GET", "/v1/engine", { key: A.session })).json.passkey).toEqual({ credential_id: phone.credentialId, label: "Owner" });
    expect((await c.req("POST", "/v1/engine/passkey/start", { key: A.session })).json.exclude).toEqual([phone.credentialId]);
  });

  it("refuses a signature over other terms: nothing is paid", async () => {
    const r = await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: A.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: challengeFor(sha256Hex("other terms")), origin: ORIGIN, rpId: RP, counter: 1 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: "refused", settled: null });
    expect(r.json.message).toEqual(expect.any(String));
    expect(((await c.req("GET", "/v1/engine/invoices", { key: A.session })).json.items as Invoice[])[0]).toMatchObject({ id: "AP-0001", status: "waiting_cfo" });
    expect((await c.req("GET", "/v1/payments", { key: A.session })).json.items).toEqual([]);
  });

  it("pays on the right signature: paid on the stand-in bank, booked, archived, and the read model fed", async () => {
    const r = await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: A.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 2 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: "approved", message: expect.stringContaining("P-0001 approved") });
    const settled = r.json.settled as Settled;
    expect(settled).toMatchObject({ invoice_status: "paid", transfer_status: "PAID", ledger_entries: 7, fed: true, error: null });
    expect(settled.vault_added).toHaveLength(3);

    // The read model, through the routes every console screen already uses.
    const invoices = (await c.req("GET", "/v1/invoices", { key: A.session })).json.items as { id: string; status: string }[];
    expect(invoices.find((i) => i.id === "AP-0001")).toMatchObject({ status: "paid", vendor: "Bergtex Textil GmbH", total: "1850.00" });
    const doc = await c.req("GET", "/v1/invoices/AP-0001/document", { key: A.session });
    expect(Buffer.from(await doc.res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await c.req("GET", "/v1/ledger/entries", { key: A.session })).json.items).toHaveLength(7);
    expect(((await c.req("GET", "/v1/payments", { key: A.session })).json.items as { status: string }[]).map((p) => p.status)).toEqual(["PAID"]);
    expect((await c.req("GET", "/v1/engine", { key: A.session })).json.chains).toEqual({ audit: true, ledger: true });
  });

  it("follows, books, archives and feeds again on request, and adds nothing", async () => {
    const r = await c.req("POST", "/v1/engine/sync", { key: A.key });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ invoice_status: null, transfer_status: null, ledger_entries: 7, vault_added: [], fed: true, error: null });
  });

  it("pages the engine's events by seq, and none carries the invoice's IBAN", async () => {
    const first = await c.req("GET", "/v1/engine/events?after=0&limit=5", { key: reader });
    expect(first.status).toBe(200);
    const items = first.json.items as { seq: number; event: string; fields: Record<string, unknown> }[];
    expect(items.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(first.json.next).toBe(5);
    const all = await c.req("GET", "/v1/engine/events", { key: reader });
    const events = all.json.items as { seq: number; event: string }[];
    expect(events.length).toBeGreaterThan(5);
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["treasury.seeded", "ap.received", "proposal.created", "passkey.enrolled", "proposal.approved", "transfer.created"]));
    const rest = await c.req("GET", `/v1/engine/events?after=${all.json.next as number}`, { key: reader });
    expect(rest.json).toEqual({ items: [], next: all.json.next });
    expect(JSON.stringify(all.json)).not.toContain(IBAN);
    for (const bad of ["after=-1", "after=x", "limit=0", "limit=201", "limit=1.5"]) expect((await c.req("GET", `/v1/engine/events?${bad}`, { key: reader })).status, bad).toBe(400);
  });

  it("lists the archive and hands out a file the index lists, and only such a file", async () => {
    const r = await c.req("GET", "/v1/engine/vault", { key: reader });
    expect(r.status).toBe(200);
    const files = r.json.files as { path: string; kind: string; bytes: number; sha256: string; added_at: string }[];
    expect(files.map((f) => f.kind).sort()).toEqual(["invoice", "receipt", "suppliers"]);
    // The archive is under the company's own prefix in the cloud's document store.
    expect((await c.env.blobs.list(`t/${A.id}/vault/`)).length).toBe(4);
    expect(await c.env.blobs.list(`t/${B.id}/vault/`)).toEqual([]);

    for (const f of files) {
      const got = await c.req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(f.path)}`, { key: reader });
      expect(got.status, f.path).toBe(200);
      const body = Buffer.from(await got.res.arrayBuffer());
      expect(sha256(body)).toBe(f.sha256);
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(got.res.headers.get("content-type")).toBe("application/pdf");
      expect(got.res.headers.get("content-disposition")).toMatch(/^attachment; filename="[\w.-]+\.pdf"$/);
      expect(got.res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(got.res.headers.get("cache-control")).toBe("no-store");
    }
    const original = files.find((f) => f.kind === "invoice")!;
    expect(original.sha256).toBe(sha256(bytes));
    // The year's index is in the store but not in the list; a path that climbs, or that is not there, is no file.
    const index = `${original.path.split("/").slice(0, 2).join("/")}/index.json`;
    for (const path of [index, `${original.path}x`, "../../etc/passwd", ""]) expect((await c.req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(path)}`, { key: reader })).status, path).toBe(404);
    expect((await c.req("GET", "/v1/engine/vault/file", { key: reader })).status).toBe(404);
  });
});

describe("the engine's catches, through the routes", () => {
  it("catches the same file again and a renumbered copy, and does not file a payment for a held invoice", async () => {
    const again = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "again.pdf", base64: b64(bytes) } });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ kind: "duplicate_document", sha256: sha256(bytes), invoice: { id: "AP-0001" } });

    const copy = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "copy.pdf", base64: b64(await pdfOf(EN_COPY)) } });
    expect(copy.status).toBe(200);
    const held = copy.json.invoice as Invoice;
    expect(held).toMatchObject({ id: "AP-0002", status: "needs_review", payable: false });
    expect(held.findings.map((f) => f.code)).toContain("possible_duplicate");

    const pay = await c.req("POST", "/v1/engine/invoices/AP-0002/pay", { key: A.session });
    expect(pay.status).toBe(409);
    expect(pay.json).toMatchObject({ code: "conflict", error: expect.stringMatching(/^AP-0002 is needs review, not ready to pay/) });
    expect(((await c.req("GET", "/v1/engine/invoices", { key: A.session })).json.items as Invoice[]).find((i) => i.id === "AP-0002")!.proposal).toBeNull();
  });

  it("archives the held invoice's document on the next sync, and feeds the read model", async () => {
    const r = await c.req("POST", "/v1/engine/sync", { key: A.session });
    expect(r.json).toMatchObject({ ledger_entries: 7, fed: true, error: null });
    // The held invoice's own document, and the suppliers list as it reads now.
    expect(r.json.vault_added).toEqual([expect.stringMatching(/BTX-2026-21A EUR 1850\.00\.pdf$/), expect.stringMatching(/Leveranciers .*\.pdf$/)]);
    expect(((await c.req("GET", "/v1/invoices", { key: A.session })).json.items as { id: string; status: string }[]).map((i) => `${i.id} ${i.status}`).sort()).toEqual(["AP-0001 paid", "AP-0002 needs_review"]);
  });
});

describe("the cloud's own gates", () => {
  const posts = ENGINE_ROUTES.filter((r) => r.method === "POST");
  // The file route answers 404 without a path; every other read answers by itself.
  const reads = ENGINE_ROUTES.filter((r) => r.method === "GET" && r.path !== "/v1/engine/vault/file");

  it("lets a viewer and a read-only key read, and do nothing else", async () => {
    expect(posts).toHaveLength(6);
    for (const key of [viewer, reader]) {
      for (const r of posts) {
        const res = await c.req("POST", at(r.path), { key, body: {} });
        expect(res.status, `${r.path}: ${JSON.stringify(res.json)}`).toBe(403);
      }
      for (const r of reads) expect((await c.req("GET", r.path.replace("{id}", "P-0001"), { key })).status, r.path).toBe(200);
    }
    // Nothing happened: the held invoice has no proposal, and the passkey is the owner's.
    expect(((await c.req("GET", "/v1/engine/invoices", { key: viewer })).json.items as Invoice[]).find((i) => i.id === "AP-0002")!.proposal).toBeNull();
    expect((await c.req("GET", "/v1/engine", { key: viewer })).json.passkey).toEqual({ credential_id: phone.credentialId, label: "Owner" });
  });

  it("asks for a sign-in, and turns away a caller who is not signed in", async () => {
    for (const r of ENGINE_ROUTES) expect((await c.req(r.method, at(r.path), r.method === "POST" ? { body: {} } : {})).status, r.path).toBe(401);
  });

  it("does not let a key run a passkey ceremony for a person: an admin key gets 403 on the three passkey routes", async () => {
    const passkeyRoutes = ["/v1/engine/passkey/start", "/v1/engine/passkey/finish", "/v1/engine/proposals/P-0001/approve"];
    for (const path of passkeyRoutes) {
      const res = await c.req("POST", path, { key: A.key, body: { code: "x", terms_sha256: "0".repeat(64), credential: {} } });
      expect(res.status, path).toBe(403);
      expect(res.json.error).toMatch(/signed-in/);
    }
    // The same key does the rest (an upload, a payment filed, a sync).
    expect((await c.req("POST", "/v1/engine/sync", { key: A.key })).status).toBe(200);
    expect((await c.req("POST", "/v1/engine/documents", { key: A.key, body: { filename: "again.pdf", base64: b64(bytes) } })).json.kind).toBe("duplicate_document");
  });

  it("keeps companies apart: another company's session finds no invoice, no proposal and no archive file here", async () => {
    const path = ((await c.req("GET", "/v1/engine/vault", { key: A.session })).json.files as { path: string }[])[0]!.path;
    expect((await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: B.session })).status).toBe(404);
    expect((await c.req("GET", "/v1/engine/proposals/P-0001", { key: B.session })).status).toBe(404);
    expect((await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: B.session, body: { terms_sha256: "0".repeat(64), credential: {} } })).status).toBe(404);
    expect((await c.req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(path)}`, { key: B.session })).status).toBe(404);
    // Its own engine is empty, with its own test money.
    expect((await c.req("GET", "/v1/engine/invoices", { key: B.session })).json).toEqual({ items: [] });
    expect((await c.req("GET", "/v1/engine/vault", { key: B.session })).json).toEqual({ files: [] });
    expect((await c.req("GET", "/v1/engine/events", { key: B.session })).json.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ subject: "AP-0001" })]));
    expect((await c.req("GET", "/v1/engine", { key: B.session })).json).toMatchObject({ mode: "test_money", passkey: null });
  });

  it("refuses a POST that comes from another site", async () => {
    for (const r of posts) {
      const res = await c.req("POST", at(r.path), { key: A.session, body: {}, headers: { origin: "https://elsewhere.example" } });
      expect(res.status, r.path).toBe(403);
      expect(res.json.error).toBe("this request came from another site");
    }
  });
});

describe("what an upload must be", () => {
  const upload = (body: unknown) => c.req("POST", "/v1/engine/documents", { key: A.session, body });
  const count = async () => ((await c.req("GET", "/v1/engine/invoices", { key: A.session })).json.items as unknown[]).length;

  it("refuses a body over the cap, more than 15 MB of document, and what is not base64, a file name or a PDF", async () => {
    const before = await count();
    // The whole body: at most 22,000,000 bytes.
    const big = await c.req("POST", "/v1/engine/documents", { key: A.session, raw: `{"filename":"big.pdf","base64":"${"A".repeat(22_000_000)}"}` });
    expect(big.status).toBe(400);
    expect(big.json.error).toBe("the body is larger than 22000000 bytes");
    // The document itself: at most 15 MB once decoded.
    const large = await upload({ filename: "large.pdf", base64: Buffer.alloc(15 * 1024 * 1024 + 1, 0x20).toString("base64") });
    expect(large.status).toBe(400);
    expect(large.json.error).toMatch(/larger than 15 MB/);

    expect((await upload({ filename: "x.pdf", base64: "not base64!" })).status).toBe(400);
    expect((await upload({ filename: "x.pdf", base64: `${"A".repeat(4_000_000)}!AAA` })).status).toBe(400);
    expect((await upload({ filename: "x.pdf", base64: `${b64(bytes)}=` })).status).toBe(400);
    expect((await upload({ filename: "x.pdf", base64: `-${b64(bytes).slice(1)}` })).status).toBe(400);
    expect((await upload({ filename: "x.pdf", base64: "" })).status).toBe(400);
    expect((await upload({ filename: "", base64: b64(bytes) })).status).toBe(400);
    expect((await upload({ filename: "x".repeat(201), base64: b64(bytes) })).status).toBe(400);
    expect((await upload({ filename: "x.pdf", base64: b64(bytes), tenant: B.id })).status).toBe(400);
    // What the inbox itself refuses comes back in its own words, as a request that does not fit (never a 500).
    const text = await upload({ filename: "notes.txt", base64: b64(Buffer.from("just some words")) });
    expect(text.status).toBe(400);
    expect(text.json.error).toMatch(/^notes\.txt is not a PDF.*nothing was filed$/);
    expect(await count()).toBe(before);
  });
});

describe("erasing a person and purging a closed company reach the company's engine", () => {
  it("erasing the person revokes their approval passkey and drops their name from it", async () => {
    const e = testCloud({ engine: true });
    try {
      const t = await e.tenant("echo");
      const second = await e.req("POST", "/v1/users", { key: t.session, body: { display_name: "Second Owner", role: "owner" } });
      const other = await sessionToken(e.env.sessionSecret, { tenantId: t.id, userId: second.json.id as string, role: "owner", gen: 0 }, e.clock.now);
      const own = new FakeAuthenticator();
      const start = await e.req("POST", "/v1/engine/passkey/start", { key: t.session });
      const done = await e.req("POST", "/v1/engine/passkey/finish", { key: t.session, body: { code: start.json.code, credential: own.register({ challenge: start.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      expect((await e.req("GET", "/v1/engine", { key: other })).json.passkey).toEqual({ credential_id: own.credentialId, label: "Owner" });

      expect((await e.req("POST", `/v1/users/${t.owner}/erase`, { key: other })).status).toBe(200);
      expect((await e.req("GET", "/v1/engine", { key: other })).json.passkey).toBeNull();
      expect(JSON.stringify(await e.env.engine!(t.id).status())).not.toContain("Owner");
    } finally { e.close(); }
  });

  it("the purge of a closed company wipes its engine: its ledger, documents and passkey go with its rows", async () => {
    const e = testCloud({ engine: true });
    try {
      const t = await e.tenant("foxtrot");
      expect((await e.req("POST", "/v1/engine/documents", { key: t.session, body: { filename: "bergtex.pdf", base64: b64(bytes) } })).status).toBe(200);
      expect(await e.env.engine!(t.id).invoices()).toHaveLength(1);
      expect((await e.req("POST", "/v1/close", { key: t.key })).status).toBe(200);
      const purge = (await import("../cloud/src/privacy.js")).purgeExpired;
      expect(await purge(e.env.sql, e.env.blobs, new Date("2034-01-01T12:00:00Z"), e.env.engine)).toEqual([t.id]);
      expect(await e.env.engine!(t.id).invoices()).toEqual([]);
    } finally { e.close(); }
  });
});

describe("a cloud with no engine wired", () => {
  it("answers 404 on every engine route, whoever asks", async () => {
    const off = testCloud();
    try {
      const t = await off.tenant("plain");
      expect(ENGINE_ROUTES).toHaveLength(12);
      for (const key of [t.session, t.key]) {
        for (const r of ENGINE_ROUTES) {
          const res = await off.req(r.method, at(r.path), { key, ...(r.method === "POST" ? { body: {} } : {}) });
          expect(res.status, `${r.method} ${r.path}`).toBe(404);
          expect(res.json.code).toBe("not_found");
        }
      }
    } finally { off.close(); }
  });
});

describe("the archive in the cloud's document store", () => {
  it("keeps every file under the company's own prefix, whatever the path says, and never two paths under one key", () => {
    const t = "t_abcdefgh";
    expect(vaultKey(t, "Northwind B.V./2026/2026-Q4/Betalingen/2026-11-02 Bergtex Textil GmbH BTX-2026-21.pdf"))
      .toBe("t/t_abcdefgh/vault/Northwind_20B.V./2026/2026-Q4/Betalingen/2026-11-02_20Bergtex_20Textil_20GmbH_20BTX-2026-21.pdf");
    // Every key is letters, digits, dots, dashes and underscores between slashes, and none holds "..".
    const paths = ["a b/c", "a_20b/c", "a_b/c", "a/b c", "Müller & Söhne/é.pdf", "Muller _26 Sohne/e.pdf", "a..b/c", "a._2eb/c", "a.b/c", "名前/请求.pdf"];
    const keys = paths.map((p) => vaultKey(t, p));
    expect(new Set(keys).size).toBe(paths.length);
    for (const k of keys) {
      expect(k).toMatch(/^t\/t_abcdefgh\/vault\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/);
      expect(k).not.toContain("..");
    }
    for (const bad of ["", "/a", "a//b", "a/", "../x", "a/../../x", "a/./b"]) expect(() => vaultKey(t, bad), bad).toThrow(/not a path in the vault/);
    expect(() => blobVault(c.env.blobs, "t_x/../t_other")).toThrow(/company id/);
  });

  it("creates a file once, checks its hash, and rewrites only an index", async () => {
    const sink = blobVault(c.env.blobs, "t_sinktest1");
    const pdf = Buffer.from("%PDF-1.4 one");
    const path = "Sink Test Co/2026/2026-Q4/Inkoopfacturen/Ünï & Co/2026-11-02 X-1 EUR 1.00.pdf";
    expect(await sink.stat(path)).toBeNull();
    await expect(sink.create(path, pdf, sha256(Buffer.from("other")), "application/pdf")).rejects.toThrow(/do not match their hash/);
    await sink.create(path, pdf, sha256(pdf), "application/pdf");
    expect(await sink.stat(path)).toEqual({ sha256: sha256(pdf), bytes: pdf.length });
    expect((await sink.read!(path))!.equals(pdf)).toBe(true);
    await expect(sink.create(path, pdf, sha256(pdf), "application/pdf")).rejects.toThrow(/already in the vault/);
    await expect(sink.create(path, Buffer.from("%PDF-1.4 two"), sha256(Buffer.from("%PDF-1.4 two")))).rejects.toThrow(/already in the vault/);
    expect((await sink.read!(path))!.equals(pdf)).toBe(true);

    const index = "Sink Test Co/2026/index.json";
    expect(await sink.readIndex(index)).toBeNull();
    await sink.writeIndex(index, "{\"files\":[]}\n");
    await sink.writeIndex(index, "{\"files\":[1]}\n");
    expect(await sink.readIndex(index)).toBe("{\"files\":[1]}\n");
    // Another company's sink sees none of it.
    expect(await blobVault(c.env.blobs, "t_sinktest2").stat(path)).toBeNull();
    expect((await c.env.blobs.list("t/t_sinktest1/vault/")).length).toBe(2);
  });
});

describe("the Worker's bundle", () => {
  it("does not hold the engine: the routes know its interface only", async () => {
    // What the Worker's entry point reaches by static imports (packages left out). The engine (src/engine, src/ap,
    // src/executors, better-sqlite3 through src/db) arrives only where a host loads it: never from the route table.
    const out = await build({ entryPoints: ["cloud/src/worker.ts"], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", packages: "external", logLevel: "silent" });
    const inputs = Object.keys(out.metafile.inputs);
    expect(inputs).toContain("cloud/src/engine/routes.ts");
    expect(inputs.filter((p) => /^src\/(engine|ap|executors|vault|passkey|db|agents|claude|cloudsync|audit|policy|redteam)\//.test(p) || /^src\/ledger\/(core|feed)\.ts$/.test(p)
      || /^cloud\/src\/(engine\/)?node\.ts$/.test(p))).toEqual([]);
    const packages = new Set(Object.values(out.metafile.inputs).flatMap((i) => i.imports.filter((x) => x.external).map((x) => x.path)));
    for (const heavy of ["better-sqlite3", "pdfkit", "unpdf", "viem", "playwright", "@anthropic-ai/sdk", "@simplewebauthn/server"]) expect(packages.has(heavy), heavy).toBe(false);
  });
});
