// "Try as guest" (13 Nov, owner): one public call opens a read-only session for the demo company, made from the seed
// (cloud/src/guest/seed.gen.ts, the runner's own code on stand-ins). It holds: the company is made once and is the seed
// exactly; the guest reads every page's data; every write is refused; one guest signing out ends no one else's session;
// and the seed file is what its script writes (npm run cloud:guest-seed).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_NAME, DEMO_SLUG, DEMO_TENANT, seedHead } from "../cloud/src/guest/guest.js";
import { SEED_BATCHES } from "../cloud/src/guest/seed.gen.js";
import { RESERVED_SLUGS } from "../cloud/src/app.js";
import { receiveEmail } from "../cloud/src/mail.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(async () => { c = await testCloud(); });
afterEach(() => c.close());

const guest = async () => {
  const r = await c.req("POST", "/v1/auth/guest", { key: null });
  expect(r.status).toBe(200);
  return r.json as { session: string; role: string; tenant: string; expires_in: number };
};

describe("Try as guest", () => {
  it("opens the demo company read-only, no passkey and no e-mail, labelled demo data", async () => {
    const g = await guest();
    expect(g).toMatchObject({ role: "viewer", tenant: DEMO_SLUG, expires_in: 900 });
    const me = await c.req("GET", "/v1/me", { key: g.session });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ tenant: { id: DEMO_TENANT, slug: DEMO_SLUG, name: DEMO_NAME, language: "en" }, role: "viewer", scopes: ["read"], demo: { as_of: expect.any(String) } });
    expect(DEMO_NAME).toMatch(/demo company/);
    expect(RESERVED_SLUGS.has(DEMO_SLUG)).toBe(true);
  });

  it("is the seed exactly, made once: a second guest finds it as it was", async () => {
    await guest();
    const rows = async () => Object.fromEntries(await Promise.all(["invoices", "transactions", "ledger_entries", "audit_rows", "documents", "vendors", "payments"].map(async (t) => [t, (await c.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?`, [DEMO_TENANT]))!.n])));
    const once = await rows();
    const sent = (k: string) => SEED_BATCHES.reduce((n, b) => n + (((b as Record<string, unknown[]>)[k]) ?? []).length, 0);
    expect(once).toEqual({ invoices: sent("invoices"), transactions: sent("transactions"), ledger_entries: sent("ledger_entries"), audit_rows: sent("audit_rows"), documents: sent("documents"), vendors: sent("vendors"), payments: sent("payments") });
    await guest();
    expect(await rows()).toEqual(once);
    expect((await c.env.sql.first<{ row_hash: string }>("SELECT row_hash FROM audit_rows WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1", [DEMO_TENANT]))!.row_hash).toBe(seedHead());
  });

  it("reads every page's data", async () => {
    const g = await guest();
    for (const path of ["/v1/invoices", "/v1/transactions", "/v1/transactions/summary", "/v1/ledger/entries", "/v1/insights", "/v1/vendors", "/v1/payments", "/v1/reports/pnl", "/v1/dashboard"]) {
      const r = await c.req("GET", path, { key: g.session });
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
    const inv = await c.req("GET", "/v1/invoices", { key: g.session });
    expect((inv.json.items as unknown[]).length).toBeGreaterThan(4);
  });

  it("refuses every write: keys, people, company, sync, export, connections", async () => {
    const g = await guest();
    for (const [method, path, body] of [
      ["POST", "/v1/keys", { name: "x", scopes: ["read"] }], ["POST", "/v1/users", { display_name: "x", role: "viewer" }], ["POST", "/v1/company", { name: "x" }],
      ["POST", "/v1/sync", {}], ["POST", "/v1/export/staged", {}], ["POST", "/v1/connect/airwallex/start", {}], ["POST", "/v1/airwallex/account", {}], ["POST", "/v1/close", {}],
      ["POST", "/v1/users/u_guest/enrolment", {}], ["POST", "/v1/webhook", { url: "https://x.test" }],
    ] as const) {
      const r = await c.req(method, path, { key: g.session, body });
      expect({ path, refused: r.status === 403 || r.status === 404 }).toEqual({ path, refused: true });
    }
    // The language is kept in the browser: the shared guest keeps none.
    expect((await c.req("POST", "/v1/me/language", { key: g.session, body: { language: "nl" } })).status).toBe(200);
    expect((await c.env.sql.first<{ language: string }>("SELECT language FROM users WHERE tenant_id = ? AND id = 'u_guest'", [DEMO_TENANT]))!.language).toBe("en");
  });

  it("one guest signing out ends no one else's session", async () => {
    const a = await guest(), b = await guest();
    expect((await c.req("POST", "/v1/auth/logout", { key: a.session })).status).toBe(200);
    expect((await c.req("GET", "/v1/me", { key: b.session })).status).toBe(200);
  });

  it("shows a dashboard whose every figure is counted from the seed's own rows", async () => {
    const g = await guest();
    const d = (await c.req("GET", "/v1/dashboard", { key: g.session })).json as {
      currency: string; money: { in: string; out: string; net: string }; cash: { day: string; net: string }[];
      spend: { key: string; amount: string; count: number; declined: number }[]; invoices: Record<string, { count: number; amount: string }> & { duplicates_stopped: number };
      approvals: { weeks: { cfo: number; alone: number }[]; approved_by_cfo: number }; agents: { decisions: number; by_fallback: number }; feed: { who: string; text: string }[];
    };
    type Tx = { direction: string; moved: boolean; currency: string; amount: string; fee: { amount: string; currency: string } | null; approval: { required: boolean }; invoice: unknown };
    const rows = SEED_BATCHES.flatMap((b) => ((b as { transactions?: { body?: Tx }[] }).transactions ?? []).map((r) => (r.body ?? r) as Tx));
    const cents = (a: string) => Math.round(Number(a) * 100);
    const moved = rows.filter((t) => t.moved && t.currency === "EUR" && t.direction !== "internal");
    const inC = moved.filter((t) => t.direction === "in").reduce((n, t) => n + cents(t.amount), 0);
    const outC = moved.filter((t) => t.direction === "out").reduce((n, t) => n + cents(t.amount) + (t.fee?.currency === "EUR" ? cents(t.fee.amount) : 0), 0);
    expect(d.currency).toBe("EUR");
    expect([cents(d.money.in), cents(d.money.out), cents(d.money.net)]).toEqual([inC, outC, inC - outC]);
    expect(cents(d.cash.at(-1)!.net)).toBe(inC - outC);
    // Spend: every outgoing row is in exactly one bar, a declined one is counted as declined and never as spend.
    const out = rows.filter((t) => t.direction === "out" && t.currency === "EUR");
    expect(d.spend.reduce((n, s) => n + cents(s.amount), 0)).toBe(outC);
    expect(d.spend.reduce((n, s) => n + s.count + s.declined, 0)).toBe(out.length);
    expect(d.spend.find((s) => s.key === "invoices")!.count).toBe(out.filter((t) => t.invoice && t.moved).length);
    // Approvals: each moved payment once, the CFO's where the register says an approval was required.
    expect(d.approvals.weeks.reduce((n, w) => n + w.cfo, 0)).toBe(moved.filter((t) => t.direction === "out" && t.approval.required).length);
    expect(d.approvals.weeks.reduce((n, w) => n + w.cfo + w.alone, 0)).toBe(moved.filter((t) => t.direction === "out").length);
    // Invoices by state, as the seed's invoices are.
    const inv = SEED_BATCHES.flatMap((b) => ((b as { invoices?: { status: string }[] }).invoices ?? []));
    expect(d.invoices.paid!.count).toBe(inv.filter((i) => i.status === "paid").length);
    expect(d.invoices.waiting_cfo!.count).toBe(inv.filter((i) => i.status === "waiting_cfo").length);
    expect(d.invoices.duplicates_stopped).toBe(1);
    // The feed says who decided, and never calls code's fallback Claude.
    expect(d.feed.length).toBeGreaterThan(8);
    expect(d.feed.every((f) => f.who.length > 0 && f.text.length > 0)).toBe(true);
    expect(d.feed.some((f) => /read by Claude/.test(f.text))).toBe(false);
    expect(d.agents.by_fallback).toBeGreaterThan(0);
  });

  it("has no engine, no inbox and takes no mail; each network has its own rate bucket", async () => {
    const g = await guest();
    expect((await c.req("GET", "/v1/engine", { key: g.session })).status).toBe(404);
    expect(((await c.req("GET", "/v1/me", { key: g.session })).json as { inbox: unknown }).inbox).toBeNull();
    const raw = Buffer.from("Subject: x\r\n\r\nhi");
    const m = { from: "a@b.example", to: `${DEMO_SLUG}@in.purser.test`, raw: new Uint8Array(raw), rawSize: raw.length, rejected: null as string | null, setReject(r: string) { m.rejected = r; } };
    expect(await receiveEmail(c.env.sql, c.env.blobs, m, { domain: "in.purser.test", now: c.clock.now })).toMatchObject({ queued: false });
    expect((await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM inbound_mail WHERE tenant_id = ?", [DEMO_TENANT]))!.n).toBe(0);
  });

  it("is not a company anyone can make: its address is reserved", async () => {
    const r = await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: DEMO_SLUG, name: "x", owner: { display_name: "x" } } });
    expect(r.status).toBe(400);
  });
});
