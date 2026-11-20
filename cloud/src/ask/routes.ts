// POST /v1/ask (public, from this site's own page): Ask Purser answers one question, streamed, one JSON object a line:
//   {type: "meta", mode, sources}   once: live (Claude), docs (the docs alone, with why), refused (code answered);
//                                   sources are the passages sent, each { n, title, url }
//   {type: "delta", text}           checked sentences, as they come
//   {type: "reset", text}           the text so far is replaced (Claude stopped mid-way, or a check stopped the answer)
//   {type: "done", mode, cited, note, reason}
// Read-only by construction: the model gets no tools, and nothing here can reach a company's data, the engine or money.
// No question or answer is kept or logged; only hourly counts (./limits.ts). The visitor's browser holds the conversation
// and sends its last turns back with each question.
import { z } from "zod";
import type { AskChunk } from "../../../src/ask/pack.js";
import type { Sql } from "../store.js";
import { ASK_COPY, citedIn, docsAnswer, HISTORY_TURN_MAX, OFF_WORDS, promptMessages, QUESTION_MAX, retrieve, screenQuestion, sentenceGate, sourcesBlock, SYSTEM, TOP_K, type OffReason, type Turn } from "./core.js";
import { askDayOpen, askRate, askSwitches, askTally, reserveAnswer } from "./limits.js";
import { ASK_MAX_TOKENS, type AskModel } from "./model.js";

export const ASK_ROUTE = "POST /v1/ask";

const Body = z.object({
  question: z.string().max(QUESTION_MAX * 2),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(HISTORY_TURN_MAX * 4) }).strict()).max(12).optional(),
}).strict();

export interface AskCtx { env: { sql: Sql; askModel?: AskModel | undefined; askSecrets?: readonly string[]; waitUntil?: (p: Promise<unknown>) => void }; req: Request; now: Date }

type Mode = "live" | "docs" | "refused";
const ndjson = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const pub = (chunks: readonly AskChunk[]) => chunks.map((c, i) => ({ n: i + 1, title: c.title, url: c.url }));

/** The answer's events, written as they come; `run` gets a writer and the stream closes when it ends. */
function streamed(c: AskCtx, run: (line: (o: unknown) => void) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o: unknown) => { void w.write(enc.encode(`${JSON.stringify(o)}\n`)).catch(() => undefined); };
  const done = run(line).catch(() => line({ type: "done", mode: "docs", cited: [], note: null, reason: OFF_WORDS.failed }))
    .finally(() => { void w.close().catch(() => undefined); });
  c.env.waitUntil?.(done);
  return new Response(readable, { status: 200, headers: ndjson });
}

/** A whole answer code wrote (a refusal, the docs alone): its meta, its text and its end, at once. */
function fixed(c: AskCtx, mode: Mode, text: string, sources: readonly AskChunk[], reason: string | null = null): Response {
  return streamed(c, async (line) => {
    line({ type: "meta", mode, sources: pub(sources) });
    line({ type: "delta", text });
    line({ type: "done", mode, cited: citedIn(text, sources.length), note: null, reason });
  });
}

const docsText = (why: OffReason, chunks: readonly AskChunk[]) => `${ASK_COPY.docsOnly(OFF_WORDS[why])}\n${docsAnswer(chunks)}`;

export function askRoutes<C extends AskCtx>(kit: { json(status: number, body: unknown): Response; err(status: number, error: string): Response; body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T> }) {
  return [{
    method: "POST" as const, path: "/v1/ask", need: "public" as const,
    summary: "Ask Purser (public, from this site's own pages): one question about Purser, answered from its public docs only (README, llms.txt, docs/), streamed as one JSON object a line (meta with the passages used, delta, reset, done with the passages cited). Body { question (at most 600 characters), history? (the conversation's last turns, kept by the browser) }. Read-only: it cannot pay, approve, change a limit or read any company's data; such a request, and any instruction aimed at the assistant, is answered by code. Claude (Haiku) only under the hands-on deployment's switches claude and ask and its caps; otherwise the docs answer alone, labelled. 6 a minute and ask_per_address_hour an hour per address (429 { code: limit }). Nothing is kept but hourly counts.",
    run: async (c: C): Promise<Response> => {
      const b = await kit.body(c, Body, 16_000);
      const sql = c.env.sql;
      const ip = c.req.headers.get("cf-connecting-ip") ?? "unknown";
      await askTally(sql, "asked", c.now);
      const s = await askSwitches(sql);
      const limited = await askRate(sql, ip, s, c.now);
      if (limited) {
        await askTally(sql, "limited", c.now);
        const r = kit.json(429, { error: limited.message, code: "limit", message: limited.message });
        r.headers.set("retry-after", "60");
        return r;
      }
      const screen = screenQuestion(b.question);
      if (!screen.ok) {
        if (screen.kind === "empty" || screen.kind === "too_long") return kit.err(400, screen.kind === "empty" ? "ask a question" : `a question is at most ${QUESTION_MAX} characters`);
        await askTally(sql, screen.kind === "money" ? "refused_money" : screen.kind === "data" ? "refused_data" : "refused_injection", c.now);
        const about = screen.kind === "injection" ? [] : retrieve("limits Face ID passkey approval CFO policy", 2);
        return fixed(c, "refused", ASK_COPY[screen.kind], about);
      }
      const history: Turn[] = (b.history ?? []).slice(-6);
      // The passages: for the question, and for the visitor's question before it (a follow-up such as "and the cost?").
      const lastUser = [...history].reverse().find((t) => t.role === "user")?.text ?? "";
      let chunks = retrieve(screen.question, TOP_K);
      if (chunks.length < 2 && lastUser) chunks = retrieve(`${screen.question} ${lastUser.slice(0, 300)}`, TOP_K);
      if (!chunks.length) { await askTally(sql, "docs", c.now); return fixed(c, "docs", ASK_COPY.unknown, retrieve("Purser in one minute what it is", 2)); }

      const model = c.env.askModel;
      let off: OffReason | null = model ? null : "not_set_up";
      if (!off && !(await askDayOpen(sql, s, c.now))) off = "budget";
      const got = off ? null : await reserveAnswer(sql, s, ip, c.now);
      if (got && !got.ok) off = got.reason === "switch_off" ? "switch_off" : got.reason === "busy" ? "busy" : "budget";
      if (off || !got || !got.ok || !model) { await askTally(sql, "docs", c.now); return fixed(c, "docs", docsText(off ?? "not_set_up", chunks), chunks, OFF_WORDS[off ?? "not_set_up"]); }
      const reservation = got.reservation;

      return streamed(c, async (line) => {
        line({ type: "meta", mode: "live", sources: pub(chunks) });
        const ctx = { sources: sourcesBlock(chunks), question: `${screen.question}\n${lastUser}`, secrets: c.env.askSecrets ?? [] };
        const gate = sentenceGate(ctx);
        let said = "";
        const stream = model({ system: SYSTEM, messages: promptMessages(history, screen.question, chunks), maxTokens: ASK_MAX_TOKENS });
        try {
          for await (const piece of stream.text) {
            const ok = gate.push(piece);
            if (gate.stopped) break;
            if (ok) { said += ok; line({ type: "delta", text: ok }); }
          }
          if (!gate.stopped) { const rest = gate.end(); if (rest) { said += rest; line({ type: "delta", text: rest }); } }
          const cost = await stream.done().catch((e: unknown) => ({ micros: (e as { micros?: number }).micros ?? reservation.micros, stop: null }));
          await reservation.settle(cost.micros);
        } catch (e) {
          await reservation.settle((e as { micros?: number }).micros ?? reservation.micros);
          await askTally(sql, "docs", c.now);
          line({ type: "reset", text: docsText("failed", chunks) });
          line({ type: "done", mode: "docs", cited: [], note: null, reason: OFF_WORDS.failed });
          return;
        }
        if (gate.stopped) {
          await askTally(sql, "stopped", c.now);
          const why = gate.stopped.ok ? "injection" : gate.stopped.why === "action" ? "money" : "injection";
          line({ type: "reset", text: ASK_COPY[why] });
          line({ type: "done", mode: "refused", cited: [], note: null, reason: null });
          return;
        }
        if (gate.dropped) await askTally(sql, "trimmed", c.now, gate.dropped);
        await askTally(sql, "live", c.now);
        if (!said.trim()) { line({ type: "delta", text: ASK_COPY.unknown }); said = ASK_COPY.unknown; }
        line({ type: "done", mode: "live", cited: citedIn(said, chunks.length), note: gate.dropped ? ASK_COPY.removed : null, reason: null });
      });
    },
  }];
}
