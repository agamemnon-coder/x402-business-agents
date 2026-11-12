// How the ERP connectors get tokens (src/erp/auth.ts): Exact's 10-minute token is refreshed only in its last 30
// seconds and the rotated refresh token is saved first; Business Central's client-credentials token is cached; a refused
// token request never echoes what was sent.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entraTokens, exactTokens, fileTokenStore, memoryTokenStore } from "../src/erp/auth.js";
import { ErpError, RecordingTransport, redactRequest } from "../src/erp/connector.js";

const tokenAnswer = (access: string, refresh?: string) => ({ status: 200, headers: {}, body: JSON.stringify({ access_token: access, token_type: "bearer", expires_in: "600", ...(refresh ? { refresh_token: refresh } : {}) }) });

describe("Exact Online tokens", () => {
  it("refreshes with the stored refresh token, saves the rotated one, and reuses the access token until its last 30 seconds", async () => {
    let t = 1_000_000;
    const store = memoryTokenStore();
    const tr = new RecordingTransport((_r, n) => tokenAnswer(`access-${n}`, `refresh-${n}`));
    const tokens = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "cid", clientSecret: "secret", store, seedRefreshToken: "seed", transport: tr, now: () => t });
    expect(await tokens.token()).toBe("access-1");
    expect(tr.sent[0]!.url).toBe("https://start.exactonline.nl/api/oauth2/token");
    expect(tr.sent[0]!.body).toContain("grant_type=refresh_token");
    expect(tr.sent[0]!.body).toContain("refresh_token=seed");
    expect(store.current()!.refresh_token).toBe("refresh-1");
    t += 560_000; // 9 min 20 s: still 40 s left, no refresh (Exact would refuse it)
    expect(await tokens.token()).toBe("access-1");
    expect(tr.sent).toHaveLength(1);
    t += 15_000; // 25 s left: refresh, with the rotated token
    expect(await tokens.token()).toBe("access-2");
    expect(tr.sent[1]!.body).toContain("refresh_token=refresh-1");
    expect(store.current()!.refresh_token).toBe("refresh-2");
  });

  it("says plainly when there is no refresh token, and a refused refresh is an auth error without the secret", async () => {
    const none = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "s", store: memoryTokenStore(), transport: new RecordingTransport(() => tokenAnswer("x")) });
    await expect(none.token()).rejects.toThrow(/ERP_EXACT_REFRESH_TOKEN/);
    const refused = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "top-secret", store: memoryTokenStore(), seedRefreshToken: "r",
      transport: new RecordingTransport(() => ({ status: 400, headers: {}, body: JSON.stringify({ error: "invalid_grant", echo: "top-secret" }) })) });
    const e = await refused.token().catch((x: unknown) => x as ErpError);
    expect(e).toBeInstanceOf(ErpError);
    expect((e as ErpError).kind).toBe("auth");
    expect((e as ErpError).message).toContain("invalid_grant");
    expect((e as ErpError).message).not.toContain("top-secret");
  });

  it("keeps the token file readable by its owner only", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "erp-tok-"));
    const path = join(dir, "erp", "exact.token.json");
    fileTokenStore(path).save({ refresh_token: "r1" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ refresh_token: "r1" });
  });

  it("prints a token request with its secrets redacted", () => {
    const r = redactRequest({ method: "POST", url: "https://start.exactonline.nl/api/oauth2/token", headers: {}, body: "grant_type=refresh_token&refresh_token=abc&client_id=cid&client_secret=xyz" });
    expect(r.body).toBe("grant_type=refresh_token&refresh_token=[redacted]&client_id=cid&client_secret=[redacted]");
  });
});

describe("Business Central tokens (Microsoft Entra client credentials)", () => {
  it("asks for the Business Central scope at the tenant's token URL and caches the token", async () => {
    let t = 0;
    const tr = new RecordingTransport(() => ({ status: 200, headers: {}, body: JSON.stringify({ access_token: "bc-token", expires_in: 3599 }) }));
    const tokens = entraTokens({ tenantId: "contoso.onmicrosoft.com", clientId: "app", clientSecret: "s", transport: tr, now: () => t });
    expect(await tokens.token()).toBe("bc-token");
    expect(tr.sent[0]!.url).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
    expect(tr.sent[0]!.body).toContain("grant_type=client_credentials");
    expect(tr.sent[0]!.body).toContain(`scope=${encodeURIComponent("https://api.businesscentral.dynamics.com/.default")}`);
    t += 3_000_000;
    await tokens.token();
    expect(tr.sent).toHaveLength(1);
    t += 600_000; // within the last minute: a new one
    await tokens.token();
    expect(tr.sent).toHaveLength(2);
  });
});
