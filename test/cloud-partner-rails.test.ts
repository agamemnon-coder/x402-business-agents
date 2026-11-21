// T:0 at every payment and the agents' tokens in Purser Cloud (cloud/src/partnerRails.ts, cloud/src/partnerView.ts) and
// the agent card's Apple Wallet pass routes (cloud/src/walletPassRoutes.ts): the recorded live run as the console shows
// it, a company's own rows instead when it has them, the Books and Agents hooks, and the pass offered only when
// configured. Offline: the cloud over SQLite, a throwaway pass certificate made at run time.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { partnerFromCompany, partnerFromRecord } from "../cloud/src/partnerRails.js";
import { PARTNER_VIEW_JS } from "../cloud/src/partnerView.js";
import { consolePage } from "../cloud/src/console.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { passConfigFrom } from "../cloud/src/walletPass.js";
import { LINK_TTL_MS } from "../cloud/src/walletPassRoutes.js";
import type { PartnerRailsRecord } from "../src/proof/partnerRailsMd.js";
import { partnerRailsMarkdown } from "../src/proof/partnerRailsMd.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { throwawayPassEnv } from "./support/passCert.js";

const RECORD = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-20-partner-rails.json", import.meta.url), "utf8")) as PartnerRailsRecord;

describe("the recorded live run", () => {
  it("booked four payments on three rails in T:0, each read back and agreeing with its rail; refused every misuse", () => {
    expect(RECORD.checks.every((c) => c.ok)).toBe(true);
    expect(new Set(RECORD.payments.map((p) => p.rail))).toEqual(new Set(["airwallex_card", "airwallex_transfer", "metal"]));
    expect(RECORD.payments.every((p) => /^je_prod_\w+$/.test(p.t0.t0_id) && p.t0.je_number.startsWith("PURPAY-") && p.t0.status === "booked")).toBe(true);
    expect(RECORD.reconcile!.ok).toBe(true);
    expect(RECORD.refusals.map((r) => [r.code, r.airwallex_calls, r.ok])).toEqual([["OVER_PER_PURCHASE", 0, true], ["MCC_NOT_ALLOWED", 0, true], ["TOKEN_REVOKED", 0, true], ["CARD_INACTIVE", 1, true]]);
    // No token is in the record: its last four only.
    expect(JSON.stringify(RECORD)).not.toMatch(/ptok_[0-9a-f]{40}/);
    // The .md beside it is the record's own (npm run partner-rails -- --md).
    expect(readFileSync(new URL("../docs/runs/2026-11-20-partner-rails.md", import.meta.url), "utf8")).toBe(partnerRailsMarkdown(RECORD));
  });

  it("is what the console shows a company with no rows of its own, labelled as Purser's sandbox run", () => {
    const P = partnerFromRecord();
    expect(P.source).toBe("recorded");
    expect(P.label).toMatch(/not this company's figures/);
    expect(P.t0.bookings.map((b) => [b.payment_id, b.t0_id])).toEqual(RECORD.payments.map((p) => [p.key, p.t0.t0_id]));
    expect(P.t0.reconcile).toMatchObject({ ok: true });
    expect(P.t0.reconcile!.rows.map((r) => r.payment_id)).toEqual(["a", "b", "c", "d"]);
    expect(P.tokens.map((t) => [t.agent, t.status])).toEqual([["sourcing", "active"], ["support", "revoked"]]);
    const support = P.tokens.find((t) => t.agent === "support")!;
    expect(support.events.map((e) => e.kind)).toEqual(["used", "refused", "refused", "refused"]);
    expect(support.events[0]!.t0_id).toBe(RECORD.payments.find((p) => p.key === "b")!.t0.t0_id);
    expect(P.refusals).toEqual([expect.objectContaining({ by: "airwallex", code: "CARD_INACTIVE" })]);
  });
});

let c: TestCloud, t: TestTenant, seq = 0;
beforeEach(async () => { c = testCloud(); t = await c.tenant("partner"); seq = 0; });
afterEach(() => { c.close(); });
const audit = (ts: string, event: string, payload: unknown, subject: string | null = null) =>
  c.env.sql.run("INSERT INTO audit_rows (tenant_id, seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [t.id, ++seq, ts, "system", event, subject, JSON.stringify(payload), `h${seq - 1}`, `h${seq}`] as never);

describe("a company's own rows", () => {
  it("are shown instead of the record: its bookings with their T:0 ids, its reconcile check, its tokens", async () => {
    await audit("2026-11-21T10:00:00Z", "agent_token.issued", { agent: "support", token_id: "tok_1", token_last4: "abcd", card_last4: "2361", mandate_sha256: "m".repeat(64), mandate: { per_purchase_cents: 6000, monthly_cents: 15000, currency: "EUR", mccs: ["7372"], expires_at: "2026-12-21T10:00:00Z" } }, "support");
    await audit("2026-11-21T10:01:00Z", "agent_token.used", { agent: "support", token_id: "tok_1", transaction_id: "ctx_1", approved: true, amount: "1.25", merchant: "Replyhub" }, "support");
    await audit("2026-11-21T10:01:02Z", "t0.booked", { payment_id: "tx-1", rail: "airwallex_card", rail_ref: "ctx_1", amount: "1.25", currency: "EUR", agent: "support", gl_account: "6100", cost_centre: "CC200", t0_account: "63410", terms_sha256: "m".repeat(64), t0_id: "je_1", je_number: "PURPAY-1", booked_at: "2026-11-21T10:01:02Z", functional: { currency: "USD", amount: "1.36" } }, "tx-1");
    await audit("2026-11-21T10:02:00Z", "agent_token.refused", { agent: "support", token_id: "tok_1", code: "OVER_PER_PURCHASE", amount: "60.01", merchant: "Replyhub" }, "support");
    await audit("2026-11-21T10:03:00Z", "agent_token.revoked", { agent: "support", token_id: "tok_1" }, "support");
    await audit("2026-11-21T10:04:00Z", "t0.reconciled", { at: "2026-11-21T10:04:00Z", ok: true, rows: [{ payment_id: "tx-1", rail: "airwallex_card", ok: true, failed: [], t0_amount: "1.25", t0_currency: "EUR", rail_amount: "1.25", rail_status: "APPROVED" }] });
    const P = (await partnerFromCompany(new TenantDb(c.env.sql, t.id)))!;
    expect(P.source).toBe("company");
    expect(P.t0.bookings).toEqual([expect.objectContaining({ payment_id: "tx-1", t0_id: "je_1", gl_account: "6100", cost_centre: "CC200", agent: "support" })]);
    expect(P.t0.reconcile).toMatchObject({ ok: true, rows: [{ payment_id: "tx-1", ok: true, t0: "EUR 1.25", rail_read: "1.25, APPROVED" }] });
    expect(P.tokens).toEqual([expect.objectContaining({ token_id: "tok_1", status: "revoked", per_purchase: "60.00", per_month: "150.00", mccs: ["7372"] })]);
    expect(P.tokens[0]!.events.map((e) => [e.kind, e.outcome, e.t0_id])).toEqual([["used", "approved", "je_1"], ["refused", "OVER_PER_PURCHASE", null]]);
    // Through the API: the company's own, and no Wallet pass while passes are not configured.
    const r = await c.req("GET", "/v1/partner-rails", { key: t.key });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ source: "company", wallet_pass: { available: false } });
  });

  it("a company without them gets the recorded run, labelled", async () => {
    const r = await c.req("GET", "/v1/partner-rails", { key: t.key });
    expect(r.json).toMatchObject({ source: "recorded", wallet_pass: { available: false } });
    expect((await c.req("GET", "/v1/partner-rails", { key: null })).status).toBe(401);
  });
});

describe("the agent card's Apple Wallet pass routes", () => {
  const card = () => audit("2026-11-21T09:00:00Z", "card.issued", { agent: "support", last4: "2361", currency: "EUR", limits: "60.00 / 150.00", nickname: "support agent: helpdesk software" }, "support");

  it("answer 404 and offer nothing while passes are not configured", async () => {
    await card();
    expect((await c.req("GET", "/v1/agents/support/wallet-pass", { key: t.key })).status).toBe(404);
    expect((await c.req("POST", "/v1/agents/support/wallet-pass/link", { key: t.key })).status).toBe(404);
  });

  it("serve the pass to a reader, and by a 5-minute signed link without a header; nothing for an agent without a card", async () => {
    c.env.walletPass = passConfigFrom(throwawayPassEnv().env)!;
    await card();
    expect((await c.req("GET", "/v1/partner-rails", { key: t.key })).json).toMatchObject({ wallet_pass: { available: true } });
    const direct = await c.req("GET", "/v1/agents/support/wallet-pass", { key: t.key });
    expect(direct.status).toBe(200);
    expect(direct.res.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const zip = new Uint8Array(await direct.res.arrayBuffer());
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    // Stored, not compressed: pass.json reads in the zip as it is.
    const inside = new TextDecoder().decode(zip);
    expect(inside).toContain('"value": "•••• 2361"');
    expect(inside).toContain('"value": "EUR 60.00"');
    expect(inside).toContain('"value": "Support agent"');
    expect((await c.req("GET", "/v1/agents/support/wallet-pass", { key: null })).status).toBe(401);
    expect((await c.req("GET", "/v1/agents/treasury/wallet-pass", { key: t.key })).status).toBe(404);
    const link = await c.req("POST", "/v1/agents/support/wallet-pass/link", { key: t.key });
    expect(link.status).toBe(201);
    const url = new URL(link.json.url as string);
    const byLink = await c.req("GET", url.pathname, { key: null });
    expect(byLink.status).toBe(200);
    expect(byLink.res.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    // Changed, or past its five minutes: nothing.
    const parts = url.pathname.split(".");
    parts[1] = parts[1]!.slice(0, -2) + (parts[1]!.endsWith("AA") ? "BB" : "AA");
    expect((await c.req("GET", parts.join("."), { key: null })).status).toBe(404);
    c.clock.now = new Date(c.clock.now.getTime() + LINK_TTL_MS + 1000);
    expect((await c.req("GET", url.pathname, { key: null })).status).toBe(404);
  });

  it("time a guest's link by the clock, not the demo company's month end (it read as expired at once)", async () => {
    c.env.walletPass = passConfigFrom(throwawayPassEnv().env)!;
    c.clock.now = new Date("2026-11-21T10:00:00Z");
    const g = await c.req("POST", "/v1/auth/guest", {});
    const link = await c.req("POST", "/v1/agents/sourcing/wallet-pass/link", { key: g.json.session as string });
    expect(link.status).toBe(201);
    expect(link.json.expires_at).toBe(new Date(c.clock.now.getTime() + LINK_TTL_MS).toISOString());
    expect((await c.req("GET", new URL(link.json.url as string).pathname, { key: null })).status).toBe(200);
  });
});

/** A stand-in for the console's el(): plain objects, their text read back. */
type Node = { tag: string; cls: string; kids: (Node | string)[]; onclick?: () => unknown; disabled?: boolean; textContent?: string; isConnected?: boolean; append(...k: unknown[]): void };
const el = (tag: string, cls: string, kids?: unknown): Node => {
  const n: Node = { tag, cls, kids: [], isConnected: true, append: (...k: unknown[]) => { n.kids.push(...(k.filter((x) => x !== null && x !== undefined && x !== false) as (Node | string)[])); } };
  n.append(...([] as unknown[]).concat(kids ?? []));
  return n;
};
const text = (n: Node | string): string => (typeof n === "string" ? n : (n.textContent ?? "") + n.kids.map(text).join(""));

describe("the console's view", () => {
  const load = (P: unknown, nl = false) => {
    class Expired extends Error {}
    const calls: string[] = [];
    const api = async (path: string) => { calls.push(path); return P; };
    const fns = new Function("el", "ic", "btn", "cur", "day", "stamp", "ext", "NL", "api", "Expired", "location", `${PARTNER_VIEW_JS}\nreturn { partnerTokenBlock, partnerBooks };`)(
      el, (i: string) => el("i", `ic-${i}`), (label: string, cls: string, icon: string) => el("button", `btn ${cls} ${icon}`, label), (c: string) => c, (s: string) => String(s).slice(0, 10), (s: string) => String(s).slice(0, 16),
      (href: string, label: string) => el("a", "ext", label), nl, api, Expired, { href: "" },
    ) as { partnerTokenBlock(P: unknown, agentId: string): Node | null; partnerBooks(host: Node): Promise<void> };
    return { ...fns, calls };
  };
  const recorded = () => ({ ...partnerFromRecord(), wallet_pass: { available: false } });

  it("Books: every payment's T:0 entry and the reconcile check, labelled", async () => {
    const v = load(recorded());
    const host = el("div", "view");
    await v.partnerBooks(host);
    const s = text(host);
    expect(s).toContain("Booked in T:0");
    for (const p of RECORD.payments) expect(s).toContain(p.t0.t0_id);
    expect(s).toContain("T:0 and every rail agree");
    expect(s).toContain("not this company's figures");
    expect(s).toContain("CARD_INACTIVE");
    expect(v.calls).toEqual(["/v1/partner-rails"]);
    const nl = el("div", "view");
    await load(recorded(), true).partnerBooks(nl);
    expect(text(nl)).toContain("Geboekt in T:0");
  });

  it("Agents: each agent's token in its drawer, its payments' T:0 references; nothing for an agent without either", () => {
    // 23 Nov: the block sits in the agent's drawer (cloud/src/agentWallet.ts openDrawer); Apple Wallet moved to "Add to phone".
    const P = recorded();
    const v = load(P);
    const [sourcing, support, payer, checker] = ["sourcing", "support", "payer", "checker"].map((id) => { const b = v.partnerTokenBlock(P, id); return b ? text(b) : ""; });
    expect(sourcing).toContain(RECORD.tokens[0]!.token_id);
    expect(sourcing).toContain(RECORD.payments.find((p) => p.key === "a")!.t0.t0_id);
    expect(sourcing).toContain(RECORD.payments.find((p) => p.key === "d")!.t0.t0_id);
    expect(support).toContain("Revoked");
    expect(support).toContain("TOKEN_REVOKED");
    expect(payer).toContain(RECORD.payments.find((p) => p.key === "c")!.t0.t0_id);
    expect(checker).toBe("");
  });

  it("is in the console, with its two hooks", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain(PARTNER_VIEW_JS.trim());
    expect(html).toContain("partnerTokenBlock(ctx.P,rec.id)");
    expect(html).toContain("partnerBooks(view())");
  });
});
