// The Xero adapter (docs/integrations/workplace.md, "Xero"), in the shape of the Moneybird and Exact Online connectors
// (src/erp/moneybird.ts, src/erp/exact.ts): the same canonical model, transport, token provider, errors and steps. It
// pushes what Purser booked: suppliers as contacts and the payables journal as manual journals. Scopes:
// accounting.manualjournals and accounting.contacts (Xero's granular scopes, required for apps made after 2 March
// 2026), with offline_access for the refresh token: nothing that touches invoices, payments or bank transactions.
//
// Endpoints, each from Xero's Accounting API reference (developer.xero.com/documentation/api/accounting/...):
// - connections (which organisation a token reaches): GET https://api.xero.com/connections, then every call carries
//   the header xero-tenant-id (.../guides/oauth2/tenants).
// - contacts:        POST /api.xro/2.0/Contacts {"Contacts":[{Name, ContactNumber, TaxNumber, EmailAddress, ...}]};
//                    GET  /api.xro/2.0/Contacts?where=ContactNumber=="..." to find one again.
// - manualjournals:  POST /api.xro/2.0/ManualJournals {"ManualJournals":[{Narration, Date, Status, LineAmountTypes,
//                    JournalLines:[{LineAmount (debit positive, credit negative), AccountCode, Description}]}]};
//                    GET  /api.xro/2.0/ManualJournals?where=Narration=="..." to find one again.
// - Idempotency-Key header on a POST (.../guides/idempotent-requests): a retried POST with the same key is not applied
//   twice.
// - Tokens (.../guides/oauth2/auth-flow): POST https://identity.xero.com/connect/token, grant_type=refresh_token, the
//   client's id and secret as HTTP Basic; the access token lives 30 minutes; the refresh token rotates on every
//   refresh, so it is kept in a file outside git (mode 600) like Exact Online's.
//
// Built and tested against a mock (test/workplace-accounting.test.ts); needs the owner's Xero app to run live.

import { z } from "zod";
import type { TokenProvider, TokenStore } from "../erp/auth.js";
import { errorForStatus, ErpError, step, type ErpVendorRow, type PushProgress, type Transport } from "../erp/connector.js";
import { amount, contentHash, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type Vendor } from "../erp/model.js";
import { callJson, jsonMap } from "../erp/rest.js";
import type { BooksPush } from "./accounting.js";

export const XERO_API = "https://api.xero.com/api.xro/2.0";
export const XERO_CONNECTIONS = "https://api.xero.com/connections";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface XeroConfig {
  tenantId: string;
  baseUrl: string;
  /** The organisation's base currency: Xero's manual journals are in it alone. */
  baseCurrency: string;
  /** Purser account code to Xero account code, where they differ; unmapped codes go as they are. */
  glMap: Record<string, string>;
  /** DRAFT (default: the accountant posts it in Xero) or POSTED. */
  journalStatus: "DRAFT" | "POSTED";
}

/** Xero's words from an error body: a ValidationException's messages, or its Message. */
export function xeroError(body: string): string {
  try {
    const j = JSON.parse(body) as { Message?: string; Detail?: string; Title?: string; Elements?: { ValidationErrors?: { Message?: string }[] }[] };
    const v = (j.Elements ?? []).flatMap((e) => e.ValidationErrors ?? []).map((e) => e.Message ?? "").filter(Boolean).slice(0, 3);
    return (v.length ? v.join("; ") : j.Detail ?? j.Message ?? j.Title ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 300);
  } catch {
    return "";
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ContactsAnswer = z.object({ Contacts: z.array(z.object({ ContactID: z.string().regex(GUID), Name: z.string().max(500).optional(), ContactNumber: z.string().max(100).nullable().optional(), TaxNumber: z.string().max(100).nullable().optional() })).max(1000) });
const JournalsAnswer = z.object({ ManualJournals: z.array(z.object({ ManualJournalID: z.string().regex(GUID), Narration: z.string().max(4000).optional(), Status: z.string().max(20).optional() })).max(1000) });
const Connections = z.array(z.object({ id: z.string().max(100), tenantId: z.string().regex(GUID), tenantType: z.string().max(40), tenantName: z.string().max(500).nullable().optional() })).max(500);

/** Purser's own id in a Xero filter: plain characters only, so it can be quoted without escaping. */
const plain = (s: string) => /^[A-Za-z0-9 ._:/-]{1,200}$/.test(s);
export const contactNumberOf = (vendorId: string) => `PURSER-${vendorId}`.slice(0, 50);
export const narrationOf = (j: JournalEntry) => `${j.memo.replace(/[\p{Cc}\p{Cf}"\\]/gu, " ").slice(0, 300)} [Purser ${j.id}]`;
const marker = (j: JournalEntry) => `[Purser ${j.id}]`;

export class XeroConnector implements BooksPush {
  readonly name = "xero" as const;

  constructor(private readonly cfg: XeroConfig, private readonly transport: Transport, private readonly tokens: TokenProvider) {
    if (!GUID.test(cfg.tenantId)) throw new ErpError("config", "the Xero tenant id is not a GUID (GET https://api.xero.com/connections lists it)");
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return { "xero-tenant-id": this.cfg.tenantId, ...(idempotencyKey ? { "idempotency-key": idempotencyKey.slice(0, 128) } : {}) };
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const r = await callJson<unknown>(this.transport, this.tokens, { method: "GET", url: `${this.cfg.baseUrl}/${path}`, headers: this.headers() }, xeroError);
    const p = schema.safeParse(r.json);
    if (!p.success) throw new ErpError("unexpected", `GET ${path.split("?")[0]}: Xero's answer is not the documented shape`);
    return p.data;
  }

  private async post<T>(path: string, body: unknown, key: string, schema: z.ZodType<T>): Promise<T> {
    const r = await callJson<unknown>(this.transport, this.tokens, { method: "POST", url: `${this.cfg.baseUrl}/${path}`, body, headers: this.headers(key) }, xeroError);
    const p = schema.safeParse(r.json);
    if (!p.success) throw new ErpError("unexpected", `POST ${path}: Xero's answer is not the documented shape`);
    return p.data;
  }

  private where(path: string, field: string, value: string): string {
    return `${path}?where=${encodeURIComponent(`${field}=="${value}"`)}`;
  }

  async pullVendors(): Promise<ErpVendorRow[]> {
    const r = await this.get("Contacts?summaryOnly=true", ContactsAnswer);
    return r.Contacts.map((c) => ({ externalId: c.ContactID, name: c.Name ?? "", ...(c.TaxNumber ? { vatId: c.TaxNumber } : {}) }));
  }

  // POST Contacts: Name (required, unique in the organisation); ContactNumber carries Purser's id so the contact is found
  // again; BankAccountDetails is the supplier's IBAN when Purser sends it.
  async pushVendor(v: Vendor, progress?: PushProgress): Promise<string> {
    return step(progress, "contact", async () => {
      const r = await this.post("Contacts", { Contacts: [{
        Name: v.name.slice(0, 255), ContactNumber: contactNumberOf(v.id), ...(v.vatId ? { TaxNumber: v.vatId } : {}), ...(v.email ? { EmailAddress: v.email } : {}),
        ...(v.iban ? { BankAccountDetails: v.iban } : {}), DefaultCurrency: v.currency,
      }] }, `purser-contact-${v.id}-${contentHash("vendor", v).slice(0, 16)}`, ContactsAnswer);
      const id = r.Contacts[0]?.ContactID;
      if (!id) throw new ErpError("unexpected", "POST Contacts: Xero answered no contact");
      return id;
    });
  }

  // POST ManualJournals: one line per journal line, the debit as a positive LineAmount and the credit as a negative one
  // (Xero: "Debits are positive, credits are negative value"); NoTax, since Purser's lines already hold the VAT on its
  // own account. The narration ends with [Purser <id>], by which the journal is found again.
  async pushJournalEntry(j: JournalEntry, progress?: PushProgress): Promise<string> {
    if (j.currency !== this.cfg.baseCurrency) throw new ErpError("validation", `journal entry ${j.id} is in ${j.currency}; Xero's manual journals are in the organisation's ${this.cfg.baseCurrency} only: book it in Xero by hand`);
    const lines = j.lines.map((l) => ({
      LineAmount: amount(l.debitCents > 0 ? l.debitCents : -l.creditCents),
      AccountCode: this.cfg.glMap[l.glAccount] ?? l.glAccount,
      Description: `${l.description ?? j.memo}${l.costCentre ? ` (cost centre ${l.costCentre})` : ""}`.slice(0, 4000),
    }));
    return step(progress, "journal", async () => {
      const r = await this.post("ManualJournals", { ManualJournals: [{ Narration: narrationOf(j), Date: j.date, Status: this.cfg.journalStatus, LineAmountTypes: "NoTax", JournalLines: lines }] },
        `purser-journal-${j.id}-${contentHash("journal", j).slice(0, 16)}`, JournalsAnswer);
      const id = r.ManualJournals[0]?.ManualJournalID;
      if (!id) throw new ErpError("unexpected", "POST ManualJournals: Xero answered no journal");
      return id;
    });
  }

  async findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry): Promise<string | null> {
    if (kind === "vendor") {
      const v = o as Vendor;
      const number = contactNumberOf(v.id);
      if (plain(number)) {
        const r = await this.get(this.where("Contacts", "ContactNumber", number), ContactsAnswer);
        if (r.Contacts[0]) return r.Contacts[0].ContactID;
      }
      return null;
    }
    if (kind === "journal") {
      const j = o as JournalEntry;
      if (!plain(j.id)) return null;
      const r = await this.get(this.where("ManualJournals", "Narration", narrationOf(j)), JournalsAnswer);
      return r.ManualJournals.find((x) => (x.Narration ?? "").endsWith(marker(j)))?.ManualJournalID ?? null;
    }
    throw new ErpError("config", `the Xero adapter pushes contacts and journal entries only, not ${kind}s`);
  }
}

/** The organisations a token reaches (GET https://api.xero.com/connections), for the owner to pick ERP_XERO_TENANT_ID from. */
export async function xeroTenants(transport: Transport, tokens: TokenProvider, url = XERO_CONNECTIONS): Promise<{ tenantId: string; type: string; name: string }[]> {
  const r = await callJson<unknown>(transport, tokens, { method: "GET", url }, xeroError);
  const p = Connections.safeParse(r.json);
  if (!p.success) throw new ErpError("unexpected", "GET connections: Xero's answer is not the documented shape");
  return p.data.map((c) => ({ tenantId: c.tenantId, type: c.tenantType, name: c.tenantName ?? "" }));
}

/**
 * Xero's tokens: refreshed a minute before the access token expires, the rotated refresh token saved before the new
 * access token is used, load-refresh-save under the store's lock (two runs never refresh with the same token).
 */
export function xeroTokens(o: { clientId: string; clientSecret?: string; store: TokenStore; seedRefreshToken?: string; transport: Transport; now?: () => number; tokenUrl?: string }): TokenProvider {
  const now = o.now ?? Date.now;
  const locked = <T>(fn: () => Promise<T>) => (o.store.withLock ? o.store.withLock(fn) : fn());
  let refused: string | null = null;
  return {
    token: () => locked(async () => {
      const t = o.store.load() ?? (o.seedRefreshToken ? { refresh_token: o.seedRefreshToken } : null);
      if (!t) throw new ErpError("config", "no Xero refresh token: set ERP_XERO_REFRESH_TOKEN once, from the authorization step");
      if (t.access_token && t.access_token !== refused && t.expires_at && t.expires_at - now() > 60_000) return t.access_token;
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      if (o.clientSecret) headers.authorization = `Basic ${Buffer.from(`${o.clientId}:${o.clientSecret}`).toString("base64")}`;
      else form.set("client_id", o.clientId);
      const res = await o.transport.send({ method: "POST", url: o.tokenUrl ?? XERO_TOKEN_URL, headers, body: form.toString() });
      if (res.status !== 200) {
        let code = "";
        try { code = String((JSON.parse(res.body) as { error?: unknown }).error ?? "").replace(/[^a-z_]/g, "").slice(0, 40); } catch { /* not JSON */ }
        const e = errorForStatus(res.status, res.headers, "Xero token", code);
        throw res.status === 400 ? new ErpError("auth", e.message, { status: 400 }) : e;
      }
      let j: { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
      try { j = JSON.parse(res.body) as typeof j; } catch { throw new ErpError("auth", "Xero token: the answer is not JSON"); }
      if (typeof j.access_token !== "string" || !j.access_token) throw new ErpError("auth", "Xero token: no access token in the answer");
      const refresh = typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : t.refresh_token;
      o.store.save({ access_token: j.access_token, expires_at: now() + Number(j.expires_in ?? 1800) * 1000, refresh_token: refresh });
      refused = null;
      return j.access_token;
    }),
    invalidate() {
      const t = o.store.load();
      refused = t?.access_token ?? null;
    },
  };
}

/** The adapter's settings from the environment (names only in errors, never values). */
export function xeroConfigFromEnv(env: Record<string, string | undefined>): XeroConfig {
  const tenantId = env.ERP_XERO_TENANT_ID?.trim();
  if (!tenantId) throw new ErpError("config", "ERP_XERO_TENANT_ID is not set");
  const status = env.ERP_XERO_JOURNAL_STATUS ?? "DRAFT";
  if (status !== "DRAFT" && status !== "POSTED") throw new ErpError("config", "ERP_XERO_JOURNAL_STATUS must be DRAFT or POSTED");
  const base = env.ERP_XERO_BASE_CURRENCY ?? "EUR";
  if (!/^[A-Z]{3}$/.test(base)) throw new ErpError("config", "ERP_XERO_BASE_CURRENCY must be a three-letter currency code");
  return { tenantId, baseUrl: XERO_API, baseCurrency: base, glMap: jsonMap(env, "ERP_XERO_GL_MAP", true), journalStatus: status };
}
