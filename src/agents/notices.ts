// Reading the supplier's price notice. This deterministic parser is the fallback the Claude layer
// replaces; either way, code checks the extracted price against the supplier's live 402 offer.

import { toCents } from "../lib/money.js";

export interface PriceNotice {
  supplier: string;
  old_price: string;
  new_price: string;
  effective_at: string | null;
  quote_excerpt: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parsePriceNoticeFallback(text: string): PriceNotice {
  const m = /costs\s+(\d+\.\d{2})\s+\*USDZ\s+instead of\s+(\d+\.\d{2})\s+\*USDZ/i.exec(text.replace(/\s+/g, " "));
  if (!m) throw new Error("price notice: no 'costs X instead of Y' sentence found");
  const supplier = /^From:.*@([a-z0-9-]+)\./im.exec(text)?.[1] ?? "unknown";
  const w = /From (\d{1,2}) (\w+) (\d{4}), (\d{2}):(\d{2}) UTC/.exec(text.replace(/\s+/g, " "));
  const month = w ? MONTHS.indexOf(w[2]!.toLowerCase()) : -1;
  return {
    supplier,
    new_price: m[1]!,
    old_price: m[2]!,
    effective_at: w && month >= 0 ? new Date(Date.UTC(Number(w[3]), month, Number(w[1]), Number(w[4]), Number(w[5]))).toISOString() : null,
    quote_excerpt: m[0],
  };
}

/** The real price is whatever the supplier's next offer says. A notice that disagrees escalates. */
export function crossCheckNotice(notice: PriceNotice, liveCents: number): { ok: true } | { ok: false; reason: string } {
  return toCents(notice.new_price) === liveCents
    ? { ok: true }
    : { ok: false, reason: `notice says ${notice.new_price}, live offer says ${(liveCents / 100).toFixed(2)}` };
}
