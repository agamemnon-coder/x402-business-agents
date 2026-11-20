// Purser as an Airwallex platform, the platform's own calls (src/airwallex/platform.ts AirwallexPlatformRest), on what
// test/airwallex-platform.test.ts does not reach: the platform rail never calls on behalf of a connected account; what it
// sends is checked first (a country code, a request id, an account id); an answer without an account or flow id is not
// taken; and the look-up of an account opened under a request id adopts exactly one account that carries that request
// id, refuses a list Airwallex did not filter or that holds two, and says when there is none.
import { describe, expect, it } from "vitest";
import type { Airwallex } from "../src/airwallex/client.js";
import { AirwallexPlatformRest, statusFromAccount } from "../src/airwallex/platform.js";

function api(answers: Record<string, unknown>, onBehalfOf?: string) {
  const calls: string[] = [];
  const a = {
    onBehalfOf,
    call: async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      const key = Object.keys(answers).find((k) => `${method} ${path}`.startsWith(k));
      if (!key) throw new Error(`unexpected ${method} ${path}`);
      return answers[key];
    },
  };
  return { api: a as unknown as Airwallex, calls };
}
const opening = { businessName: "Northwind Outdoor B.V.", countryCode: "NL", email: "cfo@northwind.example", requestId: "req_open_0001" };

describe("the platform's own calls", () => {
  it("never on behalf of a connected account", () => {
    expect(() => new AirwallexPlatformRest(api({}, "acct_someone").api)).toThrow("the platform rail calls as the platform itself, never on behalf of a connected account");
  });

  it("checks what it sends before any call", async () => {
    const a = api({});
    const rail = new AirwallexPlatformRest(a.api);
    await expect(rail.createConnectedAccount({ ...opening, countryCode: "nl" })).rejects.toThrow("the country is a two-letter code (NL, DE, …)");
    await expect(rail.createConnectedAccount({ ...opening, requestId: "short" })).rejects.toThrow("the opening's request id is not an id");
    await expect(rail.onboardingLink({ accountId: "acct", template: "t", returnUrl: "https://app.example", identity: "u" })).rejects.toThrow("not an Airwallex account id");
    await expect(rail.getAccount("../admin")).rejects.toThrow("not an Airwallex account id");
    await expect(rail.findConnectedAccount("bad id")).rejects.toThrow("not a request id");
    expect(a.calls).toEqual([]);
  });

  it("does not take an answer without an account id or a hosted flow id", async () => {
    await expect(new AirwallexPlatformRest(api({ "POST /accounts/create": { id: "", status: "CREATED" } }).api).createConnectedAccount(opening)).rejects.toThrow("Airwallex answered without an account id");
    const noFlow = api({ "POST /hosted_flows/create": { id: "../x" } });
    await expect(new AirwallexPlatformRest(noFlow.api).onboardingLink({ accountId: "acct_newco1", template: "t", returnUrl: "https://app.example", identity: "u" })).rejects.toThrow("Airwallex answered without a hosted flow id");
    expect(noFlow.calls).toEqual(["POST /hosted_flows/create"]);
    const noUrl = api({ "POST /hosted_flows/create": { id: "flow_1234" }, "POST /hosted_flows/flow_1234/authorize": {} });
    await expect(new AirwallexPlatformRest(noUrl.api).onboardingLink({ accountId: "acct_newco1", template: "t", returnUrl: "https://app.example", identity: "u" })).rejects.toThrow("the onboarding link is not on airwallex.com; it is not shown");
  });

  it("reads an account's status", async () => {
    const a = api({ "GET /accounts/acct_newco1": { id: "acct_newco1", status: "ACTION_REQUIRED" } });
    expect(await new AirwallexPlatformRest(a.api).getAccount("acct_newco1")).toEqual({ accountId: "acct_newco1", status: "ACTION_REQUIRED" });
    expect(statusFromAccount("ACTION_REQUIRED")).toBe("action_required");
    expect(statusFromAccount("SUSPENDED")).toBe("refused");
    expect(statusFromAccount("SOMETHING_NEW")).toBeNull();
  });
});

describe("the account opened under a request id", () => {
  const find = (items: unknown) => new AirwallexPlatformRest(api({ "GET /accounts?request_id=req_open_0001": { items } }).api).findConnectedAccount("req_open_0001");

  it("adopts the one account that carries the request id", async () => {
    expect(await find([{ id: "acct_other", request_id: "req_other_0002", status: "ACTIVE" }, { id: "acct_newco1", request_id: "req_open_0001", status: "CREATED" }]))
      .toEqual({ accountId: "acct_newco1", status: "CREATED" });
    expect(await find([{ id: "acct_newco1", request_id: "req_open_0001" }])).toEqual({ accountId: "acct_newco1", status: "" });
  });

  it("says there is none when no item carries it, and ignores items without a proper id", async () => {
    expect(await find([])).toBeNull();
    expect(await find([{ id: "not-an-account", request_id: "req_open_0001" }, { request_id: "req_open_0001" }])).toBeNull();
  });

  it("refuses a list it cannot read, and two accounts under one request id", async () => {
    await expect(find(undefined)).rejects.toThrow("Airwallex's account list has no items");
    await expect(find([{ id: "acct_one1", request_id: "req_open_0001" }, { id: "acct_two2", request_id: "req_open_0001" }])).rejects.toThrow("more than one account under one request id");
  });
});
