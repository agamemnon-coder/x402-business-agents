// Card actions in Purser Cloud (cloud/src/agentCards.ts), the refusals and failures around the owner's signature: an
// action signed by someone else, expired, tampered with in the database, already running or unknown is refused and
// nothing reaches Airwallex; an action that does not fit the card (freeze a frozen card, limits that already match,
// an edge test before the limits match) is refused before it is asked; and when the gateway fails or throws, the
// action is recorded as failed with Airwallex's code, once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import type { CardsAnswer, CardsPort } from "../src/airwallex/cardGate.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { fakeSandbox } from "./support/awxCardsFake.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
const writes = (calls: string[]) => calls.filter((x) => x.startsWith("POST ") && x !== "POST /authentication/login");

let c: TestCloud, t: TestTenant, s: ReturnType<typeof fakeSandbox>, desk: AwxCardsDesk;
/** What the gateway answers: the sandbox desk, unless a test replaces it. */
let gateway: (a: Parameters<CardsPort["ask"]>[0]) => Promise<CardsAnswer>;
const assertion = (challenge: string) => {
  const a = t.ownerPasskey.pk.assert("0x00", { challenge, origin: ORIGIN, rpId: RP });
  return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
};
const switchOn = () => c.env.sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_cards', 'on', '2026-11-08T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = 'on'");
const ask = (kind: string, agent = "sourcing", key = t.session) => c.req("POST", "/v1/cards/actions", { key, body: { kind, agent } });
const sign = (id: string, challenge: string, key = t.session) => c.req("POST", `/v1/cards/actions/${id}/sign`, { key, body: { credential_id: t.ownerPasskey.credential_id, assertion: assertion(challenge) } });
async function asked(kind: string, agent = "sourcing") {
  const a = await ask(kind, agent);
  expect(a.status, JSON.stringify(a.json)).toBe(201);
  return a.json.action as { id: string; challenge: string; sha256: string; lines: string[] };
}
async function act(kind: string, agent = "sourcing") {
  const action = await asked(kind, agent);
  return (await sign(action.id, action.challenge)).json;
}

beforeEach(async () => {
  c = testCloud();
  t = await c.tenant("acme");
  s = fakeSandbox();
  desk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" }, { fetchImpl: s.fetchImpl });
  gateway = (a) => desk.ask(a);
  c.env.awxCards = { ask: (a) => gateway(a) } satisfies CardsPort;
  const db = new TenantDb(c.env.sql, t.id);
  const rows = [["sourcing", "30.00 / 100.00"], ["support", "60.00 / 150.00"], ["treasury", "25.00 / 50.00"]].map(([agent, limits], i) =>
    db.insert("audit_rows", { seq: i + 1, ts: "2026-11-01T10:00:00Z", actor: agent!, event: "card.issued", subject: agent!, payload_json: JSON.stringify({ agent, last4: "0000", limits, currency: "EUR", nickname: `${agent} agent: software` }), prev_hash: "0", row_hash: String(i) }));
  await db.apply(rows);
  await switchOn();
});
afterEach(() => c.close());

describe("signing a card action", () => {
  it("refuses an action that does not exist, and one signed with a key instead of a session", async () => {
    expect((await sign("ca_0000000000000000", "x")).status).toBe(404);
    const action = await asked("issue");
    expect((await sign(action.id, action.challenge, t.key)).status).toBe(403);
    expect(writes(s.calls)).toEqual([]);
  });

  it("refuses an action that expired unsigned: ask again", async () => {
    const action = await asked("issue");
    await c.env.sql.run("UPDATE card_actions SET expires_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", [action.id]);
    const r = await sign(action.id, action.challenge);
    expect(r.status).toBe(410);
    expect(r.json.error).toMatch(/expired unsigned/);
    expect(writes(s.calls)).toEqual([]);
  });

  it("refuses an action whose stored record no longer hashes to what was asked, and one another person asked for", async () => {
    const action = await asked("issue");
    await c.env.sql.run("UPDATE card_actions SET action_json = replace(action_json, '3000', '9000') WHERE id = ?", [action.id]);
    const tampered = await sign(action.id, action.challenge);
    expect(tampered.status).toBe(409);
    expect(tampered.json.error).toMatch(/does not match its hash; nothing is sent/);
    const other = await asked("issue", "support");
    await c.env.sql.run("UPDATE card_actions SET by_user = 'someone_else' WHERE id = ?", [other.id]);
    expect((await sign(other.id, other.challenge)).status).toBe(403);
    expect(writes(s.calls)).toEqual([]);
  });

  it("refuses an action that is running, and when the switch is turned off between asking and signing, sends nothing", async () => {
    const action = await asked("issue");
    await c.env.sql.run("UPDATE card_actions SET status = 'running' WHERE id = ?", [action.id]);
    expect((await sign(action.id, action.challenge)).status).toBe(409);
    const second = await asked("issue", "support");
    await c.env.sql.run("UPDATE try_switches SET value = 'off' WHERE key = 'awx_cards'");
    const off = await sign(second.id, second.challenge);
    expect(off.status).toBe(409);
    expect(writes(s.calls)).toEqual([]);
  });

  it("records a gateway that throws or refuses as a failed action, with Airwallex's code, and answers it again without sending", async () => {
    await act("issue");
    gateway = async () => { throw new Error("connection reset"); };
    // Until 19 November a gateway that threw while the card was read answered 500 here, and on GET /v1/cards: the
    // stored card is used instead, with why there is no live answer.
    const view = await c.req("GET", "/v1/cards", { key: t.session });
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.json)).toContain("the card gateway did not answer");
    const freeze = await act("freeze");
    expect(freeze).toMatchObject({ status: "failed", kind: "freeze", reason: "the card gateway did not answer", code: "no_answer" });
    gateway = async () => ({ ok: false, code: "airwallex", reason: "the sandbox refused the call", status: 400, awx_code: "validation_failed", trace_id: "tr-1" });
    const action = await asked("freeze");
    const failed = (await sign(action.id, action.challenge)).json;
    expect(failed).toMatchObject({ status: "failed", code: "airwallex", awx_code: "validation_failed", trace_id: "tr-1" });
    const again = (await sign(action.id, action.challenge)).json;
    expect(again).toMatchObject({ status: "failed", repeated: true });
    const events = await c.env.sql.all<{ kind: string }>("SELECT kind FROM security_events WHERE tenant_id = ? AND kind LIKE 'card.%' ORDER BY at", [t.id]);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["card.issue.done", "card.freeze.failed"]));
  });

  it("an answer of the wrong shape is a failure, never a card", async () => {
    await act("issue");
    gateway = async (a) => (a.op === "status" ? ({ ok: true, op: "scope", issuing: "ok" } as CardsAnswer) : desk.ask(a));
    expect(await act("freeze")).toMatchObject({ status: "failed", reason: "an unexpected answer" });
  });
});

describe("asking for an action that does not fit the card", () => {
  it("freeze, unfreeze, limits or a test before the agent has a card: refused", async () => {
    for (const kind of ["freeze", "unfreeze", "limits", "test"]) {
      const r = await ask(kind);
      expect(r.status, kind).toBe(409);
      expect(r.json.error).toMatch(/no live card yet/);
    }
    expect(writes(s.calls)).toEqual([]);
  });

  it("an active card cannot be unfrozen, a frozen one cannot be frozen or tested at its edge", async () => {
    await act("issue");
    const unfreeze = await ask("unfreeze");
    expect(unfreeze.status).toBe(409);
    expect(unfreeze.json.error).toBe("the card is active, not frozen");
    await act("freeze");
    expect((await ask("freeze")).json.error).toBe("the card is inactive, not active");
    expect((await ask("edge")).json.error).toBe("the card is inactive, not active");
  });

  it("limits that already match the CFO policy are not set again; an edge test waits until they match", async () => {
    await act("issue");
    expect((await ask("limits")).json.error).toBe("the card's limits match the CFO policy already");
    // Airwallex now holds other limits on the card (changed in its web app): the live read updates the row.
    gateway = async (a) => {
      const x = await desk.ask(a);
      return x.ok && x.op === "card" && x.card.limits ? { ...x, card: { ...x.card, limits: { ...x.card.limits, per_tx_cents: 2000 } } } : x;
    };
    const edge = await ask("edge");
    expect(edge.status).toBe(409);
    expect(edge.json.error).toBe("set the card's limits to the CFO policy first");
    const limits = await asked("limits");
    expect(limits.lines.join("\n")).toMatch(/30\.00/);
  });

  it("a test over the limit: its amount is the card's limit plus the test's margin, and Airwallex's decline is shown", async () => {
    await act("issue");
    const test = await asked("test");
    expect(test.lines.join("\n")).toMatch(/over its limit of/);
    const r = (await sign(test.id, test.challenge)).json;
    expect(r).toMatchObject({ status: "done", kind: "test", tx: { approved: false, failure_reason: "LIMIT_EXCEEDED" } });
  });

  it("the edge test: exactly the limit, then one cent over, each with Airwallex's own answer, kept as a run record", async () => {
    await act("issue");
    const r = await act("edge");
    expect(r).toMatchObject({ status: "done", kind: "edge" });
    const tries = r.tries as { amount_cents: number; approved: boolean; failure_reason: string | null }[];
    expect(tries.map((x) => x.amount_cents)).toEqual([3000, 3001]);
    expect(tries.map((x) => x.approved)).toEqual([true, false]);
    const latest = await c.req("GET", "/v1/cards/edge/latest", { key: null });
    expect(latest.status).toBe(200);
    expect(JSON.stringify(latest.json)).toContain("3001");
  });

  it("the edge test stops at the first failed simulation and records the reason with Airwallex's code", async () => {
    await act("issue");
    gateway = async (a) => (a.op === "simulate" ? { ok: false, code: "airwallex", reason: "simulation off", awx_code: "not_found" } : desk.ask(a));
    const r = await act("edge");
    expect(r).toMatchObject({ status: "failed", reason: "simulation off (not_found)", tries: [] });
    expect((await c.req("GET", "/v1/cards/edge/latest", { key: null })).status).toBe(404);
  });
});
