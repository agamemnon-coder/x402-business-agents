// Xero's tokens and settings (src/workplace/xero.ts): the access token is reused until a minute before it expires, then
// refreshed with the stored (or the seed) refresh token, by Basic auth with a secret or the client id in the form
// without one; a rotated refresh token is saved before the new access token is used, and kept when Xero sends none; a
// token Xero refused is not reused; each refusal of the token call says why. The settings name what is missing.
import { describe, expect, it } from "vitest";
import { RecordingTransport, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import type { StoredTokens, TokenStore } from "../src/erp/auth.js";
import { xeroConfigFromEnv, xeroError, xeroTenants, xeroTokens } from "../src/workplace/xero.js";

function memoryStore(start: StoredTokens | null): TokenStore & { saved: StoredTokens[]; locks: number } {
  let cur = start;
  const s = { saved: [] as StoredTokens[], locks: 0, load: () => cur, save: (t: StoredTokens) => { cur = t; s.saved.push(t); }, withLock: async <T>(fn: () => Promise<T>) => { s.locks++; return fn(); } };
  return s;
}
const ok = (o: Record<string, unknown>): HttpResponse => ({ status: 200, headers: {}, body: JSON.stringify(o) });
const NOW = 1_800_000_000_000;

describe("Xero's tokens", () => {
  it("reuses a fresh access token, under the store's lock, without a call", async () => {
    const store = memoryStore({ access_token: "a1", expires_at: NOW + 120_000, refresh_token: "r1" });
    const tr = new RecordingTransport(() => { throw new Error("no call expected"); });
    expect(await xeroTokens({ clientId: "cid", store, transport: tr, now: () => NOW }).token()).toBe("a1");
    expect(store.locks).toBe(1);
  });

  it("refreshes a minute before expiry with the client secret; saves the rotated refresh token first", async () => {
    const store = memoryStore({ access_token: "a1", expires_at: NOW + 30_000, refresh_token: "r1" });
    const tr = new RecordingTransport(() => ok({ access_token: "a2", expires_in: 1800, refresh_token: "r2" }));
    expect(await xeroTokens({ clientId: "cid", clientSecret: "sec", store, transport: tr, now: () => NOW }).token()).toBe("a2");
    const sent = tr.sent[0]! as HttpRequest;
    expect(sent.url).toBe("https://identity.xero.com/connect/token");
    expect(sent.headers.authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    expect(new URLSearchParams(sent.body as string).get("client_id")).toBeNull();
    expect(store.saved).toEqual([{ access_token: "a2", expires_at: NOW + 1_800_000, refresh_token: "r2" }]);
  });

  it("without a secret sends the client id in the form; starts from the seed; keeps the refresh token Xero did not rotate", async () => {
    const store = memoryStore(null);
    const tr = new RecordingTransport(() => ok({ access_token: "a3" }));
    expect(await xeroTokens({ clientId: "cid", store, seedRefreshToken: "seed", transport: tr, now: () => NOW, tokenUrl: "https://id.test/token" }).token()).toBe("a3");
    const form = new URLSearchParams(tr.sent[0]!.body as string);
    expect([tr.sent[0]!.url, form.get("client_id"), form.get("refresh_token"), form.get("grant_type")]).toEqual(["https://id.test/token", "cid", "seed", "refresh_token"]);
    expect(store.saved).toEqual([{ access_token: "a3", expires_at: NOW + 1_800_000, refresh_token: "seed" }]);
  });

  it("a token Xero refused is refreshed, not reused", async () => {
    const store = memoryStore({ access_token: "a1", expires_at: NOW + 600_000, refresh_token: "r1" });
    const tr = new RecordingTransport(() => ok({ access_token: "a4", refresh_token: "r4" }));
    const t = xeroTokens({ clientId: "cid", store, transport: tr, now: () => NOW });
    t.invalidate();
    expect(await t.token()).toBe("a4");
    expect(tr.sent).toHaveLength(1);
    expect(await t.token()).toBe("a4");
    expect(tr.sent).toHaveLength(1);
  });

  it("says why there is no token: none stored, a refused refresh, an answer that is not JSON or has no access token", async () => {
    const none = xeroTokens({ clientId: "cid", store: memoryStore(null), transport: new RecordingTransport(() => ok({})) });
    await expect(none.token()).rejects.toMatchObject({ kind: "config", message: "no Xero refresh token: set ERP_XERO_REFRESH_TOKEN once, from the authorization step" });
    const make = (res: HttpResponse) => xeroTokens({ clientId: "cid", store: memoryStore({ refresh_token: "r" }), transport: new RecordingTransport(() => res), now: () => NOW });
    await expect(make({ status: 400, headers: {}, body: JSON.stringify({ error: "invalid_grant" }) }).token()).rejects.toMatchObject({ kind: "auth", status: 400 });
    await expect(make({ status: 503, headers: {}, body: "down" }).token()).rejects.toMatchObject({ kind: expect.not.stringMatching(/^auth$/) });
    await expect(make({ status: 200, headers: {}, body: "<html>" }).token()).rejects.toMatchObject({ kind: "auth", message: "Xero token: the answer is not JSON" });
    await expect(make(ok({ token_type: "Bearer" })).token()).rejects.toMatchObject({ kind: "auth", message: "Xero token: no access token in the answer" });
  });
});

describe("Xero's settings, errors and organisations", () => {
  it("names a missing tenant, a journal status it does not know and a currency that is not a code", () => {
    expect(() => xeroConfigFromEnv({})).toThrow("ERP_XERO_TENANT_ID is not set");
    expect(() => xeroConfigFromEnv({ ERP_XERO_TENANT_ID: "t", ERP_XERO_JOURNAL_STATUS: "VOIDED" })).toThrow("ERP_XERO_JOURNAL_STATUS must be DRAFT or POSTED");
    expect(() => xeroConfigFromEnv({ ERP_XERO_TENANT_ID: "t", ERP_XERO_BASE_CURRENCY: "euro" })).toThrow("ERP_XERO_BASE_CURRENCY must be a three-letter currency code");
    expect(xeroConfigFromEnv({ ERP_XERO_TENANT_ID: " t ", ERP_XERO_JOURNAL_STATUS: "POSTED" })).toMatchObject({ tenantId: "t", baseCurrency: "EUR", journalStatus: "POSTED", glMap: {} });
  });

  it("reads Xero's words from a validation error, a detail, a message or a title", () => {
    expect(xeroError(JSON.stringify({ Elements: [{ ValidationErrors: [{ Message: "Account code 9999 is not valid" }, { Message: "" }] }, {}] }))).toBe("Account code 9999 is not valid");
    expect(xeroError(JSON.stringify({ Detail: "Too\u0000many" }))).toBe("Too many");
    expect(xeroError(JSON.stringify({ Title: "Unauthorized" }))).toBe("Unauthorized");
    expect(xeroError("nope")).toBe("");
  });

  it("lists the organisations a token reaches, and refuses an answer of another shape", async () => {
    const tokens = { token: async () => "a", invalidate: () => undefined };
    const tenant = "11111111-2222-3333-4444-555555555555";
    const good = new RecordingTransport(() => ({ status: 200, headers: {}, body: JSON.stringify([{ id: "c1", tenantId: tenant, tenantType: "ORGANISATION", tenantName: null }]) }));
    expect(await xeroTenants(good, tokens)).toEqual([{ tenantId: tenant, type: "ORGANISATION", name: "" }]);
    const bad = new RecordingTransport(() => ({ status: 200, headers: {}, body: JSON.stringify([{ id: "c1", tenantId: "not-a-guid", tenantType: "ORGANISATION" }]) }));
    await expect(xeroTenants(bad, tokens)).rejects.toMatchObject({ kind: "unexpected", message: "GET connections: Xero's answer is not the documented shape" });
  });
});
