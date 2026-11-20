// The Airwallex gateway's contract, both sides of it (Purser Cloud's actions, 14 Nov). Only the kit11 Worker holds the sandbox key.
// Purser Cloud asks it over a service binding to a named entrypoint (AwxGateway, never an HTTP path anyone can reach),
// one call at a time: { method, path, body?, query? }. This file is the contract both Workers import:
//   AWX_GATEWAY_ALLOW   every call the gateway may make: method and path, nothing else (no login, no other host)
//   gatewayCheck        the one check of a request, run on both sides (the Cloud before it sends, kit11 before it calls)
//   gatewayApi          the Cloud's side: the same call(method, path, body, query) as src/airwallex/client.ts, so the
//                       engine's own adapters (AirwallexRest, AirwallexBatchRest) run over it unchanged
// Sandbox only, test money only: the kit11 side talks to https://api.sandbox.airwallex.com and nothing else.
// Money calls must carry a request_id (Airwallex's idempotency key) and, for a payout or a conversion, the hash of the
// terms the CFO signed (metadata.approval_sha256): the gateway refuses them without.


/** What a call does: reads, sandbox simulations, writes that move no money, and money. */
export type GatewayKind = "read" | "sim" | "write" | "money";

export interface GatewayRule { method: "GET" | "POST"; path: RegExp; kind: GatewayKind; name: string }

const ID = "[A-Za-z0-9_-]{1,64}";
const p = (s: string) => new RegExp(`^${s.replace(/\{id\}/g, ID)}$`);

/** Every call the gateway may make, under /api/v1. Anything else is refused before it is sent. */
export const AWX_GATEWAY_ALLOW: readonly GatewayRule[] = [
  { method: "GET", path: p("/balances/current"), kind: "read", name: "balances" },
  { method: "GET", path: p("/global_accounts"), kind: "read", name: "global accounts" },
  { method: "GET", path: p("/deposits"), kind: "read", name: "deposits" },
  { method: "GET", path: p("/fx/rates/current"), kind: "read", name: "FX rate" },
  { method: "GET", path: p("/fx/conversions"), kind: "read", name: "conversions (by request_id)" },
  { method: "GET", path: p("/beneficiaries"), kind: "read", name: "beneficiaries" },
  { method: "GET", path: p("/transfers"), kind: "read", name: "transfers (by request_id)" },
  { method: "GET", path: p("/transfers/{id}"), kind: "read", name: "one transfer" },
  // Reads for /mcp/airwallex (cloud/src/claude/awxCodemode.ts): the ledger and the cards, never a card's /details.
  { method: "GET", path: p("/financial_transactions"), kind: "read", name: "financial transactions" },
  { method: "GET", path: p("/issuing/cards"), kind: "read", name: "cards" },
  { method: "GET", path: p("/issuing/cards/{id}"), kind: "read", name: "one card" },
  { method: "GET", path: p("/batch_transfers"), kind: "read", name: "batch transfers (by request_id)" },
  { method: "GET", path: p("/batch_transfers/{id}"), kind: "read", name: "one batch transfer" },
  { method: "GET", path: p("/batch_transfers/{id}/items"), kind: "read", name: "batch transfer items" },
  { method: "POST", path: p("/beneficiaries/schema"), kind: "read", name: "beneficiary schema" },
  { method: "POST", path: p("/beneficiaries/validate"), kind: "read", name: "beneficiary validation" },
  { method: "POST", path: p("/beneficiaries/verify_account"), kind: "read", name: "account verification" },
  { method: "POST", path: p("/fx/quotes/create"), kind: "write", name: "FX quote" },
  { method: "POST", path: p("/beneficiaries/create"), kind: "write", name: "beneficiary" },
  { method: "POST", path: p("/batch_transfers/create"), kind: "write", name: "batch transfer (draft)" },
  { method: "POST", path: p("/batch_transfers/{id}/add_items"), kind: "write", name: "batch transfer items" },
  { method: "POST", path: p("/batch_transfers/{id}/quote"), kind: "write", name: "batch transfer quote" },
  { method: "POST", path: p("/batch_transfers/{id}/delete"), kind: "write", name: "batch transfer delete" },
  { method: "POST", path: p("/fx/conversions/create"), kind: "money", name: "FX conversion" },
  { method: "POST", path: p("/transfers/create"), kind: "money", name: "transfer" },
  { method: "POST", path: p("/batch_transfers/{id}/submit"), kind: "money", name: "batch transfer submit" },
  { method: "POST", path: p("/simulation/transfers/{id}/transition"), kind: "sim", name: "transfer status (sandbox simulation)" },
  { method: "POST", path: p("/simulation/deposit/create"), kind: "sim", name: "deposit (sandbox simulation)" },
];

/** The sandbox host: the only one the kit11 side calls. */
export const GATEWAY_SANDBOX_BASE = "https://api.sandbox.airwallex.com/api/v1";
/** A request body larger than this is refused (a batch of 20 lines fits easily). */
export const GATEWAY_MAX_BODY = 32 * 1024;

export interface GatewayRequest {
  method: "GET" | "POST";
  /** Under /api/v1, such as /transfers/create. */
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

/** The gateway's answer: Airwallex's JSON, or why not, with Airwallex's code and trace id only (never its words or a key). */
export type GatewayAnswer =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number; code: string | null; trace_id: string | null; ambiguous?: true; refused?: string };

export class GatewayRefused extends Error {
  constructor(readonly reason: string) { super(`Airwallex gateway refused: ${reason}`); this.name = "GatewayRefused"; }
}

const SHA = /^[0-9a-f]{64}$/;
const REQ_ID = /^[A-Za-z0-9_-]{8,64}$/;
const QKEY = /^[a-z_]{1,40}$/;

/** The rule for a call, or why it is refused: method and path on the list, a small body, plain query, money with its ids. */
export function gatewayCheck(r: GatewayRequest): { rule: GatewayRule } | { refused: string } {
  if (!r || (r.method !== "GET" && r.method !== "POST") || typeof r.path !== "string") return { refused: "not a call" };
  if (r.path.length > 160 || /[?#\s%]|\.\./.test(r.path)) return { refused: "not a plain path" };
  const rule = AWX_GATEWAY_ALLOW.find((a) => a.method === r.method && a.path.test(r.path));
  if (!rule) return { refused: `${r.method} ${r.path.replace(/[A-Za-z0-9_-]{20,}/g, "{id}")} is not on the allow-list` };
  for (const [k, v] of Object.entries(r.query ?? {})) {
    if (!QKEY.test(k) || typeof v !== "string" || v.length > 200) return { refused: "a query value is not plain" };
  }
  if (r.method === "GET" && r.body !== undefined) return { refused: "a read carries no body" };
  if (r.body !== undefined) {
    let size: number;
    try { size = JSON.stringify(r.body).length; } catch { return { refused: "the body is not JSON" }; }
    if (size > GATEWAY_MAX_BODY) return { refused: "the body is too large" };
  }
  const b = (r.body ?? {}) as Record<string, unknown>;
  const approval = (b.metadata as { approval_sha256?: unknown } | undefined)?.approval_sha256;
  if (r.path === "/transfers/create" || r.path === "/fx/conversions/create") {
    if (typeof b.request_id !== "string" || !REQ_ID.test(b.request_id)) return { refused: "a money call needs its request_id" };
    if (typeof approval !== "string" || !SHA.test(approval)) return { refused: "a money call needs the signed terms' hash (metadata.approval_sha256)" };
  }
  if (r.path === "/batch_transfers/create" && (typeof b.request_id !== "string" || !REQ_ID.test(b.request_id))) return { refused: "a batch needs its request_id" };
  return { rule };
}
