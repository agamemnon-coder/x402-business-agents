// npm run smoke:judge: the live site as a judge meets it, checked in one go before judging (Sunday evening), with one
// screen of PASS / FAIL, each check's time, and how much of the day's budgets is left. Test money only.
//
//   1. Pages: the site's key pages answer 200 (as a browser asks, with no cookie); the MCP endpoints on purser-try
//      answer 401 to a call with no token (POST /mcp/airwallex and POST /mcp); /health raises no alert.
//   2. Two /try walks, as a judge on a laptop and on an iPhone: scripts/try-live-record.ts (the repository's own walk
//      recorder) in Chromium at 1440 px and in WebKit as an iPhone 15, each into a folder of the system's temp dir that
//      is deleted afterwards. From each record: every step passed, Claude read the invoices (source "claude", no
//      fallback to the parser), both Airwallex sandbox transfers PAID, the one-cent change refused, the proof valid on
//      /verify and with the repository's verifier.
//   3. /proof in a browser, desktop and phone: 200, no console error, no sideways scroll, the evidence wall drawn.
//   4. Headroom: with PURSER_ADMIN_TOKEN set (read here, never printed), the owner's read-only aggregates
//      (POST /v1/try/ops on purser-try): Claude spend today per pool and all time against the caps, and the capacity
//      switches; with the walks' own cost, how many more walks the day's cap allows. The kit11 limits that no route
//      shows (AWX_PAYOUT_DAY payouts a UTC day) are printed from the code, with the payouts this run used.
//
// What it spends: 2 walks = 4 test companies' worth of /try (2 starts each), 4 Airwallex SANDBOX payouts of the 100 a
// UTC day (worker/src/awxPayout.ts AWX_PAYOUT_DAY), and about USD 0.01 of Claude at list price. --no-walks skips
// part 2 (nothing spent). Exit 0 when every check passed, 1 otherwise.
//   npm run smoke:judge [-- --no-walks] [--base <url>] [--try-base <url>]
// The pure parts (the checks read from a walk's record, the headroom, the screen) are tested in test/smoke-judge.test.ts.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AWX_PAYOUT_DAY, AWX_PAYOUT_PER_COMPANY } from "../worker/src/awxPayout.js";
import { NUMBERS } from "../cloud/src/try/switches.js";

export const SITE = "https://kit11.max-31b.workers.dev";
export const TRY_HOST = "https://purser-try.max-31b.workers.dev";
/** The pages a judge opens from the README and the site's own links, each expected to answer 200. */
export const PAGES = ["/", "/try", "/proof", "/verify", "/runs", "/airwallex", "/visa", "/alta", "/security", "/status", "/docs", "/llms.txt", "/try/stage"] as const;
/** The walks: a laptop in Chromium and an iPhone in WebKit (Safari's engine), as scripts/try-live-record.ts takes them. */
export const WALKS = [
  { label: "desktop, Chromium 1440", profile: "desktop", browser: "chromium" },
  { label: "iPhone 15, WebKit", profile: "phone-iphone", browser: "webkit" },
] as const;

export interface Check { group: string; name: string; ok: boolean; ms: number | null; detail: string }

/** The parts of a try-live-record.ts record the checks read (its run-<n>.json). */
export interface WalkRecord {
  ok: boolean; failures: string[];
  steps_ms: Record<string, number | null>;
  answers: { path: string; body: Record<string, unknown> | null }[];
  events: { main: { event: string; fields: Record<string, unknown> }[]; cash: { event: string; fields: Record<string, unknown> }[] };
  bundle: { downloaded?: { repo_verifier?: { ok?: boolean } } | null; paid?: { repo_verifier?: { ok?: boolean } | null } | null };
  console_errors: string[];
}

/** What a judge's walk must show, read from its record: one check each, with the figure it rests on. */
export function walkChecks(label: string, r: WalkRecord): Check[] {
  const evs = [...r.events.main, ...r.events.cash];
  const reads = evs.filter((e) => e.event === "claude.read");
  const byClaude = reads.filter((e) => e.fields.source === "claude");
  const models = [...new Set(byClaude.map((e) => String(e.fields.model)))];
  const agentRuns = evs.filter((e) => e.event === "agent.run");
  const agentsDone = agentRuns.filter((e) => e.fields.status === "done");
  const cost = [...byClaude, ...agentRuns].reduce((k, e) => k + (typeof e.fields.cost_usd_micros === "number" ? e.fields.cost_usd_micros : 0), 0);
  const payouts = r.answers.filter((a) => /\/pay$/.test(a.path)).map((a) => a.body?.airwallex_payout as Record<string, unknown> | undefined).filter((p): p is Record<string, unknown> => !!p);
  const sandbox = payouts.filter((p) => p.source === "airwallex-sandbox");
  const notSent = payouts.filter((p) => p.source !== "airwallex-sandbox").map((p) => String(p.reason ?? p.source));
  const paid = r.answers.filter((a) => /payout\/simulate$/.test(a.path) && (a.body?.note as Record<string, unknown> | undefined)?.status === "PAID").length;
  const refused = r.answers.some((a) => /\/pay$/.test(a.path) && a.body?.outcome === "refused");
  const proofs = [r.bundle.downloaded?.repo_verifier?.ok === true, r.bundle.paid?.repo_verifier?.ok === true];
  const s = (k: string) => r.steps_ms[k] ?? null;
  const g = `walk: ${label}`;
  return [
    { group: g, name: "every step of the walk passed", ok: r.ok, ms: sum([s("start_ms"), s("read_120_ms"), s("autopay_ms"), s("read_1850_ms"), s("cfo_to_approved_ms"), s("sign_to_paid_on_screen_ms"), s("refusal_ms"), s("verify_ms"), s("hold_ms")]), detail: r.ok ? "all ok" : r.failures.slice(0, 2).join("; ") },
    { group: g, name: "Claude read the invoices (no fallback)", ok: reads.length > 0 && byClaude.length === reads.length, ms: s("read_1850_ms"), detail: `${byClaude.length} of ${reads.length} reads by Claude${models.length ? ` (${models.join(", ")})` : ""}; USD ${(cost / 1e6).toFixed(4)}` },
    { group: g, name: "Claude's agents answered", ok: agentRuns.length > 0 && agentsDone.length === agentRuns.length, ms: null, detail: `${agentsDone.length} of ${agentRuns.length} agent runs done` },
    { group: g, name: "Airwallex sandbox: transfers made and PAID", ok: sandbox.length === 2 && paid === 2, ms: s("autopay_awx_paid_ms"), detail: `${sandbox.length} of ${payouts.length} sent to the sandbox, ${paid} PAID${notSent.length ? `; not sent: ${notSent.join(", ")}` : ""}` },
    { group: g, name: "the one-cent change refused", ok: refused, ms: s("refusal_ms"), detail: refused ? "refused, nothing paid" : "no refusal seen" },
    { group: g, name: "both proofs valid (repository's verifier)", ok: proofs.every(Boolean), ms: s("verify_ms"), detail: `${proofs.filter(Boolean).length} of 2 valid` },
    { group: g, name: "no console error", ok: r.console_errors.length === 0, ms: null, detail: r.console_errors.length ? r.console_errors[0]!.slice(0, 80) : "0" },
  ];
}

const sum = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, x) => a + x!, 0));

/** The claude block of POST /v1/try/ops (cloud/src/try/adminPage.ts adminStats), and its switches. */
export interface Ops {
  claude?: { spent_today_by_pool?: Record<string, { micros: number | null; cap_micros: number }>; all_time?: { micros: number | null; cap_micros: number }; switch?: string };
  switches?: Record<string, string>;
  visitors?: { last_hour?: { started?: number }; last_day?: { started?: number } };
}

/**
 * The budgets left, as lines: Claude per pool and all time (with how many more walks of the measured cost fit), the
 * capacity switches against their ceilings, and the payouts a UTC day the code allows. Pure: everything comes in.
 */
export function headroom(ops: Ops | null, walkMicros: number | null, payoutsUsed: number): { lines: string[]; warnings: string[] } {
  const lines: string[] = [], warnings: string[] = [];
  const walks = (left: number) => (walkMicros && walkMicros > 0 ? `, about ${Math.floor(left / walkMicros).toLocaleString("en-GB")} walks` : "");
  const usd = (m: number) => `USD ${(m / 1e6).toFixed(2)}`;
  if (!ops) {
    lines.push("Claude caps: not read (set PURSER_ADMIN_TOKEN to read POST /v1/try/ops; the token is never printed)");
  } else {
    const c = ops.claude ?? {};
    if (c.switch !== "on") warnings.push("the claude switch is off: /try reads with Purser's code, not Claude");
    for (const pool of ["public", "jury", "event"]) {
      const p = c.spent_today_by_pool?.[pool];
      if (!p) continue;
      const left = Math.max(0, p.cap_micros - (p.micros ?? 0));
      lines.push(`Claude today, ${pool}: ${usd(p.micros ?? 0)} of ${usd(p.cap_micros)}; ${usd(left)} left${walks(left)}`);
      if (pool === "public" && p.cap_micros <= 0) warnings.push("cap_day_micros_public is 0: public visitors get no Claude");
    }
    if (c.all_time) {
      const left = Math.max(0, c.all_time.cap_micros - (c.all_time.micros ?? 0));
      lines.push(`Claude all time: ${usd(c.all_time.micros ?? 0)} of ${usd(c.all_time.cap_micros)}; ${usd(left)} left${walks(left)}`);
      if (walkMicros && left < walkMicros * 100) warnings.push(`all-time Claude cap: fewer than 100 walks left (${usd(left)})`);
    }
    const sw = ops.switches ?? {};
    const cap = (k: string) => {
      const v = /^\d+$/.test(sw[k] ?? "") ? Number(sw[k]) : NUMBERS[k]?.fallback ?? 0;
      return { v: Math.min(v, NUMBERS[k]?.ceiling ?? v), ceiling: NUMBERS[k]?.ceiling ?? v, set: sw[k] !== undefined };
    };
    const inflight = cap("max_inflight"), perAddr = cap("starts_per_address_hour"), perDay = cap("starts_per_day_public");
    lines.push(`Claude actions in flight at once (max_inflight): ${inflight.v} (ceiling ${inflight.ceiling})`);
    lines.push(`public starts per network an hour: ${perAddr.v}${perAddr.set ? "" : " (default)"} (ceiling ${perAddr.ceiling}); a day: ${perDay.v}${perDay.set ? "" : " (default)"}`);
    // 20 judges at once: about 10 actions in flight at the peak (docs/runs/2026-11-21-try-capacity.md).
    if (inflight.v < 12) warnings.push(`max_inflight is ${inflight.v}: 20 judges at once need about 12; set it to 20 (POST /v1/try/admin)`);
    // Judges behind one network (a venue's Wi-Fi): each walk starts 2 companies.
    if (perAddr.v < 40) warnings.push(`starts_per_address_hour is ${perAddr.v}: 20 judges on one network need 40 (2 a walk); set it to 50, or give them a jury link`);
    if (ops.visitors?.last_day?.started !== undefined) lines.push(`test companies started in the last 24 h: ${ops.visitors.last_day.started}`);
  }
  const walksLeft = Math.floor((AWX_PAYOUT_DAY - payoutsUsed) / AWX_PAYOUT_PER_COMPANY);
  lines.push(`Airwallex sandbox payouts a UTC day (code, AWX_PAYOUT_DAY): ${AWX_PAYOUT_DAY}, ${AWX_PAYOUT_PER_COMPANY} a walk; this run used ${payoutsUsed}, so at most ${walksLeft} more walks with payouts today (others' walks count too)`);
  return { lines, warnings };
}

/** The one screen: every check on a line, then the headroom, then PASS or FAIL. */
export function render(checks: Check[], room: { lines: string[]; warnings: string[] }, totalMs: number): string {
  const out: string[] = [];
  let group = "";
  for (const c of checks) {
    if (c.group !== group) { group = c.group; out.push(group); }
    const t = c.ms === null ? "" : `${(c.ms / 1000).toFixed(1)} s`;
    out.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(44)} ${t.padStart(7)}  ${c.detail}`);
  }
  out.push("headroom");
  for (const l of room.lines) out.push(`  ${l}`);
  for (const w of room.warnings) out.push(`  WARN  ${w}`);
  const failed = checks.filter((c) => !c.ok).length;
  out.push(failed ? `FAIL: ${failed} of ${checks.length} checks failed (${(totalMs / 1000).toFixed(0)} s)` : `PASS: all ${checks.length} checks passed (${(totalMs / 1000).toFixed(0)} s)${room.warnings.length ? `, ${room.warnings.length} warnings` : ""}`);
  return out.join("\n");
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The relay's /health (worker/src/core.ts): JSON whose alerts list is empty. Its status is "recorded_demo" between live runs. */
export function healthOk(text: string): boolean {
  try { const j = JSON.parse(text) as { alerts?: unknown }; return Array.isArray(j.alerts) && j.alerts.length === 0; } catch { return false; }
}

/** The pages and the endpoints that must refuse without a token. */
export async function pageChecks(o: { site: string; tryHost: string; fetch: Fetch }): Promise<Check[]> {
  const timed = async (name: string, url: string, init: RequestInit, want: (r: Response, text: string) => boolean, said: (r: Response) => string): Promise<Check> => {
    const t = Date.now();
    try {
      const r = await o.fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
      const text = await r.text();
      return { group: "pages", name, ok: want(r, text), ms: Date.now() - t, detail: said(r) };
    } catch (e) {
      return { group: "pages", name, ok: false, ms: Date.now() - t, detail: `no answer: ${(e as Error).message}` };
    }
  };
  const browser = { headers: { accept: "text/html,*/*", "user-agent": "purser-smoke-judge" } };
  const mcp = { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) };
  return Promise.all([
    ...PAGES.map((p) => timed(`${p} answers 200`, `${o.site}${p}`, browser, (r) => r.status === 200, (r) => String(r.status))),
    timed("/health raises no alert", `${o.site}/health`, {}, (r, t) => r.status === 200 && healthOk(t), (r) => String(r.status)),
    timed("MCP /mcp/airwallex refuses no token (401)", `${o.tryHost}/mcp/airwallex`, mcp, (r) => r.status === 401, (r) => String(r.status)),
    timed("MCP /mcp refuses no token (401)", `${o.tryHost}/mcp`, mcp, (r) => r.status === 401, (r) => String(r.status)),
  ]);
}

/** One walk by the repository's recorder, in its own process, into a temp folder that is removed afterwards. */
async function walk(w: (typeof WALKS)[number], n: number): Promise<{ checks: Check[]; micros: number | null; payouts: number }> {
  const dir = mkdtempSync(join(tmpdir(), "smoke-judge-"));
  try {
    const t = Date.now();
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, ["--import", "tsx", "scripts/try-live-record.ts", String(n), w.profile, dir], { env: { ...process.env, BROWSER: w.browser, NETWORK: "none" }, stdio: ["ignore", "ignore", "pipe"] });
      const kill = setTimeout(() => p.kill("SIGKILL"), 8 * 60_000);
      p.on("close", (c) => { clearTimeout(kill); resolve(c); });
    });
    let rec: WalkRecord;
    try { rec = JSON.parse(readFileSync(join(dir, `run-${n}.json`), "utf8")) as WalkRecord; } catch {
      return { checks: [{ group: `walk: ${w.label}`, name: "the walk wrote its record", ok: false, ms: Date.now() - t, detail: `recorder exited ${String(code)} with no record` }], micros: null, payouts: 0 };
    }
    const evs = [...rec.events.main, ...rec.events.cash];
    const micros = evs.filter((e) => e.event === "claude.read" || e.event === "agent.run").reduce((k, e) => k + (typeof e.fields.cost_usd_micros === "number" ? e.fields.cost_usd_micros : 0), 0);
    const payouts = rec.answers.filter((a) => /\/pay$/.test(a.path) && (a.body?.airwallex_payout as Record<string, unknown> | undefined)?.source === "airwallex-sandbox").length;
    return { checks: walkChecks(w.label, rec), micros, payouts };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** /proof in a browser, on a laptop and on an iPhone: 200, no console error, no sideways scroll, the wall drawn. */
async function proofChecks(site: string): Promise<Check[]> {
  const { launchBrowser } = await import("../test/browser/support/browser.js");
  const { IPHONE } = await import("./tryWalkNetwork.js");
  const out: Check[] = [];
  for (const [label, name, opts] of [["desktop, Chromium 1440", "chromium", { viewport: { width: 1440, height: 900 } }], ["iPhone 15, WebKit", "webkit", { ...IPHONE }]] as const) {
    const t = Date.now();
    const b = await launchBrowser(name);
    try {
      const page = await (await b.newContext(opts)).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      const res = await page.goto(`${site}/proof`, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(1_000);
      const seen = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth - window.innerWidth, text: document.body.innerText }));
      const wall = /\/try walks/.test(seen.text);
      const ok = res?.status() === 200 && errors.length === 0 && seen.wide <= 1 && wall;
      out.push({ group: "proof page", name: `/proof, ${label}`, ok, ms: Date.now() - t, detail: `${res?.status() ?? "no answer"}; ${errors.length} console errors; ${seen.wide > 1 ? `${seen.wide} px sideways scroll` : "no sideways scroll"}; ${wall ? "evidence wall drawn" : "no /try walks tile"}` });
    } catch (e) {
      out.push({ group: "proof page", name: `/proof, ${label}`, ok: false, ms: Date.now() - t, detail: (e as Error).message.split("\n")[0]! });
    } finally { await b.close(); }
  }
  return out;
}

async function opsOf(tryHost: string, fetch: Fetch): Promise<Ops | null> {
  const token = process.env.PURSER_ADMIN_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`${tryHost}/v1/try/ops`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: tryHost }, body: "{}", signal: AbortSignal.timeout(20_000) });
    return r.ok ? ((await r.json()) as Ops) : null;
  } catch { return null; }
}

export async function main(argv: string[], fetch: Fetch = globalThis.fetch): Promise<number> {
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const site = (arg("--base") ?? SITE).replace(/\/+$/, ""), tryHost = (arg("--try-base") ?? TRY_HOST).replace(/\/+$/, "");
  const t0 = Date.now();
  console.log(`smoke:judge on ${site} (test money only)${argv.includes("--no-walks") ? ", no walks" : ": 2 /try walks, 4 Airwallex sandbox payouts, about USD 0.01 of Claude"}`);
  const checks: Check[] = [...(await pageChecks({ site, tryHost, fetch }))];
  const micros: number[] = [];
  let payouts = 0;
  if (!argv.includes("--no-walks")) {
    if (site !== SITE) checks.push({ group: "walks", name: "walks run on the live site only", ok: false, ms: null, detail: `scripts/try-live-record.ts walks ${SITE}, not ${site}` });
    // One after the other: the walks share the day's payouts and one network's start limit, as two judges would.
    for (const [i, w] of WALKS.entries()) {
      const r = await walk(w, i + 1);
      checks.push(...r.checks);
      if (r.micros !== null) micros.push(r.micros);
      payouts += r.payouts;
    }
  }
  checks.push(...(await proofChecks(site)));
  const room = headroom(await opsOf(tryHost, fetch), micros.length ? Math.max(...micros) : null, payouts);
  console.log(render(checks, room, Date.now() - t0));
  return checks.every((c) => c.ok) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main(process.argv.slice(2)));
