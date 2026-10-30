// Ask Purser (G), step 5, end to end: the CFO types on the phone; the relay queues the words (one message at a
// time); the runner reads them and answers on the ticket, with a task card proposal that waits for Face ID.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { askPurser } from "../src/agents/askPurser.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { viewKey } from "../src/relay/config.js";
import { sqlOver } from "../src/relay/local.js";
import { RelayRunner } from "../src/relay/runner.js";
import { Relay } from "../worker/src/core.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-10-30T10:00:00Z");
const MSG = "Book a flight to Berlin for the trade fair on 12 November, at most €250";
const post = (relay: Relay, body: unknown, headers: Record<string, string> = {}) => relay.fetch(new Request(`${BASE}/api/ask`, {
  method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": viewKey(TOKEN), ...headers }, body: JSON.stringify(body),
}));

function world(withAsk = true) {
  const db = openDb(":memory:");
  const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0 });
  const runner = new RelayRunner({
    db, cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now: () => t0,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => relay.fetch(new Request(input, init))) as typeof fetch,
    execute: async () => undefined, log: () => undefined,
    ...(withAsk ? { ask: (text: string) => askPurser(db, new Tools(db, new ClaudeReader(db, null)), text, t0) } : {}),
  });
  return { db, relay, runner };
}

describe("Ask Purser from the phone", () => {
  it("answers on the ticket with the task card proposal, which waits for Face ID", async () => {
    const { db, relay, runner } = world();
    await runner.syncOnce();
    const sent = await post(relay, { text: MSG });
    expect(sent.status).toBe(202);
    const { ticket } = (await sent.json()) as { ticket: string };
    await runner.syncOnce();
    await runner.idle();
    await runner.syncOnce();
    const t = (await (await relay.fetch(new Request(`${BASE}/api/tickets/${ticket}`, { headers: { "x-kit11-view": viewKey(TOKEN) } }))).json()) as { status: string; message: string };
    expect(t).toMatchObject({ status: "answered" });
    expect(t.message).toMatch(/^I proposed P-0001: a single-use flight card, at most 250\.00 EUR/);
    expect(db.prepare("SELECT kind, status FROM proposals").all()).toEqual([{ kind: "task_card", status: "PENDING_APPROVAL" }]);
  });

  // Breaks if the relay takes more than one message at a time, overlong text, or a post from another site.
  it("takes one message at a time, at most 500 characters, only from its own pages", async () => {
    const { relay, runner } = world();
    await runner.syncOnce();
    expect((await post(relay, { text: "x".repeat(501) })).status).toBe(400);
    expect((await post(relay, { text: "" })).status).toBe(400);
    expect((await post(relay, { text: MSG }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(relay, { text: MSG })).status).toBe(202);
    expect((await post(relay, { text: MSG }, { "cf-connecting-ip": "10.9.9.9" })).status).toBe(429);
  });

  it("refuses on the ticket when the runner does not take chat messages", async () => {
    const { relay, runner } = world(false);
    await runner.syncOnce();
    const { ticket } = (await (await post(relay, { text: MSG })).json()) as { ticket: string };
    await runner.syncOnce();
    await runner.idle();
    await runner.syncOnce();
    const t = (await (await relay.fetch(new Request(`${BASE}/api/tickets/${ticket}`, { headers: { "x-kit11-view": viewKey(TOKEN) } }))).json()) as { status: string; message: string };
    expect(t).toMatchObject({ status: "refused", message: expect.stringMatching(/does not take chat messages/) });
  });
});
