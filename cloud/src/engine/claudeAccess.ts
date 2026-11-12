// Claude for a company's engine in the Worker (src/engine/budget.ts ClaudeAccess), made by its Durable Object's host
// (./hostWorker.ts). Off unless the Worker's var ENGINE_CLAUDE is "on". With it on: no key, no reservation (no_key);
// with the key, every action that may ask Claude reserves its ceiling in D1 (./spend.ts) under the switches the owner
// set, reads with the visitor's client (a 30 s timeout, no SDK retries), at most 4,000 tokens an answer, and writes a
// claude.asking row before each call. The switches and the company's pool come from lane C (cloud/src/try): until it
// lands, the stand-ins below say nothing is set, so Claude is off (switch_off) and nothing is spent.
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeReader } from "../../../src/claude/reader.js";
import { tryClaudeClient, type ClaudeAccess } from "../../../src/engine/budget.js";
import type { Sql } from "../store.js";
import { d1Spend } from "./spend.js";

/** The most an answer may hold for a visitor's company (the agents' turns get 2,000 with task A6). */
export const READER_MAX_TOKENS = 4_000;

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
    reserve: async () => (client ? (await spend()).reserve() : { ok: false, reason: "no_key" }),
    reader: (db, budget) => new ClaudeReader(db, client, Date.now, {}, { budget, maxTokens: READER_MAX_TOKENS, announce: true }),
    status: async () => (client ? (await spend()).status() : { on: false, cap_micros: null }),
  };
}
