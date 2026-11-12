// Claude in the engine under hard ceilings (src/engine/budget.ts, the reader's options in src/claude/reader.ts). The
// Anthropic client runs on a stand-in fetch with canned answers: no request leaves the process, and no key is real.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeReader, MODELS, PDF_PAGES_BOUND } from "../src/claude/reader.js";
import { SCAN_MAX_PAGES } from "../src/ap/scan.js";
import { callCostMicros } from "../src/claude/pricing.js";
import { openDb, type DB } from "../src/db/open.js";
import { useDocStore } from "../src/ap/docStore.js";
import { actionBudget, tryClaudeClient, worstCaseMicros, type ClaudeAccess, type CappedReason } from "../src/engine/budget.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { parseApFallback } from "../src/ap/reading.js";

/** Answers each of the inbox's calls in the shape it asks for: a classification, or the invoice's reading. */
const inboxAnswer = (keys: string[]) => (keys.includes("kind") ? { kind: "invoice" } : keys.includes("iban") ? parseApFallback(EN) : { note: "" });

const Reading = z.object({ vendor: z.string(), total: z.string() });
const fallback = () => ({ vendor: "from the parser", total: "0.00" });
const ask = { task: "ap.read:test", role: "act" as const, actor: "treasury" as const, schema: Reading, instruction: "Read this invoice.", document: "Bergtex Textil GmbH, total EUR 1,850.00" };

interface Seen { model: string; max_tokens: number; chars: number; fallbacks?: unknown; beta: string | null }
/** A fetch that answers every call with a reading and the usage `usage(body)` says, and records what it was asked. */
function standIn(usage: (b: { max_tokens: number; chars: number }) => { input: number; output: number } = () => ({ input: 1200, output: 80 }), answer: (schemaKeys: string[]) => unknown = () => ({ vendor: "Bergtex Textil GmbH", total: "1850.00" })) {
  const seen: Seen[] = [];
  let n = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const body = (await req.json()) as { model: string; max_tokens: number; fallbacks?: unknown; output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } };
    const chars = JSON.stringify(body).length;
    seen.push({ model: body.model, max_tokens: body.max_tokens, chars, fallbacks: body.fallbacks, beta: req.headers.get("anthropic-beta") });
    const u = usage({ max_tokens: body.max_tokens, chars });
    return new Response(JSON.stringify({
      id: `msg_${++n}`, type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(answer(Object.keys(body.output_config?.format?.schema?.properties ?? {}))) }],
      usage: { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": `req_stand_in_${n}` } });
  }) as typeof fetch;
  return { client: new Anthropic({ apiKey: "stand-in-not-a-key", fetch: f, maxRetries: 0 }), seen };
}
const rows = (db: DB) => db.prepare("SELECT event, payload_json FROM audit_log ORDER BY seq").all() as { event: string; payload_json: string }[];

describe("the reader's options for the engine (budget, maxTokens, announce)", () => {
  it("changes nothing without them: max_tokens 16,000 and no row before the call", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const r = await new ClaudeReader(db, s.client).ask(ask, fallback);
    expect(r.source).toBe("claude");
    expect(s.seen[0]!.max_tokens).toBe(16_000);
    expect(rows(db).map((x) => x.event)).toEqual(["claude.read"]);
  });

  it("announces a call just before it is sent (role and model, never the prompt), and asks for no more than maxTokens", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    await new ClaudeReader(db, s.client, Date.now, {}, { announce: true, maxTokens: 4_000 }).ask(ask, fallback);
    expect(s.seen[0]!.max_tokens).toBe(4_000);
    const r = rows(db);
    expect(r.map((x) => x.event)).toEqual(["claude.asking", "claude.read"]);
    expect(JSON.parse(r[0]!.payload_json)).toEqual({ role: "read", model: MODELS.act });
  });

  it("counts what each call cost against the action's budget, and the reading's row carries model and cost", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const budget = actionBudget(250_000);
    await new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000 }).ask(ask, fallback);
    const read = JSON.parse(rows(db).at(-1)!.payload_json) as { model: string; cost_usd_micros: number };
    // (request_id: the reader takes it from the parsed answer, which the SDK 1.3.0 leaves without it over a stand-in fetch.)
    expect(read).toMatchObject({ model: MODELS.act });
    expect(read.cost_usd_micros).toBe(callCostMicros(MODELS.act, { input: 1200, output: 80, cache_read: 0, cache_write: 0 }));
    expect(budget.left()).toBe(250_000 - read.cost_usd_micros);
  });

  it("does not send a call whose worst case is more than the action has left: the parser reads, and the rows say why", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const budget = actionBudget(worstCaseMicros(MODELS.act, 4_000, 10) - 1);
    const r = await new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000, announce: true }).ask(ask, fallback);
    expect(s.seen).toHaveLength(0);
    expect(r).toMatchObject({ source: "fallback", value: fallback() });
    const events = rows(db);
    expect(events.map((x) => x.event)).toEqual(["claude.capped", "claude.fallback"]);
    expect(JSON.parse(events[0]!.payload_json)).toMatchObject({ reason: "action_budget", model: MODELS.act });
  });

  it("never records more than the action's budget, even when every answer uses all it may", async () => {
    const db = openDb(":memory:");
    // The stand-in reports the most a call could use: the whole prompt and every token of max_tokens.
    const s = standIn((b) => ({ input: Math.ceil(b.chars / 3), output: b.max_tokens }));
    const reserved = 60_000;
    const budget = actionBudget(reserved);
    const reader = new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000 });
    for (let i = 0; i < 10; i++) await reader.ask({ ...ask, task: `ap.read:${i}` }, fallback);
    const spent = rows(db).filter((x) => x.event === "claude.read").reduce((a, x) => a + (JSON.parse(x.payload_json) as { cost_usd_micros: number }).cost_usd_micros, 0);
    expect(s.seen.length).toBeGreaterThan(0);
    expect(s.seen.length).toBeLessThan(10);
    expect(spent).toBeLessThanOrEqual(reserved);
  });

  it("counts a call that failed after it was sent at its worst case (it may have been billed)", async () => {
    const db = openDb(":memory:");
    const f = (async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }), { status: 529 })) as typeof fetch;
    const budget = actionBudget(1_000_000);
    const r = await new ClaudeReader(db, new Anthropic({ apiKey: "stand-in-not-a-key", fetch: f, maxRetries: 0 }), Date.now, {}, { budget, maxTokens: 4_000 }).ask(ask, fallback);
    expect(r.source).toBe("fallback");
    expect(budget.left()).toBeLessThan(1_000_000);
    expect(1_000_000 - budget.left()).toBeLessThanOrEqual(worstCaseMicros(MODELS.act, 4_000, 100_000));
  });

  it("asks for no server-side fallback under a budget (a second, dearer attempt the ceiling cannot see); a runner keeps it", async () => {
    const budgeted = standIn();
    await new ClaudeReader(openDb(":memory:"), budgeted.client, Date.now, {}, { budget: actionBudget(1_000_000) }).ask(ask, fallback);
    expect(budgeted.seen[0]).toMatchObject({ fallbacks: undefined });
    expect(budgeted.seen[0]!.beta ?? "").not.toMatch(/server-side-fallback/);
    const runner = standIn();
    await new ClaudeReader(openDb(":memory:"), runner.client).ask(ask, fallback);
    expect(runner.seen[0]).toMatchObject({ fallbacks: "default" });
  });

  it("bounds a scan by its pages, not its bytes: a small PDF of 3 pages is counted at 3 pages' worth", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    // Just enough for the bytes of a 3 KB file, far too little for 3 pages read as images.
    const budget = actionBudget(worstCaseMicros(MODELS.act, 4_000, 20_000));
    const r = await new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000 }).askPdf({ task: "ap.scan", role: "act", actor: "treasury", schema: Reading, instruction: "Read.", pdf: new Uint8Array(3_000) }, fallback);
    expect(s.seen).toHaveLength(0);
    expect(r.source).toBe("fallback");
    expect(PDF_PAGES_BOUND).toBe(SCAN_MAX_PAGES);
  });

  it("bounds a call's worst case from the price list, and cannot bound a model it has no price for", () => {
    expect(worstCaseMicros(MODELS.act, 4_000, 3_000)).toBeGreaterThan(callCostMicros(MODELS.act, { input: 1_000, output: 4_000, cache_read: 0, cache_write: 0 })!);
    expect(worstCaseMicros("claude-unknown", 1, 1)).toBe(Infinity);
  });

  it("gives a visitor's company a client that waits 30 seconds at most and retries nothing itself", () => {
    const c = tryClaudeClient("stand-in-not-a-key");
    expect(c.timeout).toBe(30_000);
    expect(c.maxRetries).toBe(0);
  });
});

/** A company's engine in memory (as in test/engine-host.test.ts) with the Claude access given. */
function host(claude?: ClaudeAccess) {
  const db = openDb(":memory:");
  const docs = new Map<string, Buffer>();
  useDocStore(db, { put: (sha, b) => { docs.set(`mem:${sha}`, Buffer.from(b)); return `mem:${sha}`; }, get: (p) => docs.get(p)! });
  const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
  const bank = standInBank(store);
  const h = new EngineHost({
    db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)),
    rp: { rpId: "engine.example.invalid", origin: "https://engine.example.invalid" }, company: { name: "Budget Test Co", lang: "en" }, vault: null, feed: null,
    ...(claude ? { claude } : {}),
  });
  return { db, host: h };
}
/** Claude access as the cloud gives it, over a stand-in client: what was reserved and what was settled. */
function access(o: { refuse?: CappedReason; micros?: number; client?: Anthropic } = {}) {
  const log = { reserved: 0, settled: [] as number[] };
  const client = o.client ?? standIn().client;
  const a: ClaudeAccess = {
    reserve: async () => {
      if (o.refuse) return { ok: false, reason: o.refuse };
      log.reserved++;
      return { ok: true, reservation: { micros: o.micros ?? 250_000, settle: async (m: number) => { log.settled.push(m); } } };
    },
    reader: (db, budget) => new ClaudeReader(db, client, Date.now, {}, { budget, maxTokens: 4_000, announce: true }),
    status: async () => ({ on: !o.refuse, cap_micros: 400_000, spent_micros: null }),
  };
  return { access: a, log };
}

describe("the engine's actions with Claude under caps (src/engine/host.ts)", () => {
  it("reserves before an upload, reads with Claude within the reservation, and settles to what the calls cost", async () => {
    const s = standIn(undefined, inboxAnswer);
    const { access: a, log } = access({ client: s.client });
    const { db, host: h } = host(a);
    const up = await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(up.kind).toBe("invoice");
    expect(s.seen.length).toBeGreaterThan(0);
    expect(log.reserved).toBe(1);
    expect(up.invoice!.read_by).toMatch(/claude/);
    const cost = rows(db).filter((r) => r.event === "claude.read").reduce((n, r) => n + (JSON.parse(r.payload_json) as { cost_usd_micros: number }).cost_usd_micros, 0);
    expect(log.settled).toEqual([cost]);
    // Each call announced before its reading.
    const events = rows(db).map((r) => r.event).filter((e) => e.startsWith("claude."));
    expect(events[0]).toBe("claude.asking");
    expect(events.indexOf("claude.read")).toBeGreaterThan(events.indexOf("claude.asking"));
  });

  it("when the caps say no: no call, the parser reads, and the row says why; nothing to settle", async () => {
    const s = standIn();
    const { access: a, log } = access({ refuse: "company_cap", client: s.client });
    const { db, host: h } = host(a);
    const up = await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(up.invoice).toMatchObject({ read_by: "parser" });
    expect(s.seen).toHaveLength(0);
    expect(log).toEqual({ reserved: 0, settled: [] });
    const capped = rows(db).filter((r) => r.event === "claude.capped").map((r) => JSON.parse(r.payload_json));
    expect(capped).toEqual([{ reason: "company_cap" }]);
  });

  it("settles a failed action too: what the budget spent, never more than the reservation", async () => {
    const f = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const { access: a, log } = access({ micros: 300_000, client: new Anthropic({ apiKey: "stand-in-not-a-key", fetch: f, maxRetries: 0 }) });
    const { host: h } = host(a);
    await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(log.settled).toHaveLength(1);
    expect(log.settled[0]).toBeGreaterThan(0);
    expect(log.settled[0]).toBeLessThanOrEqual(300_000);
    // An upload the inbox refuses is settled as well.
    await expect(h.upload({ bytes: new Uint8Array([1, 2, 3]), filename: "notes.txt" })).rejects.toThrow(/nothing was filed/);
    expect(log.settled).toHaveLength(2);
  });

  it("says in its status whether Claude or the parser reads, and what this company spent against its cap", async () => {
    const { access: a } = access({ client: standIn(undefined, inboxAnswer).client });
    const { host: h } = host(a);
    await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    const st = await h.status();
    expect(st).toMatchObject({ reader: "claude", agents: "code", cap_micros: 400_000 });
    // Without the cloud's own figure, what this ledger's rows say.
    expect(st.spent_micros).toBeGreaterThan(0);
    // With it, the cloud's figure: it also holds calls counted at their worst case and stale reservations.
    const { access: b } = access();
    const withSpend = host({ ...b, status: async () => ({ on: true, cap_micros: 400_000, spent_micros: 123_456 }) });
    expect(await withSpend.host.status()).toMatchObject({ reader: "claude", spent_micros: 123_456 });
    expect(await host().host.status()).toMatchObject({ reader: "parser", agents: "code", spent_micros: 0, cap_micros: null });
  });

  it("without Claude access the engine reads as before: no reservation, no new rows", async () => {
    const { db, host: h } = host();
    await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(rows(db).some((r) => r.event.startsWith("claude.capped") || r.event === "claude.asking")).toBe(false);
  });
});
