// The transactions page and its JSON routes on the local payables app: loopback only, the strict content policy with a
// nonce, the register as JSON and CSV, filters checked, and an unknown id never echoed back.
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { payablesApp } from "../src/servers/payables.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
let dir: string;
let db: DB;
let base: string;
let close: () => void;

beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "tx-page-"));
  db = openDb(":memory:");
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('support', 'ch_1', 'card_1', '4242', 'support', 'EUR', 10000, 50000, 'ACTIVE', '2026-11-01', '2026-11-01')").run();
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('ctx_1', 'card_1', 'support', 'Helpdesk SaaS', '5734', 4900, 'EUR', 'APPROVED', 1, 'simulation', '2026-11-06T10:00:00Z', '2026-11-06T10:00:01Z')").run();
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, source, occurred_at, recorded_at) VALUES ('ctx_2', 'card_1', 'support', 'Casino', '7995', 9900, 'EUR', 'DECLINED', 0, 'merchant category not allowed', 'simulation', '2026-11-06T11:00:00Z', '2026-11-06T11:00:01Z')").run();
  const server = payablesApp(db, { inbox: { dir, reader: parserOnly }, rail: null }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  close = () => server.close();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { close(); rmSync(dir, { recursive: true, force: true }); });

describe("the transactions page", () => {
  it("is served with a nonce-only script policy and links back to the invoices", async () => {
    const res = await fetch(base + "/transactions");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[^']+' 'self'/);
    expect(csp).not.toContain("unsafe-inline' 'self'; connect");
    const html = await res.text();
    expect(html).toContain("<h1>Transacties</h1>");
    expect(html).toMatch(/<a href="\/transactions" aria-current="page">Transacties<\/a>/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1]!;
    expect(html).toContain(`<script type="module" nonce="${nonce}">`);
  });

  it("serves the register, filtered, and one row by id; an unknown id is not echoed", async () => {
    const j = await (await fetch(base + "/api/payables/transactions")).json() as { rows: { id: string; moved: boolean }[]; totals: { currency: string; out: string }[] };
    expect(j.rows.map((r) => [r.id, r.moved])).toEqual([["card:ctx_2", false], ["card:ctx_1", true]]);
    expect(j.totals).toEqual([expect.objectContaining({ currency: "EUR", out: "49.00", not_moved: 1 })]);
    const moved = await (await fetch(base + "/api/payables/transactions?moved=true")).json() as { rows: { id: string }[] };
    expect(moved.rows.map((r) => r.id)).toEqual(["card:ctx_1"]);
    expect((await fetch(base + "/api/payables/transactions?from=yesterday")).status).toBe(400);
    const one = await fetch(base + "/api/payables/transactions/" + encodeURIComponent("card:ctx_1"));
    expect(await one.json()).toMatchObject({ id: "card:ctx_1", counterparty: "Helpdesk SaaS", reconciliation: "missing_booking" });
    const miss = await fetch(base + "/api/payables/transactions/" + encodeURIComponent("<script>x</script>"));
    expect(miss.status).toBe(404);
    expect(await miss.text()).not.toContain("<script>");
  });

  it("exports the same rows as CSV and JSON", async () => {
    const list = await (await fetch(base + "/api/payables/transactions")).json() as { rows: { id: string }[] };
    const csv = await fetch(base + "/api/payables/export/transactions.csv");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    const lines = (await csv.text()).trimEnd().split("\r\n");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(list.rows.map((r) => r.id));
    const json = await (await fetch(base + "/api/payables/export/transactions.json")).json() as { rows: { id: string }[] };
    expect(json.rows.map((r) => r.id)).toEqual(list.rows.map((r) => r.id));
  });
});
