// /try/sign, step 0: "One policy → three locks", computed from the same code Purser uses (Max, item 1). Each panel is
// checked here, field for field, against what Purser's real code produces from the same policy:
//   Airwallex  the card body IssuingRest itself sends (createCard, setCardLimits, setCardControls), captured from a stub
//              API that answers locally; the limits as rules.ts's cardLimits() reads them from Purser's settings; the
//              starting categories, currencies and end date as cards.ts's cardControls() gives them;
//   Alta      the arguments the owner signer passes to metal-agent (issueReplacementCredential, with metal-agent
//              itself mocked, so nothing runs), built by the one function both it and the bootstrap use;
//   Purser     its settings by the rules' own keys, and "looser" for the amounts by rules.ts's loosens().
// Nothing here reaches Airwallex or Alta.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/metal/agentCli.js", async (orig) => ({
  ...(await orig<typeof import("../src/metal/agentCli.js")>()),
  keyPath: (f: string) => `/nowhere/keys/${f}`,
  metalAgent: vi.fn(() => ({ fields: new Map<string, string[]>(), out: "" })),
}));

const { metalAgent } = await import("../src/metal/agentCli.js");
const { issueReplacementCredential } = await import("../src/executors/ownerSigner.js");
const { IssuingRest } = await import("../src/airwallex/issuing.js");
const { cardControls } = await import("../src/policy/cards.js");
const { cardLimits, loosens, rules } = await import("../src/policy/rules.js");
const { openDb } = await import("../src/db/open.js");
const { credentialCreateArgs } = await import("../src/metal/credentialArgs.js");
const { AGENTS, MANDATE_EXPIRES_IN_SECONDS } = await import("../src/config/policy.js");
const { cardOf, defaultPolicy, fieldLooser, mandateOf, policyKey, threeLocks, withSet } = await import("../src/try/policy.js");
import type { Airwallex } from "../src/airwallex/client.js";
import type { WorldPolicy } from "../src/try/policy.js";

const now = new Date("2026-11-04T10:00:00Z");
const WORLD = "0123456789abcdef";
const start = defaultPolicy(now, { reserve_floor: "25000.00", alone_limit: "500.00" });
// A policy with every field moved, for each agent: the panels must follow every one of them.
const moved = (p: WorldPolicy): WorldPolicy => AGENTS.reduce((acc, a) => withSet(acc, a, {
  per_tx: "12.34", monthly: "99.99", mccs: ["5734", "7011"], currencies: ["EUR", "GBP"], end_date: "2027-01-31", alone: "750.00", reserve_floor: "21000.00",
}), p);
const POLICIES: [string, WorldPolicy][] = [["the starting policy", start], ["a policy with every field changed", moved(start)]];

/** A stub of Purser's Airwallex client: records each body, answers with a card carrying what it was sent. */
function stubApi() {
  const sent: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const api = {
    call: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (body) sent.push({ method, path, body });
      const ac = (sent.at(-1)?.body.authorization_controls ?? {}) as Record<string, unknown>;
      return { card_id: "card-1", cardholder_id: "holder-1", card_number: "4111 xxxx xxxx 1234", card_status: "ACTIVE", authorization_controls: ac };
    }),
  };
  return { api: api as unknown as Airwallex, sent };
}

describe("(a) Airwallex's card controls: what IssuingRest itself would send", () => {
  for (const [what, policy] of POLICIES) {
    for (const agent of AGENTS) {
      it(`${what}, ${agent}: authorization_controls equal createCard's body, field for field`, async () => {
        const locks = threeLocks(policy, agent, now, WORLD);
        const { api, sent } = stubApi();
        await new IssuingRest(api).createCard({ cardholderId: "holder-1", nickname: "test", createdBy: "Northwind CFO policy", ...cardOf(policy, agent) });
        expect(sent[0]!.path).toBe("/issuing/cards/create");
        const real = sent[0]!.body.authorization_controls as Record<string, unknown>;
        const shown = locks.airwallex.authorization_controls as Record<string, unknown>;
        expect(Object.keys(shown).sort()).toEqual(Object.keys(real).sort());
        for (const k of Object.keys(real)) expect(shown[k], k).toEqual(real[k]);
        // The values themselves, from the policy.
        const p = policy.agents[agent];
        expect(real).toMatchObject({
          transaction_limits: { currency: "EUR", limits: [{ amount: Number(p.per_tx), interval: "PER_TRANSACTION" }, { amount: Number(p.monthly), interval: "MONTHLY" }] },
          allowed_merchant_categories: p.mccs, allowed_currencies: p.currencies, active_to: `${p.end_date}T23:59:59.000Z`,
        });
      });

      it(`${what}, ${agent}: the limits and controls equal the bodies of a policy change (setCardLimits, setCardControls)`, async () => {
        const locks = threeLocks(policy, agent, now, WORLD);
        const { api, sent } = stubApi();
        const rest = new IssuingRest(api);
        const { limits, controls } = cardOf(policy, agent);
        await rest.setCardLimits("card-1", limits);
        await rest.setCardControls("card-1", controls);
        const shown = locks.airwallex.authorization_controls as { transaction_limits: Record<string, unknown>; allowed_merchant_categories: string[]; allowed_currencies: string[] };
        expect((sent[0]!.body.authorization_controls as { transaction_limits: unknown }).transaction_limits).toEqual({ ...shown.transaction_limits, cash_withdrawal_limits: [] });
        expect(sent[1]!.body.authorization_controls).toEqual({ allowed_merchant_categories: shown.allowed_merchant_categories, allowed_currencies: shown.allowed_currencies });
      });

      it(`${what}, ${agent}: the card's limits are what rules.ts's cardLimits() reads from Purser's settings`, () => {
        const db = openDb(":memory:");
        const p = policy.agents[agent];
        const put = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)");
        put.run(`card.${agent}.per_tx`, p.per_tx, now.toISOString());
        put.run(`card.${agent}.monthly`, p.monthly, now.toISOString());
        expect(cardOf(policy, agent).limits).toEqual(cardLimits(db, agent));
      });
    }
  }

  it("the starting categories, currencies and end date are cards.ts's cardControls(), for each agent", () => {
    for (const agent of AGENTS) {
      const real = cardControls(agent, now);
      const p = start.agents[agent];
      expect([p.mccs, p.currencies, p.end_date]).toEqual([real.mccs, real.currencies, real.activeTo!.slice(0, 10)]);
    }
  });

  it("the starting limits are Purser's own: an empty settings table gives the same cardLimits()", () => {
    const db = openDb(":memory:");
    for (const agent of AGENTS) expect(cardOf(start, agent).limits).toEqual(cardLimits(db, agent));
  });
});

describe("(a) Alta's mandate: the arguments Purser's owner signer passes to metal-agent", () => {
  it("issueReplacementCredential builds its call with credentialCreateArgs, the function the panel uses", () => {
    const spec = { agent: "treasury" as const, principal: "0x00000000000000000000000000000000000000b0" as const, capCents: 1234, budgetCents: 9999, payees: [{ address: "0x00000000000000000000000000000000000000c1" as const, name: "Sweep" }], description: "kit11 P-0042" };
    issueReplacementCredential(spec, "P-0042", "/nowhere/keys/treasury.key.json");
    const args = vi.mocked(metalAgent).mock.calls.at(-1)![0];
    const built = credentialCreateArgs({ ...spec, expiresInSeconds: MANDATE_EXPIRES_IN_SECONDS });
    expect(args.slice(0, built.length)).toEqual(built);
    expect(args.slice(built.length)).toEqual(["--mandate-key-file", "/nowhere/keys/treasury.key.json", "--key", "/nowhere/keys/owner-business.key.json", "--out", "/nowhere/keys/treasury.P-0042.credential.json"]);
  });

  it("the bootstrap builds the first mandates with the same function", () => {
    const src = readFileSync("src/cli/bootstrap.ts", "utf8");
    expect(src).toMatch(/credentialCreateArgs\(/);
    expect(src).not.toMatch(/"--cap", fromCents/);
  });

  for (const [what, policy] of POLICIES) {
    for (const agent of AGENTS) {
      it(`${what}, ${agent}: cap, budget, payee and expiry, field for field`, () => {
        const locks = threeLocks(policy, agent, now, WORLD);
        const args = credentialCreateArgs(mandateOf(policy, agent, now, WORLD));
        expect(locks.metal.args).toEqual(args);
        const after = (flag: string) => args[args.indexOf(flag) + 1];
        const p = policy.agents[agent];
        expect(locks.metal.params).toEqual({
          cap: after("--cap"), budget: after("--budget"), payee: after("--payee"),
          expires_in_seconds: after("--expires-in"), expires_at: new Date(now.getTime() + Number(after("--expires-in")) * 1000).toISOString(),
        });
        expect([after("--cap"), after("--budget")]).toEqual([p.per_tx, p.monthly]);
        expect(Date.parse(locks.metal.params.expires_at)).toBe(Date.parse(`${p.end_date}T23:59:59.000Z`));
      });
    }
  }
});

describe("(a) Purser's rule: the settings by Purser's own keys; looser as Purser decides it", () => {
  it("the amounts and the floor carry the keys of Purser's rules; the others are marked as the test world's", () => {
    const real = new Set(rules(openDb(":memory:")).map((r) => r.key as string));
    for (const agent of AGENTS) {
      const locks = threeLocks(start, agent, now, WORLD);
      const p = start.agents[agent];
      expect(locks.purser.settings).toEqual({
        [`card.${agent}.per_tx`]: p.per_tx, [`card.${agent}.monthly`]: p.monthly, eur_floor: start.reserve_floor,
        [policyKey("mccs", agent)]: p.mccs.join(","), [policyKey("currencies", agent)]: p.currencies.join(","),
        [policyKey("end_date", agent)]: `${p.end_date}T23:59:59.000Z`, [policyKey("alone", agent)]: p.alone,
      });
      for (const k of Object.keys(locks.purser.settings)) expect(real.has(k) || locks.purser.test_world_keys.includes(k), k).toBe(true);
      expect(locks.purser.test_world_keys.every((k) => !real.has(k))).toBe(true);
    }
  });

  it("for the amounts and the floor, looser is rules.ts's loosens(), both ways", () => {
    const cases: [("per_tx" | "monthly" | "alone" | "reserve_floor"), string, string][] = [
      ["per_tx", "25.00", "25.01"], ["per_tx", "25.00", "24.99"], ["monthly", "50.00", "60.00"], ["monthly", "50.00", "1.00"],
      ["alone", "500.00", "500.01"], ["alone", "500.00", "0.00"], ["reserve_floor", "25000.00", "24999.99"], ["reserve_floor", "25000.00", "30000.00"],
    ];
    for (const [field, from, to] of cases) {
      expect(fieldLooser(field, from, to), `${field} ${from} → ${to}`).toBe(loosens({ key: policyKey(field, "treasury"), from, to }));
    }
  });
});
