// What the OpenAPI document says beyond the route table (19 Nov, integrations): a stable operationId for every route,
// a tag, the query parameters and the answers of the operations the SDKs call (sdk/typescript, sdk/python), and the
// document as YAML (openapi/purser.yaml). The route table (./app.ts ROUTES) stays the one source of which routes exist:
// test/openapi-spec.test.ts fails when a route is in the code and not in openapi/purser.yaml, or the other way round,
// and when the committed file differs from what `npm run openapi` writes.
//
// The safety boundary, said once here and in the document: a key reads (read) and files a payment for the CFO's
// approval (propose); no key approves. Approving takes a signed-in person's passkey over the exact terms.

/** A JSON Schema (2020-12, OpenAPI 3.1's dialect). */
export type Schema = Record<string, unknown>;

const S = { type: "string" } as const;
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });

/** The answers the SDKs read, as components of the document. Fields the cloud may add later are allowed. */
export const API_SCHEMAS: Record<string, Schema> = {
  Invoice: {
    type: "object", required: ["id", "version"], additionalProperties: true,
    description: "A supplier invoice as the company's records hold it (the runner's or the engine's copy, versioned).",
    properties: {
      id: { type: "string", description: "Like AP-0004" }, version: { type: "integer" },
      vendor: S, invoice_no: S, due_date: { type: "string", description: "YYYY-MM-DD" }, currency: S, total: { type: "string", description: "A decimal amount, like 1309.00" }, status: S,
    },
  },
  InvoiceDetail: {
    allOf: [{ $ref: "#/components/schemas/Invoice" }, { type: "object", properties: { earlier_versions: { type: "array", items: { type: "object", properties: { version: { type: "integer" }, replaced_at: S } } } } }],
  },
  InvoicePage: {
    type: "object", required: ["items", "next_cursor"],
    properties: { items: { type: "array", items: { $ref: "#/components/schemas/Invoice" } }, next_cursor: { ...nullable(S), description: "Send as cursor for the next page; null on the last page" } },
  },
  Proposal: {
    type: "object", required: ["id", "kind", "status", "terms_sha256"], additionalProperties: true,
    description: "A payment proposal: the exact terms the CFO's passkey signs. PENDING_APPROVAL waits for the CFO; only their passkey moves it on.",
    properties: {
      id: { type: "string", description: "Like P-0009" }, kind: S,
      status: { type: "string", description: "PENDING_APPROVAL, APPROVED, EXECUTED, FAILED, REJECTED or EXPIRED" },
      terms_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      challenge: { type: "string", description: "What the CFO's passkey signs over the terms" },
      facts: { type: "array", items: { type: "array", prefixItems: [S, S], minItems: 2, maxItems: 2 }, description: "[label, value] pairs a person reads" },
      warnings: { type: "array", items: S },
    },
  },
  ProposalAnswer: { type: "object", required: ["proposal"], properties: { proposal: { $ref: "#/components/schemas/Proposal" } } },
  ProposeAnswer: {
    type: "object", required: ["proposal"], additionalProperties: true,
    description: "The filed proposal. Nothing is paid until the CFO approves these exact terms with their passkey, except within a pay-alone limit the CFO set (off unless set), which `alone` then names.",
    properties: { proposal: { $ref: "#/components/schemas/Proposal" }, alone: { type: "object" }, settled: nullable({ type: "object" }) },
  },
  EngineInvoice: {
    type: "object", required: ["id", "status", "payable", "vendor", "currency", "total"], additionalProperties: true,
    properties: {
      id: S, status: S, status_words: S, payable: { type: "boolean", description: "Whether a payment can be proposed now" }, vendor: S, invoice_no: S, currency: S, total: S, due_date: S,
      findings: { type: "array", items: { type: "object", properties: { level: S, code: S, message: S } } },
      proposal: nullable({ $ref: "#/components/schemas/Proposal" }),
    },
  },
  EngineInvoices: { type: "object", required: ["items"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/EngineInvoice" } } } },
  Me: {
    type: "object", required: ["tenant", "kind", "scopes"], additionalProperties: true,
    properties: {
      tenant: { type: "object", properties: { id: S, slug: S, name: S, language: S } },
      kind: { type: "string", enum: ["key", "session"] },
      scopes: { type: "array", items: { type: "string", enum: ["read", "sync", "admin", "propose"] } },
      role: nullable(S),
    },
  },
};

const ref = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
const query = (name: string, description: string, schema: Schema = S) => ({ name, in: "query", required: false, description, schema });
const PAGE = [query("limit", "1 to 200 (default 50)", { type: "integer", minimum: 1, maximum: 200 }), query("cursor", "next_cursor of the page before")];

export interface OperationExtra { operationId: string; parameters?: Schema[]; ok?: { status: number; description: string; content: Record<string, unknown> } }

/** The operations the SDKs call, by "METHOD /path": a fixed operationId, their query parameters and their answer. */
export const SDK_OPERATIONS: Record<string, OperationExtra> = {
  "GET /v1/me": { operationId: "getMe", ok: { status: 200, description: "Who is calling", content: ref("Me") } },
  "GET /v1/invoices": { operationId: "listInvoices", parameters: [query("status", "ready, paid, held, ..."), query("due_from", "YYYY-MM-DD"), query("due_to", "YYYY-MM-DD"), ...PAGE], ok: { status: 200, description: "A page of invoices", content: ref("InvoicePage") } },
  "GET /v1/invoices/{id}": { operationId: "getInvoice", ok: { status: 200, description: "One invoice", content: ref("InvoiceDetail") } },
  "GET /v1/engine/invoices": { operationId: "listPayableInvoices", ok: { status: 200, description: "The engine's invoices, with whether each can be proposed and its proposal", content: ref("EngineInvoices") } },
  "POST /v1/engine/invoices/{id}/pay": { operationId: "proposePayment", ok: { status: 200, description: "The proposal, filed for the CFO's approval", content: ref("ProposeAnswer") } },
  "GET /v1/engine/proposals/{id}": { operationId: "getProposal", ok: { status: 200, description: "The proposal and its status", content: ref("ProposalAnswer") } },
};

/** "GET /v1/engine/proposals/{id}" → "getV1EngineProposalsById"; the SDK operations keep their own names. */
export function operationIdOf(method: string, path: string): string {
  const fixed = SDK_OPERATIONS[`${method} ${path}`]?.operationId;
  if (fixed) return fixed;
  const words = path.split("/").filter(Boolean).map((p) => (p.startsWith("{") ? `by ${p.slice(1, -1)}` : p))
    .join(" ").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

/** The group a route belongs to, for the document's tags and the reference page. */
export function tagOf(path: string, need: string): string {
  if (need === "platform" || path.startsWith("/v1/admin/")) return "Platform";
  if (path.startsWith("/v1/try")) return "Hands-on demo";
  if (path.startsWith("/v1/engine")) return "Engine (payments)";
  if (path.startsWith("/v1/auth/") || path.startsWith("/v1/keys") || path.startsWith("/v1/users") || path.startsWith("/v1/security") || path === "/v1/me" || path === "/v1/me/language") return "Access";
  if (path === "/mcp" || path.startsWith("/oauth/") || path.startsWith("/.well-known/oauth") || path.startsWith("/v1/claude") || path === "/connect-ai") return "AI agents (MCP, OAuth)";
  if (path.startsWith("/.well-known/agent") || path === "/openapi.json" || path === "/api" || path.startsWith("/v1/openapi")) return "Discovery";
  if (!path.startsWith("/v1/")) return "Site";
  return "Company";
}

export const TAG_DESCRIPTIONS: Record<string, string> = {
  Company: "The company's books, read-only for read keys: invoices, documents, suppliers, payments, the transactions register, the ledger and its reports; and the owner's settings.",
  "Engine (payments)": "The company's engine (test money): propose an invoice's payment (read + propose); approving is a signed-in person's passkey only, never a key.",
  Access: "Who may do what: passkey sign-in, sessions, API keys (read, sync, admin, propose) and people.",
  "AI agents (MCP, OAuth)": "Purser as a remote MCP server for AI clients, its connector tokens and its OAuth sign-in.",
  Discovery: "Machine-readable descriptions: this document, the A2A Agent Card and the API reference page.",
  Platform: "The platform operator's routes (the platform admin token).",
  "Hands-on demo": "The hands-on demo's own routes (/try): a visitor's test company, for a day, test money.",
  Site: "Icons and pages.",
};

// --- YAML ------------------------------------------------------------------------------------------------------------

/** A plain scalar YAML reads back as the same string; anything else is written JSON-quoted (valid YAML 1.2). */
function scalar(s: string): string {
  const plain = /^[A-Za-z_/][A-Za-z0-9 _./(){}-]*$/.test(s) && !/[ ]$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/: | #/.test(s);
  return plain ? s : JSON.stringify(s);
}
const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(k) ? k : JSON.stringify(k));

/** JSON-shaped data as block YAML: maps and lists indented by two, strings quoted where a plain one would change. */
export function toYaml(v: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const inline = (x: unknown): string | null => {
    if (x === null) return "null";
    if (typeof x === "string") return scalar(x);
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    if (Array.isArray(x) && x.length === 0) return "[]";
    if (typeof x === "object" && Object.keys(x as object).length === 0) return "{}";
    return null;
  };
  if (Array.isArray(v)) {
    return v.map((item) => {
      const one = inline(item);
      if (one !== null) return `${pad}- ${one}\n`;
      const body = toYaml(item, indent + 2);
      return `${pad}- ${body.slice(indent + 2)}`;
    }).join("");
  }
  if (typeof v === "object" && v !== null) {
    return Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => {
      const one = inline(x);
      return one !== null ? `${pad}${key(k)}: ${one}\n` : `${pad}${key(k)}:\n${toYaml(x, indent + 2)}`;
    }).join("");
  }
  return `${pad}${inline(v)}\n`;
}

/** The operations of a document, as "METHOD /path" (the test's view of openapi/purser.yaml, read back by its indentation). */
export function yamlOperations(yaml: string): string[] {
  const out: string[] = [];
  let inPaths = false, path = "";
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) { inPaths = line === "paths:"; continue; }
    if (!inPaths) continue;
    const p = /^ {2}("?)(\/[^"]*)\1:$/.exec(line);
    if (p) { path = p[2]!; continue; }
    const m = /^ {4}(get|post|put|patch|delete):$/.exec(line);
    if (m && path) out.push(`${m[1]!.toUpperCase()} ${path}`);
  }
  return out;
}
