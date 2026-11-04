// Re-checks the Airwallex side of the ledger against Airwallex itself (read-only): every booked chain credit
// is a settled deposit whose reference is its tx hash, and every executed invoice payment's conversion and
// transfer are exactly the ones the approved terms describe, carrying the approval hash in their metadata.

import { cents } from "./adapter.js";
import type { Airwallex } from "./client.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { termsHash, type Terms } from "../lib/terms.js";
import type { InvoicePaymentTerms } from "../agents/euroBill.js";

export type Check = { level: "ok" | "FAIL" | "note"; what: string; detail: string };

type Get = (path: string, query?: Record<string, string>) => Promise<unknown>;
type Items<T> = { items: T[]; has_more?: boolean };
type AwxDeposit = { id: string; amount: number | string; currency: string; reference?: string | null; status: string };
type AwxConversion = { conversion_id: string; request_id: string; quote_id?: string; status: string; buy_amount: number | string; sell_amount: number | string; metadata?: Record<string, string> | null };
type AwxTransfer = {
  id: string; request_id: string; status: string; transfer_amount: number | string; transfer_currency: string; beneficiary_id?: string;
  reference?: string; metadata?: Record<string, string> | null; fee_amount?: number | string | null; fee_currency?: string | null;
};

export const getVia = (api: Airwallex): Get => (path, query) => api.call("GET", path, undefined, query);

const differences = (pairs: [string, unknown, unknown][]) =>
  pairs.filter(([, got, want]) => String(got) !== String(want)).map(([k, got, want]) => `${k} ${String(got)} != ${String(want)}`);

export async function verifyAirwallex(db: DB, get: Get): Promise<Check[]> {
  const out: Check[] = [];
  const add = (level: Check["level"], what: string, detail = "") => out.push({ level, what, detail });

  const credits = db.prepare("SELECT event_key, tx_hash, amount_base_units, awx_deposit_id, created_at FROM chain_credits WHERE awx_deposit_id IS NOT NULL").all() as
    { event_key: string; tx_hash: string; amount_base_units: string; awx_deposit_id: string; created_at: string }[];
  for (const c of credits) {
    const since = new Date(Date.parse(c.created_at) - 24 * 3600 * 1000).toISOString();
    let found: AwxDeposit | undefined;
    for (let page = 0; !found; page++) {
      const r = (await get("/deposits", { from_created_at: since, page_num: String(page), page_size: "100" })) as Items<AwxDeposit>;
      found = r.items.find((d) => d.id === c.awx_deposit_id);
      if (!r.has_more) break;
    }
    if (!found) { add("FAIL", `deposit ${c.awx_deposit_id}`, "not found in Airwallex"); continue; }
    const diff = differences([
      ["reference", found.reference, c.tx_hash],
      ["amount", fromCents(cents(found.amount)), fromCents(baseUnitsToCents(BigInt(c.amount_base_units)))],
      ["currency", found.currency, "USD"],
      ["status", found.status, "SETTLED"],
    ]);
    add(diff.length ? "FAIL" : "ok", `deposit ${c.awx_deposit_id}`, diff.length ? diff.join("; ") : `USD ${fromCents(cents(found.amount))}, reference = tx ${c.tx_hash.slice(0, 12)}…, SETTLED`);
  }

  const executed = db.prepare("SELECT proposal_id, terms_json, terms_sha256 FROM proposals WHERE kind = 'invoice_payment' AND status = 'EXECUTED'").all() as
    { proposal_id: string; terms_json: string; terms_sha256: string }[];
  for (const p of executed) {
    const t = JSON.parse(p.terms_json) as InvoicePaymentTerms;
    const sha = p.terms_sha256;
    if (termsHash(t as Terms) !== sha) { add("FAIL", `${p.proposal_id} terms`, "stored terms no longer hash to the approved hash"); continue; }

    if (t.conversion) {
      const c = t.conversion;
      const r = (await get("/fx/conversions", { request_id: c.request_id, page_num: "0", page_size: "10" })) as Items<AwxConversion>;
      const hits = r.items.filter((x) => x.request_id === c.request_id);
      if (hits.length !== 1) add("FAIL", `${p.proposal_id} conversion`, `${hits.length} conversions with request_id ${c.request_id}`);
      else {
        const x = hits[0]!;
        const diff = differences([
          ["quote_id", x.quote_id ?? c.quote_id, c.quote_id],
          ["buy_amount", fromCents(cents(x.buy_amount)), c.buy_amount],
          ["sell_amount", fromCents(cents(x.sell_amount)), c.sell_amount],
          ["status", x.status, "SETTLED"],
          ...(x.metadata ? [["metadata.approval_sha256", x.metadata.approval_sha256, sha] as [string, unknown, unknown]] : []),
        ]);
        add(diff.length ? "FAIL" : "ok", `${p.proposal_id} conversion ${x.conversion_id}`, diff.length ? diff.join("; ") : `EUR ${c.buy_amount} for USD ${c.sell_amount} on quote ${c.quote_id.slice(0, 8)}…, SETTLED`);
      }
    }

    const r = (await get("/transfers", { request_id: t.transfer_request_id, page_num: "0", page_size: "10" })) as Items<AwxTransfer>;
    const hits = r.items.filter((x) => x.request_id === t.transfer_request_id);
    if (hits.length !== 1) { add("FAIL", `${p.proposal_id} transfer`, `${hits.length} transfers with request_id ${t.transfer_request_id}`); continue; }
    const x = hits[0]!;
    const diff = differences([
      ["amount", fromCents(cents(x.transfer_amount)), t.amount],
      ["currency", x.transfer_currency, t.currency],
      ["beneficiary_id", x.beneficiary_id, t.beneficiary_id],
      ["reference", x.reference, t.reference],
      ["metadata.approval_sha256", x.metadata?.approval_sha256, sha],
      ["status", x.status, "PAID"],
    ]);
    add(diff.length ? "FAIL" : "ok", `${p.proposal_id} transfer ${x.id}`, diff.length ? diff.join("; ") : `EUR ${t.amount} to ${t.beneficiary_name}, approval hash in metadata, PAID`);

    if (x.fee_amount != null) {
      const fee = `${x.fee_currency} ${fromCents(cents(x.fee_amount))}`;
      // Terms before the fee ceiling carried an estimate ("fee"), which the real fee may exceed.
      const ceiling = (t as { fee_max?: string }).fee_max;
      const est = (t as { fee?: string }).fee;
      if (ceiling) add(x.fee_currency === "EUR" && cents(x.fee_amount) <= toCents(ceiling) ? "ok" : "FAIL", `${p.proposal_id} fee`, `${fee}, ceiling EUR ${ceiling}`);
      else add("note", `${p.proposal_id} fee`, `${fee}; the terms estimated EUR ${est ?? "?"} (approved before the fee ceiling existed)`);
    }
  }
  return out;
}
