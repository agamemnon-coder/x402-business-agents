// The TypeScript client (sdk/typescript) against Purser Cloud in this process, with its engine (test money): the README's
// quickstart (list invoices, propose a payment, read the proposal's status), its operations against openapi/purser.yaml,
// and the boundary: a propose key files, it never approves, and the client has no way to.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { yamlOperations } from "../cloud/src/apiSpec.js";
import { OPERATIONS, Purser, PurserError } from "../sdk/typescript/src/index.js";
import { ORIGIN } from "./support/cloud.js";
import { integrationsWorld, type IntegrationsWorld } from "./support/integrationsWorld.js";

// The sample invoice is due 16 Nov 2026; the engine reads the real date for "overdue" (test/cloud-engine.test.ts).
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

let w: IntegrationsWorld;
beforeAll(async () => { w = await integrationsWorld(); }, 60_000);
afterAll(() => w.c.close());

const client = (apiKey: string) => new Purser({ baseUrl: ORIGIN, apiKey, fetch: w.c.fetch });

describe("the TypeScript client", () => {
  it("runs the README's quickstart: list invoices, propose a payment, read the proposal's status", async () => {
    const purser = client(w.proposeKey);
    expect((await purser.me()).scopes.sort()).toEqual(["propose", "read"]);
    const page = await purser.listInvoices({ limit: 10 });
    expect(page.items.map((i) => i.id)).toEqual(["AP-0001"]);
    const all: string[] = [];
    for await (const i of purser.invoices({ limit: 1 })) all.push(i.id);
    expect(all).toEqual(["AP-0001"]);
    expect((await purser.getInvoice("AP-0001")).id).toBe("AP-0001");

    const payable = (await purser.listPayableInvoices()).filter((i) => i.payable);
    expect(payable.map((i) => `${i.id} ${i.vendor} ${i.currency} ${i.total}`)).toEqual(["AP-0001 Bergtex Textil GmbH EUR 1850.00"]);
    const { proposal } = await purser.proposePayment("AP-0001");
    expect(proposal).toMatchObject({ id: "P-0001", status: "PENDING_APPROVAL", terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await purser.getProposal(proposal.id)).status).toBe("PENDING_APPROVAL");
  });

  it("says why Purser would not file, with the API's status and code", async () => {
    const twice = await client(w.proposeKey).proposePayment("AP-0001").catch((e: unknown) => e);
    expect(twice).toBeInstanceOf(PurserError);
    expect(twice).toMatchObject({ status: 409, code: "conflict" });
    await expect(client(w.proposeKey).getProposal("P-0999")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("a read key reads and cannot propose; a propose key cannot approve, manage keys or change the company", async () => {
    await expect(client(w.readKey).proposePayment("AP-0001")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    const approve = await w.c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: w.proposeKey, body: { terms_sha256: "0".repeat(64), credential: {} }, headers: { origin: "null-omit" } });
    expect(approve.status).toBe(403);
    expect((await w.c.req("POST", "/v1/keys", { key: w.proposeKey, body: { name: "more", scopes: ["admin"] }, headers: { origin: "null-omit" } })).status).toBe(403);
    expect((await w.c.req("POST", "/v1/company", { key: w.proposeKey, body: { name: "x" }, headers: { origin: "null-omit" } })).status).toBe(403);
    // A propose key may make a key with no more than its own scopes, never admin.
    expect((await w.c.req("POST", "/v1/keys", { key: w.proposeKey, body: { name: "child", scopes: ["read", "propose"] }, headers: { origin: "null-omit" } })).status).toBe(403);
    expect((await client(w.proposeKey).getProposal("P-0001")).status).toBe("PENDING_APPROVAL");
  });

  it("calls only operations of openapi/purser.yaml, under their operationIds, and none approves", () => {
    const yaml = readFileSync("openapi/purser.yaml", "utf8");
    const ops = new Set(yamlOperations(yaml));
    for (const [id, [method, path]] of Object.entries(OPERATIONS)) {
      expect(ops.has(`${method} ${path}`), `${id}: ${method} ${path}`).toBe(true);
      expect(yaml).toContain(`operationId: ${id}\n`);
    }
    expect(Object.values(OPERATIONS).filter(([, p]) => /approve/.test(p))).toEqual([]);
    expect(Object.getOwnPropertyNames(Purser.prototype).filter((n) => /approv/i.test(n))).toEqual([]);
  });

  it("refuses plain http to another host, an empty key and an id that is a path", async () => {
    expect(() => new Purser({ baseUrl: "http://purser.example.com", apiKey: "pck_x" })).toThrow(/https/);
    expect(() => new Purser({ baseUrl: "http://127.0.0.1:8787", apiKey: "pck_x" })).not.toThrow();
    expect(() => new Purser({ baseUrl: ORIGIN, apiKey: "" })).toThrow(/environment/);
    await expect(client(w.proposeKey).getProposal("../../v1/keys")).rejects.toThrow(/an id like/);
  });
});
