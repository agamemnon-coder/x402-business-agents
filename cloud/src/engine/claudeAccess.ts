// Claude for a company's engine in the Worker (src/engine/budget.ts ClaudeAccess), made by its Durable Object's host
// (./hostWorker.ts). Off unless the Worker's var ENGINE_CLAUDE is "on". With it on: no key, no reservation (no_key);
// with the key, every action that may ask Claude reserves its ceiling in D1 (./spend.ts) under the switches the owner
// set, reads with the visitor's client (a 30 s timeout, no SDK retries), at most 4,000 tokens an answer, and writes a
// claude.asking row before each call. The switches and the company's pool come from lane C (cloud/src/try): until it
// lands, the stand-ins below say nothing is set, so Claude is off (switch_off) and nothing is spent.
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeReader, MODELS } from "../../../src/claude/reader.js";
import { budgetedClient, tryClaudeClient, type ClaudeAccess } from "../../../src/engine/budget.js";
import type { Sql } from "../store.js";
import { d1Spend } from "./spend.js";

/** The most an answer may hold for a visitor's company (the agents' turns get 2,000: AGENT_MAX_TOKENS, task A6). */
export const READER_MAX_TOKENS = 4_000;

/**
 * The demo reads an invoice with the fastest model the product uses (Haiku, the classifier's), not the runner's Sonnet:
 * a visitor waits on every read, and the owner measured about 6.4 s a request on the live demo (12 Nov). Low effort and
 * no extended thinking, as every reader call.
 */
// 12 Nov: the review note written when a payment is filed (role review, Opus on the runner) is Haiku here too: the live
// panel showed Claude Opus for 17 s on Pay.
export const READER_MODELS = { act: MODELS.classify, review: MODELS.classify } as const;

/** Until lane C's readSwitches is wired in: no switch is set. */
export const noSwitches = async (): Promise<Record<string, unknown>> => ({});
/** Until lane C's tryScopes is wired in: a company made by the platform admin is in the smoke pool, with no address. */
export const smokePool = async (): Promise<{ pool: string; address: string | null }> => ({ pool: "smoke", address: null });

export function claudeAccess(o: {
  engineClaude: string | undefined;
  key: string | undefined;
  sql: Sql;
  tenantId: string;
  switches?: (sql: Sql) => Promise<Record<string, unknown>>;
  scopes?: (sql: Sql, tenantId: string) => Promise<{ pool: string; address: string | null }>;
  /** The Anthropic client from the key (the visitor's client; tests hand in one on a stand-in fetch). */
  client?: (key: string) => Anthropic;
}): ClaudeAccess | undefined {
  if (o.engineClaude !== "on") return undefined;
  const client = o.key ? (o.client ?? tryClaudeClient)(o.key) : null;
  const spend = async () => d1Spend(o.sql, await (o.switches ?? noSwitches)(o.sql), { tenantId: o.tenantId, ...(await (o.scopes ?? smokePool)(o.sql, o.tenantId)) });
  return {
    reserve: async (opts) => (client ? (await spend()).reserve(opts) : { ok: false, reason: "no_key" }),
    reader: (db, budget) => new ClaudeReader(db, client, Date.now, READER_MODELS, { budget, maxTokens: READER_MAX_TOKENS, announce: true }),
    // Task A6: the payables agents, on the same key and the same action's budget (each call's worst case first).
    agents: (budget) => (client ? budgetedClient(client, budget) : null),
    status: async () => (client ? (await spend()).status() : { on: false, cap_micros: null, spent_micros: null }),
  };
}
