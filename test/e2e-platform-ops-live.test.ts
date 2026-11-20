// The end-to-end run's live platform calls (src/e2e/platformOps.ts LivePlatformOps) against a stand-in Airwallex client:
// never on behalf of a connected account; a company that has its account is not opened again; a new one is created,
// given a fictional sole trader's details, submitted, waited for and activated, in that order; the EUR rate comes from
// the client level of the current rate, as amounts; test money goes only to an account id.
import { describe, expect, it } from "vitest";
import type { Airwallex } from "../src/airwallex/client.js";
import { LivePlatformOps, rateFromAmounts, soleTraderDetails } from "../src/e2e/platformOps.js";
import type { WorldCompany } from "../src/e2e/world.js";

function api(o: { onBehalfOf?: string; status?: Record<string, string | undefined> } = {}) {
  const calls: { method: string; path: string; body: unknown; query: unknown }[] = [];
  const a = {
    onBehalfOf: o.onBehalfOf,
    call: async (method: string, path: string, body?: unknown, query?: unknown) => {
      calls.push({ method, path, body, query });
      if (path === "/accounts/create") return { id: "acct_new_bergtex", status: "CREATED" };
      if (path.endsWith("/submit")) return { status: o.status?.submit };
      if (path.includes("/update_status")) return { status: o.status?.active };
      if (path === "/fx/rates/current") return { rate: 1.08, created_at: "2026-11-10T09:00:00+0000", rate_details: [{ level: "AWX", rate: 1.07, sell_amount: 92.5 }, { level: "CLIENT", rate: 1.0811, sell_amount: 92.5 }] };
      if (path === "/connected_account_transfers/create") return { id: "cat_1", status: "SETTLED" };
      return {};
    },
  };
  return { api: a as unknown as Airwallex, calls };
}
const company = (o: Partial<WorldCompany> = {}): WorldCompany => ({ key: "BERG", name: "Bergtex (fictional)", tenant: "t_berg", accountId: null, ...o } as WorldCompany);

describe("the run's live platform calls", () => {
  it("are never made on behalf of a connected account", () => {
    expect(() => new LivePlatformOps(api({ onBehalfOf: "acct_x" }).api, "acct_fee")).toThrow("the platform's own calls are never made on behalf of a connected account");
  });

  it("a company with its account is not opened again", async () => {
    const { api: a, calls } = api();
    expect(await new LivePlatformOps(a, "acct_fee").ensureAccount(company({ accountId: "acct_have" }))).toMatchObject({ accountId: "acct_have", opened: false });
    expect(calls).toEqual([]);
  });

  it("opens a new one: create, the sole trader's details, submit, wait, activate", async () => {
    const { api: a, calls } = api({ status: { submit: "SUBMITTED", active: "ACTIVE" } });
    const waits: number[] = [];
    const out = await new LivePlatformOps(a, "acct_fee", { sleep: async (ms) => { waits.push(ms); }, activationWaitMs: 5 }).ensureAccount(company());
    expect(out).toEqual({ accountId: "acct_new_bergtex", status: "ACTIVE", opened: true, ids: { created: "CREATED", submitted: "SUBMITTED" } });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /accounts/create", "POST /accounts/acct_new_bergtex/update", "POST /accounts/acct_new_bergtex/submit", "POST /simulation/accounts/acct_new_bergtex/update_status"]);
    expect(calls[0]!.body).toMatchObject({ request_id: "e2e-open-berg", primary_contact: { email: "berg@test.purser.invalid" } });
    expect(calls[1]!.body).toEqual(soleTraderDetails(company()));
    expect(waits).toEqual([5]);
    const quiet = api();
    expect(await new LivePlatformOps(quiet.api, "acct_fee", { sleep: async () => undefined }).ensureAccount(company())).toMatchObject({ status: "?", ids: { submitted: "?" } });
  });

  it("the EUR rate from the client level, as amounts; test money only to an account id", async () => {
    const { api: a, calls } = api();
    const ops = new LivePlatformOps(a, "acct_fee");
    expect(await ops.eurRate("USD")).toEqual({ rate: rateFromAmounts(10_000, 9_250), to: "USD", at: "2026-11-10T09:00:00.000Z", source: "Airwallex sandbox GET /fx/rates/current (client rate 1.0811; USD 100.00 for EUR 92.50)" });
    expect(await ops.fund("acct_new_bergtex", 25_000, "e2e-fund-1")).toEqual({ id: "cat_1", status: "SETTLED" });
    expect(calls.at(-1)!.body).toMatchObject({ request_id: "e2e-fund-1", destination: "acct_new_bergtex", amount: "250.00", currency: "EUR" });
    await expect(ops.fund("not-an-account", 1, "r")).rejects.toThrow("not an Airwallex account id");
    expect(() => rateFromAmounts(0, 1)).toThrow("a rate needs two positive amounts");
  });
});
