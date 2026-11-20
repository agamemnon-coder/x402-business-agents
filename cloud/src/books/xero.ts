// Bills to Xero (20 Nov): a company that connected its own Xero organisation (Settings, "Connect Xero"; cloud/src/connect.ts)
// sends its supplier invoices there as DRAFT bills (Xero's Invoices with Type ACCPAY), from Purser Cloud.
//
// A draft only: Purser never authorises a bill in Xero, never pays one and never marks one paid; a person in Xero checks
// and approves each draft there. Each invoice goes once (books_pushes, and Xero's Idempotency-Key header for a retried
// request). Calls go to api.xero.com only, with the company's own token and its own organisation's id (xero-tenant-id):
// one company's push can never reach another company's Xero.
//
// From Xero's documentation (developer.xero.com, Accounting API "Invoices" and "Connections", read 20 Nov 2026):
//   POST https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false   { Invoices: [ { Type: "ACCPAY", Contact: { Name },
//        InvoiceNumber, Reference, Date, DueDate, CurrencyCode, Status: "DRAFT", LineAmountTypes: "Exclusive",
//        LineItems: [ { Description, Quantity, UnitAmount, AccountCode, TaxAmount } ] } ] }
//   A contact named that does not exist yet is made by Xero. TaxType is left to the account's default tax rate, and
//   TaxAmount carries Purser's VAT (Xero takes an override of its own calculation); the draft is for a person to check.
//   GET https://api.xero.com/connections: the organisations a token may call (tenantId, authEventId).
// Status: built and tested against a stand-in shaped like these pages; not yet run against a Xero demo company.

import { accessToken, ConnectRefused, type ConnectEnv } from "../connect.js";
import { bills, type Bill } from "../connections.js";
import { fromB64, sha256Hex } from "../crypto.js";
import { logEvent } from "../log.js";
import type { Sql } from "../store.js";
import { TenantDb, WriteConflict } from "../tenant.js";

const API = "https://api.xero.com";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bills per push: one request each, well under Xero's 60 calls a minute per organisation. */
export const XERO_PUSH_MAX = 25;

/** The organisation a fresh token was issued for: the connection of this consent (authEventId), else the newest one. */
export async function xeroTenantOf(f: typeof fetch, token: string): Promise<string | null> {
  let res: Response;
  try { res = await f(`${API}/connections`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) }); } catch { return null; }
  if (!res.ok) return null;
  const list = (await res.json().catch(() => [])) as { tenantId?: unknown; tenantType?: unknown; authEventId?: unknown; updatedDateUtc?: unknown }[];
  if (!Array.isArray(list)) return null;
  const orgs = list.filter((c) => typeof c.tenantId === "string" && GUID.test(c.tenantId) && (c.tenantType === undefined || c.tenantType === "ORGANISATION"));
  let event: unknown = null;
  try { event = (JSON.parse(new TextDecoder().decode(fromB64(token.split(".")[1] ?? ""))) as { authentication_event_id?: unknown }).authentication_event_id; } catch { event = null; }
  const mine = orgs.find((c) => typeof event === "string" && c.authEventId === event);
  const newest = [...orgs].sort((x, y) => String(y.updatedDateUtc ?? "").localeCompare(String(x.updatedDateUtc ?? "")))[0];
  return ((mine ?? newest)?.tenantId as string | undefined) ?? null;
}

const clean = (s: string, n = 200) => [...s].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").replace(/ +/g, " ").trim().slice(0, n);

/** One Purser supplier invoice as a Xero draft bill. */
export function xeroBill(b: Bill): Record<string, unknown> {
  const net = b.subtotal ?? b.total, tax = b.tax ?? "0.00";
  return {
    Type: "ACCPAY", Contact: { Name: clean(b.vendor, 255) || "Unknown supplier" }, InvoiceNumber: clean(b.invoice_no, 255), Reference: `Purser ${b.id}`,
    ...(b.issue_date ? { Date: b.issue_date.slice(0, 10) } : {}), DueDate: b.due_date.slice(0, 10), CurrencyCode: b.currency, Status: "DRAFT", LineAmountTypes: "Exclusive",
    LineItems: [{ Description: clean(`${b.vendor} invoice ${b.invoice_no} (Purser ${b.id})`, 4000), Quantity: 1, UnitAmount: Number(net), ...(b.gl_account ? { AccountCode: b.gl_account } : {}), TaxAmount: Number(tax) }],
  };
}

export interface XeroPushResult {
  organisation: string;
  status: "draft";
  pushed: { invoice_id: string; xero_invoice_id: string }[];
  already: number;
  failed: { invoice_id: string; reason: string }[];
  /** Invoices left for the next push (more than XERO_PUSH_MAX, or Xero asked to slow down). */
  remaining: number;
}

/**
 * Sends the company's supplier invoices that Xero does not hold yet (issued between `from` and `to` when given) as draft
 * bills to the company's own connected Xero organisation. Stops at a 401 or 429 (the rest wait for the next push).
 */
export async function pushBillsToXero(sql: Sql, env: ConnectEnv, a: { tenantId: string; by: string; from: string | null; to: string | null; now: Date }): Promise<XeroPushResult> {
  const tok = await accessToken(sql, a.tenantId, "xero", env, a.now);
  const org = tok.account;
  if (!org || !GUID.test(org)) throw new ConnectRefused(409, "the connected Xero organisation is not known; disconnect and connect Xero again");
  const db = new TenantDb(sql, a.tenantId);
  const done = new Set((await db.select<{ invoice_id: string }>("books_pushes", { provider: "xero" })).map((r) => r.invoice_id));
  const all = await bills(db, a.from, a.to);
  const todo = all.filter((b) => !done.has(b.id));
  const out: XeroPushResult = { organisation: org, status: "draft", pushed: [], already: all.length - todo.length, failed: [], remaining: 0 };
  let i = 0;
  for (; i < todo.length && i < XERO_PUSH_MAX; i++) {
    const b = todo[i]!;
    let res: Response;
    try {
      res = await env.fetch(`${API}/api.xro/2.0/Invoices?summarizeErrors=false`, {
        method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${tok.access_token}`, "xero-tenant-id": org, accept: "application/json", "content-type": "application/json",
          // The same invoice for the same organisation always sends the same key: a retried request makes no second bill.
          "idempotency-key": (await sha256Hex(`purser|${a.tenantId}|xero|${org}|${b.id}`)).slice(0, 64) },
        body: JSON.stringify({ Invoices: [xeroBill(b)] }),
      });
    } catch {
      out.failed.push({ invoice_id: b.id, reason: "Xero did not answer; try again" });
      continue;
    }
    if (res.status === 401 || res.status === 403) { out.failed.push({ invoice_id: b.id, reason: "Xero refused the connection; connect Xero again" }); i++; break; }
    if (res.status === 429) { out.failed.push({ invoice_id: b.id, reason: "Xero asked to slow down; push again in a minute" }); i++; break; }
    const j = (await res.json().catch(() => ({}))) as { Invoices?: { InvoiceID?: unknown; StatusAttributeString?: unknown; ValidationErrors?: { Message?: unknown }[] }[]; Elements?: { ValidationErrors?: { Message?: unknown }[] }[]; Message?: unknown };
    const inv = j.Invoices?.[0];
    const id = typeof inv?.InvoiceID === "string" && GUID.test(inv.InvoiceID) && inv.StatusAttributeString !== "ERROR" ? inv.InvoiceID : null;
    if (res.ok && id) {
      try {
        await db.apply([db.insert("books_pushes", { provider: "xero", invoice_id: b.id, remote_id: id, pushed_at: a.now.toISOString(), pushed_by: a.by })]);
      } catch (e) {
        // Two pushes at once: the other one recorded it (Xero made one bill, by the idempotency key).
        if (!(e instanceof WriteConflict)) throw e;
      }
      out.pushed.push({ invoice_id: b.id, xero_invoice_id: id });
      continue;
    }
    const errs = [...(inv?.ValidationErrors ?? []), ...(j.Elements?.[0]?.ValidationErrors ?? [])].map((v) => (typeof v.Message === "string" ? clean(v.Message) : "")).filter(Boolean);
    out.failed.push({ invoice_id: b.id, reason: errs.length ? `Xero: ${errs.slice(0, 3).join("; ")}` : `Xero answered ${res.status}` });
  }
  out.remaining = todo.length - i;
  logEvent("info", "xero.bills_pushed", { tenant: a.tenantId, pushed: out.pushed.length, failed: out.failed.length, remaining: out.remaining }, a.now);
  return out;
}
