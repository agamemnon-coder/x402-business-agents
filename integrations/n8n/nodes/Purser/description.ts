// The Purser node's description for n8n (declarative style: n8n makes each request from `routing`). Plain data with no
// import, so it is tested without n8n (test/n8n-node.test.ts checks every request against openapi/purser.yaml).
//
// Read and propose only. There is no approve operation, and none can be added that works: the API refuses every key
// at the approve route; approving is the CFO's passkey over the exact terms, in Purser Cloud.

/** Each operation: its resource, its value, the request it makes (an OpenAPI operation) and where the answer's items are. */
export const PURSER_OPERATIONS = [
  { resource: "invoice", value: "getAll", name: "Get Many", action: "List invoices", description: "Supplier invoices, one page (status filter, limit)", operationId: "listInvoices", method: "GET", url: "/v1/invoices", root: "items" },
  { resource: "invoice", value: "get", name: "Get", action: "Get an invoice", description: "One invoice, with its earlier versions", operationId: "getInvoice", method: "GET", url: "=/v1/invoices/{{encodeURIComponent($parameter.invoiceId)}}", root: null },
  { resource: "invoice", value: "getPayable", name: "Get Payable", action: "List payable invoices", description: "The engine's invoices: whether each can be proposed, and its proposal", operationId: "listPayableInvoices", method: "GET", url: "/v1/engine/invoices", root: "items" },
  { resource: "proposal", value: "create", name: "Propose Payment", action: "Propose an invoice's payment", description: "File the invoice's payment for the CFO's approval. Nothing is paid until the CFO signs with their passkey.", operationId: "proposePayment", method: "POST", url: "=/v1/engine/invoices/{{encodeURIComponent($parameter.invoiceId)}}/pay", root: "proposal" },
  { resource: "proposal", value: "get", name: "Get Status", action: "Get a proposal's status", description: "Where a proposal stands: PENDING_APPROVAL until the CFO's passkey", operationId: "getProposal", method: "GET", url: "=/v1/engine/proposals/{{encodeURIComponent($parameter.proposalId)}}", root: "proposal" },
] as const;

const opsOf = (resource: string) => PURSER_OPERATIONS.filter((o) => o.resource === resource).map((o) => ({
  name: o.name, value: o.value, action: o.action, description: o.description,
  routing: {
    request: { method: o.method, url: o.url },
    ...(o.root ? { output: { postReceive: [{ type: "rootProperty", properties: { property: o.root } }] } } : {}),
  },
}));

export const purserDescription = {
  displayName: "Purser",
  name: "purser",
  icon: "file:purser.svg",
  group: ["transform"],
  version: 1,
  subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
  description: "Read a company's supplier invoices and propose payments for the CFO's approval in Purser. Cannot approve: only the CFO's passkey does. Test money only until a company goes live.",
  defaults: { name: "Purser" },
  // n8n's main connection; written as its value so this file needs no import.
  inputs: ["main"],
  outputs: ["main"],
  credentials: [{ name: "purserApi", required: true }],
  requestDefaults: { baseURL: "={{$credentials.baseUrl.replace(/\\/$/, '')}}", headers: { Accept: "application/json" } },
  properties: [
    { displayName: "Resource", name: "resource", type: "options", noDataExpression: true, default: "invoice",
      options: [{ name: "Invoice", value: "invoice" }, { name: "Proposal", value: "proposal" }] },
    { displayName: "Operation", name: "operation", type: "options", noDataExpression: true, default: "getAll", displayOptions: { show: { resource: ["invoice"] } }, options: opsOf("invoice") },
    { displayName: "Operation", name: "operation", type: "options", noDataExpression: true, default: "create", displayOptions: { show: { resource: ["proposal"] } }, options: opsOf("proposal") },
    { displayName: "Invoice ID", name: "invoiceId", type: "string", required: true, default: "", placeholder: "AP-0004",
      displayOptions: { show: { resource: ["invoice", "proposal"], operation: ["get", "create"] }, hide: { resource: ["proposal"], operation: ["get"] } } },
    { displayName: "Proposal ID", name: "proposalId", type: "string", required: true, default: "", placeholder: "P-0009", displayOptions: { show: { resource: ["proposal"], operation: ["get"] } } },
    { displayName: "Status", name: "status", type: "string", default: "", placeholder: "ready", description: "Only invoices with this status",
      displayOptions: { show: { resource: ["invoice"], operation: ["getAll"] } }, routing: { send: { type: "query", property: "status" } } },
    { displayName: "Limit", name: "limit", type: "number", typeOptions: { minValue: 1, maxValue: 200 }, default: 50, description: "Max number of results to return",
      displayOptions: { show: { resource: ["invoice"], operation: ["getAll"] } }, routing: { send: { type: "query", property: "limit" } } },
  ],
};

/** The credential's fields: the cloud's URL and an API key (shown as a password; read, or read and propose). */
export const purserCredential = {
  name: "purserApi",
  displayName: "Purser API",
  documentationUrl: "https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/integrations/README.md",
  properties: [
    { displayName: "Purser Cloud URL", name: "baseUrl", type: "string", default: "", placeholder: "https://purser.example.com", required: true },
    { displayName: "API Key", name: "apiKey", type: "string", typeOptions: { password: true }, default: "", required: true,
      description: "A key an owner made in Purser Cloud: scope read, or read and propose to file payments. Never admin." },
  ],
  authenticate: { type: "generic", properties: { headers: { Authorization: "=Bearer {{$credentials.apiKey}}" } } },
  test: { request: { baseURL: "={{$credentials.baseUrl.replace(/\\/$/, '')}}", url: "/v1/me" } },
};
