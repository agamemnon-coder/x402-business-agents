// P2 end to end: the CFO writes the policy on the phone; the relay queues the words; the runner has Opus draft rules,
// checks each one (from the phone they may only tighten), and answers on the ticket with the proposal that now waits
// for Face ID. Nothing is applied on the way.
import Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { draftPolicyFromText, draftSummary } from "../src/policy/fromText.js";
import { policyValue } from "../src/policy/rules.js";
import { viewKey } from "../src/relay/config.js";
import { sqlOver } from "../src/relay/local.js";
import { RelayRunner } from "../src/relay/runner.js";
import { Relay } from "../worker/src/core.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-03T10:00:00Z");
const TEXT = "Het sourcing-agent kaartje hooguit €20 per aankoop. Treasury mag €40 per aankoop.";

const fake = (parsed: unknown): Anthropic => ({
  beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: parsed }) } },
}) as unknown as Anthropic;

describe("policy in plain words from the phone (P2)", () => {
  it("drafts on the runner, refuses loosening, and leaves a proposal for Face ID", async () => {
    const db = openDb(":memory:");
    const tools = new Tools(db, new ClaudeReader(db, fake({
      changes: [
        { key: "card.sourcing.per_tx", to: "20.00", quote: "hooguit €20 per aankoop", why: "sourcing card per purchase" },
        { key: "card.treasury.per_tx", to: "40.00", quote: "Treasury mag €40 per aankoop", why: "treasury card per purchase" },
      ],
      not_mapped: [], questions: [],
    })));
    const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0 });
    const runner = new RelayRunner({
      db, cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now: () => t0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => relay.fetch(new Request(input, init))) as typeof fetch,
      execute: async () => undefined, log: () => undefined,
      draftPolicy: async (text) => {
        const r = await draftPolicyFromText(db, tools, text, t0, { tightenOnly: true });
        return { proposalId: r.proposal?.proposal_id ?? null, message: draftSummary(r) };
      },
    });
    await runner.syncOnce();
    const sent = await relay.fetch(new Request(`${BASE}/api/policy-text`, {
      method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": viewKey(TOKEN) }, body: JSON.stringify({ text: TEXT }),
    }));
    expect(sent.status).toBe(202);
    const { ticket } = (await sent.json()) as { ticket: string };
    await runner.syncOnce();
    await runner.idle();
    await runner.syncOnce();
    const t = (await (await relay.fetch(new Request(`${BASE}/api/tickets/${ticket}`, { headers: { "x-kit11-view": viewKey(TOKEN) } }))).json()) as { status: string; message: string };
    expect(t.status).toBe("drafted");
    expect(t.message).toMatch(/^P-0001 waits for your Face ID: Sourcing agent's card: most per purchase: 30\.00 → 20\.00\./);
    expect(t.message).toMatch(/would loosen the policy/);
    const p = db.prepare("SELECT status, created_by, terms_json FROM proposals").all() as { status: string; created_by: string; terms_json: string }[];
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ status: "PENDING_APPROVAL", created_by: "claude" });
    expect(JSON.parse(p[0]!.terms_json).changes).toHaveLength(1);
    expect(policyValue(db, "card.sourcing.per_tx")).toBe("30.00");
  });

  it("answers 'refused' when nothing became a rule, and when the runner cannot draft", async () => {
    const db = openDb(":memory:");
    const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0 });
    const mk = (draftPolicy?: (text: string) => Promise<{ proposalId: string | null; message: string }>) => new RelayRunner({
      db, cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now: () => t0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => relay.fetch(new Request(input, init))) as typeof fetch,
      execute: async () => undefined, log: () => undefined, draftPolicy,
    });
    const send = async () => {
      const res = await relay.fetch(new Request(`${BASE}/api/policy-text`, {
        method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": viewKey(TOKEN), "cf-connecting-ip": `10.9.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ text: TEXT }),
      }));
      return ((await res.json()) as { ticket: string }).ticket;
    };
    const status = async (ticket: string) => ((await (await relay.fetch(new Request(`${BASE}/api/tickets/${ticket}`, { headers: { "x-kit11-view": viewKey(TOKEN) } }))).json()) as { status: string; message: string });
    for (const [runner, expected] of [[mk(), /does not draft rules/], [mk(async () => ({ proposalId: null, message: "No rule came out of this text" })), /No rule came out/]] as const) {
      await runner.syncOnce();
      const ticket = await send();
      await runner.syncOnce();
      await runner.idle();
      await runner.syncOnce();
      const s = await status(ticket);
      expect(s.status).toBe("refused");
      expect(s.message).toMatch(expected);
    }
  });
});
