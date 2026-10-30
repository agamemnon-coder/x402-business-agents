// Chaos per outside service (hardening item 4): when Anthropic, the relay, Metal's RPC or Airwallex fails, nothing
// moves by accident, nothing is recorded twice, and the work goes on once the service is back.
import type Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { askPurser } from "../src/agents/askPurser.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { cardRows, pollCardTransactions, setupCards } from "../src/policy/cards.js";
import { pollQuarantine, setupReceivePolicy } from "../src/policy/quarantine.js";
import { sqlOver } from "../src/relay/local.js";
import { RelayRunner } from "../src/relay/runner.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { FakeReceivePolicy } from "../src/redteam/receivePolicy.js";
import { Relay } from "../worker/src/core.js";

const now = new Date("2026-10-30T10:00:00Z");

describe("Anthropic fails", () => {
  // Breaks if a failed model call stops the agent or is used half-way: the plain parser decides, and it is logged.
  it("falls back to the plain parser on an overloaded or unreachable API, and logs why", async () => {
    const db = openDb(":memory:");
    for (const err of [Object.assign(new Error("Overloaded"), { status: 529 }), new Error("fetch failed: ECONNRESET")]) {
      const client = { beta: { messages: { parse: async () => { throw err; } } } } as unknown as Anthropic;
      const r = await askPurser(db, new Tools(db, new ClaudeReader(db, client)), "Book a flight to Berlin, at most €250", now);
      expect(r.proposalId).toMatch(/^P-\d{4}$/);
    }
    const notes = (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'claude.fallback'").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json).note as string);
    expect(notes.some((n) => /call failed/.test(n))).toBe(true);
  });
});

describe("the relay is unreachable", () => {
  it("fails the sync without changing the ledger, and syncs normally once the relay is back", async () => {
    const db = openDb(":memory:");
    const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: "t".repeat(64), now: () => now });
    let down = true;
    const runner = new RelayRunner({
      db, cfg: { url: "https://kit11.example.workers.dev", origin: "https://kit11.example.workers.dev", rpId: "kit11.example.workers.dev", token: "t".repeat(64) }, now: () => now,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => (down ? Promise.reject(new Error("connect ECONNREFUSED")) : relay.fetch(new Request(input, init)))) as typeof fetch,
      execute: async () => undefined, log: () => undefined,
    });
    const before = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    await expect(runner.syncOnce()).rejects.toThrow(/ECONNREFUSED/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(before);
    down = false;
    await runner.syncOnce();
    expect((await relay.fetch(new Request("https://kit11.example.workers.dev/api/snapshot", { headers: { "x-kit11-view": (await import("../src/relay/config.js")).viewKey("t".repeat(64)) } }))).status).toBe(200);
  });
});

describe("Metal's RPC fails during the quarantine poll", () => {
  it("records nothing and keeps its place, so the held payment is found once the RPC is back", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO metal_accounts (address, role) VALUES ('0x00000000000000000000000000000000000000b1', 'business'), ('0x00000000000000000000000000000000000000e1', 'sweep')").run();
    const rp = new FakeReceivePolicy();
    await setupReceivePolicy(db, rp, "sweep.key.json", now);
    rp.receive("0x00000000000000000000000000000000000000f9", "0x00000000000000000000000000000000000000e1", 10n ** 16n);
    const real = rp.quarantinedSince.bind(rp);
    rp.quarantinedSince = async () => { throw new Error("RPC 503"); };
    await expect(pollQuarantine(db, rp, now)).rejects.toThrow(/503/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM quarantines").get()).toEqual({ n: 0 });
    rp.quarantinedSince = real;
    expect(await pollQuarantine(db, rp, now)).toBe(1);
  });
});

describe("Airwallex fails", () => {
  it("issues no task card when Airwallex does not answer, and says nothing was charged", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.createCard = async () => { throw new Error("Airwallex 503 Service Unavailable"); };
    const r = await askPurser(db, new Tools(db, new ClaudeReader(db, null)), "Book a flight to Berlin, at most €250", now, { rail: awx });
    expect(r).toMatchObject({ proposalId: null, taskId: null, reply: expect.stringMatching(/did not issue the card.*Nothing was charged/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM task_cards").get()).toEqual({ n: 0 });
  });

  it("finds a card charge whose webhook was lost with the next poll, and records it once", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const t = await awx.simulateCardCharge({ cardId: cardRows(db)[0]!.card_id, amountCents: 1999, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get()).toEqual({ n: 0 });
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await pollCardTransactions(db, awx, later)).toBe(1);
    expect(await pollCardTransactions(db, awx, later)).toBe(0);
    expect(db.prepare("SELECT transaction_id FROM card_transactions").all()).toEqual([{ transaction_id: t.transactionId }]);
  });
});
