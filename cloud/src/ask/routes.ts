// POST /v1/ask (public, from this site's own page): Ask Purser answers one question as an agent, streamed, one JSON
// object a line:
//   {type: "meta", mode, sources, live}  once: live (Claude), docs (the docs alone, with why), records (code read the
//                                        demo company's records, no model), refused (code answered); live: whether
//                                        Claude answers on this deployment now; sources are the passages sent, each
//                                        { n, title, url, kind }
//   {type: "step", id, tool, label, detail, state, ok}   a read the agent makes: "run" when it starts, "done" when read
//   {type: "source", source}             a source a read added (a passage search_docs found, a record a tool read)
//   {type: "card", card}                 the invoices a read returned, as rows the page draws (./cards.ts)
//   {type: "delta", text}                checked sentences, as they come
//   {type: "reset", text}                the text so far is replaced (words before a read, or a check stopped the answer)
//   {type: "done", mode, cited, note, reason, steps}
// Read-only by construction: every tool reads (./tools.ts), the demo company is read only and the public chat never reads
// a signed-in company; nothing here can reach the engine or money. No question, answer or file is kept or logged; only
// hourly counts (./limits.ts). The visitor's browser holds the conversation and sends its last turns back each time.
import { z } from "zod";
import type { AskChunk } from "../../../src/ask/pack.js";
import type { Blobs, Sql } from "../store.js";
import { ATTACH_B64_MAX, ATTACH_TYPES, checkAttachment } from "./attach.js";
import { ASK_COPY, citedIn, docsAnswer, HISTORY_TURN_MAX, OFF_WORDS, promptMessages, QUESTION_MAX, retrieve, screenQuestion, sentenceGate, sourcesBlock, SYSTEM, TOP_K, type OffReason, type Turn } from "./core.js";
import { ASK_FILE_TOKENS_MAX, askDayOpen, askRate, askSwitches, askTally, questionWorstMicros, reserveAnswer, roundWorstMicros } from "./limits.js";
import { ASK_MAX_ROUNDS, ASK_MAX_ROUNDS_FILE, ASK_MAX_TOKENS, type ApiMessage, type AskModel, type Block } from "./model.js";
import { cardOf, demoDetail } from "./cards.js";
import { ASK_CONTEXT_KINDS, CONTEXT_ID, contextLine, parseContext } from "./context.js";
import { ASK_TOOLS, localRead, resultForPeople, runAskTool, TOOLS_PER_QUESTION, TOOLS_PER_ROUND } from "./tools.js";

export const ASK_ROUTE = "POST /v1/ask";
/** The body at most: a question, the last turns, and a 5 MB file as base64. */
export const ASK_BODY_MAX = ATTACH_B64_MAX + 64_000;

const Body = z.object({
  question: z.string().max(QUESTION_MAX * 2),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(HISTORY_TURN_MAX * 4) }).strict()).max(12).optional(),
  attachment: z.object({ name: z.string().max(300), type: z.enum(ATTACH_TYPES), data: z.string().max(ATTACH_B64_MAX) }).strict().optional(),
  // The console page Ask Purser is open on (./context.ts): a kind from a fixed list and a record's id, never a secret.
  context: z.object({ kind: z.enum(ASK_CONTEXT_KINDS), id: z.string().regex(CONTEXT_ID).optional(), demo: z.boolean().optional() }).strict().optional(),
}).strict();

export interface AskCtx { env: { sql: Sql; blobs?: Blobs; origin?: string; askModel?: AskModel | undefined; askSecrets?: readonly string[]; waitUntil?: (p: Promise<unknown>) => void }; req: Request; now: Date }

type Mode = "live" | "docs" | "records" | "refused";
interface Src { n: number; title: string; url: string; kind: "doc" | "data" }
const ndjson = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const pub = (chunks: readonly AskChunk[]): Src[] => chunks.map((c, i) => ({ n: i + 1, title: c.title, url: c.url, kind: "doc" }));

/** The answer's events, written as they come; `run` gets a writer and the stream closes when it ends. */
function streamed(c: AskCtx, run: (line: (o: unknown) => void) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o: unknown) => { void w.write(enc.encode(`${JSON.stringify(o)}\n`)).catch(() => undefined); };
  const done = run(line).catch(() => line({ type: "done", mode: "docs", cited: [], note: null, reason: OFF_WORDS.failed, steps: 0 }))
    .finally(() => { void w.close().catch(() => undefined); });
  c.env.waitUntil?.(done);
  return new Response(readable, { status: 200, headers: ndjson });
}

/** A whole answer code wrote (a refusal, the docs alone): its meta, its text and its end, at once. */
function fixed(c: AskCtx, mode: Mode, text: string, sources: readonly Src[], live: boolean, reason: string | null = null): Response {
  return streamed(c, async (line) => {
    line({ type: "meta", mode, sources, live });
    line({ type: "delta", text });
    line({ type: "done", mode, cited: citedIn(text, sources.length), note: null, reason, steps: 0 });
  });
}

const docsText = (why: OffReason, chunks: readonly AskChunk[], lead = "") => `${lead ? `${lead} ` : ""}${ASK_COPY.docsOnly(OFF_WORDS[why])}\n${docsAnswer(chunks)}`;
/** Characters of a prompt as tokens, generously (3 characters a token). */
const tokensOf = (s: string) => Math.ceil(s.length / 3);
const FIXED_TOKENS = tokensOf(SYSTEM + JSON.stringify(ASK_TOOLS));

export function askRoutes<C extends AskCtx>(kit: { json(status: number, body: unknown): Response; err(status: number, error: string): Response; body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T> }) {
  return [{
    method: "POST" as const, path: "/v1/ask", need: "public" as const,
    summary: "Ask Purser (public, from this site's own pages): one question about Purser, answered by an agent with read-only tools over Purser's public docs (README, llms.txt, docs/) and the demo company's records (made-up data, read only), streamed as one JSON object a line (meta with the passages used, step for each read, source, delta, reset, done with the sources cited). Body { question (at most 600 characters), history? (the conversation's last turns, kept by the browser), attachment? { name, type (PDF, CSV, text, PNG, JPEG, WebP or GIF), data (base64, at most 5 MB) }, context? { kind (the console page: overview, invoices, invoice, transactions, payment, agents, policy, books, audit or proof), id? (the record's id, letters, digits and _.:- only), demo? (the person is in the demo company) } }. Read-only: it cannot pay, approve, change a limit or read a real company's data; such a request, and any instruction aimed at the assistant, is answered by code. Claude (Haiku) only under the hands-on deployment's switches claude and ask and its caps; otherwise the docs answer alone (or code reads the demo company's records), labelled. 6 a minute and ask_per_address_hour an hour per address (429 { code: limit }). Nothing is kept but hourly counts: no question, answer or file.",
    run: async (c: C): Promise<Response> => {
      const b = await kit.body(c, Body, ASK_BODY_MAX);
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
        await askTally(sql, screen.kind === "money" ? "refused_money" : "refused_injection", c.now);
        const about = screen.kind === "injection" ? [] : retrieve("limits Face ID passkey approval CFO policy", 2);
        return fixed(c, "refused", ASK_COPY[screen.kind], pub(about), false);
      }
      const file = b.attachment ? checkAttachment(b.attachment) : null;
      if (file && !file.ok) return kit.err(400, file.why);
      if (file) await askTally(sql, "files", c.now);
      const history: Turn[] = (b.history ?? []).slice(-6);
      // The passages: for the question, and for the visitor's question before it (a follow-up such as "and the cost?").
      const lastUser = [...history].reverse().find((t) => t.role === "user")?.text ?? "";
      let chunks = retrieve(screen.question, TOP_K);
      if (chunks.length < 2 && lastUser) chunks = retrieve(`${screen.question} ${lastUser.slice(0, 300)}`, TOP_K);
      const context = parseContext(b.context);
      const records = localRead(screen.question, context);
      const toolCtx = { sql, ...(c.env.blobs ? { blobs: c.env.blobs } : {}), origin: c.env.origin ?? "", now: c.now };
      // Nothing in the docs, no file and nothing to read: "I don't know", without asking the model.
      if (!chunks.length && !file && !records) { await askTally(sql, "docs", c.now); return fixed(c, "docs", ASK_COPY.unknown, pub(retrieve("Purser in one minute what it is", 2)), !!c.env.askModel); }

      const model = c.env.askModel;
      let off: OffReason | null = model ? null : "not_set_up";
      if (!off && !(await askDayOpen(sql, s, c.now))) off = "budget";
      // A file is priced before it is asked about: its tokens counted by the API (free), within ASK_FILE_TOKENS_MAX.
      let fileTokens = 0;
      if (!off && file?.ok && model) {
        try {
          fileTokens = model.countTokens
            ? await model.countTokens({ system: "", messages: [{ role: "user", content: [file.block, { type: "text", text: "." }] }], maxTokens: 1 })
            : file.text !== null ? tokensOf(file.text) : file.kind === "image" ? 1_600 : Math.ceil(file.bytes / 50);
        } catch { off = "failed"; }
        if (!off && fileTokens > ASK_FILE_TOKENS_MAX) return fixed(c, "refused", ASK_COPY.fileTooLong, [], true);
      }
      const worst = questionWorstMicros(fileTokens);
      const got = off ? null : await reserveAnswer(sql, s, ip, c.now, worst);
      if (got && !got.ok) off = got.reason === "switch_off" ? "switch_off" : got.reason === "busy" ? "busy" : "budget";
      if (off || !got || !got.ok || !model) {
        const why = off ?? "not_set_up";
        const lead = file ? ASK_COPY.fileNeedsLive : "";
        // The demo company's records, read by code: the one read the question names, its lines as they are.
        if (records) {
          const r = await runAskTool(toolCtx, records.tool, records.args, 1);
          if (!r.isError) {
            await askTally(sql, "records", c.now);
            const src: Src[] = r.sources.map((x, i) => ({ n: i + 1, title: x.title, url: x.url, kind: x.kind }));
            const [first = "", ...rest] = resultForPeople(r.text).split("\n").filter((l) => !/^Northwind Outdoor \(demo company\): demo company/.test(l));
            const text = `${lead ? `${lead} ` : ""}${OFF_WORDS[why]} ${ASK_COPY.records}\n${first} [1]\n${rest.join("\n")}`.trim();
            const card = await cardOf(records.tool, r.data, demoDetail(toolCtx, runAskTool)).catch(() => null);
            return streamed(c, async (line) => {
              line({ type: "meta", mode: "records", sources: src, live: false });
              line({ type: "step", id: "s1", tool: r.step.tool, label: r.step.label, detail: r.step.detail, state: "done", ok: true });
              if (card) line({ type: "card", card });
              line({ type: "delta", text });
              line({ type: "done", mode: "records", cited: [1], note: null, reason: OFF_WORDS[why], steps: 1 });
            });
          }
        }
        await askTally(sql, "docs", c.now);
        if (!chunks.length) return fixed(c, "docs", `${lead ? `${lead} ` : ""}${ASK_COPY.unknown}`, pub(retrieve("Purser in one minute what it is", 2)), false, OFF_WORDS[why]);
        return fixed(c, "docs", docsText(why, chunks, lead), pub(chunks), false, OFF_WORDS[why]);
      }
      const reservation = got.reservation;
      const fileOk = file?.ok ? file : null;

      return streamed(c, async (line) => {
        const sources: Src[] = pub(chunks);
        const seen = new Set(chunks.map((x) => x.id));
        line({ type: "meta", mode: "live", sources, live: true });
        const ctxLine = context ? contextLine(context) : null;
        const gate = sentenceGate({ sources: `${sourcesBlock(chunks)}${fileOk?.text ? `\n${fileOk.text}` : ""}`, question: `${screen.question}\n${lastUser}${ctxLine ? `\n${ctxLine}` : ""}`, secrets: c.env.askSecrets ?? [] }, { lenientFigures: fileOk !== null && fileOk.kind !== "text" });
        const messages: ApiMessage[] = promptMessages(history, screen.question, chunks, fileOk?.block ?? null, ctxLine) as ApiMessage[];
        const rounds = fileOk ? ASK_MAX_ROUNDS_FILE : ASK_MAX_ROUNDS;
        let said = "", spent = 0, calls = 0, steps = 0, outOfBudget = false;
        // The prompt's size without the file's bytes (counted apart, in fileTokens).
        const promptTokens = () => FIXED_TOKENS + fileTokens + tokensOf(JSON.stringify(messages, (k, v: unknown) => (k === "data" && typeof v === "string" && v.length > 2_000 ? "" : v)));
        try {
          for (let round = 1; round <= rounds; round++) {
            const last = round === rounds || calls >= TOOLS_PER_QUESTION;
            if (spent + roundWorstMicros(promptTokens()) > reservation.micros) { outOfBudget = true; break; }
            const stream = model({ system: SYSTEM, messages, maxTokens: ASK_MAX_TOKENS, tools: ASK_TOOLS, toolChoice: last ? "none" : "auto" });
            const before = said;
            let err: unknown = null;
            try {
              for await (const piece of stream.text) {
                const ok = gate.push(piece);
                if (gate.stopped) break;
                if (ok) { said += ok; line({ type: "delta", text: ok }); }
              }
            } catch (e) { err = e; }
            const end = await stream.done().catch((e: unknown) => { err ??= e; return { micros: (e as { micros?: number }).micros ?? roundWorstMicros(promptTokens()), stop: null, content: undefined }; });
            spent += end.micros;
            if (err) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { micros: 0 });
            if (gate.stopped) break;
            const uses = (end.content ?? []).filter((x): x is Block & { id: string; name: string; input: unknown } => x.type === "tool_use" && typeof x.id === "string" && typeof x.name === "string");
            if (end.stop !== "tool_use" || !uses.length || last) {
              const rest = gate.end();
              if (rest) { said += rest; line({ type: "delta", text: rest }); }
              break;
            }
            // Words before a read are not the answer: they go, and the reads begin.
            gate.clear();
            if (said !== before) { said = before; line({ type: "reset", text: said }); }
            messages.push({ role: "assistant", content: end.content! });
            const results: Block[] = [];
            for (const [i, u] of uses.entries()) {
              const id = `s${++steps}`;
              if (i >= TOOLS_PER_ROUND || calls >= TOOLS_PER_QUESTION) {
                results.push({ type: "tool_result", tool_use_id: u.id, content: "Not read: too many reads for one question. Answer with what you have.", is_error: true });
                continue;
              }
              calls++;
              line({ type: "step", id, tool: u.name, label: null, detail: null, state: "run", ok: true });
              const r = await runAskTool(toolCtx, u.name, u.input, sources.length + 1, seen);
              for (const x of r.sources) {
                const src: Src = { n: sources.length + 1, title: x.title, url: x.url, kind: x.kind };
                sources.push(src);
                if (x.chunk) seen.add(x.chunk.id);
                line({ type: "source", source: src });
              }
              if (!r.isError) gate.learn(r.text);
              line({ type: "step", id, tool: u.name, label: r.step.label, detail: r.step.detail, state: "done", ok: r.step.ok });
              // The rows it read, as a card the page draws (./cards.ts): the demo company's records, as returned.
              if (!r.isError && r.data) { const card = await cardOf(u.name, r.data, demoDetail(toolCtx, runAskTool)).catch(() => null); if (card) line({ type: "card", card }); }
              results.push({ type: "tool_result", tool_use_id: u.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
            }
            await askTally(sql, "tool_calls", c.now, Math.min(uses.length, TOOLS_PER_ROUND));
            messages.push({ role: "user", content: results });
          }
          await reservation.settle(spent);
        } catch (e) {
          await reservation.settle(spent + ((e as { micros?: number }).micros ?? 0));
          await askTally(sql, "docs", c.now);
          line({ type: "reset", text: chunks.length ? docsText("failed", chunks) : `${OFF_WORDS.failed} ${ASK_COPY.unknown}` });
          line({ type: "done", mode: "docs", cited: [], note: null, reason: OFF_WORDS.failed, steps });
          return;
        }
        if (gate.stopped) {
          await askTally(sql, "stopped", c.now);
          const why = gate.stopped.ok ? "injection" : gate.stopped.why === "action" ? "money" : "injection";
          line({ type: "reset", text: ASK_COPY[why] });
          line({ type: "done", mode: "refused", cited: [], note: null, reason: null, steps });
          return;
        }
        if (gate.dropped) await askTally(sql, "trimmed", c.now, gate.dropped);
        await askTally(sql, "live", c.now);
        if (!said.trim()) { const t = outOfBudget ? ASK_COPY.budgetSpent : ASK_COPY.unknown; line({ type: "delta", text: t }); said = t; }
        const note = [gate.dropped ? ASK_COPY.removed : null, gate.unchecked ? ASK_COPY.fileFigures : null, outOfBudget && said !== ASK_COPY.budgetSpent ? ASK_COPY.budgetSpent : null].filter(Boolean).join(" ") || null;
        line({ type: "done", mode: "live", cited: citedIn(said, sources.length), note, reason: null, steps });
      });
    },
  }];
}
