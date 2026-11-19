// The n8n community node (integrations/n8n): read and propose operations only, each request an operation of
// openapi/purser.yaml under its operationId; the API key sent as a bearer header and stored as a password; the package
// names the files n8n loads. No approve operation. Building and publishing the package is the owner's step.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { yamlOperations } from "../cloud/src/apiSpec.js";

// The node's package is CommonJS (n8n loads it so); it is loaded here at run time, outside the root typecheck, and typed by hand.
interface Op { resource: string; value: string; operationId: string; method: string; url: string }
interface Prop { name: string; type?: string; typeOptions?: Record<string, unknown>; default?: unknown; options?: unknown[] }
const DESCRIPTION = "../integrations/n8n/nodes/Purser/description.ts";
const { PURSER_OPERATIONS, purserCredential, purserDescription } = (await import(DESCRIPTION)) as {
  PURSER_OPERATIONS: Op[];
  purserCredential: { name: string; authenticate: unknown; properties: Prop[]; test: { request: { url: string } } };
  purserDescription: { credentials: unknown; properties: Prop[] };
};

const yaml = readFileSync("openapi/purser.yaml", "utf8");
const inSpec = new Set(yamlOperations(yaml));
/** An n8n URL expression as the route it calls: "=/v1/invoices/{{...invoiceId...}}/pay" → "/v1/invoices/{id}/pay". */
const pathOf = (url: string) => url.replace(/^=/, "").replace(/\{\{[^}]*\}\}/g, "{id}");

describe("the n8n node", () => {
  it("reads invoices and proposals and proposes a payment; nothing else", () => {
    expect(PURSER_OPERATIONS.map((o) => `${o.resource}.${o.value} ${o.operationId}`)).toEqual([
      "invoice.getAll listInvoices", "invoice.get getInvoice", "invoice.getPayable listPayableInvoices",
      "proposal.create proposePayment", "proposal.get getProposal",
    ]);
    expect(JSON.stringify(purserDescription)).not.toMatch(/\/approve|"approve/i);
  });

  it("makes only requests of openapi/purser.yaml, under their operationIds", () => {
    for (const o of PURSER_OPERATIONS) {
      expect(inSpec.has(`${o.method} ${pathOf(o.url)}`), `${o.method} ${o.url}`).toBe(true);
      expect(yaml).toContain(`operationId: ${o.operationId}\n`);
    }
    const options = purserDescription.properties.filter((p) => p.name === "operation").flatMap((p) => p.options as { routing: { request: { method: string; url: string } } }[]);
    expect(options.map((o) => `${o.routing.request.method} ${o.routing.request.url}`)).toEqual(PURSER_OPERATIONS.map((o) => `${o.method} ${o.url}`));
  });

  it("sends the API key as a bearer header from n8n's credential store, shown as a password, with no default", () => {
    expect(purserCredential.authenticate).toEqual({ type: "generic", properties: { headers: { Authorization: "=Bearer {{$credentials.apiKey}}" } } });
    const key = purserCredential.properties.find((p) => p.name === "apiKey")!;
    expect(key).toMatchObject({ type: "string", typeOptions: { password: true }, default: "" });
    expect(purserCredential.test.request.url).toBe("/v1/me");
    expect(purserDescription.credentials).toEqual([{ name: purserCredential.name, required: true }]);
  });

  it("is a community node package whose n8n section names the files its build makes", () => {
    const pkg = JSON.parse(readFileSync("integrations/n8n/package.json", "utf8")) as { name: string; keywords: string[]; n8n: { credentials: string[]; nodes: string[] } };
    expect(pkg.name).toMatch(/^n8n-nodes-/);
    expect(pkg.keywords).toContain("n8n-community-node-package");
    for (const f of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) expect(existsSync(`integrations/n8n/${f.replace(/^dist\//, "").replace(/\.js$/, ".ts")}`), f).toBe(true);
    expect(readFileSync("integrations/n8n/nodes/Purser/Purser.node.ts", "utf8")).toContain("description = purserDescription");
    expect(readFileSync("integrations/n8n/credentials/PurserApi.credentials.ts", "utf8")).toContain("purserCredential.authenticate");
    expect(existsSync("integrations/n8n/nodes/Purser/purser.svg")).toBe(true);
  });
});
