// Code Mode in a real isolate (docs/codemode.md): Code Mode's host code (cloud/src/claude/codemode.ts) in local workerd
// with a real Worker Loader binding (worker_loaders), each run in a fresh Dynamic Worker, over two made-up companies
// (test/support/codemodeWorkerd.ts). Model-written code that tries to get out is stopped by the runtime or by the host:
// fetch() and sockets (no network), eval and new Function, the loader's env and its secret, process.env, prototype
// pollution (it stays in its own isolate and is gone the next run), another company's books, a tool off the list,
// a state-changing tool, too many calls, a huge answer and a huge result, a run that never settles, and console spam.
// Every run leaves one log line with the tools, the outcome and the code's hash, never the code or the data.
//
// Not covered here: a synchronous infinite loop or a memory bomb. Local workerd does not enforce the Worker Loader's
// cpuMs limit (tried 21 Nov: a while(true) blocked the test's workerd until killed), so those are Cloudflare's to stop
// in production (limits.cpuMs, the isolate's memory limit); test/cloud-codemode.test.ts checks the limits are passed.
//
// Runs only with CLOUD_DB=d1 (npm run test:d1) or CODEMODE_WORKERD=on, where wrangler's toolchain is installed
// (npm ci --prefix worker). Local only: no network, no Cloudflare account, nothing kept.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeRunResult } from "../cloud/src/claude/codemode.js";

interface Workerd { ready: Promise<void>; fetch(url: string, init?: RequestInit): Promise<Response>; dispose(): Promise<void> }
interface Wrangler { unstable_startWorker(options: { config: string; dev: Record<string, unknown> }): Promise<Workerd> }

const ON = process.env.CLOUD_DB === "d1" || process.env.CODEMODE_WORKERD === "on";
/** A made-up value in the loader Worker's env, not a secret: no run may ever see it. */
const SENTINEL = "sentinel-not-a-real-secret-7f3a";

describe("Code Mode in local workerd: a real Worker Loader isolate per run", () => {
  if (!ON) {
    it.skip("skipped in the plain run: it needs wrangler's toolchain (CLOUD_DB=d1 or CODEMODE_WORKERD=on)", () => undefined);
    return;
  }
  let dir: string;
  let w: Workerd | undefined;
  const run = async (code: string, tenant: "A" | "B" = "A", wallMs?: number): Promise<CodeRunResult> => {
    const r = await w!.fetch("http://codemode.test/run", { method: "POST", body: JSON.stringify({ tenant, code, ...(wallMs ? { wallMs } : {}) }) });
    const text = await r.text();
    expect(text).not.toContain(SENTINEL);
    return JSON.parse(text) as CodeRunResult;
  };

  beforeAll(async () => {
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];
    process.env.WRANGLER_SEND_METRICS = "false";
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
    const wrangler = createRequire(resolve("worker/package.json"))("wrangler") as Wrangler;
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "codemode-"));
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify({
      name: "codemode-test", main: resolve("test/support/codemodeWorkerd.ts"), compatibility_date: "2026-10-01",
      worker_loaders: [{ binding: "LOADER" }], vars: { SECRET_SENTINEL: SENTINEL },
    }));
    w = await wrangler.unstable_startWorker({ config: join(dir, "wrangler.json"), dev: { persist: false, watch: false, remote: false, inspector: false, logLevel: "error", server: { hostname: "127.0.0.1", port: 0 } } });
    await w.ready;
  }, 120_000);
  afterAll(async () => { await w?.dispose(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("runs typed code against the company's own books and returns only what it returns", async () => {
    const r = await run(`const p = await purser.list_invoices({ status: "waiting_cfo" });
      console.log("found", p.items.length);
      return { count: p.items.length, ids: p.items.map((i) => i.id) };`);
    expect(r).toMatchObject({ ok: true, result: { count: 1, ids: ["A-0001"] }, logs: ["found 1"], sandbox: "worker-loader" });
    expect(r.calls).toEqual([expect.objectContaining({ tool: "list_invoices", outcome: "ok" })]);
    // A whole async arrow is called as well.
    expect(await run("async () => { const a = await purser.get_invoice({ id: 'A-0002' }); return a.invoice.vendor; }")).toMatchObject({ ok: true, result: "Lumen" });
  });

  it("no network: fetch() and a socket throw inside the isolate", async () => {
    const f = await run("return await fetch('https://example.com/').then((r) => r.status)");
    expect(f).toMatchObject({ ok: false, error: { code: "code_threw" } });
    // The prelude removed fetch; were it reachable, the runtime would still refuse (globalOutbound: null), as the socket shows.
    expect(f.error!.message).toMatch(/fetch is not a function|not permitted to access the internet/);
    const s = await run("const { connect } = await import('cloudflare:sockets'); const k = connect('1.1.1.1:80'); await k.opened; return 'open'");
    expect(s.ok).toBe(false);
    expect(s.error!.message).toMatch(/not permitted to access the internet/);
    // The globals the prelude drops are gone.
    expect(await run("return [typeof fetch, typeof caches, typeof WebSocket]")).toMatchObject({ ok: true, result: ["undefined", "undefined", "undefined"] });
  });

  it("no code from strings: eval and new Function are refused by the runtime", async () => {
    for (const code of ["return eval('1 + 1')", "return new Function('return 1')()", "return (async function(){}).constructor('return 1')()"]) {
      const r = await run(code);
      expect(r.ok, code).toBe(false);
    }
    expect((await run("return eval('1 + 1')")).error!.message).toMatch(/Code generation from strings disallowed/);
  });

  it("no env and no secret: the loader's env, process.env and globalThis hold nothing of the host", async () => {
    const r = await run(`const seen = [];
      for (const k of Object.getOwnPropertyNames(globalThis)) { try { const v = globalThis[k]; if (typeof v === "string") seen.push(k + "=" + v); } catch {} }
      return { env: typeof env, penv: typeof process === "object" ? Object.keys(process.env ?? {}) : "none", self: typeof this, strings: seen, keys: Object.getOwnPropertyNames(globalThis).filter((k) => /secret|loader|sentinel|env/i.test(k)) };`);
    expect(r).toMatchObject({ ok: true, result: { env: "undefined", penv: [], self: "undefined", keys: [] } });
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
  });

  it("prototype pollution stays in its own isolate, and the next run starts clean", async () => {
    const a = await run("Object.prototype.polluted = 'yes'; Array.prototype.map = () => ['hijacked']; JSON.parse = () => ({ ok: true, data: 'forged' }); return 1");
    expect(a).toMatchObject({ ok: true, result: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await run("return [({}).polluted ?? null, [1].map((x) => x + 1)]")).toMatchObject({ ok: true, result: [null, [2]] });
    // Arguments that try to smuggle a prototype are refused by the tool's strict schema, on the host.
    const p = await run("return await purser.list_invoices(JSON.parse('{\"__proto__\": {\"status\": \"paid\"}}'))");
    expect(p).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
  });

  it("one company: another company's invoice is not found, and no argument names a company", async () => {
    expect(await run("return await purser.get_invoice({ id: 'B-0001' })", "A")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await run("return await purser.get_invoice({ id: 'B-0001' })", "B")).toMatchObject({ ok: true, result: { invoice: { vendor: "Other Co" } } });
    expect(await run("return await purser.list_invoices({ tenant: 'B' })", "A")).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
    const all = await run("return (await purser.list_invoices()).items.map((i) => i.id)", "A");
    expect(all).toMatchObject({ ok: true, result: ["A-0001", "A-0002"] });
  });

  it("only the read tools: a state-changing tool is not in the API, and the host refuses it however it is asked for", async () => {
    expect(await run("return Object.keys(purser)")).toMatchObject({ ok: true, result: ["list_invoices", "get_invoice", "big_report"] });
    const r = await run("return await purser.propose_invoice_payment({ invoice_id: 'A-0001' })");
    expect(r).toMatchObject({ ok: false, error: { code: "code_threw" } });
    expect(r.error!.message).toMatch(/not a function/);
    // purser is frozen: adding a method sends nothing new to the host.
    expect(await run("try { purser.x = 1 } catch (e) { return 'frozen' } return Object.isFrozen(purser)")).toMatchObject({ ok: true });
  });

  it("limits: too many calls, an answer too large, a result too large, console spam", async () => {
    const many = await run("for (let i = 0; i < 40; i++) await purser.list_invoices(); return 'done'");
    expect(many).toMatchObject({ ok: false, error: { code: "too_many_calls" } });
    expect(many.calls.length).toBeGreaterThan(25);
    expect(await run("return await purser.big_report()")).toMatchObject({ ok: false, error: { code: "answer_too_large" } });
    const big = await run("return 'x'.repeat(1000000)");
    expect(big).toMatchObject({ ok: false, error: { code: "output_too_large" } });
    expect(JSON.stringify(big).length).toBeLessThan(5_000);
    const spam = await run("for (let i = 0; i < 10000; i++) console.log('line ' + i + ' ' + 'y'.repeat(5000)); return 1");
    expect(spam.ok).toBe(true);
    expect(spam.logs.length).toBe(40);
    expect(Math.max(...spam.logs.map((l) => l.length))).toBeLessThanOrEqual(300);
    expect(await run("const o = {}; o.self = o; return o")).toMatchObject({ ok: false, error: { code: "result_not_json" } });
  });

  it("a run that never settles is stopped, and the host stays up", async () => {
    const hang = await run("await new Promise(() => {}); return 1");
    expect(hang.ok).toBe(false);
    expect(["sandbox_failed", "timeout"]).toContain(hang.error!.code);
    const slow = await run("await new Promise((r) => setTimeout(r, 5000)); return 1", "A", 1_000);
    expect(slow).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(await run("return 2 + 2")).toMatchObject({ ok: true, result: 4 });
  });

  it("a syntax error, a thrown error and code that breaks out of its function are the code's own failure", async () => {
    expect(await run("return {{")).toMatchObject({ ok: false, error: { code: "code_threw" } });
    expect(await run("throw new Error('nope')")).toMatchObject({ ok: false, error: { code: "code_threw", message: "nope" } });
    // Closing the task's function and writing module code: it is still inside the same isolate, with nothing to reach.
    const out = await run("return 1 }\nglobalThis.leak = 1; export const x = 2; async function y() {");
    expect(["code_threw", undefined]).toContain(out.error?.code);
  });

  it("observability: one log line per run with the tools, the outcome and the code's hash, never the code or the data", async () => {
    await w!.fetch("http://codemode.test/logs");
    await run("const p = await purser.get_invoice({ id: 'A-0001' }); return p.invoice.vendor");
    await run("return await purser.get_invoice({ id: 'B-0001' })");
    const lines = await (await w!.fetch("http://codemode.test/logs")).json() as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: "info", event: "codemode.run", tenant: "t_A", sandbox: "worker-loader", calls: 1, tools: "get_invoice", refused: 0, outcome: "ok" });
    expect(lines[1]).toMatchObject({ level: "warn", outcome: "not_found", refused: 1 });
    expect(lines[0]!.code_sha256).toMatch(/^[0-9a-f]{16}$/);
    const text = JSON.stringify(lines);
    for (const leak of ["Bergtex", "A-0001", "purser.get_invoice", SENTINEL]) expect(text).not.toContain(leak);
  });
});
