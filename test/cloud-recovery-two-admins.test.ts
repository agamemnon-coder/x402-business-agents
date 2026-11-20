// An owner recovery takes two platform admins (review finding 2, 20 Nov): one named admin key asks for it, a different
// named admin key approves it, and only then is the recovery key issued. The legacy single token takes no part, the same
// key cannot do both, and the check is one of a fixed list, not free text. Both admin ids are in the company's
// security event, and the owners are told at each step.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newAdminKey } from "../cloud/src/adminKeys.js";
import { RECOVERY_REQUESTS_SCHEMA } from "../cloud/src/recovery.js";
import { ADMIN_TOKEN, testCloud, twoRecoveryAdmins, type TestCloud } from "./support/cloud.js";

function hooks(c: TestCloud): string[] {
  const types: string[] = [];
  c.env.outbound = async (_url, init) => { types.push((JSON.parse(String(init.body)) as { type: string }).type); return new Response("ok", { status: 200 }); };
  c.env.retryDelayMs = 0;
  return types;
}

describe("owner recovery by two platform admins", () => {
  it("the first admin asks (no key yet), the same admin cannot approve, a second admin approves and the key is issued; both are recorded", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      await c.req("POST", "/v1/webhook", { key: t.session, body: { url: "https://hooks.example.com/purser" } });
      const sent = hooks(c);
      const admins = await twoRecoveryAdmins(c);
      // Free text is gone: the check is one of a fixed list.
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { owner_id: t.owner, checked_by: "trust me" } })).status).toBe(400);
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { owner_id: t.owner, check: "a chat" } })).status).toBe(400);
      const asked = await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { owner_id: t.owner, check: "video_call" } });
      expect(asked.status, JSON.stringify(asked.json)).toBe(202);
      expect(asked.json).toMatchObject({ status: "awaiting_second_admin", requested_by: "ops-first", owner_id: t.owner });
      expect(asked.json).not.toHaveProperty("recovery_key");
      const id = asked.json.request_id as string;
      // The same admin key cannot approve its own request.
      const self = await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${id}/approve`, { key: admins.first });
      expect(self.status).toBe(403);
      expect(self.json.error).toMatch(/a second, different admin/);
      // The legacy single token takes no part, neither to ask nor to approve.
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${id}/approve`, { key: ADMIN_TOKEN })).status).toBe(403);
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: ADMIN_TOKEN, body: { owner_id: t.owner, check: "video_call" } })).status).toBe(403);
      // An unknown request: 404.
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/rr_nothere000/approve`, { key: admins.second })).status).toBe(404);
      const ok = await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${id}/approve`, { key: admins.second });
      expect(ok.status, JSON.stringify(ok.json)).toBe(201);
      expect(ok.json.recovery_key).toMatch(/^pck_/);
      expect(ok.json).toMatchObject({ requested_by: "ops-first", approved_by: "ops-second", owner_id: t.owner });
      // Approved once: a second approval of the same request issues nothing more.
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${id}/approve`, { key: admins.second })).status).toBe(409);
      // Recorded with both admins, and the owners told at both steps.
      const ev = (await c.req("GET", "/v1/security/events", { key: t.session })).json.items as { kind: string; actor: string; detail: Record<string, unknown> }[];
      expect(ev.find((x) => x.kind === "recovery.requested")).toMatchObject({ actor: "platform:ops-first", detail: { owner: t.owner, check: "video_call" } });
      expect(ev.find((x) => x.kind === "recovery.issued")).toMatchObject({ actor: "platform:ops-second", detail: { owner: t.owner, requested_by: "ops-first", approved_by: "ops-second", check: "video_call" } });
      expect(sent).toEqual(expect.arrayContaining(["security.recovery_requested", "security.recovery_issued"]));
    } finally { c.close(); }
  });

  it("an admin key without the recovery scope can do neither step", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const admins = await twoRecoveryAdmins(c);
      const reader = await newAdminKey({ id: "ops-reader", scopes: ["read"], days: 30, now: c.clock.now });
      c.env.adminKeys = `${c.env.adminKeys},${reader.entry}`;
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: reader.key, body: { owner_id: t.owner, check: "in_person" } })).status).toBe(403);
      const asked = await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { owner_id: t.owner, check: "in_person" } });
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${asked.json.request_id as string}/approve`, { key: reader.key })).status).toBe(403);
    } finally { c.close(); }
  });

  it("a request expires after a day unapproved; one open request per owner at a time", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const admins = await twoRecoveryAdmins(c);
      const asked = await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.first, body: { owner_id: t.owner, check: "phone_callback" } });
      expect(asked.status).toBe(202);
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.second, body: { owner_id: t.owner, check: "phone_callback" } })).status).toBe(409);
      c.clock.now = new Date(c.clock.now.getTime() + 25 * 3_600_000);
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery/${asked.json.request_id as string}/approve`, { key: admins.second })).status).toBe(409);
      // A new request may be made once the old one expired.
      expect((await c.req("POST", `/v1/admin/tenants/${t.id}/recovery`, { key: admins.second, body: { owner_id: t.owner, check: "phone_callback" } })).status).toBe(202);
    } finally { c.close(); }
  });

  it("the table the Worker makes on first use is the D1 migration's", () => {
    const statements = readFileSync("cloud/migrations/0008_recovery_requests.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(statements).toEqual([RECOVERY_REQUESTS_SCHEMA]);
  });
});
