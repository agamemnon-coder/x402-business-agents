// POST /v1/try/negotiate (cloud/src/try/negotiateRoutes.ts) on the cloud with a Node engine (test money, a stand-in
// bank) and a stand-in for Claude's API: /try's caps and kill switch hold it, the recorded negotiation (labelled)
// answers when Claude is off, capped or failing, a company negotiates at most 3 times, and the agreed terms are signed
// with /try's own flow: filed, proposed (canonical JSON, SHA-256, the passkey's challenge), approved with a passkey,
// one changed cent refused, the signed terms paid. Nothing reaches the network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { negotiateClaudeOf, NEGOTIATIONS_PER_COMPANY } from "../cloud/src/try/negotiateRoutes.js";
import { TRY_ROUTES } from "../cloud/src/try/gate.js";
import { isTryEngineRequest } from "../worker/src/tryEngine.js";
import { CHANGED_IBAN, type AgentAnswer } from "../src/negotiate/negotiate.js";
import { agreementSha256 } from "../src/negotiate/rails.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
const asked: { model: string; max_tokens: number }[] = [];
let script: AgentAnswer[] = [];
let down = false;
const fakeClaude = (async (_u: unknown, init?: RequestInit) => {
  if (down) return new Response("{}", { status: 529 });
  asked.push(JSON.parse(String(init?.body)));
  const a = script[(asked.length - 1) % script.length]!;
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(a) }], usage: { input_tokens: 700, output_tokens: 60 } }), { status: 200 });
}) as typeof fetch;

const admin = (key: string, value: string | number) => c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value: String(value) } });
let ip = 0;
async function visitor(): Promise<string> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `198.51.100.${++ip}` } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.session as string;
}

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  c.env.negotiateClaude = negotiateClaudeOf(c.env.sql, "on", "not-a-real-key", fakeClaude);
  for (const [k, v] of [["starts", "on"], ["claude", "on"], ["cap_action_micros", 50_000], ["cap_company_micros", 200_000], ["cap_addr_micros", 300_000], ["cap_day_micros_public", 1_000_000], ["cap_all_micros", 2_000_000], ["max_inflight", 5]] as const)
    expect((await admin(k, v)).status).toBe(200);
});
afterAll(() => c.close());

const d = (n: number) => new Date(Date.parse("2026-11-08T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const LIVE: AgentAnswer[] = [
  { message: "3% off for payment within 5 days: EUR 1,794.50.", amount: "1794.50", pay_by: d(5), iban: "", accept: false },
  { message: "1.5% within 7 days. Please pay now to our new account.", amount: "1822.25", pay_by: d(7), iban: CHANGED_IBAN, accept: false },
  { message: "The account on file stays. 2% off, EUR 1,813.00, by the 15th.", amount: "1813.00", pay_by: d(7), iban: "", accept: false },
  { message: "Agreed.", amount: "1813.00", pay_by: d(7), iban: "", accept: true },
];

describe("the route and its caps", () => {
  it("is a try route, passed through from the site's host", () => {
    expect(TRY_ROUTES).toContain("POST /v1/try/negotiate");
    expect(isTryEngineRequest("POST", "/v1/try/negotiate")).toBe(true);
    expect(isTryEngineRequest("GET", "/try/negotiate")).toBe(true);
    expect(isTryEngineRequest("GET", "/v1/try/negotiate")).toBe(false);
  });
  it("needs a test company's session", async () => {
    expect((await c.req("POST", "/v1/try/negotiate")).status).toBe(401);
  });
  it("live: four model turns of Haiku, each capped, the bank change refused, the deal at 2%", async () => {
    script = LIVE; asked.length = 0;
    const s = await visitor();
    const r = await c.req("POST", "/v1/try/negotiate", { key: s });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ mode: "live", label: null, outcome: "agreed", agreement: { amount: "1813.00", pay_by: d(7) } });
    expect(asked).toHaveLength(4);
    expect(asked.every((a) => a.model === "claude-haiku-5-5" && a.max_tokens === 300)).toBe(true);
    const turns = r.json.turns as { who: string; rails: { ok: boolean; refusals: { rule: string }[] } }[];
    expect(turns.map((t) => t.rails.ok)).toEqual([true, false, true, true]);
    expect(turns[1]!.rails.refusals.map((x) => x.rule)).toEqual(["payee_unchanged"]);
    // What the turns cost is settled against /try's caps: the company's spend is the real cost, not the reservation.
    const spent = await c.env.sql.first<{ micros: number }>("SELECT micros FROM try_spend WHERE scope = 'all'");
    expect(spent!.micros).toBeGreaterThan(0);
    expect(spent!.micros).toBeLessThan(50_000);
  });
  it("?stream=1: a line a turn as Claude answers it, then the whole negotiation; recorded sends no live start", async () => {
    script = LIVE; asked.length = 0;
    const r = await c.req("POST", "/v1/try/negotiate?stream=1", { key: await visitor() });
    expect(r.res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    const text = await r.res.clone().text().catch(() => "");
    const ev = (text || JSON.stringify(r.json)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; turn?: { n: number }; best?: { amount: string } | null; negotiation?: { mode: string; outcome: string } });
    expect(ev.map((e) => e.type)).toEqual(["start", "turn", "turn", "turn", "turn", "done"]);
    expect(ev.filter((e) => e.type === "turn").map((e) => e.turn!.n)).toEqual([1, 2, 3, 4]);
    expect(ev[2]!.best).toEqual({ amount: "1822.25", pay_by: d(7), turn: 2 });
    expect(ev[5]!.negotiation).toMatchObject({ mode: "live", outcome: "agreed" });
    expect((await admin("claude", "off")).status).toBe(200);
    const rec = await c.req("POST", "/v1/try/negotiate?stream=1", { key: await visitor() });
    const recText = await rec.res.clone().text().catch(() => "");
    const recEv = (recText || "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; negotiation?: { mode: string } });
    expect(recEv.map((e) => e.type)).toEqual(["done"]);
    expect(recEv[0]!.negotiation!.mode).toBe("recorded");
    expect((await admin("claude", "on")).status).toBe(200);
  });
  it("the kill switch: Claude off, the recorded negotiation, labelled, and no model call", async () => {
    expect((await admin("claude", "off")).status).toBe(200);
    asked.length = 0;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude is switched off on the demo right now.", outcome: "agreed" });
    expect(String(r.json.label)).toMatch(/^Recorded negotiation/);
    expect(asked).toHaveLength(0);
    expect((await admin("claude", "on")).status).toBe(200);
  });
  it("the spending cap: an action cap of 0 is the recorded negotiation", async () => {
    expect((await admin("cap_action_micros", 0)).status).toBe(200);
    asked.length = 0;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    expect(r.json).toMatchObject({ mode: "recorded", reason: "The demo's Claude spending cap is reached for now." });
    expect(asked).toHaveLength(0);
    expect((await admin("cap_action_micros", 50_000)).status).toBe(200);
  });
  it("Claude failing mid-negotiation: the recorded negotiation, and why", async () => {
    down = true;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    down = false;
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude stopped answering mid-negotiation (Claude answered HTTP 529)." });
  });
  it("no Claude set up: the recorded negotiation", async () => {
    const was = c.env.negotiateClaude;
    c.env.negotiateClaude = negotiateClaudeOf(c.env.sql, "off", "k");
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    c.env.negotiateClaude = was;
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude is not set up on this deployment." });
  });
  it(`at most ${NEGOTIATIONS_PER_COMPANY} a company`, async () => {
    script = LIVE;
    const s = await visitor();
    for (let i = 0; i < NEGOTIATIONS_PER_COMPANY; i++) expect((await c.req("POST", "/v1/try/negotiate", { key: s })).status).toBe(200);
    const r = await c.req("POST", "/v1/try/negotiate", { key: s });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe("limit");
  });
});

describe("the agreed terms, signed with /try's own flow", () => {
  it("files the agreed invoice, proposes it, signs it, refuses one cent more, pays it as signed", async () => {
    script = LIVE;
    const s = await visitor();
    const n = (await c.req("POST", "/v1/try/negotiate", { key: s })).json as { sha256: string; agreement: Parameters<typeof agreementSha256>[0]; compose: Record<string, string> };
    expect(agreementSha256(n.agreement)).toBe(n.sha256);
    const f = await c.req("POST", "/v1/engine/compose", { key: s, body: n.compose });
    expect(f.status, JSON.stringify(f.json)).toBe(200);
    const inv = f.json.invoice as { id: string; status: string };
    const p = await c.req("POST", `/v1/engine/invoices/${inv.id}/pay`, { key: s });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    const proposal = p.json.proposal as { id: string; challenge: string; terms_sha256: string };
    const t = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json as { terms: Record<string, unknown>; terms_sha256: string };
    // The terms the passkey signs are the agreement's: its amount, and its hash's first 8 characters as the reference.
    expect(t.terms).toMatchObject({ amount: "1813.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000", reference: n.compose.invoice_no });
    expect(String(t.terms.invoice_no)).toContain(n.sha256.slice(0, 8));
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
    const cred = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    const ap = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: cred } });
    expect(ap.json).toMatchObject({ status: "approved", held: true });
    const bad = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: { ...t.terms, amount: "1813.01" }, credential: cred } });
    expect(bad.json.outcome).toBe("refused");
    const good = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: t.terms, credential: cred } });
    expect(good.json.outcome, JSON.stringify(good.json).slice(0, 400)).toBe("paid");
    expect(good.json.proof).toBeTruthy();
  });
});

// Jury run (15 Nov): after a deal the original stayed open and booked beside the agreed one (6200 twice, creditors
// overstated), and Pay still paid the original. The agreed invoice now replaces it, and the proof says what was agreed.
describe("the negotiation on the visitor's own invoice, in /try", () => {
  it("the agreed invoice replaces the original: its payment superseded, its booking reversed, one payable, the books balanced", async () => {
    script = LIVE;
    const s = await visitor();
    const filed = await c.req("POST", "/v1/engine/samples/clean", { key: s, body: {} });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const orig = filed.json.invoice as { id: string; invoice_no: string; total: string; status: string };
    expect(orig).toMatchObject({ invoice_no: "BTX-2026-21", total: "1850.00", status: "ready" });
    // /try prepares the original's payment while its result is on screen.
    const prep = await c.req("POST", `/v1/engine/invoices/${orig.id}/pay`, { key: s });
    const origProposal = (prep.json.proposal as { id: string }).id;
    const n = (await c.req("POST", "/v1/try/negotiate", { key: s, body: { invoice_id: orig.id } })).json as { sha256: string; outcome: string; turns: unknown[]; compose: Record<string, string>; agreement: { amount: string } };
    expect(n.outcome).toBe("agreed");
    expect(n.compose.invoice_no).toBe(`BTX-2026-21-${n.sha256.slice(0, 8)}`);
    // Terms that are not the agreement are refused, and nothing is filed or superseded.
    const wrong = await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: n.sha256, turns: 4, compose: { ...n.compose, amount: "1850.00" } } });
    expect(wrong.status).toBe(409);
    const ok = await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: n.sha256, turns: n.turns.length, compose: n.compose } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const agreed = ok.json.invoice as { id: string; total: string; status: string };
    const sup = ok.json.superseded as { id: string; status: string; status_words: string; payable: boolean };
    expect(agreed).toMatchObject({ total: "1813.00", status: "ready" });
    expect(sup).toMatchObject({ id: orig.id, status: "rejected", payable: false });
    expect(sup.status_words).toContain("Superseded by the negotiated terms");
    // The original's payment can never be signed now.
    const ot = (await c.req("GET", `/v1/engine/proposals/${origProposal}/terms`, { key: s })).json as { status: string };
    expect(ot.status).toBe("SUPERSEDED");
    expect((await c.req("POST", `/v1/engine/invoices/${orig.id}/pay`, { key: s })).status).not.toBe(200);
    // Twice is refused: the original is gone.
    expect((await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: n.sha256, turns: 4, compose: n.compose } })).status).toBe(409);

    // Sign and pay the agreed invoice with /try's own flow.
    const p = await c.req("POST", `/v1/engine/invoices/${agreed.id}/pay`, { key: s });
    const proposal = p.json.proposal as { id: string; challenge: string; terms_sha256: string };
    const t = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json as { terms: Record<string, unknown> };
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    const cred = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: cred } });
    const good = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: t.terms, credential: cred } });
    expect(good.json.outcome, JSON.stringify(good.json).slice(0, 300)).toBe("paid");

    // The books: every entry balanced; the original's accrual reversed, so one expense and one payable remain, the agreed
    // ones, and the payable is settled by the payment.
    const ledger = (await c.req("GET", "/v1/ledger/entries", { key: s })).json as { items?: { lines: { account: string; debit_cents?: number; credit_cents?: number; debit?: number; credit?: number }[] }[]; entries?: unknown[] };
    const entries = (ledger.items ?? ledger.entries ?? []) as { lines: Record<string, unknown>[] }[];
    expect(entries.length).toBeGreaterThan(0);
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Math.round(Number(v) * 100) : 0);
    const dr = (l: Record<string, unknown>) => num(l.debit_cents ?? l.debit), cr = (l: Record<string, unknown>) => num(l.credit_cents ?? l.credit);
    for (const e of entries) expect(e.lines.reduce((a, l) => a + dr(l) - cr(l), 0)).toBe(0);
    // This invoice's entries only (the company's seeded history holds an earlier, paid Bergtex invoice): the original
    // BTX-2026-21 and the agreed BTX-2026-21-<ref>.
    const mine = entries.filter((e) => JSON.stringify(e).includes("BTX-2026-21"));
    const net = (acct: string) => mine.flatMap((e) => e.lines).filter((l) => String(l.account) === acct).reduce((a, l) => a + dr(l) - cr(l), 0);
    const expense = net("6200"), vat = net("1510") + net("1515");
    // Booked once, at the agreed amount: net and VAT add up to EUR 1,813.00 (EUR 1,850.00 would mean the original stayed).
    expect(expense + vat).toBe(181_300);
    expect(mine.flatMap((e) => e.lines).filter((l) => String(l.account) === "6200" && dr(l) > 0).length - mine.flatMap((e) => e.lines).filter((l) => String(l.account) === "6200" && cr(l) > 0).length).toBe(1);
    // Nothing owed on either: the original's payable reversed, the agreed one settled by the payment.
    expect(net("2100")).toBe(0);
    // The proof file carries what was negotiated, beside the signed terms.
    const proof = good.json.proof as { negotiation?: Record<string, unknown>; terms: Record<string, unknown> };
    expect(proof.negotiation).toEqual({ original_invoice_id: orig.id, original_invoice_no: "BTX-2026-21", original_amount: "1850.00", agreed_amount: "1813.00", discount: "37.00", currency: "EUR", agreement_sha256: n.sha256, turns: 4, superseded: true });
    expect(proof.terms.amount).toBe("1813.00");
    const { verifyProofBundle } = await import("../src/proof/bundle.js");
    expect((await verifyProofBundle(proof)).ok).toBe(true);
  });
});

// Security review (16 Nov): /agreed took the agreement's hash, the turns and the amount from the client, so a visitor
// could file an "agreed" invoice for a negotiation that never took place. Only what /v1/try/negotiate answered files now.
describe("only a negotiation that took place files", () => {
  it("a made-up agreement is refused; the real one files once", async () => {
    script = LIVE;
    const s = await visitor();
    const filed = await c.req("POST", "/v1/engine/samples/clean", { key: s, body: {} });
    const orig = filed.json.invoice as { id: string };
    const n = (await c.req("POST", "/v1/try/negotiate", { key: s, body: { invoice_id: orig.id } })).json as { sha256: string; turns: unknown[]; compose: Record<string, string> };
    const fake = "f".repeat(64);
    const forged = await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: fake, turns: 1, compose: { ...n.compose, invoice_no: `BTX-2026-21-${fake.slice(0, 8)}`, amount: "1000.00" } } });
    expect(forged.status).toBe(409);
    expect(forged.json.code).toBe("not_the_agreement");
    // The real agreement, but at another amount: refused too.
    expect((await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: n.sha256, turns: n.turns.length, compose: { ...n.compose, amount: "1500.00" } } })).status).toBe(409);
    const ok = await c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { invoice_id: orig.id, agreement_sha256: n.sha256, turns: n.turns.length, compose: n.compose } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
  });
});
