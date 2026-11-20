// Roles in Purser Cloud (review finding 5, 20 Nov): the CFO approves (read + approve), the owner manages (read + admin)
// and does not approve while the company has a CFO who can sign in; a company without one keeps working, its owner
// approving with a note on screen. No API key ever approves. docs/security/roles.md is the matrix; this file holds
// every cell of it to the code, then walks the roles through the real routes.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { hasScope, oidcSession, SCOPES, scopesOf, type Role } from "../cloud/src/auth.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { addPerson, ORIGIN, RP, testCloud } from "./support/cloud.js";

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

const COLUMNS: { head: string; role: Role; hasCfo: boolean }[] = [
  { head: "owner", role: "owner", hasCfo: true }, { head: "owner (no CFO)", role: "owner", hasCfo: false },
  { head: "cfo", role: "cfo", hasCfo: true }, { head: "accountant", role: "accountant", hasCfo: true }, { head: "viewer", role: "viewer", hasCfo: true },
];

/** The matrix's rows, as the document has them. */
function matrix(): { action: string; route: string; cells: Record<string, string> }[] {
  const doc = readFileSync("docs/security/roles.md", "utf8");
  const lines = doc.split("\n").filter((l) => l.startsWith("| "));
  const head = lines[0]!.split("|").slice(1, -1).map((x) => x.trim());
  expect(head).toEqual(["Action", "Route", ...COLUMNS.map((c) => c.head), "API key"]);
  return lines.slice(2).map((l) => {
    const cells = l.split("|").slice(1, -1).map((x) => x.trim());
    return { action: cells[0]!, route: cells[1]!.replace(/`/g, ""), cells: Object.fromEntries(head.slice(2).map((h, i) => [h, cells[i + 2]!])) };
  });
}

describe("the role matrix (docs/security/roles.md) is the code's", () => {
  it("every cell: a role's session by scopesOf and the route's need; an API key by the scope it needs, never approve", () => {
    const rows = matrix();
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      const [method, path] = r.route.split(" ");
      const route = ROUTES.find((x) => x.method === method && x.path === path);
      expect(route, r.route).toBeDefined();
      const need = route!.need as "read" | "sync" | "admin" | "propose" | "approve";
      for (const col of COLUMNS) expect(`${r.route} ${col.head}: ${r.cells[col.head]}`).toBe(`${r.route} ${col.head}: ${hasScope(scopesOf(col.role, { companyHasCfo: col.hasCfo }), need) ? "yes" : "no"}`);
      expect(`${r.route} key: ${r.cells["API key"]}`).toBe(`${r.route} key: ${need === "approve" ? "never" : need}`);
    }
    // Every route that approves is in the matrix, and no key may hold the scope.
    const approving = ROUTES.filter((x) => x.need === "approve").map((x) => `${x.method} ${x.path}`).sort();
    expect(approving).toEqual(rows.filter((r) => r.cells["API key"] === "never").map((r) => r.route).sort());
    expect(approving).toEqual(expect.arrayContaining(["POST /v1/engine/proposals/{id}/approve", "POST /v1/engine/passkey/start", "POST /v1/engine/passkey/finish", "POST /v1/engine/invoices/{id}/reject"]));
    expect(SCOPES).not.toContain("approve");
  });

  it("separation of duties: owner does not imply approve, except in a company with no CFO", () => {
    expect([...scopesOf("owner", { companyHasCfo: true })].sort()).toEqual(["admin", "read"]);
    expect([...scopesOf("owner", { companyHasCfo: false })].sort()).toEqual(["admin", "approve", "read"]);
    expect([...scopesOf("cfo", { companyHasCfo: true })].sort()).toEqual(["approve", "read"]);
    expect([...scopesOf("accountant", { companyHasCfo: false })]).toEqual(["read"]);
    expect([...scopesOf("viewer", { companyHasCfo: false })]).toEqual(["read"]);
  });
});

describe("the roles through the routes", () => {
  it("an owner alone approves (and is told why); with a CFO, the CFO approves and manages nothing, the owner manages and approves nothing; no key approves", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      expect((await c.req("POST", "/v1/company", { key: t.session, body: { language: "en" } })).status).toBe(200);
      // The owner of a company with no CFO: approves, labelled.
      let me = await c.req("GET", "/v1/me", { key: t.session });
      expect(me.json).toMatchObject({ role: "owner", approves: "owner_without_cfo" });
      expect(me.json.scopes).toEqual(expect.arrayContaining(["read", "admin", "approve"]));

      // A CFO is added and signs in: from the owners' next request, the CFO approves and they do not.
      const cfo = await addPerson(c, "acme", t.session, "cfo", "Carla CFO");
      me = await c.req("GET", "/v1/me", { key: t.session });
      expect(me.json.approves).toBeNull();
      expect((me.json.scopes as string[]).sort()).toEqual(["admin", "read"]);
      const cme = await c.req("GET", "/v1/me", { key: cfo.session });
      expect(cme.json).toMatchObject({ role: "cfo", approves: "cfo" });
      expect((cme.json.scopes as string[]).sort()).toEqual(["approve", "read"]);

      // The CFO manages nothing.
      expect((await c.req("POST", "/v1/users", { key: cfo.session, body: { display_name: "X", role: "viewer" } })).status).toBe(403);
      expect((await c.req("GET", "/v1/keys", { key: cfo.session })).status).toBe(403);
      expect((await c.req("POST", "/v1/webhook", { key: cfo.session, body: { url: "https://hooks.example.com/x" } })).status).toBe(403);
      expect((await c.req("POST", "/v1/export/staged", { key: cfo.session })).status).toBe(403);
      // The owner approves nothing, and is told why.
      const ownerStart = await c.req("POST", "/v1/engine/passkey/start", { key: t.session });
      expect(ownerStart.status).toBe(403);
      expect(ownerStart.json.error).toMatch(/the CFO approves payments, not an owner/);
      // No key approves, whatever its scopes; no key can be made with approve.
      const key = await c.req("POST", "/v1/engine/passkey/start", { key: t.key });
      expect(key.status).toBe(403);
      expect(key.json.error).toMatch(/a key never approves/);
      expect((await c.req("POST", "/v1/keys", { key: t.session, body: { name: "x", scopes: ["approve"] } })).status).toBe(400);

      // The whole flow, split: the owner uploads and files the payment, the CFO enrols and approves.
      const up = await c.req("POST", "/v1/engine/documents", { key: t.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
      expect(up.status, JSON.stringify(up.json)).toBe(200);
      const filed = await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: t.session });
      expect(filed.status, JSON.stringify(filed.json)).toBe(200);
      const p = filed.json.proposal as { id: string; terms_sha256: string; challenge: string };
      // The CFO files nothing.
      expect((await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: cfo.session })).status).toBe(403);
      const phone = new FakeAuthenticator();
      const s = await c.req("POST", "/v1/engine/passkey/start", { key: cfo.session });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      const done = await c.req("POST", "/v1/engine/passkey/finish", { key: cfo.session, body: { code: s.json.code, credential: phone.register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
      // The company's first approval key: no endorsement, no cooling-off.
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      expect(done.json).toMatchObject({ credential_id: phone.credentialId, how: "first", cooling_until: null });
      const sign = { terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) };
      // An owner sending the CFO's own signature is still refused: the scope, not the signature, decides who may send it.
      expect((await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: t.session, body: sign })).status).toBe(403);
      const ok = await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: cfo.session, body: sign });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.json.status).toBe("approved");
    } finally { c.close(); }
  });

  it("an accountant and a viewer read and approve nothing", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      for (const role of ["accountant", "viewer"] as const) {
        const p = await addPerson(c, "acme", t.session, role);
        expect((await c.req("GET", "/v1/invoices", { key: p.session })).status).toBe(200);
        expect((await c.req("POST", "/v1/engine/passkey/start", { key: p.session })).status).toBe(403);
        expect((await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: p.session, body: { terms_sha256: "0".repeat(64), credential: {} } })).status).toBe(403);
      }
      // Neither of them is a CFO: the owner still approves.
      expect((await c.req("GET", "/v1/me", { key: t.session })).json.approves).toBe("owner_without_cfo");
    } finally { c.close(); }
  });

  it("a sign-in with Google, Microsoft or Apple (cloud/src/oidc.ts) never carries approve or admin, whatever the role", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      const cfo = await addPerson(c, "acme", t.session, "cfo", "Carla CFO");
      const viaOidc = async (user: string) => (await oidcSession(c.env.sql, c.env.sessionSecret, t.id, user, c.clock.now)).token;
      for (const [who, passkeyScopes] of [[cfo.id, ["approve", "read"]], [t.owner, ["admin", "read"]]] as const) {
        const s = await viaOidc(who);
        const me = await c.req("GET", "/v1/me", { key: s });
        expect(me.json).toMatchObject({ scopes: ["read"], approves: null, signed_in_with: "oidc" });
        // The same person with the passkey holds their role's scopes: the read-only rule is the sign-in's, not the role's.
        expect(((await c.req("GET", "/v1/me", { key: who === cfo.id ? cfo.session : t.session })).json.scopes as string[]).sort()).toEqual([...passkeyScopes]);
        for (const path of ["/v1/engine/passkey/start", "/v1/engine/security-key/start"]) expect((await c.req("POST", path, { key: s })).status, path).toBe(403);
        expect((await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: s, body: { terms_sha256: "0".repeat(64), credential: {} } })).status).toBe(403);
        expect((await c.req("POST", "/v1/users", { key: s, body: { display_name: "X", role: "viewer" } })).status).toBe(403);
      }
    } finally { c.close(); }
  });
});
