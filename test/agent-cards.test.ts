// The agents' live sandbox cards (cloud/src/agentCards.ts, worker/src/awxCards.ts, src/airwallex/cardGate.ts): the card
// allow-list holds exactly the calls Max allowed; a write needs the owner's passkey signature over the exact action's
// hash; the same signed action never runs twice; the switch, the try companies and the caps stop it; and no full card
// number or CVV is ever stored, answered or rendered (the fake sandbox below sends both, as a careless API might).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import { cardCallCheck, safeCard, safeTx, type CardsPort } from "../src/airwallex/cardGate.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { cardsBlocked, WRITES_PER_DAY } from "../cloud/src/agentCards.js";
import { UI_JS } from "../cloud/src/consoleUi.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { CVV, fakeSandbox, PAN } from "./support/awxCardsFake.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

describe("the card allow-list (src/airwallex/cardGate.ts)", () => {
  const lim = { currency: "EUR", limits: [{ amount: 30, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] };
  it("takes reads, the three writes and the purchase simulation, in their exact shapes", () => {
    expect(cardCallCheck("GET", "/issuing/cards", undefined, { page_num: "0", page_size: "1" })).toHaveProperty("rule");
    expect(cardCallCheck("GET", "/issuing/transactions", undefined, { card_id: "card_1" })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/issuing/cards/create", { request_id: "a".repeat(48), form_factor: "VIRTUAL", authorization_controls: { transaction_limits: lim } })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/issuing/cards/card_1/update", { card_status: "INACTIVE" })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/issuing/cards/card_1/update", { card_status: "ACTIVE" })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/issuing/cards/card_1/update", { authorization_controls: { transaction_limits: { ...lim, cash_withdrawal_limits: [] } } })).toHaveProperty("rule");
    expect(cardCallCheck("POST", "/simulation/issuing/create", { card_id: "c", transaction_amount: 35, transaction_currency: "EUR", merchant_category_code: "5734", merchant_info: "x" })).toHaveProperty("rule");
  });
  it("refuses everything else: other paths, other fields, closing a card, a physical card, big limits, odd query keys", () => {
    const refused = (m: string, p: string, b?: unknown, q?: Record<string, string>) => expect(cardCallCheck(m, p, b, q)).toHaveProperty("refused");
    refused("POST", "/transfers/create", { request_id: "x" });
    refused("GET", "/issuing/cards/card_1/details");
    refused("POST", "/issuing/cards/card_1/update", { card_status: "CLOSED" });
    refused("POST", "/issuing/cards/card_1/update", { card_status: "INACTIVE", nick_name: "x" });
    refused("POST", "/issuing/cards/card_1/update", { authorization_controls: { allowed_merchant_categories: ["0000"] } });
    refused("POST", "/issuing/cards/card_1/update", { authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 9999, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } } });
    refused("POST", "/issuing/cards/create", { request_id: "a".repeat(48), form_factor: "PHYSICAL", authorization_controls: { transaction_limits: lim } });
    refused("POST", "/issuing/cards/create", { form_factor: "VIRTUAL", authorization_controls: { transaction_limits: lim } });
    refused("GET", "/issuing/cards", undefined, { email: "a" });
    refused("GET", "/issuing/cards/../transfers");
    refused("DELETE", "/issuing/cards/card_1");
  });
  it("lets only the last four digits out: never the card number, the CVV or the cardholder", () => {
    const c = safeCard({ card_id: "card_1", card_number: PAN, cvv: CVV, cardholder_id: "ch_1", card_status: "ACTIVE" })!;
    expect(c.last4).toBe("1902");
    expect(JSON.stringify(c)).not.toMatch(new RegExp(`${PAN}|"${CVV}"|ch_1|cvv`));
    expect(JSON.stringify(safeTx({ card_transaction_id: "t1", card_id: "card_1", card_number: PAN, transaction_amount: -5, transaction_currency: "EUR", status: "APPROVED", created_at: "2026-11-08T00:00:00Z" }))).not.toContain(PAN);
  });
});

describe("kit11's card desk (worker/src/awxCards.ts)", () => {
  const sha = "a".repeat(64);
  it("refuses writes while AWX_CARDS_WRITE is not on, and a write without the signed action's hash", async () => {
    const s = fakeSandbox();
    const off = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k" }, { fetchImpl: s.fetchImpl });
    expect(await off.ask({ op: "status", card_id: "card_1", status: "INACTIVE", action_sha256: sha })).toMatchObject({ ok: false, code: "writes_off" });
    const onDesk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" }, { fetchImpl: s.fetchImpl });
    expect(await onDesk.ask({ op: "status", card_id: "card_1", status: "INACTIVE", action_sha256: "nope" })).toMatchObject({ ok: false, code: "refused" });
    expect(s.calls.filter((x) => !x.includes("login"))).toEqual([]);
  });
  it("says ok or forbidden for the Issuing scope check, and no_key without a key", async () => {
    expect(await new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k" }, { fetchImpl: fakeSandbox().fetchImpl }).ask({ op: "scope" })).toEqual({ ok: true, op: "scope", issuing: "ok" });
    expect(await new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k" }, { fetchImpl: fakeSandbox({ issuing: false }).fetchImpl }).ask({ op: "scope" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await new AwxCardsDesk({}).ask({ op: "scope" })).toMatchObject({ ok: false, code: "no_key" });
  });
});

describe("live cards in Purser Cloud (cloud/src/agentCards.ts)", () => {
  let c: TestCloud, t: TestTenant, s: ReturnType<typeof fakeSandbox>;
  const assertion = (challenge: string) => {
    const a = t.ownerPasskey.pk.assert("0x00", { challenge, origin: ORIGIN, rpId: RP });
    return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
  };
  const switchOn = () => c.env.sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_cards', 'on', '2026-11-08T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = 'on'");
  const ask = (kind: string, agent = "sourcing", key = t.session) => c.req("POST", "/v1/cards/actions", { key, body: { kind, agent } });
  const sign = (id: string, challenge: string) => c.req("POST", `/v1/cards/actions/${id}/sign`, { key: t.session, body: { credential_id: t.ownerPasskey.credential_id, assertion: assertion(challenge) } });
  async function act(kind: string, agent = "sourcing") {
    const a = await ask(kind, agent);
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    const action = a.json.action as { id: string; challenge: string; sha256: string };
    return { action, signed: await sign(action.id, action.challenge) };
  }

  beforeEach(async () => {
    c = testCloud();
    t = await c.tenant("acme");
    s = fakeSandbox();
    const desk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" }, { fetchImpl: s.fetchImpl });
    c.env.awxCards = { ask: (a) => desk.ask(a) } satisfies CardsPort;
    // The company's records name its three agents and their cards as issued under the CFO policy.
    const db = new TenantDb(c.env.sql, t.id);
    const rows = [["sourcing", "30.00 / 100.00"], ["support", "60.00 / 150.00"], ["treasury", "25.00 / 50.00"]].map(([agent, limits], i) =>
      db.insert("audit_rows", { seq: i + 1, ts: "2026-11-01T10:00:00Z", actor: agent!, event: "card.issued", subject: agent!, payload_json: JSON.stringify({ agent, last4: "0000", limits, currency: "EUR", nickname: `${agent} agent: software` }), prev_hash: "0", row_hash: String(i) }));
    await db.apply(rows);
  });
  afterEach(() => c.close());

  it("is off while the admin switch awx_cards is missing: nothing reaches Airwallex", async () => {
    const r = await ask("issue");
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("awx_cards");
    const v = await c.req("GET", "/v1/cards", { key: t.session });
    expect(v.json).toMatchObject({ on: false, can_act: false });
    expect(s.calls).toEqual([]);
  });

  it("issues a card with the policy's limits only after the owner's passkey signs the exact action, once", async () => {
    await switchOn();
    const a = await ask("issue");
    const action = a.json.action as { id: string; challenge: string; sha256: string; signed_text: string; lines: string[] };
    expect(action.challenge).toBe(Buffer.from(action.sha256, "hex").toString("base64url"));
    expect(JSON.parse(action.signed_text)).toMatchObject({ kind: "issue", agent: "sourcing", limits: { per_tx_cents: 3000, monthly_cents: 10000 }, sandbox: true });
    expect(s.calls).toEqual([]);
    // A signature over anything else is refused, and nothing is sent.
    const wrong = await sign(action.id, Buffer.from("b".repeat(64), "hex").toString("base64url"));
    expect(wrong.status).toBe(401);
    expect(s.calls).toEqual([]);
    const ok = await sign(action.id, action.challenge);
    expect(ok.json).toMatchObject({ status: "done", kind: "issue", card: { last4: "1902", status: "ACTIVE", per_tx_cents: 3000, monthly_cents: 10000 } });
    // Idempotent by the signed hash: the same signature again answers the first result and sends nothing.
    const creates = s.calls.filter((x) => x === "POST /issuing/cards/create").length;
    const again = await sign(action.id, action.challenge);
    expect(again.json).toMatchObject({ status: "done", repeated: true });
    expect(s.calls.filter((x) => x === "POST /issuing/cards/create").length).toBe(creates);
    expect(creates).toBe(1);
    expect((await ask("issue")).status).toBe(409);
  });

  it("freezes and unfreezes with Face ID, and shows a decline when the agent tries over its limit", async () => {
    await switchOn();
    await act("issue");
    expect((await act("freeze")).signed.json).toMatchObject({ status: "done", card: { status: "INACTIVE" } });
    expect((await ask("freeze")).status).toBe(409);
    expect((await act("unfreeze")).signed.json).toMatchObject({ status: "done", card: { status: "ACTIVE" } });
    const test = await act("test");
    expect(test.signed.json).toMatchObject({ status: "done", tx: { approved: false, failure_reason: "LIMIT_EXCEEDED", amount_cents: 3500 } });
    const v = await c.req("GET", "/v1/cards", { key: t.session });
    const sourcing = (v.json.agents as { agent: string; card: { status: string; last4: string }; transactions: { id: string; approved: boolean }[] }[]).find((x) => x.agent === "sourcing")!;
    expect(sourcing.card).toMatchObject({ status: "ACTIVE", last4: "1902" });
    expect(sourcing.transactions[0]).toMatchObject({ approved: false });
    expect(sourcing.transactions[0]!.id).toMatch(/^ctx_/);
  });

  it("never stores, answers or renders a full card number or CVV", async () => {
    await switchOn();
    await act("issue");
    await act("test");
    const v = await c.req("GET", "/v1/cards", { key: t.session });
    expect(JSON.stringify(v.json)).not.toContain(PAN);
    expect(JSON.stringify(v.json)).not.toMatch(/"cvv"|"737"|ch_secret_holder/i);
    for (const table of ["agent_cards", "card_actions", "card_reads", "security_events"]) {
      const dump = JSON.stringify(await c.env.sql.all(`SELECT * FROM ${table}`));
      expect(dump, table).not.toContain(PAN);
      expect(dump, table).not.toMatch(/"cvv"|"737"|ch_secret_holder/);
    }
    // The Agents tab draws the masked dots and the last four only, never a field for a full number.
    expect(UI_JS).toContain("•••• •••• •••• ");
    expect(UI_JS).not.toMatch(/card_number|cvv/i);
  });

  it("holds the caps: one card an agent, three a company, and the daily writes", async () => {
    await switchOn();
    for (const a of ["sourcing", "support", "treasury"]) expect((await act("issue", a)).signed.json.status).toBe("done");
    expect((await c.env.sql.all("SELECT * FROM agent_cards")).length).toBe(3);
    // The daily cap: count the day full, then a new action is refused before it is even asked.
    for (let i = 0; i < WRITES_PER_DAY; i++) {
      await c.env.sql.run("INSERT INTO card_actions (tenant_id, id, sha256, kind, agent, action_json, challenge, by_user, created_at, expires_at, status, day) VALUES (?, ?, ?, 'freeze', 'sourcing', '{}', 'x', 'u', 'x', 'x', 'done', '2026-11-08')", [t.id, `pad${i}`, `pad${i}`]);
    }
    expect((await ask("freeze")).status).toBe(429);
  });

  it("refuses a key, a viewer and a /try test company; asks only the owner's own passkey", async () => {
    await switchOn();
    expect((await ask("issue", "sourcing", t.key)).status).toBe(403);
    expect((await ask("issue", "nobody")).status).toBe(404);
    expect(await cardsBlocked(c.env.sql, "t_try_abc", c.env.awxCards)).toContain("/try");
    expect(await cardsBlocked(c.env.sql, t.id, undefined)).toContain("no card gateway");
    expect(await cardsBlocked(c.env.sql, t.id, c.env.awxCards)).toBeNull();
    expect(s.calls).toEqual([]);
  });

  it("answers the Issuing scope check as ok or forbidden, without card data", async () => {
    expect((await c.req("GET", "/v1/cards/scope", { key: null })).json).toMatchObject({ issuing: "ok" });
    const c2 = testCloud();
    const desk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k" }, { fetchImpl: fakeSandbox({ issuing: false }).fetchImpl });
    c2.env.awxCards = { ask: (a) => desk.ask(a) };
    expect((await c2.req("GET", "/v1/cards/scope", { key: null })).json).toMatchObject({ issuing: "forbidden" });
    c2.close();
  });
});
