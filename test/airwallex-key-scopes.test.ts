// Scoped Airwallex keys per role (security hardening, 19 November). Each role may have its own API key, created in the
// Airwallex web app with only that role's scopes: AIRWALLEX_API_KEY_READ (reads, reconciliation), _PAYOUT (the
// payout executors), _ISSUING (the agents' cards), _SPEND (bills and vendors). Each falls back to AIRWALLEX_API_KEY
// when unset. With a role key, the client refuses, before anything is sent, any call outside that role's allow-list,
// which mirrors Airwallex's key scopes (https://www.airwallex.com/docs/developer-tools/api/api-key-scopes.md); and a
// process that would use a role key for a call outside its list refuses to start. Stand-in fetch only: 0 network.
import { describe, expect, it } from "vitest";
import { Airwallex, fromEnv } from "../src/airwallex/client.js";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { IssuingRest, issuingFromEnv } from "../src/airwallex/issuing.js";
import { AirwallexScopeRefused, ROLE_CALLS, ROLE_ENV, ROLE_SCOPES, ROLES, assertRoleKeys, resourceOf, roleCallRefusals, scopeAllows, type AirwallexRole } from "../src/airwallex/keyScopes.js";

const BASE = { AIRWALLEX_CLIENT_ID: "stand-in-client", AIRWALLEX_API_KEY: "stand-in-general-key" };

/** A recording stand-in for Airwallex: logs every request (with the key a login used); answers a token or an empty list. */
function standIn() {
  const calls: { method: string; path: string; key: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", path: url.pathname.replace("/api/v1", ""), key: headers.get("x-api-key") });
    if (url.pathname.endsWith("/authentication/login")) return Response.json({ token: "t" });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const client = (role: AirwallexRole | undefined, s: ReturnType<typeof standIn>) => new Airwallex({ clientId: "c", apiKey: "k", fetchImpl: s.fetchImpl, minGapMs: 0, sleep: async () => {}, ...(role ? { role } : {}) });

describe("scoped Airwallex keys per role", () => {
  it("reads each role's key from its own variable, falling back to AIRWALLEX_API_KEY with no role guard", () => {
    expect(ROLE_ENV).toEqual({ read: "AIRWALLEX_API_KEY_READ", payout: "AIRWALLEX_API_KEY_PAYOUT", issuing: "AIRWALLEX_API_KEY_ISSUING", spend: "AIRWALLEX_API_KEY_SPEND" });
    for (const role of ROLES) {
      expect(fromEnv(BASE, role)).toMatchObject({ clientId: "stand-in-client", apiKey: "stand-in-general-key" });
      expect(fromEnv(BASE, role)?.role).toBeUndefined();
      const scoped = fromEnv({ ...BASE, [ROLE_ENV[role]]: `stand-in-${role}-key` }, role);
      expect(scoped).toMatchObject({ clientId: "stand-in-client", apiKey: `stand-in-${role}-key`, role });
    }
    // A role key alone, with no general key, still serves its role; the general client stays off.
    expect(fromEnv({ AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY_READ: "r" }, "read")).toMatchObject({ apiKey: "r", role: "read" });
    expect(fromEnv({ AIRWALLEX_CLIENT_ID: "c", AIRWALLEX_API_KEY_READ: "r" })).toBeNull();
    // No role asked: the general key, as before.
    expect(fromEnv({ ...BASE, AIRWALLEX_API_KEY_PAYOUT: "p" })).toMatchObject({ apiKey: "stand-in-general-key" });
  });

  it("holds the scopes the owner creates in the Airwallex web app, role by role", () => {
    expect(ROLE_SCOPES).toEqual({
      read: { read: ["Balances", "Deposits", "Global Accounts", "Transfers", "Beneficiaries", "Conversion", "Financial Transactions", "Bills", "Vendors", "Authorizations and Transactions", "Cards"], write: [] },
      payout: { read: ["Balances"], write: ["Transfers", "Beneficiaries", "Conversion", "Simulations"] },
      issuing: { read: ["Authorizations and Transactions"], write: ["Cards", "Cardholders"] },
      spend: { read: [], write: ["Bills", "Vendors", "Upload Files"] },
    });
    expect(resourceOf("/balances/current")).toBe("Balances");
    expect(resourceOf("/batch_transfers/b1/submit")).toBe("Transfers");
    expect(resourceOf("/fx/quotes/create")).toBe("Conversion");
    expect(resourceOf("/issuing/cards/c1/update")).toBe("Cards");
    expect(resourceOf("/issuing/transactions")).toBe("Authorizations and Transactions");
    expect(resourceOf("/simulation/issuing/create")).toBe("Simulations");
    expect(resourceOf("/webhooks/create")).toBeNull();
  });

  it("allows, per role, exactly its scopes: Read is GET, Write is GET and POST", () => {
    const cases: [AirwallexRole, "GET" | "POST", string, boolean][] = [
      ["read", "GET", "/balances/current", true], ["read", "GET", "/financial_transactions", true], ["read", "GET", "/issuing/transactions", true],
      ["read", "POST", "/transfers/create", false], ["read", "POST", "/issuing/cards/c1/update", false], ["read", "GET", "/issuing/cardholders", false],
      ["payout", "POST", "/transfers/create", true], ["payout", "POST", "/fx/conversions/create", true], ["payout", "POST", "/beneficiaries/create", true],
      ["payout", "POST", "/simulation/transfers/t1/transition", true], ["payout", "GET", "/balances/current", true], ["payout", "POST", "/batch_transfers/create", true],
      ["payout", "POST", "/issuing/cards/c1/update", false], ["payout", "GET", "/deposits", false], ["payout", "POST", "/global_accounts/create", false], ["payout", "POST", "/webhooks/create", false],
      ["issuing", "POST", "/issuing/cards/c1/update", true], ["issuing", "POST", "/issuing/cardholders/create", true], ["issuing", "GET", "/issuing/transactions", true],
      ["issuing", "POST", "/transfers/create", false], ["issuing", "POST", "/simulation/issuing/create", false], ["issuing", "GET", "/balances/current", false],
      ["spend", "POST", "/spend/bills/create", true], ["spend", "POST", "/spend/vendors/create", true], ["spend", "POST", "/files/upload", true],
      ["spend", "POST", "/transfers/create", false], ["spend", "GET", "/balances/current", false],
    ];
    for (const [role, method, path, ok] of cases) expect(scopeAllows(role, method, path), `${role} ${method} ${path}`).toBe(ok);
  });

  it("refuses a call outside the role's list before anything is sent, not even the login", async () => {
    const s = standIn();
    await expect(client("read", s).call("POST", "/transfers/create", {})).rejects.toBeInstanceOf(AirwallexScopeRefused);
    await expect(client("payout", s).call("POST", "/issuing/cards/c1/update", {})).rejects.toThrow(/the payout key may not call POST \/issuing\/cards\/c1\/update/);
    await expect(client("issuing", s).call("POST", "/transfers/create", {})).rejects.toBeInstanceOf(AirwallexScopeRefused);
    expect(s.calls).toEqual([]);
    await client("read", s).call("GET", "/balances/current");
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /authentication/login", "GET /balances/current"]);
    // No role (the general key): no guard, as before.
    await client(undefined, s).call("POST", "/webhooks/create", {});
    expect(s.calls.at(-1)).toMatchObject({ method: "POST", path: "/webhooks/create" });
  });

  it("refuses to start when a role key would be used for a call outside its role's list", () => {
    for (const role of ROLES) expect(roleCallRefusals(role, ROLE_CALLS[role]), role).toEqual([]);
    expect(roleCallRefusals("read", [...ROLE_CALLS.read, "POST /transfers/create"])).toEqual(["the read key may not call POST /transfers/create (Transfers needs Write; the read key has Read)"]);
    expect(() => assertRoleKeys({ ...BASE, AIRWALLEX_API_KEY_READ: "r" })).not.toThrow();
    expect(() => assertRoleKeys({ ...BASE, AIRWALLEX_API_KEY_ISSUING: "i" }, { ...ROLE_CALLS, issuing: [...ROLE_CALLS.issuing, "POST /simulation/issuing/create"] }))
      .toThrow(/AIRWALLEX_API_KEY_ISSUING.*POST \/simulation\/issuing\/create/);
    // Unset role keys are not checked: the general key is not scoped by this client.
    expect(() => assertRoleKeys(BASE, { ...ROLE_CALLS, issuing: ["POST /transfers/create"] })).not.toThrow();
    // fromEnv with a role key makes the same check, so any process that would use one refuses at its start.
    expect(fromEnv({ ...BASE, AIRWALLEX_API_KEY_PAYOUT: "p" }, "payout")).toMatchObject({ role: "payout" });
  });

  it("ROLE_CALLS covers every call the role's own code makes: the payout rail and the card rail, run on the stand-in", async () => {
    const seen = async (role: AirwallexRole, run: (api: Airwallex) => Promise<unknown>[]) => {
      const s = standIn();
      const refused: string[] = [];
      await Promise.all(run(client(role, s)).map((p) => p.catch((e: unknown) => { if (e instanceof AirwallexScopeRefused) refused.push(e.message); })));
      return { refused, calls: s.calls.filter((c) => c.path !== "/authentication/login").map((c) => `${c.method} ${c.path.replace(/\/(c1|t1|x1)(?=\/|$)/g, "/{id}")}`) };
    };
    const payout = await seen("payout", (api) => {
      const r = new AirwallexRest(api);
      const any = r as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      return [r.balances(), r.balancesAll(), r.getTransfer("t1"), r.findTransferByRequestId("x"), r.findTransferByRequestIdStrict("x"), r.findConversionByRequestId("x"),
        any.createTransfer!({ requestId: "x", beneficiaryId: "b", amountCents: 1, currency: "EUR", reference: "r", method: "SWIFT", approvalSha256: "a".repeat(64) }),
        any.createQuote!({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 100 }), any.currentRate!({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 100 }),
        any.transitionTransfer!("t1", "SENT"), any.findBeneficiaryByIban!("DE89370400440532013000")];
    });
    expect(payout.refused).toEqual([]);
    for (const c of payout.calls) expect(ROLE_CALLS.payout, c).toContain(c);
    const issuing = await seen("issuing", (api) => {
      const r = new IssuingRest(api);
      return [r.findCardholderByEmail("a@b.example"), r.createCardholder({ email: "a@b.example", firstName: "A", lastName: "B" }), r.findCard("h", "n"),
        r.createCard({ cardholderId: "h", nickname: "n", createdBy: "x", limits: { currency: "EUR", perTxCents: 1, monthlyCents: 1 } }), r.getCard("c1"),
        r.setCardLimits("c1", { currency: "EUR", perTxCents: 1, monthlyCents: 1 }), r.setCardStatus("c1", "INACTIVE"), r.setCardControls("c1", { mccs: [], currencies: [] }), r.listCardTransactions("c1")];
    });
    expect(issuing.refused).toEqual([]);
    for (const c of issuing.calls) expect(ROLE_CALLS.issuing, c).toContain(c);
    expect(issuing.calls.length).toBeGreaterThan(5);
  });

  it("the card rail uses the issuing key, and its sandbox charge simulation the payout key (Simulations is a payout scope)", async () => {
    const s = standIn();
    const env = { ...BASE, AIRWALLEX_API_KEY_ISSUING: "the-issuing-key", AIRWALLEX_API_KEY_PAYOUT: "the-payout-key" };
    const rails = issuingFromEnv(undefined, env, s.fetchImpl)!;
    await rails.rail.getCard("c1").catch(() => null);
    await rails.sim.simulateCardCharge({ cardId: "c1", amountCents: 1, currency: "EUR", merchant: "m", mcc: "5734" }).catch(() => null);
    const logins = s.calls.filter((c) => c.path === "/authentication/login").map((c) => c.key);
    expect(logins).toEqual(["the-issuing-key", "the-payout-key"]);
    expect(s.calls.filter((c) => c.path !== "/authentication/login").map((c) => `${c.method} ${c.path}`)).toEqual(["GET /issuing/cards/c1", "POST /simulation/issuing/create"]);
  });
});
