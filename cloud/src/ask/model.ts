// The model behind Ask Purser: one streamed Messages API call, Haiku (the classifier's model, src/claude/reader.ts
// MODELS.classify, the fastest the product uses), low effort, thinking off, ASK_MAX_TOKENS at most, no tools at all (it
// can read nothing and do nothing), 20 s and no retries. fetch only, as the site Worker's own live calls
// (worker/src/talkRound.ts): the cloud Worker's entry carries neither the SDK nor src/claude (test/cloud-engine.test.ts),
// so the model id and its list price are restated here and held equal to src/claude by test/cloud-ask.test.ts.
// Tests and the browser check hand in a scripted model instead.

export const ASK_MODEL = "claude-haiku-5-5";
export const ASK_MAX_TOKENS = 500;
export const ASK_TIMEOUT_MS = 20_000;
/** Haiku's list price in micro-dollars a token (src/claude/pricing.ts): input, output. */
export const ASK_PRICE = { input: 0.1, output: 0.5 } as const;
/** A call's cost, rounded up as src/claude/pricing.ts rounds it (in nano-dollars first). Prompts stay far under 100,000 tokens. */
export const askCostMicros = (input: number, output: number) => Math.ceil(Math.round(input * ASK_PRICE.input * 1000 + output * ASK_PRICE.output * 1000) / 1000);

export interface AskRequest { system: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens: number }
/** What the model said, in pieces as they come, then its cost; a model that fails throws (with what it may have cost). */
export interface AskStream { text: AsyncIterable<string>; done(): Promise<{ micros: number; stop: string | null }> }
export type AskModel = (req: AskRequest) => AskStream;

/** Claude over the Messages API, streamed (server-sent events), with the demo's capped key (a Worker secret; never logged or shown). */
export function claudeAskModel(apiKey: string, fetcher: typeof fetch = (i, init) => fetch(i, init)): AskModel {
  return (req) => {
    let input = 0, output = 0, stop: string | null = null;
    let finish!: (v: { micros: number; stop: string | null }) => void, fail!: (e: unknown) => void;
    const done = new Promise<{ micros: number; stop: string | null }>((ok, no) => { finish = ok; fail = no; });
    done.catch(() => undefined);
    async function* text(): AsyncGenerator<string> {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS);
      try {
        const res = await fetcher("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctl.signal,
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ model: ASK_MODEL, max_tokens: req.maxTokens, system: req.system, messages: req.messages, stream: true, thinking: { type: "disabled" }, output_config: { effort: "low" } }),
        });
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
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
            if (!data) continue;
            const ev = JSON.parse(data) as { type: string; message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number } }; delta?: { type?: string; text?: string; stop_reason?: string | null }; usage?: { output_tokens?: number }; error?: { type?: string } };
            if (ev.type === "message_start") input = (ev.message?.usage?.input_tokens ?? 0) + (ev.message?.usage?.cache_read_input_tokens ?? 0);
            else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") yield ev.delta.text;
            else if (ev.type === "message_delta") { output = ev.usage?.output_tokens ?? output; stop = ev.delta?.stop_reason ?? null; }
            else if (ev.type === "error") throw new Error(`the model stopped: ${ev.error?.type ?? "error"}`);
          }
        }
        if (stop === "refusal") throw new Error("the model declined");
        finish({ micros: askCostMicros(input, output), stop });
      } catch (e) {
        // What it may have cost: the input counted, and the output at most the cap.
        const err = Object.assign(e instanceof Error ? e : new Error(String(e)), { micros: askCostMicros(input, Math.max(output, input ? req.maxTokens : 0)) });
        fail(err);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    return { text: text(), done: () => done };
  };
}
