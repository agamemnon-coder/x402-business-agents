// Code Mode for Purser's own read tools (docs/codemode.md): instead of calling the tools one by one, the model gets a
// typed TypeScript API generated from them (`purser.list_invoices(...)` and the rest) and writes code against it. The
// code runs in a fresh Cloudflare Dynamic Worker (Worker Loader, `env.LOADER.load`), an isolate of its own:
//
//   - No network: `globalOutbound: null`, so fetch() and connect() throw in the isolate (the runtime enforces it).
//   - No bindings, no env, no secret: the isolate's `env` is empty. Its one way out is the `call` function this host
//     passes to it over Workers RPC; each call is checked here, in the loader Worker, before anything is read.
//   - A strict allow-list: only tools marked read-only reach the list (proposing, approving and paying are never in it),
//     and a name outside it is refused here, whatever the isolate sends.
//   - One company: the tools run with the caller's own tenant-scoped database (the McpCtx this request was given). No
//     argument names a company, and every tool's arguments are a strict schema, so the code cannot ask for another's.
//   - Limits: the code's size, tool calls per run, bytes per answer and in all, the run's wall time (here), its CPU time
//     and subrequests (Cloudflare's `limits`, enforced by the runtime), the size of what it returns and of its logs.
//   - Every run is logged as one line (codemode.run): which tools, how many calls, how long, the outcome, the code's
//     hash and size. Never the code itself, the arguments, the answers or anything secret.
//
// Payments, approvals and policy stay in Purser's deterministic control plane: nothing here can propose, approve, pay,
// change a limit or write, and the code never sees a payment credential or the CFO's approval rules' secrets. Every
// payment still needs the CFO's passkey (Face ID) over its exact terms.
//
// This file holds no Workers-only import (it is type-checked and unit-tested under Node); the isolate's own module is
// a string built here (sandboxModules).
import type { z } from "zod";
import { logEvent, redact } from "../log.js";

type Json = Record<string, unknown>;

/** A tool as Code Mode takes it: the same shape as an MCP tool in ./mcp.ts. */
export interface CodeTool<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  outputSchema: Json;
  args: z.ZodType<Json>;
  readOnly: boolean;
  run(ctx: C, args: Json): Promise<{ content: { type: string; text?: string }[]; structuredContent?: Json; isError?: boolean }>;
}

/** The limits of one run. CPU time and subrequests are Cloudflare's to enforce (Worker Loader `limits`). */
export const CODEMODE_LIMITS = {
  /** The code, in characters. */
  codeChars: 20_000,
  /** Tool calls in one run. */
  toolCalls: 25,
  /** One tool call's arguments, as JSON characters. */
  argsChars: 10_000,
  /** One tool answer handed to the code, as JSON bytes. */
  answerBytes: 300_000,
  /** All tool answers of one run together, as JSON bytes. */
  totalAnswerBytes: 2_000_000,
  /** What the run returns to the model, as JSON bytes. */
  outputBytes: 24_000,
  /** console lines kept, and characters per line. */
  logLines: 40,
  logLineChars: 300,
  /** The run's wall time, measured here. */
  wallMs: 15_000,
  /** The isolate's CPU time (Worker Loader limits.cpuMs). */
  cpuMs: 1_000,
  /** The isolate's subrequests (Worker Loader limits.subRequests): its RPC calls back to this host, with room to spare. */
  subRequests: 30,
} as const;

/** The isolate's compatibility date: the Worker's own. No compatibility flag (no nodejs_compat in the isolate). */
export const SANDBOX_COMPATIBILITY_DATE = "2026-10-01";

/** Why a run, or one call in it, did not give an answer. Stable codes, for clients to branch on. */
export const CODEMODE_ERRORS = {
  invalid_code: "The code is missing, not text, or longer than the limit.",
  sandbox_unavailable: "This deployment has no Worker Loader binding (LOADER), so no code runs here; nothing was read.",
  sandbox_failed: "The isolate stopped (for example its CPU or memory limit) or could not load the code.",
  timeout: "The run took longer than its wall-time limit and was stopped.",
  code_threw: "The code threw, or has a syntax error; the message says what.",
  result_not_json: "What the code returned is not JSON (a function, a cycle, a BigInt); return plain data.",
  output_too_large: "What the code returned is larger than the limit; return fewer rows or fields.",
  too_many_calls: "The code made more tool calls than one run may.",
  unknown_tool: "No read tool by that name; search shows the API.",
  not_available_in_code_mode: "Code Mode only reads. Proposing, approving, paying, changing a limit or writing is never possible from code: the CFO approves every payment with a passkey in Purser Cloud.",
  invalid_arguments: "The arguments do not fit the tool's typed signature.",
  answer_too_large: "One tool answer, or all of them together, is larger than the limit; ask for less (a lower limit, a filter).",
  late_call: "The run had already ended when this call arrived; await every call before returning.",
  not_found: "No invoice, payment or proposal in this company's books has that id.",
  could_not_answer: "The books could not answer that question as asked.",
  tool_failed: "The tool failed; nothing was changed.",
} as const;
export type CodemodeErrorCode = keyof typeof CODEMODE_ERRORS;
const isCode = (c: unknown): c is CodemodeErrorCode => typeof c === "string" && Object.prototype.hasOwnProperty.call(CODEMODE_ERRORS, c);

/** A tool name that asks for what Code Mode never does: the same words /mcp refuses (./mcp.ts NEVER_OVER_MCP). */
const NEVER_IN_CODE = /^(propose|approve|authori[sz]e|confirm|reject|cancel|pay|make|execute|send|transfer|refund|sign|release|freeze|unfreeze|raise|set|change|update|edit|write|create|add|insert|delete|remove|post|book)(_|$)|(^|_)(approve|approval|pay|payout|payment_proposal|sign|limit)(_|$)/i;

// ---------------------------------------------------------------------------------------------------------------------
// The typed API: TypeScript declarations generated from the tools' JSON Schemas.

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const doc = (s: unknown, pad: string) => (typeof s === "string" && s ? `${pad}/** ${s.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim()} */\n` : "");
const key = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));

/** A JSON Schema as a TypeScript type (the subset Purser's tools use; anything else is unknown). */
export function tsType(s: unknown, pad = ""): string {
  if (!s || typeof s !== "object") return "unknown";
  const o = s as Json;
  const alts = (o.anyOf ?? o.oneOf) as unknown[] | undefined;
  if (Array.isArray(alts)) return [...new Set(alts.map((x) => tsType(x, pad)))].join(" | ") || "unknown";
  if (Array.isArray(o.enum)) return o.enum.map((v) => JSON.stringify(v)).join(" | ") || "never";
  if (Array.isArray(o.type)) return [...new Set(o.type.map((t) => tsType({ ...o, type: t }, pad)))].join(" | ");
  switch (o.type) {
    case "string": return "string";
    case "integer": case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": { const t = tsType(o.items, pad); return /[|&]/.test(t) ? `(${t})[]` : `${t}[]`; }
    case "object": {
      const props = (o.properties ?? {}) as Record<string, Json>;
      const names = Object.keys(props);
      if (!names.length) return "Record<string, unknown>";
      const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
      const inner = `${pad}  `;
      const lines = names.map((n) => `${doc(props[n]!.description, inner)}${inner}${key(n)}${req.has(n) ? "" : "?"}: ${tsType(props[n], inner)};`);
      if (o.additionalProperties !== false) lines.push(`${inner}[field: string]: unknown;`);
      return `{\n${lines.join("\n")}\n${pad}}`;
    }
    default: return "unknown";
  }
}

/** One tool's method in the API: its description, its typed argument and its typed answer. */
function methodOf(t: CodeTool<unknown>, pad: string): string {
  const inProps = Object.keys(((t.inputSchema.properties ?? {}) as Json));
  const required = Array.isArray(t.inputSchema.required) && (t.inputSchema.required as unknown[]).length > 0;
  const arg = inProps.length ? `args${required ? "" : "?"}: ${tsType(t.inputSchema, pad)}` : "";
  return `${doc(`${t.title}. ${t.description}`, pad)}${pad}${t.name}(${arg}): Promise<${tsType(t.outputSchema, pad)}>;`;
}

/** The read-only tools Code Mode may offer: those marked readOnly with a plain name, nothing else. */
export function allowedTools<C>(tools: readonly CodeTool<C>[]): CodeTool<C>[] {
  return tools.filter((t) => t.readOnly === true && TOOL_NAME.test(t.name) && !/^propose/.test(t.name));
}

const API_HEAD = [
  "/** Thrown by a purser.* call that Purser refused: code is one of Code Mode's error codes (not_found, invalid_arguments, ...). */",
  "declare class PurserError extends Error { readonly code: string }",
  "/** Purser's books for the company this connection is for, read only. Every method returns plain JSON data. */",
].join("\n");

/** The typed API as TypeScript declarations: all tools, or the ones named. */
export function apiDeclarations<C>(tools: readonly CodeTool<C>[], only?: readonly string[]): string {
  const pick = allowedTools(tools).filter((t) => !only || only.includes(t.name));
  return `${API_HEAD}\ndeclare const purser: {\n${pick.map((t) => methodOf(t as CodeTool<unknown>, "  ")).join("\n")}\n};`;
}

/** search: the tools whose name, title, description or parameters hold every word of the query (none: all of them). */
export function searchApi<C>(tools: readonly CodeTool<C>[], query = ""): { query: string; tools: string[]; api: string; how: string } {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const hay = (t: CodeTool<C>) => `${t.name} ${t.title} ${t.description} ${Object.keys((t.inputSchema.properties ?? {}) as Json).join(" ")}`.toLowerCase().replace(/_/g, " ");
  const hit = allowedTools(tools).filter((t) => words.every((w) => hay(t).includes(w.replace(/_/g, " "))));
  return {
    query,
    tools: hit.map((t) => t.name),
    api: hit.length ? apiDeclarations(tools, hit.map((t) => t.name)) : "",
    how: "Write the body of an async function (or one `async () => { ... }`) that awaits purser.<tool>(args) and returns plain JSON data. It runs in an isolate with no network and no secrets; it can only read this company's books.",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The host side of a run: the one function the isolate may call, checked here.

export interface CallRecord { tool: string; outcome: "ok" | CodemodeErrorCode; ms: number }
interface Budget { calls: number; bytes: number; closed: boolean; records: CallRecord[] }
type CallFn = (name: unknown, argsJson: unknown) => Promise<string>;

const enc = new TextEncoder();
const bytesOf = (s: string) => enc.encode(s).byteLength;
const fail = (code: CodemodeErrorCode, message: string = CODEMODE_ERRORS[code]) => JSON.stringify({ ok: false, error: { code, message: redact(message).slice(0, 500) } });

/** The code of a tool's refusal ({"error":{"code"}} in its second text item, as ./mcp.ts refuse() writes it). */
function refusalOf(r: { content: { type: string; text?: string }[] }): { code: CodemodeErrorCode; message: string } {
  const first = r.content[0]?.text ?? "refused";
  try {
    const e = (JSON.parse(r.content[1]?.text ?? "{}") as { error?: { code?: unknown } }).error;
    return { code: isCode(e?.code) ? e.code : "tool_failed", message: first };
  } catch { return { code: "tool_failed", message: first }; }
}

/** The function handed to the isolate: allow-list, arguments, the company's own data, the budget. */
export function hostCall<C>(tools: readonly CodeTool<C>[], ctx: C, budget: Budget, clock: () => number, isBadRequest: (e: unknown) => boolean): CallFn {
  const allow = new Map(allowedTools(tools).map((t) => [t.name, t] as const));
  return async (name, argsJson) => {
    const t0 = clock();
    const tool = typeof name === "string" && TOOL_NAME.test(name) ? allow.get(name) : undefined;
    const label = typeof name === "string" ? name.slice(0, 64) : "(not a name)";
    const done = (outcome: CallRecord["outcome"], out: string) => { budget.records.push({ tool: label, outcome, ms: clock() - t0 }); return out; };
    if (budget.closed) return done("late_call", fail("late_call"));
    if (++budget.calls > CODEMODE_LIMITS.toolCalls) return done("too_many_calls", fail("too_many_calls", `more than ${CODEMODE_LIMITS.toolCalls} tool calls in one run`));
    if (!tool) {
      const named = typeof name === "string" && TOOL_NAME.test(name) ? name : "";
      if (named && NEVER_IN_CODE.test(named)) return done("not_available_in_code_mode", fail("not_available_in_code_mode"));
      return done("unknown_tool", fail("unknown_tool", `no read tool ${label}; search shows the API`));
    }
    let args: unknown = {};
    if (argsJson !== undefined && argsJson !== "") {
      if (typeof argsJson !== "string" || argsJson.length > CODEMODE_LIMITS.argsChars) return done("invalid_arguments", fail("invalid_arguments", `the arguments must be one JSON object of at most ${CODEMODE_LIMITS.argsChars} characters`));
      try { args = JSON.parse(argsJson); } catch { return done("invalid_arguments", fail("invalid_arguments", "the arguments are not JSON")); }
    }
    if (args === null || typeof args !== "object" || Array.isArray(args)) return done("invalid_arguments", fail("invalid_arguments", "the arguments must be one object"));
    const parsed = tool.args.safeParse(args);
    if (!parsed.success) return done("invalid_arguments", fail("invalid_arguments", `${tool.name}: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ")}`));
    let r: Awaited<ReturnType<CodeTool<C>["run"]>>;
    try { r = await tool.run(ctx, parsed.data); } catch (e) {
      if (isBadRequest(e)) return done("could_not_answer", fail("could_not_answer", `${tool.name} could not answer: ${(e as Error).message}`));
      return done("tool_failed", fail("tool_failed"));
    }
    if (budget.closed) return done("late_call", fail("late_call"));
    if (r.isError) { const e = refusalOf(r); return done(e.code, fail(e.code, e.message)); }
    const out = JSON.stringify({ ok: true, data: r.structuredContent ?? null });
    const n = bytesOf(out);
    if (n > CODEMODE_LIMITS.answerBytes) return done("answer_too_large", fail("answer_too_large", `${tool.name}'s answer is ${n} bytes, over ${CODEMODE_LIMITS.answerBytes}; ask for less`));
    if ((budget.bytes += n) > CODEMODE_LIMITS.totalAnswerBytes) return done("answer_too_large", fail("answer_too_large", `the run's answers passed ${CODEMODE_LIMITS.totalAnswerBytes} bytes`));
    return done("ok", out);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The isolate: what runs in it, and how it is started.

/** The code as the body of the task's async function. A whole `async () => { ... }` is called. */
export function taskBody(code: string): string {
  return /^\s*async\s*(\(\s*\)|\w+)\s*=>\s*\{[\s\S]*\}\s*;?\s*$/.test(code) || /^\s*async\s+function\s*\w*\s*\(\s*\)\s*\{[\s\S]*\}\s*;?\s*$/.test(code)
    ? `return await (${code.trim().replace(/;\s*$/, "")})();`
    : code;
}

/**
 * The isolate's modules: main.js (its entrypoint, ours) and task.js (the model's code as one async function). main.js
 * builds the typed `purser` object (one method per allowed tool, frozen; each sends its name and JSON arguments to the
 * host's call function), keeps console output in a bounded list, drops the globals a run never needs, then imports and
 * runs the task. What it returns is untrusted: the host checks every field (runInSandbox).
 */
export function sandboxModules(code: string, toolNames: readonly string[]): Record<string, string> {
  const L = CODEMODE_LIMITS;
  const main = `import { WorkerEntrypoint } from "cloudflare:workers";
const NAMES = ${JSON.stringify(toolNames)};
class PurserError extends Error { constructor(code, message) { super(message); this.name = "PurserError"; this.code = code; } }
export default class PurserCodeRun extends WorkerEntrypoint {
  async evaluate(call) {
    const logs = [];
    const line = (tag) => (...a) => { if (logs.length >= ${L.logLines}) return; logs.push((tag + a.map((x) => { if (typeof x === "string") return x; try { return JSON.stringify(x); } catch { return String(x); } }).join(" ")).slice(0, ${L.logLineChars})); };
    for (const [k, tag] of [["log", ""], ["info", ""], ["debug", ""], ["warn", "[warn] "], ["error", "[error] "]]) { try { console[k] = line(tag); } catch {} }
    const purser = Object.freeze(Object.fromEntries(NAMES.map((n) => [n, async (args) => {
      const raw = await call(n, args === undefined ? "" : JSON.stringify(args));
      const r = JSON.parse(raw);
      if (!r.ok) throw new PurserError(r.error.code, r.error.message);
      return r.data;
    }])));
    for (const k of ["fetch", "connect", "caches", "WebSocket", "EventSource", "XMLHttpRequest", "navigator"]) {
      try { delete globalThis[k]; } catch {}
      if (k in globalThis) { try { Object.defineProperty(globalThis, k, { value: undefined, writable: false, configurable: false }); } catch { try { globalThis[k] = undefined; } catch {} } }
    }
    try {
      const task = (await import("./task.js")).default;
      const value = await task(purser, PurserError);
      let json;
      try { json = JSON.stringify(value === undefined ? null : value); } catch (e) { return { ok: false, code: "result_not_json", message: String(e && e.message || e), logs }; }
      if (typeof json !== "string") return { ok: false, code: "result_not_json", message: "the value has no JSON form", logs };
      return { ok: true, json, logs };
    } catch (e) {
      return { ok: false, code: e instanceof PurserError ? e.code : "code_threw", message: String(e && e.message || e), logs };
    }
  }
}
`;
  return { "main.js": main, "task.js": `export default async function task(purser, PurserError) {\n${taskBody(code)}\n}\n` };
}

/** The Worker Loader binding's part used here (Cloudflare Dynamic Workers: env.LOADER, worker_loaders in wrangler). */
export interface CodeLoader {
  load(code: {
    compatibilityDate: string; compatibilityFlags?: string[]; mainModule: string; modules: Record<string, string>;
    env?: Record<string, unknown>; globalOutbound: null; limits?: { cpuMs?: number; subRequests?: number };
  }): { getEntrypoint(): { evaluate(call: CallFn): Promise<unknown> } & Partial<Disposable> } & Partial<Disposable>;
}

/** Where code runs. Production: a Dynamic Worker (workerLoaderExecutor). Tests may give their own. */
export interface SandboxExecutor {
  readonly kind: string;
  /** Runs the code with the call function as its only way out; resolves with the isolate's raw, unchecked answer. */
  run(input: { code: string; toolNames: readonly string[]; call: CallFn }): Promise<unknown>;
}

const disposeQuietly = (x: unknown) => { try { (x as Partial<Disposable> | null)?.[Symbol.dispose]?.(); } catch { /* disposal never masks the answer */ } };

/** A fresh Dynamic Worker per run (load, not get: nothing is cached or shared between runs, companies or tokens). */
export function workerLoaderExecutor(loader: CodeLoader): SandboxExecutor {
  return {
    kind: "worker-loader",
    async run({ code, toolNames, call }) {
      const worker = loader.load({
        compatibilityDate: SANDBOX_COMPATIBILITY_DATE,
        compatibilityFlags: [],
        mainModule: "main.js",
        modules: sandboxModules(code, toolNames),
        // No env: no binding, no variable, no secret in the isolate. No network: fetch() and connect() throw.
        env: {},
        globalOutbound: null,
        limits: { cpuMs: CODEMODE_LIMITS.cpuMs, subRequests: CODEMODE_LIMITS.subRequests },
      });
      const ep = worker.getEntrypoint();
      try { return await ep.evaluate(call); } finally { disposeQuietly(ep); disposeQuietly(worker); }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// A run.

export interface CodeRunResult {
  ok: boolean;
  result?: unknown;
  error?: { code: CodemodeErrorCode; message: string };
  logs: string[];
  calls: CallRecord[];
  duration_ms: number;
  sandbox: string;
}

export interface CodeRunOptions<C> {
  tools: readonly CodeTool<C>[];
  ctx: C;
  code: unknown;
  executor: SandboxExecutor | null;
  /** Who ran it, for the log line: the company's id and the token's id (never a secret). */
  who: { tenant: string; principal: string };
  isBadRequest?: (e: unknown) => boolean;
  clock?: () => number;
  log?: (level: "info" | "warn", event: string, fields: Json) => void;
  /** A shorter wall-time limit than CODEMODE_LIMITS.wallMs (tests); never a longer one. */
  wallMs?: number;
}

const SANDBOX_DIED: [RegExp, string][] = [
  [/cpu|exceeded.*time|time limit/i, "the isolate ran out of CPU time"],
  [/memory/i, "the isolate ran out of memory"],
  [/hung|never generate a response/i, "the code waited on something that never settles"],
];

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Runs the model's code once, in the sandbox, and gives back only checked, bounded data. Never throws. */
export async function runCode<C>(o: CodeRunOptions<C>): Promise<CodeRunResult> {
  const clock = o.clock ?? (() => Date.now());
  const t0 = clock();
  const budget: Budget = { calls: 0, bytes: 0, closed: false, records: [] };
  const kind = o.executor?.kind ?? "none";
  const finish = async (r: Omit<CodeRunResult, "calls" | "duration_ms" | "sandbox">): Promise<CodeRunResult> => {
    budget.closed = true;
    const out: CodeRunResult = { ...r, calls: budget.records.slice(0, CODEMODE_LIMITS.toolCalls + 5), duration_ms: clock() - t0, sandbox: kind };
    const code = typeof o.code === "string" ? o.code : "";
    (o.log ?? logEvent)(out.ok ? "info" : "warn", "codemode.run", {
      tenant: o.who.tenant, principal: o.who.principal, sandbox: kind,
      code_sha256: code ? (await sha256Hex(code)).slice(0, 16) : null, code_chars: code.length,
      calls: budget.calls, tools: [...new Set(budget.records.map((x) => x.tool))].join(" ") || null,
      refused: budget.records.filter((x) => x.outcome !== "ok").length,
      outcome: out.ok ? "ok" : out.error!.code, duration_ms: out.duration_ms,
      output_bytes: out.ok ? bytesOf(JSON.stringify(out.result ?? null)) : 0,
    });
    return out;
  };
  if (typeof o.code !== "string" || !o.code.trim() || o.code.length > CODEMODE_LIMITS.codeChars) {
    return finish({ ok: false, error: { code: "invalid_code", message: `code must be text of 1 to ${CODEMODE_LIMITS.codeChars} characters` }, logs: [] });
  }
  if (!o.executor) return finish({ ok: false, error: { code: "sandbox_unavailable", message: CODEMODE_ERRORS.sandbox_unavailable }, logs: [] });
  const tools = allowedTools(o.tools);
  const call = hostCall(tools, o.ctx, budget, clock, o.isBadRequest ?? (() => false));
  const wallMs = Math.min(o.wallMs ?? CODEMODE_LIMITS.wallMs, CODEMODE_LIMITS.wallMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raw: unknown;
  try {
    raw = await Promise.race([
      o.executor.run({ code: o.code, toolNames: tools.map((t) => t.name), call }),
      new Promise<never>((_, no) => { timer = setTimeout(() => no(new RunTimeout()), wallMs); }),
    ]);
  } catch (e) {
    if (e instanceof RunTimeout) return finish({ ok: false, error: { code: "timeout", message: `the run passed ${wallMs} ms and was stopped` }, logs: [] });
    const msg = e instanceof Error ? e.message : String(e);
    // The runtime compiles the code's module when it loads the isolate: a syntax error is the code's own failure.
    if (/SyntaxError|Unexpected (token|end|identifier|string|number)|Invalid or unexpected|missing \) /i.test(msg)) return finish({ ok: false, error: { code: "code_threw", message: redact(`syntax error: ${msg}`).slice(0, 300) }, logs: [] });
    const why = SANDBOX_DIED.find(([re]) => re.test(msg))?.[1] ?? "the isolate stopped or could not load the code";
    return finish({ ok: false, error: { code: "sandbox_failed", message: why }, logs: [] });
  } finally { if (timer) clearTimeout(timer); }
  return finish(checkAnswer(raw));
}

class RunTimeout extends Error {}

/** The isolate's answer, checked field by field: anything malformed is the isolate's failure, not data. */
export function checkAnswer(raw: unknown): Omit<CodeRunResult, "calls" | "duration_ms" | "sandbox"> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Json;
  const logs = Array.isArray(r.logs) ? r.logs.filter((x): x is string => typeof x === "string").slice(0, CODEMODE_LIMITS.logLines).map((x) => redact(x.slice(0, CODEMODE_LIMITS.logLineChars))) : [];
  if (r.ok === true) {
    if (typeof r.json !== "string") return { ok: false, error: { code: "result_not_json", message: CODEMODE_ERRORS.result_not_json }, logs };
    const n = bytesOf(r.json);
    if (n > CODEMODE_LIMITS.outputBytes) return { ok: false, error: { code: "output_too_large", message: `the result is ${n} bytes, over ${CODEMODE_LIMITS.outputBytes}; return fewer rows or fields` }, logs };
    try { return { ok: true, result: JSON.parse(r.json) as unknown, logs }; } catch { return { ok: false, error: { code: "result_not_json", message: CODEMODE_ERRORS.result_not_json }, logs }; }
  }
  if (r.ok === false) {
    const code: CodemodeErrorCode = isCode(r.code) ? r.code : "code_threw";
    return { ok: false, error: { code, message: redact(typeof r.message === "string" ? r.message : CODEMODE_ERRORS[code]).slice(0, 500) }, logs };
  }
  return { ok: false, error: { code: "sandbox_failed", message: "the isolate gave no answer in the expected form" }, logs };
}
