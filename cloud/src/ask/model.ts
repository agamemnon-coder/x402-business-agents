// The model behind Ask Purser (21 Nov: an agent, not one generated answer): Claude Haiku (the classifier's model,
// src/claude/reader.ts MODELS.classify, the fastest and cheapest the product uses) with adaptive thinking at low effort,
// READ-ONLY tools (./tools.ts: the docs, and the demo company's records the console already shows), one streamed
// Messages API call a round, ASK_MAX_TOKENS a round at most, 25 s a round and no retries. The route (./routes.ts) runs
// the rounds, at most ASK_MAX_ROUNDS, under the reservation ./limits.ts made for the whole question.
//
// fetch only, as the site Worker's own live calls (worker/src/talkRound.ts): the cloud Worker's entry carries neither the
// SDK nor src/claude (test/cloud-engine.test.ts holds its bundle free of @anthropic-ai/sdk), so the model id and its list
// prices are restated here and held equal to src/claude by test/cloud-ask.test.ts. Tests and the browser check hand in a
// scripted model instead.

export const ASK_MODEL = "claude-haiku-5-5";
/** One round's output at most (adaptive thinking counts against it). */
export const ASK_MAX_TOKENS = 3_000;
export const ASK_TIMEOUT_MS = 25_000;
/** Rounds of one question at most (each round: Claude reads, then may call tools); with a file attached, fewer. */
export const ASK_MAX_ROUNDS = 5;
export const ASK_MAX_ROUNDS_FILE = 4;
/** Haiku's list prices in micro-dollars a token (src/claude/pricing.ts): input, cache write (5 min), cache read, output. */
export const ASK_PRICE = { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 } as const;
/** Over this many prompt tokens Haiku is priced higher; Ask Purser keeps every prompt under it (./limits.ts). */
export const ASK_LONG_PROMPT = 100_000;

export interface AskUsage { input: number; output: number; cache_read: number; cache_write: number }
/** A call's cost, rounded up as src/claude/pricing.ts rounds it (in nano-dollars first). */
export function askCostMicros(u: AskUsage | number, output?: number): number {
  const x: AskUsage = typeof u === "number" ? { input: u, output: output ?? 0, cache_read: 0, cache_write: 0 } : u;
  const k = x.input + x.cache_read + x.cache_write > ASK_LONG_PROMPT ? 5 : 1;
  const nano = Math.round(x.input * ASK_PRICE.input * 1000 * k + x.cache_write * ASK_PRICE.cacheWrite * 1000 * k + x.cache_read * ASK_PRICE.cacheRead * 1000 * k + x.output * ASK_PRICE.output * 1000 * k);
  return Math.ceil(nano / 1000);
}

/** A content block as the Messages API carries it (text, image, document, tool_use, tool_result, thinking, …). */
export type Block = { type: string } & Record<string, unknown>;
export interface ApiMessage { role: "user" | "assistant"; content: string | Block[] }
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }
export interface AskRequest {
  system: string;
  messages: ApiMessage[];
  maxTokens: number;
  /** The read-only tools; none: Claude answers from what it was given. */
  tools?: readonly ToolDef[];
  /** "none" on the last round: Claude must answer now, with the tools still listed (the prompt cache stays whole). */
  toolChoice?: "auto" | "none";
}
export interface AskTurnEnd {
  micros: number;
  stop: string | null;
  /** What Claude wrote this round, block by block, to send back unchanged in the next (thinking included). */
  content?: Block[];
}
/** What the model said, in pieces as they come, then its cost and its blocks; a model that fails throws (with what it may have cost). */
export interface AskStream { text: AsyncIterable<string>; done(): Promise<AskTurnEnd> }
export type AskModel = ((req: AskRequest) => AskStream) & {
  /** The prompt's input tokens (the free count_tokens endpoint), to price a question with a file before it is asked. */
  countTokens?: (req: AskRequest) => Promise<number>;
};

const HEADERS = (apiKey: string) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" });

/** The request body: adaptive thinking at low effort, the tools, and the prompt cached (the system, tools and file repeat each round). */
export function askBody(req: AskRequest, stream: boolean): Record<string, unknown> {
  return {
    model: ASK_MODEL, max_tokens: req.maxTokens, system: req.system, messages: req.messages,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: { type: req.toolChoice ?? "auto" } } : {}),
    thinking: { type: "adaptive" }, output_config: { effort: "low" }, cache_control: { type: "ephemeral" },
    ...(stream ? { stream: true } : {}),
  };
}

/** Claude over the Messages API, streamed (server-sent events), with the demo's capped key (a Worker secret; never logged or shown). */
export function claudeAskModel(apiKey: string, fetcher: typeof fetch = (i, init) => fetch(i, init)): AskModel {
  const model: AskModel = (req) => {
    const usage: AskUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    let stop: string | null = null;
    const blocks: Block[] = [];
    const partial = new Map<number, string>();
    let finish!: (v: AskTurnEnd) => void, fail!: (e: unknown) => void, settled = false;
    const done = new Promise<AskTurnEnd>((ok, no) => { finish = (v) => { settled = true; ok(v); }; fail = (e) => { settled = true; no(e); }; });
    done.catch(() => undefined);
    async function* text(): AsyncGenerator<string> {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS);
      try {
        const res = await fetcher("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal, headers: { ...HEADERS(apiKey), accept: "text/event-stream" }, body: JSON.stringify(askBody(req, true)) });
        if (!res.ok || !res.body) throw new Error(`the model answered HTTP ${res.status}`);
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done: end } = await rd.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
            if (!data) continue;
            const ev = JSON.parse(data) as {
              type: string; index?: number; content_block?: Block;
              message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
              delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string; stop_reason?: string | null };
              usage?: { output_tokens?: number }; error?: { type?: string };
            };
            if (ev.type === "message_start") {
              const u = ev.message?.usage;
              usage.input = u?.input_tokens ?? 0; usage.cache_read = u?.cache_read_input_tokens ?? 0; usage.cache_write = u?.cache_creation_input_tokens ?? 0;
            } else if (ev.type === "content_block_start" && ev.content_block && typeof ev.index === "number") {
              blocks[ev.index] = { ...ev.content_block };
            } else if (ev.type === "content_block_delta" && typeof ev.index === "number") {
              const b = blocks[ev.index], d = ev.delta;
              if (!b || !d) continue;
              if (d.type === "text_delta" && typeof d.text === "string") { b.text = `${String(b.text ?? "")}${d.text}`; yield d.text; }
              else if (d.type === "input_json_delta" && typeof d.partial_json === "string") partial.set(ev.index, (partial.get(ev.index) ?? "") + d.partial_json);
              else if (d.type === "thinking_delta" && typeof d.thinking === "string") b.thinking = `${String(b.thinking ?? "")}${d.thinking}`;
              else if (d.type === "signature_delta" && typeof d.signature === "string") b.signature = d.signature;
            } else if (ev.type === "content_block_stop" && typeof ev.index === "number") {
              const b = blocks[ev.index];
              if (b?.type === "tool_use") {
                // A tool's input arrives as JSON in pieces; one that does not parse is sent to the tool as {} (refused there).
                const j = partial.get(ev.index) ?? "";
                try { b.input = j ? JSON.parse(j) as unknown : (b.input ?? {}); } catch { b.input = {}; }
              }
            } else if (ev.type === "message_delta") {
              usage.output = ev.usage?.output_tokens ?? usage.output; stop = ev.delta?.stop_reason ?? null;
            } else if (ev.type === "error") throw new Error(`the model stopped: ${ev.error?.type ?? "error"}`);
          }
        }
        if (stop === "refusal") throw new Error("the model declined");
        // Sent back next round as they came; an empty text block is not (the API refuses one in a request).
        finish({ micros: askCostMicros(usage), stop, content: blocks.filter((b) => b && !(b.type === "text" && !b.text)) });
      } catch (e) {
        // What it may have cost: the input counted, and the output at most the cap.
        const worst = { ...usage, output: Math.max(usage.output, usage.input + usage.cache_read + usage.cache_write ? req.maxTokens : 0) };
        const err = Object.assign(e instanceof Error ? e : new Error(String(e)), { micros: askCostMicros(worst) });
        fail(err);
        throw err;
      } finally {
        clearTimeout(timer);
        // Read no further (a check stopped the answer): the round ends here, at what it may have cost.
        if (!settled) { ctl.abort(); finish({ micros: askCostMicros({ ...usage, output: Math.max(usage.output, req.maxTokens) }), stop: "stopped", content: [] }); }
      }
    }
    return { text: text(), done: () => done };
  };
  model.countTokens = async (req) => {
    const { model: m, system, messages, tools } = askBody(req, false) as { model: string; system: string; messages: unknown; tools?: unknown };
    const res = await fetcher("https://api.anthropic.com/v1/messages/count_tokens", { method: "POST", headers: HEADERS(apiKey), body: JSON.stringify({ model: m, ...(system ? { system } : {}), messages, ...(tools ? { tools } : {}) }), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`count_tokens answered HTTP ${res.status}`);
    const n = ((await res.json()) as { input_tokens?: unknown }).input_tokens;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("count_tokens gave no count");
    return n;
  };
  return model;
}
