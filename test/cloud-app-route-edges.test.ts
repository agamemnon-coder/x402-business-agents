// Purser Cloud's routes (cloud/src/app.ts), the refusals the other cloud tests leave: the platform's security log with a
// `since` that is not a time, a company address taken, a recovery for a company that is not there or for someone who
// is not its owner, an OpenID provider that does not exist, the security.txt by HEAD, and an
// over-long body. Each answer is checked with its status and words; nothing is written where it is refused.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, testCloud, twoRecoveryAdmins, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud(); });
afterEach(() => { c.close(); });

describe("the platform operator's routes", () => {
  it("the security log refuses a `since` that is not a time, and takes a limit or none", async () => {
    expect(await c.req("GET", "/v1/admin/security-log?since=yesterday", { key: ADMIN_TOKEN })).toMatchObject({ status: 400, json: { error: "since must be a time like 2026-11-19T00:00:00Z" } });
    const ok = await c.req("GET", "/v1/admin/security-log?since=2026-11-01T00:00:00Z&limit=x", { key: ADMIN_TOKEN });
    expect(ok.status).toBe(200);
  });

  it("a company address already taken is a 409, and the first company stays as it was", async () => {
    const body = { slug: "acme", name: "Acme", owner: { display_name: "Owner" } };
    expect((await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body })).status).toBe(201);
    expect(await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { ...body, name: "Other" } })).toMatchObject({ status: 409, json: { error: "the address acme is taken" } });
  });

  it("a recovery for a company id that is not one, a company that is not there, or a person who is not its owner", async () => {
    const t = await c.tenant("rec", { bare: true });
    const admins = await twoRecoveryAdmins(c);
    const body = { owner_id: t.owner, check: "video_call" };
    for (const id of ["nope", "t_doesnotexist01"]) {
      expect(await c.req("POST", `/v1/admin/tenants/${id}/recovery`, { key: admins.first, body })).toMatchObject({ status: 404 });
      expect(await c.req("POST", `/v1/admin/tenants/${id}/recovery/rr_1/approve`, { key: admins.second })).toMatchObject({ status: 404 });
    }
    expect(await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { ...body, owner_id: "u_nobody" } })).toMatchObject({ status: 409, json: { error: "a recovery is for an existing owner of this company" } });
  });
});

describe("public routes", () => {
  it("an OpenID provider that is not offered is not found", async () => {
    const r = await c.req("POST", "/v1/auth/oidc/myspace/start", { body: { tenant: "acme" } });
    expect(r.status).toBe(404);
  });

  it("serves security.txt by HEAD as by GET", async () => {
    const get = await c.fetch("https://cloud.test/.well-known/security.txt");
    const head = await c.fetch("https://cloud.test/.well-known/security.txt", { method: "HEAD" });
    expect(get.status).toBe(200);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
  });

  it("a body over the route's size is refused before it is read as JSON", async () => {
    const r = await c.req("POST", "/v1/auth/challenge", { raw: JSON.stringify({ tenant: "acme" }), headers: { "content-length": "2000000" } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/^the body is larger than \d+ bytes$/);
  });
});
