// openapi/purser.yaml against the code (19 Nov, integrations): every route of the route table (cloud/src/app.ts ROUTES)
// is in the document and every operation of the document is a route; the committed file is exactly what `npm run
// openapi` writes; operationIds are unique; every schema in it compiles as JSON Schema 2020-12; and the cloud serves
// the same document at /openapi.json and /v1/openapi.json, with the API reference page at /api (no script, CSP-safe).
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApi, ROUTES } from "../cloud/src/app.js";
import { SDK_OPERATIONS, yamlOperations } from "../cloud/src/apiSpec.js";
import { openApiYaml, SPEC_FILE } from "../scripts/openapi.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const yaml = readFileSync(SPEC_FILE, "utf8");
const inCode = ROUTES.map((r) => `${r.method} ${r.path}`);
const inSpec = yamlOperations(yaml);

let c: TestCloud;
beforeAll(() => { c = testCloud(); });
afterAll(() => c.close());

describe("openapi/purser.yaml and the route table", () => {
  it("lists every route in the code", () => {
    const missing = inCode.filter((r) => !inSpec.includes(r));
    expect(missing, `in the code, not in ${SPEC_FILE} (run npm run openapi)`).toEqual([]);
  });

  it("lists no route the code does not have", () => {
    const extra = inSpec.filter((r) => !inCode.includes(r));
    expect(extra, `in ${SPEC_FILE}, not in the code (run npm run openapi)`).toEqual([]);
    expect(new Set(inSpec).size).toBe(inSpec.length);
    expect(inSpec.length).toBe(inCode.length);
  });

  it("is exactly what npm run openapi writes from the code (summaries, scopes, bodies and answers included)", () => {
    expect(yaml === openApiYaml(), `${SPEC_FILE} is out of date: run npm run openapi`).toBe(true);
  });

  it("names each operation once, keeps the SDKs' operationIds, and marks what each needs", () => {
    const doc = openApi("https://cloud.example.invalid");
    const ops = Object.values(doc.paths as Record<string, Record<string, { operationId: string; "x-purser-needs": string; tags: string[] }>>).flatMap((m) => Object.values(m));
    const ids = ops.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, extra] of Object.entries(SDK_OPERATIONS)) {
      const [method, path] = key.split(" ") as [string, string];
      expect((doc.paths as Record<string, Record<string, { operationId: string }>>)[path]?.[method.toLowerCase()]?.operationId).toBe(extra.operationId);
    }
    expect(ops.every((o) => o.tags.length === 1 && o["x-purser-needs"])).toBe(true);
  });

  it("proposing needs the propose scope; approving needs a person, and no scope grants it", () => {
    const paths = openApi("https://x.test").paths as Record<string, Record<string, { "x-purser-needs": string; summary: string }>>;
    expect(paths["/v1/engine/invoices/{id}/pay"]!.post!["x-purser-needs"]).toBe("propose");
    expect(paths["/v1/engine/proposals/{id}/approve"]!.post!.summary).toMatch(/a session only/);
    expect(ROUTES.filter((r) => r.need === "propose").map((r) => `${r.method} ${r.path}`)).toEqual(["POST /v1/engine/invoices/{id}/pay"]);
  });

  it("holds schemas that compile as JSON Schema 2020-12 (components and request bodies)", () => {
    const doc = openApi("https://x.test") as { components: { schemas: Record<string, object> }; paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: object }> } }>> };
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema({ $id: "doc", components: doc.components });
    for (const name of Object.keys(doc.components.schemas)) expect(() => ajv.getSchema(`doc#/components/schemas/${name}`), name).not.toThrow();
    let bodies = 0;
    for (const ops of Object.values(doc.paths)) for (const op of Object.values(ops)) {
      const s = op.requestBody?.content["application/json"]?.schema;
      if (s) { bodies++; expect(() => ajv.compile(s)).not.toThrow(); }
    }
    expect(bodies).toBeGreaterThanOrEqual(7);
    // A key's request names the propose scope.
    expect(JSON.stringify(doc.paths["/v1/keys"]!.post!.requestBody)).toContain('"propose"');
  });
});

describe("the cloud serves the document and its reference page", () => {
  it("at /openapi.json, the same as /v1/openapi.json, readable from any origin", async () => {
    const a = await c.req("GET", "/openapi.json");
    expect(a.status).toBe(200);
    expect(a.res.headers.get("access-control-allow-origin")).toBe("*");
    expect(a.json).toEqual((await c.req("GET", "/v1/openapi.json")).json);
    expect((a.json as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("at /api, as one HTML page with no script and a nonce-only style policy", async () => {
    const r = await c.req("GET", "/api");
    const html = await r.res.text();
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toMatch(/^text\/html/);
    const csp = r.res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^default-src 'none'; style-src 'nonce-[A-Za-z0-9_-]+'/);
    expect(csp).not.toMatch(/script-src|unsafe-inline|https?:/);
    expect(html).not.toMatch(/<script|\son\w+=|javascript:/i);
    expect(html).not.toMatch(/https?:\/\/(?!github\.com\/agamemnon-coder\/)[^"'\s<]+\.(js|css)/);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(html).toContain(`<style nonce="${nonce}">`);
    for (const id of ["listInvoices", "proposePayment", "getProposal"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("No key, agent, integration or chat message approves");
  });
});
