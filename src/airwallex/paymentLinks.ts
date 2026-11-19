// The seller side: a payment link for one open receivable (Airwallex Payment Links, sandbox only, test money; docs:
// api/payments/payment_links, read 19 November 2026). Northwind invoices a retailer; Purser asks Airwallex for a
// single-use link for exactly that invoice (fixed amount and currency, the invoice number as reference and metadata), so
// the customer can pay by card on Airwallex's hosted page. When the invoice is paid by any route (the link, or a bank
// transfer to a Global Account that the receivables agent matched), Purser switches the link off, so nobody can pay
// the same invoice twice.
//   POST /api/v1/pa/payment_links/create             fixed pricing, reusable false
//   GET  /api/v1/pa/payment_links/{id}               read back: amount, currency, reference, active
//   POST /api/v1/pa/payment_links/{id}/deactivate    once the receivable is no longer open
// Nothing here moves money; the hosted checkout page is the customer's, in a browser.

import type { Airwallex } from "./client.js";
import { fromCents, toCents } from "../lib/money.js";

export interface PaymentLink { id: string; url: string; active: boolean; status: string; amountCents: number; currency: string; reference: string | null; reusable: boolean; invoiceNo: string | null; paidCount: number }
type RawLink = { id: string; url?: string; active?: boolean; status?: string; amount?: number | string; currency?: string; reference?: string | null; reusable?: boolean; metadata?: Record<string, unknown> | null; successful_payment_intent_count?: number };

export function toLink(r: RawLink): PaymentLink {
  const meta = r.metadata?.invoice_no;
  return {
    id: r.id, url: r.url ?? "", active: r.active === true, status: r.status ?? "", amountCents: toCents(Number(r.amount ?? 0).toFixed(2)), currency: (r.currency ?? "").toUpperCase(),
    reference: r.reference ?? null, reusable: r.reusable === true, invoiceNo: typeof meta === "string" ? meta : null, paidCount: r.successful_payment_intent_count ?? 0,
  };
}

export interface OpenReceivable { invoice_no: string; customer: string; currency: string; amount_cents: number; due_date: string }

/** A single-use link for exactly this receivable. Refuses a non-positive amount or a due date in the past. */
export async function createInvoiceLink(api: Pick<Airwallex, "call">, r: OpenReceivable, now = new Date()): Promise<PaymentLink> {
  if (!(r.amount_cents > 0)) throw new Error(`${r.invoice_no}: a payment link needs a positive amount; nothing was sent`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due_date) || Date.parse(`${r.due_date}T23:59:59Z`) < now.getTime()) throw new Error(`${r.invoice_no}: the due date ${r.due_date} has passed; nothing was sent`);
  return toLink(await api.call<RawLink>("POST", "/pa/payment_links/create", {
    title: `Invoice ${r.invoice_no}`, reusable: false, amount: Number(fromCents(r.amount_cents)), currency: r.currency, reference: r.invoice_no,
    description: `Northwind Outdoor invoice ${r.invoice_no} to ${r.customer} (sandbox, test money)`, expires_at: `${r.due_date}T23:59:59+0000`,
    metadata: { invoice_no: r.invoice_no, issuer: "purser" },
  }));
}

export async function getLink(api: Pick<Airwallex, "call">, id: string): Promise<PaymentLink> {
  return toLink(await api.call<RawLink>("GET", `/pa/payment_links/${encodeURIComponent(id)}`));
}

/** Differences between a link and the receivable it was made for (empty when it is exactly that invoice). */
export function linkDifferences(l: PaymentLink, r: OpenReceivable): string[] {
  const d: string[] = [];
  if (l.amountCents !== r.amount_cents) d.push(`amount ${fromCents(l.amountCents)} ≠ ${fromCents(r.amount_cents)}`);
  if (l.currency !== r.currency) d.push(`currency ${l.currency} ≠ ${r.currency}`);
  if (l.reference !== r.invoice_no) d.push(`reference ${l.reference ?? "none"} ≠ ${r.invoice_no}`);
  if (l.reusable) d.push("the link is reusable; one invoice is paid once");
  return d;
}

/**
 * Switches the link off once its receivable is no longer open (PAID, PARTIAL paid by other means, or written off).
 * Refuses while the receivable is still OPEN: the customer may still need the link.
 */
export async function retireLink(api: Pick<Airwallex, "call">, id: string, receivableStatus: string): Promise<PaymentLink> {
  if (receivableStatus === "OPEN") throw new Error("the receivable is still open; its payment link stays on");
  return toLink(await api.call<RawLink>("POST", `/pa/payment_links/${encodeURIComponent(id)}/deactivate`, {}));
}
