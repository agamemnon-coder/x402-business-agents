// npm run awx-readback: every full Airwallex id a juror can see in the docs, read back from the Airwallex sandbox with
// GET only (requirements QA, 1 November: "read-only GET of every Airwallex id"). Prints and records the object kind,
// status and amount; nothing else (no names, no bank details). Writes docs/runs/airwallex-readback.json.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Airwallex, fromEnv } from "../airwallex/client.js";

const repo = resolve(import.meta.dirname, "../..");
const SOURCES = ["docs/airwallex.md", "docs/requirements-matrix.md", "docs/metal-award.md", "docs/data-qa.md", "docs/demo/snapshot.json", "docs/claims.md"];
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

const cfg = fromEnv();
if (!cfg) { console.error("needs the Airwallex sandbox keys (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY); nothing was read"); process.exit(2); }
const api = new Airwallex(cfg);

const where = new Map<string, Set<string>>();
for (const f of SOURCES) {
  let text: string;
  try { text = readFileSync(resolve(repo, f), "utf8"); } catch { continue; }
  for (const id of text.match(UUID) ?? []) (where.get(id) ?? where.set(id, new Set()).get(id)!).add(f);
}

type Found = { id: string; kind: string; status: string; amount: string; shown_in: string[] };
const tryGet = async (path: string): Promise<Record<string, unknown> | null> => {
  try { return await api.call<Record<string, unknown>>("GET", path); } catch { return null; }
};
// Deposits have no GET by id: list them since 25 October and match.
const deposits = new Map<string, Record<string, unknown>>();
for (let page = 0; page < 50; page++) {
  const r = await api.call<{ items: Record<string, unknown>[]; has_more?: boolean }>("GET", "/deposits", undefined, { from_created_at: "2026-10-25T00:00:00Z", page_num: String(page), page_size: "100" }).catch(() => null);
  if (!r) break;
  for (const d of r.items) deposits.set(String(d.id), d);
  if (!r.has_more) break;
}

// Card transactions are found through the list (data-qa did the same); some ids do not answer a GET by id.
const cardTx = new Map<string, Record<string, unknown>>();
for (let page = 0; page < 50; page++) {
  const r = await api.call<{ items: Record<string, unknown>[]; has_more?: boolean }>("GET", "/issuing/transactions", undefined, { from_created_at: "2026-10-25T00:00:00Z", page_num: String(page), page_size: "100" }).catch(() => null);
  if (!r) break;
  for (const t of r.items) for (const k of ["transaction_id", "id"]) if (t[k]) cardTx.set(String(t[k]), t);
  if (!r.has_more) break;
}

const out: Found[] = [];
const missing: { id: string; shown_in: string[] }[] = [];
for (const [id, files] of where) {
  const shown_in = [...files];
  const conv = await tryGet(`/fx/conversions/${id}`);
  if (conv) { out.push({ id, kind: "conversion", status: String(conv.status), amount: `${String(conv.buy_amount)} ${String(conv.buy_currency)} for ${String(conv.sell_amount)} ${String(conv.sell_currency)}`, shown_in }); continue; }
  const tr = await tryGet(`/transfers/${id}`);
  if (tr) { out.push({ id, kind: "transfer", status: String(tr.status), amount: `${String(tr.transfer_amount)} ${String(tr.transfer_currency)}`, shown_in }); continue; }
  const tx = await tryGet(`/issuing/transactions/${id}`);
  if (tx) { out.push({ id, kind: "card transaction", status: String(tx.status), amount: `${String(tx.transaction_amount ?? tx.billing_amount)} ${String(tx.transaction_currency ?? tx.billing_currency)}`, shown_in }); continue; }
  const listed = cardTx.get(id);
  if (listed) { out.push({ id, kind: "card transaction", status: String(listed.status), amount: `${String(listed.transaction_amount ?? listed.billing_amount)} ${String(listed.transaction_currency ?? listed.billing_currency)}`, shown_in }); continue; }
  // A beneficiary: only that it exists (its bank details stay at Airwallex, never printed).
  const ben = await tryGet(`/beneficiaries/${id}`);
  if (ben) { out.push({ id, kind: "beneficiary", status: "exists", amount: "-", shown_in }); continue; }
  const quote = await tryGet(`/fx/quotes/${id}`);
  if (quote) { out.push({ id, kind: "quote", status: String(quote.status ?? "found"), amount: `${String(quote.buy_amount)} ${String(quote.buy_currency)}`, shown_in }); continue; }
  const dep = deposits.get(id);
  if (dep) { out.push({ id, kind: "deposit", status: String(dep.status), amount: `${String(dep.amount)} ${String(dep.currency)}`, shown_in }); continue; }
  missing.push({ id, shown_in });
}

for (const f of out) console.log(`ok    ${f.kind.padEnd(16)} ${f.id}  ${f.status}  ${f.amount}`);
for (const m of missing) console.log(`NONE  ${m.id}  (not found at Airwallex as a conversion, transfer, card transaction, beneficiary, quote or deposit; a quote expires; shown in ${m.shown_in.join(", ")})`);
writeFileSync(resolve(repo, "docs/runs/airwallex-readback.json"), JSON.stringify({ read_at: new Date().toISOString(), method: "GET only, Airwallex sandbox", found: out, not_found: missing }, null, 2) + "\n");
console.log(`\n${out.length} ids read back, ${missing.length} not found; docs/runs/airwallex-readback.json`);
