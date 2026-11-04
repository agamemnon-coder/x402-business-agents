// Phase D, the push to Max's hub (src/hub/runs.ts, src/hub/client.ts): the body's exact shape, its limits (12 runs,
// 8 KB), the deterministic check on each run, and that it carries no secret, IBAN, account number, address or
// personal data. A fake hub only; no real hub is called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { audit } from "../src/audit/log.js";
import { assertSafeBody, buildPushBody, MAX_BODY_BYTES, MAX_RUNS, proposalCheck, type HubBody } from "../src/hub/runs.js";
import { pushRuns } from "../src/hub/client.js";
import { HubLoop } from "../src/hub/consult.js";
import { hubEndpoint } from "../src/hub/config.js";

type DB = ReturnType<typeof openDb>;
const T0 = new Date("2026-11-04T10:00:00Z");
const EXPIRES = "2099-01-01T00:00:00Z";
const IBAN = "DE89370400440532013000";
const ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";
const TOKEN = "hub-token-for-tests-only-0001";
const URL_ = "https://hub.example.test";

let db: DB;
let n = 0;
function file(terms: (id: string) => Terms, createdBy: "treasury" | "support" | "system" = "treasury", at = T0): string {
  const id = `P-${String(++n).padStart(4, "0")}`;
  createProposal(db, { terms: terms(id), createdBy, explanation: "[opus] APPROVE: pay Jane Doe <jane.doe@example.com>" }, at);
  return id;
}
const invoice = (id: string): Terms => ({
  schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: EXPIRES, invoice_no: `INV-${id}`, amount: "240.00",
  vendor: "Jane Doe Consulting", beneficiary_name: "Jane Doe Consulting", beneficiary_id: "8f14e45f-ceea-467a-9c1f-1b2a3c4d5e6f",
  iban_last4: IBAN.slice(-4), iban: IBAN, transfer_request_id: `req-${id}`,
});
const refunds = (id: string): Terms => ({
  schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: EXPIRES, dispute_id: "D-1", customer: ADDRESS,
  refunds: [{ sale_id: "7", payment_id: "refund-7", to: ADDRESS, amount: "0.05" }, { sale_id: "10", payment_id: "refund-10", to: ADDRESS, amount: "0.05" }],
  total: "0.10", reason: "wrong data", evidence: [],
});

function fakeHub(mode: "ok" | "down" | "timeout" = "ok") {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (mode === "down") throw new TypeError(`fetch failed for ${String(input)}`);
    if (mode === "timeout") return new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

beforeEach(() => {
  db = openDb(":memory:");
  n = 0;
  vi.stubEnv("HUB_URL", URL_);
  vi.stubEnv("HUB_PUSH_TOKEN", TOKEN);
  vi.stubEnv("HUB_PUSH_ENABLED", "on");
  vi.stubEnv("HUB_DECISIONS_ENABLED", "");
  vi.stubEnv("AIRWALLEX_CLIENT_ID", "");
  vi.stubEnv("AIRWALLEX_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the push body", () => {
  it("has exactly the agreed shape, dry-run without the sandbox keys", () => {
    const id = file(invoice);
    const body = buildPushBody(db);
    expect(Object.keys(body).sort()).toEqual(["mode", "runs", "title"]);
    expect(body.mode).toBe("dry-run");
    expect(body.title).toBe("Purser");
    expect(body.runs).toEqual([{ id: expect.stringMatching(/^memory-[0-9a-f]{6}\/P-0001$/), agent: "treasury", what: "Invoice payment", amount: "240.00", currency: "EUR", check: "pass", rule: "invoice_payout_needs_person", human: "waiting" }]);
    expect(id).toBe("P-0001");
  });

  it("says live only when this runner has the Airwallex sandbox keys", () => {
    vi.stubEnv("AIRWALLEX_CLIENT_ID", "x");
    vi.stubEnv("AIRWALLEX_API_KEY", "y");
    expect(buildPushBody(db).mode).toBe("live");
  });

  it("holds the last 12 runs, newest first, under 8 KB", () => {
    for (let i = 0; i < 20; i++) file(refunds, "support", new Date(T0.getTime() + i * 1000));
    const body = buildPushBody(db);
    expect(body.runs).toHaveLength(MAX_RUNS);
    expect(body.runs[0]!.id.endsWith("/P-0020")).toBe(true);
    expect(body.runs[11]!.id.endsWith("/P-0009")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(body.runs[0]).toMatchObject({ agent: "support", what: "Refund batch", amount: "0.10", currency: "USDZ" });
  });

  it("carries no IBAN, account id, address, name, e-mail, URL or token from the ledger", () => {
    const a = file(invoice);
    file(refunds, "support");
    decide(db, { proposalId: a, decision: "APPROVED", typedPrefix: (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(a) as { terms_sha256: string }).terms_sha256.slice(0, 8), approver: "max", method: "cli" }, T0);
    audit(db, "sourcing", "upstream.refused", "41", { seq: 41, supplier: "stockline", reason: `mandate_cap_exceeded: 0.04 is over the cap, payee ${ADDRESS}`, refused_by: "purser" }, T0);
    const body = buildPushBody(db);
    const text = JSON.stringify(body);
    // Fails if: any field is copied from the terms, the explanation or a refusal's free text.
    for (const s of [IBAN, IBAN.slice(-4), ADDRESS, ADDRESS.toLowerCase(), "Jane", "Doe", "jane.doe@example.com", "8f14e45f", "max", "INV-", "stockline", TOKEN, URL_]) expect(text).not.toContain(s);
    expect(() => assertSafeBody(body, [URL_, TOKEN])).not.toThrow();
    expect(body.runs.find((r) => r.what === "Data purchase refused")).toMatchObject({ check: "fail", rule: "mandate_cap_exceeded", human: "none", agent: "sourcing" });
  });

  it("marks what Purser's rules stop as check fail, with the rule", () => {
    const id = file(refunds, "support");
    const row = () => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as Parameters<typeof proposalCheck>[1];
    expect(proposalCheck(db, row())).toEqual({ check: "pass", rule: "refund_over_auto_limit" });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString());
    expect(proposalCheck(db, row())).toEqual({ check: "fail", rule: "emergency_stop" });
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(id);
    expect(proposalCheck(db, row())).toEqual({ check: "fail", rule: "approval_expired" });
  });
});

describe("assertSafeBody", () => {
  const ok: HubBody = { mode: "dry-run", title: "Purser", runs: [{ id: "main-1-abcdef/P-0001", agent: "treasury", what: "Invoice payment", amount: "240.00", currency: "EUR", check: "pass", rule: "four_eyes", human: "waiting" }] };
  const withWhat = (what: string): HubBody => ({ ...ok, runs: [{ ...ok.runs[0]!, what }] });
  it("accepts a clean body", () => expect(() => assertSafeBody(ok, [TOKEN])).not.toThrow());
  it.each([
    ["an IBAN", `Pay ${IBAN}`],
    ["a chain address", `to ${ADDRESS}`],
    ["an account number", "account 123456789012"],
    ["an e-mail address", "jane.doe@example.com"],
    ["a key, token or long id", "sk-ant-api03-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"],
    ["a private key", "-----BEGIN PRIVATE KEY-----"],
  ])("rejects %s", (name, what) => {
    expect(() => assertSafeBody(withWhat(what))).toThrow(name);
  });
  it("rejects the hub's own token and URL", () => {
    expect(() => assertSafeBody(withWhat(`t ${TOKEN}`), [TOKEN])).toThrow(/secret value/);
    expect(() => assertSafeBody(withWhat(URL_), [URL_])).toThrow(/secret value/);
  });
  it("rejects any field outside the agreed shape", () => {
    expect(() => assertSafeBody({ ...ok, runs: [{ ...ok.runs[0]!, iban: "x" } as never] })).toThrow(/unexpected fields/);
    expect(() => assertSafeBody({ ...ok, secret: "x" } as never)).toThrow(/unexpected fields/);
  });
});

describe("pushRuns", () => {
  it("posts the body to /push/purser with the token header", async () => {
    file(invoice);
    const hub = fakeHub();
    expect(await pushRuns(db, { fetch: hub.fetch })).toEqual({ ok: true, runs: 1 });
    expect(hub.calls[0]!.url).toBe(`${URL_}/push/purser`);
    expect(hub.calls[0]!.init.method).toBe("POST");
    expect((hub.calls[0]!.init.headers as Record<string, string>)["X-Push-Token"]).toBe(TOKEN);
    expect(JSON.parse(hub.calls[0]!.init.body as string)).toEqual(buildPushBody(db));
  });

  it.each(["down", "timeout"] as const)("never throws when the hub is %s, and logs neither URL nor token", async (mode) => {
    file(invoice);
    const lines: string[] = [];
    const r = await pushRuns(db, { fetch: fakeHub(mode).fetch, log: (l) => lines.push(l), timeoutMs: 20 });
    expect(r).toEqual({ ok: false, reason: mode === "down" ? "network" : "timeout" });
    expect(lines).toHaveLength(1);
    for (const l of lines) { expect(l).not.toContain(URL_); expect(l).not.toContain("hub.example"); expect(l).not.toContain(TOKEN); }
  });

  it("sends nothing without an https hub address and a token", async () => {
    const hub = fakeHub();
    vi.stubEnv("HUB_URL", "http://hub.example.test");
    expect(await pushRuns(db, { fetch: hub.fetch })).toEqual({ ok: false, reason: "not configured" });
    vi.stubEnv("HUB_URL", URL_);
    vi.stubEnv("HUB_PUSH_TOKEN", "");
    expect(await pushRuns(db, { fetch: hub.fetch })).toEqual({ ok: false, reason: "not configured" });
    expect(hub.calls).toEqual([]);
    expect(hubEndpoint({ HUB_URL: "http://localhost:8787/", HUB_PUSH_TOKEN: "t" })).toEqual({ url: "http://localhost:8787", token: "t" });
  });

  it("pushes from the runner's loop only when the switch is on and the runs changed", async () => {
    const hub = fakeHub();
    const loop = new HubLoop(db, { fetch: hub.fetch }, async () => {});
    file(invoice);
    await loop.pushIfChanged();
    await loop.pushIfChanged();
    expect(hub.calls).toHaveLength(1);
    file(refunds, "support");
    await loop.pushIfChanged();
    expect(hub.calls).toHaveLength(2);
    vi.stubEnv("HUB_PUSH_ENABLED", "");
    file(invoice);
    await loop.pushIfChanged();
    expect(hub.calls).toHaveLength(2);
  });
});

// The terms hash of an invoice proposal is stable whatever the push does (it reads, never writes).
it("reads the ledger only", () => {
  const id = file(invoice);
  const before = (db.prepare("SELECT terms_sha256, status FROM proposals WHERE proposal_id = ?").get(id) as object);
  const seq = (db.prepare("SELECT MAX(seq) AS s FROM audit_log").get() as { s: number }).s;
  buildPushBody(db);
  expect(db.prepare("SELECT terms_sha256, status FROM proposals WHERE proposal_id = ?").get(id)).toEqual(before);
  expect((db.prepare("SELECT MAX(seq) AS s FROM audit_log").get() as { s: number }).s).toBe(seq);
  expect(termsHash(invoice(id))).toBe((before as { terms_sha256: string }).terms_sha256);
});
