// What one Claude call costs, from its token usage and Anthropic's published prices (src/claude/pricing.ts).
// Integer micro-dollars throughout, so totals add up exactly.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { callCostMicros, PRICES } from "../src/claude/pricing.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb } from "../src/db/open.js";
import { z } from "zod";

describe("the cost of a Claude call (src/claude/pricing.ts)", () => {
  // Breaks if a price is mistyped or cache reads are priced like fresh input.
  it("prices input, cache writes, cache reads and output per model, in micro-dollars", () => {
    // Opus 5.5: $4 in, $5 5-minute cache write, $0.20 cache read, $20 out per million tokens.
    expect(callCostMicros("claude-opus-5-5", { input: 1000, output: 500, cache_read: 2000, cache_write: 100 })).toBe(4000 + 10000 + 400 + 500);
    // Sonnet 5.5: $2, $2.50, $0.10, $10.
    expect(callCostMicros("claude-sonnet-5-5", { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 })).toBe(2_000_000);
    expect(callCostMicros("claude-sonnet-5-5", { input: 0, output: 0, cache_read: 1_000_000, cache_write: 0 })).toBe(100_000);
    // Haiku 5.5 up to 100,000 prompt tokens: $0.10 in, $0.50 out.
    expect(callCostMicros("claude-haiku-5-5", { input: 10_000, output: 1000, cache_read: 0, cache_write: 0 })).toBe(1000 + 500);
  });

  // Breaks if Haiku's long-prompt prices are ignored: the prompt counts input, cache reads and cache writes.
  it("charges Haiku's higher prices when the whole prompt is over 100,000 tokens", () => {
    expect(callCostMicros("claude-haiku-5-5", { input: 60_000, output: 1000, cache_read: 50_000, cache_write: 0 })).toBe(30_000 + 2500 + 2500);
  });

  it("rounds a fraction of a micro-dollar up, and knows no price for an unknown model", () => {
    expect(callCostMicros("claude-haiku-5-5", { input: 1, output: 0, cache_read: 0, cache_write: 0 })).toBe(1);
    expect(callCostMicros("claude-unknown-9", { input: 1, output: 1, cache_read: 0, cache_write: 0 })).toBeNull();
    expect(Object.keys(PRICES).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  // Breaks if the audit row stops carrying latency or cost: the "Powered by Claude" panel reads them.
  it("records latency and cost with every Claude reading", async () => {
    const db = openDb(":memory:");
    let t = 1000;
    const client = { beta: { messages: { parse: async (p: { model: string }) => {
      t += 850;
      return { model: p.model, stop_reason: "end_turn", stop_details: null, parsed_output: { ok: true },
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 } };
    } } } } as unknown as Anthropic;
    const reader = new ClaudeReader(db, client, () => t);
    await reader.ask({ task: "t", role: "review", actor: "treasury", schema: z.object({ ok: z.boolean() }), instruction: "i", document: "d" }, () => ({ ok: false }));
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'claude.read'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ model: "claude-opus-5-5", latency_ms: 850, cost_usd_micros: 14_900, usage: { input: 1000, output: 500, cache_read: 2000, cache_write: 100 } });
  });
});

describe("the Claude summary on the dashboard (snapshot.claude)", () => {
  // Breaks if the panel's numbers stop coming from the audit rows: calls per model, average latency, cost, and the
  // AI cost per €1,000 of euro payments (approved card spend plus paid euro transfers).
  it("sums calls, latency and cost per model, and prices AI per €1,000 of euro payments", async () => {
    const { audit } = await import("../src/audit/log.js");
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const db = openDb(":memory:");
    const read = (model: string, latency: number, cost: number) => audit(db, "treasury", "claude.read", "t", { model, latency_ms: latency, cost_usd_micros: cost, usage: { input: 1, output: 1, cache_read: 0, cache_write: 0 } });
    read("claude-haiku-5-5", 400, 100);
    read("claude-haiku-5-5", 600, 300);
    read("claude-sonnet-5-5", 2000, 9000);
    read("claude-opus-5-5", 5000, 15_000);
    // An older recording: usage but no latency or cost; the cost comes from its usage, the latency stays unknown.
    audit(db, "treasury", "claude.read", "t", { model: "claude-sonnet-5-5", usage: { input: 1000, output: 100, cache_read: 0 } });
    audit(db, "treasury", "claude.fallback", "t", { model: "claude-opus-5-5", note: "no key" });
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('I-1', 'v', '1500.00', 'EUR', '2026-11-01', 'h', 'b', 'd', 'PAID')").run();
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('t1', 'r1', 'I-1', '1500.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'h', '2026-10-30T00:00:00Z')").run();
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('t2', 'r2', 'I-1', '999.00', 'EUR', 'SWIFT', '20.00', 'CANCELLED', 'h', '2026-10-30T00:00:00Z')").run();
    const c = buildSnapshot(db, new Date("2026-10-30T12:00:00Z")).claude;
    expect(c.calls).toBe(5);
    expect(c.fallbacks).toBe(1);
    expect(c.models.map((m) => [m.model, m.calls, m.avg_latency_ms, m.cost_usd_micros])).toEqual([
      ["Haiku 5.5", 2, 500, 400],
      ["Sonnet 5.5", 2, 2000, 9000 + 3000],
      ["Opus 5.5", 1, 5000, 15_000],
    ]);
    expect(c.cost_usd_micros).toBe(400 + 12_000 + 15_000);
    expect(c.per_call_usd_micros).toBe(Math.ceil(27_400 / 5));
    expect(c.eur_paid).toBe("1500.00");
    // 27,400 micro-dollars over €1,500 is 18,267 micro-dollars per €1,000, rounded up.
    expect(c.per_1000_eur_usd_micros).toBe(18_267);
  });

  it("has nothing to divide by without euro payments or calls", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const c = buildSnapshot(openDb(":memory:"), new Date("2026-10-30T12:00:00Z")).claude;
    expect(c).toMatchObject({ calls: 0, cost_usd_micros: 0, per_call_usd_micros: null, per_1000_eur_usd_micros: null, models: [] });
  });
});
