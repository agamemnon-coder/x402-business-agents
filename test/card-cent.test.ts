// One cent over the limit (15 Nov): the agents' cards sorted out honestly from one live read (src/airwallex/agentCardSet.ts),
// adopted in Purser Cloud and on /airwallex alike; the older test cards frozen with one signed action; the limit L, then
// L + 0.01, at Airwallex's sandbox simulation, its own answers kept as a run record and shown only as the record says;
// and payees who are people shown by initials only (src/airwallex/personName.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import { agentCardsLive, POLICY_LIMITS, resetAgentCardsCache } from "../worker/src/agentCardsLive.js";
import { beneficiariesOf } from "../worker/src/awxRead.js";
import { cardCallCheck } from "../src/airwallex/cardGate.js";
import { agentOfCard, cardSetSummary, classifyAgentCards, type CardLite } from "../src/airwallex/agentCardSet.js";
import { initialsOf, looksLikePerson, publicNickname, publicPayeeName } from "../src/airwallex/personName.js";
import { centHolds, centHtml, centLine, type CentRecord } from "../src/redesign/cardCent.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { annotateBeneficiaries } from "../cloud/src/awxLive.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { CVV, fakeSandbox, PAN } from "./support/awxCardsFake.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
const lite = (o: Partial<CardLite> & { id: string; nickname: string }): CardLite => ({ last4: "0000", status: "ACTIVE", created_at: "2026-11-01T00:00:00Z", per_tx_cents: 3000, monthly_cents: 10000, ...o });

describe("sorting the sandbox's cards per agent (src/airwallex/agentCardSet.ts)", () => {
  const cards = [
    lite({ id: "a", nickname: "sourcing agent: warehouse (3efefc)", per_tx_cents: 4500, created_at: "2026-11-03T06:00:00Z" }),
    lite({ id: "b", nickname: "sourcing agent: market data", per_tx_cents: 5700, created_at: "2026-10-29T15:00:00Z" }),
    lite({ id: "c", nickname: "Sourcing agent: warehouse (Purser Cloud)", per_tx_cents: 3000, created_at: "2026-11-02T00:00:00Z" }),
    lite({ id: "d", nickname: "support agent: helpdesk", per_tx_cents: 6000, monthly_cents: 15000, status: "INACTIVE" }),
    lite({ id: "e", nickname: "a probe card", per_tx_cents: 100 }),
  ];
  it("knows the agent by the nickname, and only by it", () => {
    expect([agentOfCard("sourcing agent: x"), agentOfCard("Treasury agent: y"), agentOfCard("probe"), agentOfCard(null)]).toEqual(["sourcing", "treasury", null, null]);
  });
  it("picks the active card that matches the policy as live, even when an older one is newer; the rest are older test cards", () => {
    const [sourcing, support, treasury] = classifyAgentCards(cards, POLICY_LIMITS);
    expect(sourcing!.live?.id).toBe("c");
    expect(sourcing!.in_sync).toBe(true);
    expect(sourcing!.older.map((o) => [o.card.id, o.frozen])).toEqual([["a", false], ["b", false]]);
    // A frozen card is never live; an agent with no active card has none.
    expect(support!.live).toBeNull();
    expect(support!.older.map((o) => o.frozen)).toEqual([true]);
    expect(treasury!.live).toBeNull();
  });
  it("a card Purser Cloud pinned stays live, matching or not", () => {
    const [sourcing] = classifyAgentCards(cards, POLICY_LIMITS, { sourcing: "a" });
    expect(sourcing!.live?.id).toBe("a");
    expect(sourcing!.in_sync).toBe(false);
  });
  it("never says all match while an older card is still active or an agent has no live card", () => {
    const s = cardSetSummary(classifyAgentCards(cards, POLICY_LIMITS));
    expect(s).toEqual({ ok: false, text: "1 of 3 agents have a live card that matches the CFO policy; 2 older test cards are still active" });
  });
});

describe("the one cent: whole cents in the allow-list, and the record's line computed, never typed", () => {
  it("takes 30.01 as a whole-cent amount (30.01 * 100 is not exactly 3001 in floating point)", () => {
    expect(cardCallCheck("POST", "/simulation/issuing/create", { card_id: "c", transaction_amount: 30.01, transaction_currency: "EUR", merchant_category_code: "5734", merchant_info: "x" })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/simulation/issuing/create", { card_id: "c", transaction_amount: 30.015, transaction_currency: "EUR", merchant_category_code: "5734", merchant_info: "x" })).toHaveProperty("refused");
  });
  const rec = (a: number, b: number, okA = true, okB = false): CentRecord => ({
    run: "card-cent", ran_at: "2026-11-15T09:00:00.000Z", label: "Airwallex sandbox · test money", method: "m", agent: "sourcing", action_sha256: "f".repeat(64),
    card: { last4: "1902", card_id_last4: "abcd", per_tx_cents: 3000, monthly_cents: 10000 },
    attempts: [
      { amount_cents: a, currency: "EUR", id: "ctx_1", at: "2026-11-15T09:00:01Z", status: okA ? "APPROVED" : "FAILED", approved: okA, failure_reason: okA ? null : "LIMIT_EXCEEDED" },
      { amount_cents: b, currency: "EUR", id: "ctx_2", at: "2026-11-15T09:00:02Z", status: okB ? "APPROVED" : "FAILED", approved: okB, failure_reason: okB ? null : "LIMIT_EXCEEDED" },
    ],
  });
  it("says what the record holds, word for word", () => {
    expect(centLine(rec(3000, 3001))).toBe("Airwallex itself: EUR 30.00 approved, EUR 30.01 declined (LIMIT_EXCEEDED)");
    expect(centHolds(rec(3000, 3001))).toBe(true);
    // Had Airwallex approved both, the page says so and does not claim the limit held.
    expect(centLine(rec(3000, 3001, true, true))).toBe("Airwallex itself: EUR 30.00 approved, EUR 30.01 approved");
    expect(centHolds(rec(3000, 3001, true, true))).toBe(false);
  });
  it("claims nothing for a run that is not exactly L and L + 0.01, or with no record", () => {
    expect(centLine(rec(3000, 3500))).toBeNull();
    expect(centLine(rec(2999, 3000))).toBeNull();
    expect(centHtml({ file: "docs/runs/x.json", rec: rec(3000, 3500) })).toBe("");
    expect(centHtml(null)).toBe("");
    const html = centHtml({ file: "docs/runs/airwallex-card-cent-2026-11-15.json", rec: rec(3000, 3001) });
    expect(html).toContain("Airwallex itself: EUR 30.00 approved, EUR 30.01 declined (LIMIT_EXCEEDED)");
    expect(html).toContain("ctx_1");
    expect(html).toContain("docs/runs/airwallex-card-cent-2026-11-15.json");
  });
});

describe("payees who are people, by initials only (src/airwallex/personName.ts)", () => {
  it("tells a person from a company", () => {
    for (const n of ["Jan de Vries", "Maria Garcia Lopez", "Anna Müller"]) expect(looksLikePerson(n), n).toBe(true);
    for (const n of ["Stockline Data GmbH", "Northwind Outdoor", "Packwise", "ACME Ltd", "Bergtex 2"]) expect(looksLikePerson(n), n).toBe(false);
    expect(looksLikePerson("Packwise", "PERSONAL")).toBe(true);
  });
  it("keeps initials only, and drops a person's nickname", () => {
    expect(initialsOf("Jan de Vries")).toBe("J. d. V.");
    expect(publicPayeeName("Jan de Vries", "COMPANY")).toBe("J. d. V.");
    expect(publicPayeeName("Stockline Data GmbH", "COMPANY")).toBe("Stockline Data GmbH");
    expect(publicNickname("Jan de Vries EUR SWIFT", true)).toBeNull();
    expect(publicNickname("Jan de Vries EUR SWIFT", false)).toBe("J. d. V. EUR SWIFT");
    expect(publicNickname("Stockline Data GmbH EUR SWIFT", false)).toBe("Stockline Data GmbH EUR SWIFT");
  });
  it("masks at the read gateway, and again in Purser Cloud's Airwallex tab", () => {
    const raw = { items: [
      { id: "b1", nickname: "Jan de Vries EUR", beneficiary: { entity_type: "PERSONAL", first_name: "Jan", last_name: "de Vries", bank_details: { account_name: "Jan de Vries", iban: "DE89370400440532013000" } } },
      { id: "b2", nickname: "Stockline Data GmbH EUR SWIFT", beneficiary: { entity_type: "COMPANY", company_name: "Stockline Data GmbH", bank_details: {} } },
    ] };
    const out = beneficiariesOf(raw);
    expect(out.map((b) => [b.name, b.nickname])).toEqual([["J. d. V.", null], ["Stockline Data GmbH", "Stockline Data GmbH EUR SWIFT"]]);
    expect(JSON.stringify(out)).not.toMatch(/Vries|Jan\b/);
    const cloud = annotateBeneficiaries({ beneficiaries: [{ id: "b3", name: "Piet Jansen", nickname: "Piet Jansen EUR", entity_type: "COMPANY" }] }) as { beneficiaries: { name: string; nickname: string | null }[] };
    expect(cloud.beneficiaries[0]).toMatchObject({ name: "P. J.", nickname: null });
  });
});

describe("live cards, sorted out and tested at the limit (Purser Cloud and /airwallex)", () => {
  let c: TestCloud, t: TestTenant, s: ReturnType<typeof fakeSandbox>;
  const assertion = (challenge: string) => {
    const a = t.ownerPasskey.pk.assert("0x00", { challenge, origin: ORIGIN, rpId: RP });
    return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
  };
  const ask = (kind: string, agent = "sourcing") => c.req("POST", "/v1/cards/actions", { key: t.session, body: { kind, agent } });
  async function act(kind: string, agent = "sourcing") {
    const a = await ask(kind, agent);
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    const action = a.json.action as { id: string; challenge: string; lines: string[]; signed_text: string };
    const signed = await c.req("POST", `/v1/cards/actions/${action.id}/sign`, { key: t.session, body: { credential_id: t.ownerPasskey.credential_id, assertion: assertion(action.challenge) } });
    return { action, signed };
  }
  let desk: AwxCardsDesk;
  beforeEach(async () => {
    c = testCloud();
    t = await c.tenant("acme");
    s = fakeSandbox();
    // The sandbox as Max found it on 15 Nov: older Sourcing cards at EUR 45 and 57 a purchase, and one at the policy's 30.
    s.seed({ nick_name: "sourcing agent: warehouse and data software (3efefc)", card_status: "ACTIVE", per: 45, month: 100, created_at: "2026-11-03T06:06:27.783+0000", last4: "1423" });
    s.seed({ nick_name: "sourcing agent: market data", card_status: "ACTIVE", per: 57, month: 100, created_at: "2026-10-29T15:53:00.000+0000", last4: "1902" });
    s.seed({ nick_name: "sourcing agent: warehouse and data software (Purser Cloud)", card_status: "ACTIVE", per: 30, month: 100, created_at: "2026-11-02T10:00:00.000+0000", last4: "5550" });
    s.seed({ nick_name: "support agent: helpdesk software (3efefc)", card_status: "ACTIVE", per: 60, month: 150, created_at: "2026-11-03T06:06:29.394+0000", last4: "6203" });
    desk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" }, { fetchImpl: s.fetchImpl });
    c.env.awxCards = { ask: (a) => desk.ask(a) };
    const db = new TenantDb(c.env.sql, t.id);
    await db.apply([["sourcing", "30.00 / 100.00"], ["support", "60.00 / 150.00"], ["treasury", "25.00 / 50.00"]].map(([agent, limits], i) =>
      db.insert("audit_rows", { seq: i + 1, ts: "2026-11-01T10:00:00Z", actor: agent!, event: "card.issued", subject: agent!, payload_json: JSON.stringify({ agent, last4: "0000", limits, currency: "EUR", nickname: `${agent} agent: software` }), prev_hash: "0", row_hash: String(i) })));
    await c.env.sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_cards', 'on', '2026-11-15T00:00:00Z')");
    resetAgentCardsCache();
  });
  afterEach(() => c.close());

  it("Cloud's Agents tab and /airwallex say the same, from the same read: live card, policy, older cards", async () => {
    const v = (await c.req("GET", "/v1/cards", { key: t.session })).json as { agents: { agent: string; card: { last4: string; per_tx_cents: number } | null; in_sync: boolean; older: { last4: string; frozen: boolean }[] }[] };
    const src = v.agents.find((a) => a.agent === "sourcing")!;
    expect(src.card).toMatchObject({ last4: "5550", per_tx_cents: 3000 });
    expect(src.in_sync).toBe(true);
    expect(src.older.map((o) => [o.last4, o.frozen])).toEqual([["1423", false], ["1902", false]]);
    // "No live card yet" no more: the support agent's card from the sandbox is adopted too.
    expect(v.agents.find((a) => a.agent === "support")!.card).toMatchObject({ last4: "6203" });
    const site = await agentCardsLive((q) => desk.ask(q)) as { source: string; summary: { ok: boolean; text: string }; agents: { agent: string; live: { last4: string } | null; older: { last4: string }[] }[] };
    expect(site.source).toBe("airwallex-sandbox");
    expect(site.agents.find((a) => a.agent === "sourcing")!.live?.last4).toBe("5550");
    expect(site.agents.find((a) => a.agent === "sourcing")!.older.map((o) => o.last4)).toEqual(["1423", "1902"]);
    expect(site.summary).toEqual({ ok: false, text: "2 of 3 agents have a live card that matches the CFO policy; 2 older test cards are still active" });
    for (const body of [v, site]) {
      expect(JSON.stringify(body)).not.toMatch(/\b\d{13,19}\b/);
      expect(JSON.stringify(body)).not.toMatch(new RegExp(`"cvv"|"${CVV}"|ch_secret_holder|${PAN}`));
    }
  });

  it("freezes the older test cards with one signed action, and leaves the live card alone", async () => {
    await c.req("GET", "/v1/cards", { key: t.session });
    const { action, signed } = await act("tidy");
    expect(action.lines[0]).toContain("•••• 1423, •••• 1902");
    expect(JSON.parse(action.signed_text).card_ids).toHaveLength(2);
    expect(signed.json).toMatchObject({ status: "done", kind: "tidy" });
    expect([...s.cards.values()].filter((x) => x.nick_name.startsWith("sourcing")).map((x) => [x.last4, x.card_status])).toEqual([["1423", "INACTIVE"], ["1902", "INACTIVE"], ["5550", "ACTIVE"]]);
    resetAgentCardsCache();
    const site = await agentCardsLive((q) => desk.ask(q)) as { summary: { text: string } };
    expect(site.summary.text).toBe("2 of 3 agents have a live card that matches the CFO policy");
    expect((await ask("tidy")).status).toBe(409);
  });

  it("runs the limit, then one cent over, at the sandbox; keeps Airwallex's answers as the run record", async () => {
    await c.req("GET", "/v1/cards", { key: t.session });
    expect((await c.req("GET", "/v1/cards/edge/latest", { key: null })).status).toBe(404);
    const { action, signed } = await act("edge");
    expect(JSON.parse(action.signed_text).amounts_cents).toEqual([3000, 3001]);
    expect(signed.json).toMatchObject({ status: "done", kind: "edge" });
    const sims = s.calls.filter((x) => x === "POST /simulation/issuing/create");
    expect(sims).toHaveLength(2);
    const rec = (await c.req("GET", "/v1/cards/edge/latest", { key: null })).json as unknown as CentRecord;
    expect(centLine(rec)).toBe("Airwallex itself: EUR 30.00 approved, EUR 30.01 declined (LIMIT_EXCEEDED)");
    expect(rec.card).toMatchObject({ last4: "5550", per_tx_cents: 3000 });
    expect(rec.attempts.map((a) => typeof a.id === "string" && a.id.length > 0)).toEqual([true, true]);
    expect(JSON.stringify(rec)).not.toMatch(/\b\d{13,19}\b|"cvv"|ch_secret_holder/);
  });

  it("asks for the policy's limits before the edge test when the live card differs", async () => {
    // A company that already pinned the EUR 45 card: the edge test waits for "Set limits to the policy".
    const id = [...s.cards.values()].find((x) => x.last4 === "1423")!.card_id;
    await c.env.sql.exec("CREATE TABLE IF NOT EXISTS agent_cards (tenant_id TEXT NOT NULL, agent TEXT NOT NULL, card_id TEXT NOT NULL, last4 TEXT, status TEXT NOT NULL, per_tx_cents INTEGER, monthly_cents INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, action_sha256 TEXT NOT NULL, PRIMARY KEY (tenant_id, agent))");
    await c.req("GET", "/v1/cards", { key: t.session });
    await c.env.sql.run("UPDATE agent_cards SET card_id = ?, last4 = '1423', per_tx_cents = 4500 WHERE tenant_id = ? AND agent = 'sourcing'", [id, t.id]);
    const r = await ask("edge");
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("limits to the CFO policy first");
    expect((await act("limits")).signed.json).toMatchObject({ status: "done", card: { per_tx_cents: 3000 } });
    expect((await act("edge")).signed.json).toMatchObject({ status: "done" });
  });

  it("does not issue a second card for an agent the sandbox already has one for", async () => {
    const r = await ask("issue");
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("adopted");
  });

  it("a company of its own with no agents in its records sees Kit 11's three when live cards are on, and nothing when off", async () => {
    const c2 = testCloud();
    const t2 = await c2.tenant("ownco");
    c2.env.awxCards = { ask: (a) => desk.ask(a) };
    const view = async () => ((await c2.req("GET", "/v1/cards", { key: t2.session })).json as { agents: { agent: string; card: { last4: string } | null }[] }).agents;
    expect(await view()).toEqual([]);
    await c2.env.sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_cards', 'on', '2026-11-15T00:00:00Z')");
    const agents = await view();
    expect(agents.map((a) => a.agent)).toEqual(["sourcing", "support", "treasury"]);
    expect(agents.find((a) => a.agent === "sourcing")!.card).toMatchObject({ last4: "5550" });
    // The one-cent test runs as built, signed by this company's own owner.
    const a = await c2.req("POST", "/v1/cards/actions", { key: t2.session, body: { kind: "edge", agent: "sourcing" } });
    expect(a.status).toBe(201);
    const act = a.json.action as { id: string; challenge: string };
    const sig = t2.ownerPasskey.pk.assert("0x00", { challenge: act.challenge, origin: ORIGIN, rpId: RP });
    const signed = await c2.req("POST", `/v1/cards/actions/${act.id}/sign`, { key: t2.session, body: { credential_id: t2.ownerPasskey.credential_id, assertion: { authenticatorData: b64u(sig.authenticatorData), clientDataJSON: b64u(sig.clientDataJSON), signature: b64u(sig.signature) } } });
    expect(signed.json).toMatchObject({ status: "done", kind: "edge" });
    c2.close();
  });
});
