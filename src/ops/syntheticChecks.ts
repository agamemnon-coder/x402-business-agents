// The hourly synthetic checks behind /status and /status.json (19 Nov). Once an hour the site's Worker (kit11,
// worker/wrangler.jsonc, its cron trigger) asks each public address below the way a visitor or a client would, from
// outside (the Worker's global fetch goes over the public internet: compatibility flag global_fetch_strictly_public),
// and keeps one row per address: when, the HTTP status, how long the whole answer took, and whether it passed
// (worker/src/statusDesk.ts, in the Worker's own Durable Object storage). /status and /status.json add the rows up:
// uptime and p50/p95 latency per address over 24 hours, 7 days and since the start.
//
// Honest by construction: the only rows are the checks that ran. Nothing is backfilled, nothing is estimated, and until
// the first check has run the page says so instead of showing a number. The checks were added on 19 Nov 2026
// (STATUS_SINCE); rows dated before it are never counted. A pass means the address answered with its own shape (a page
// that is HTML, /health's JSON, the engine's counts, an MCP initialize result), not only "something answered".
//
// Everything here is plain functions over an injected fetch and clock, so test/status-checks.test.ts runs it with a
// fake clock and fake answers.

/** HTML-escapes text (kept here so the Worker bundle pulls in nothing of the site's page code). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The day the hourly checks were added. The "since start" window never reaches before it. */
export const STATUS_SINCE = "2026-11-19";
const SINCE_MS = Date.parse(`${STATUS_SINCE}T00:00:00.000Z`);
export const STATUS_SITE = "https://kit11.max-31b.workers.dev";
/** Purser Cloud's test-money deployment, which serves the MCP server (src/ui/more.ts PURSER_CLOUD_MCP). */
export const STATUS_CLOUD = "https://purser-try.max-31b.workers.dev";
/** The demo company's public, read-only connector token (cloud/src/auth.ts DEMO_CONNECTOR_TOKEN; published on /docs). */
const DEMO_TOKEN = "purser-demo-read-only";
/** How long one address may take before it counts as failed. */
export const CHECK_TIMEOUT_MS = 10_000;
/** At most this much of an answer is read (a page is far smaller). */
const MAX_BODY = 2_000_000;

export interface CheckTarget {
  key: string;
  label: string;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** What the address must answer for the check to pass, in words (shown on /status.json). */
  expect: string;
  pass(status: number, contentType: string, body: string): boolean;
}

const isHtml = (status: number, type: string, body: string) => status === 200 && type.startsWith("text/html") && /<html[\s>]/i.test(body);
const parsed = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** MCP's initialize, as a client sends it first (Streamable HTTP, JSON answer). */
export const MCP_INITIALIZE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "purser-status-check", version: "1" } } });

/** The public addresses checked every hour, in the order /status lists them. */
export const CHECK_TARGETS: readonly CheckTarget[] = [
  { key: "home", label: "Home (/)", method: "GET", url: `${STATUS_SITE}/`, expect: "200, an HTML page", pass: isHtml },
  { key: "proof", label: "/proof", method: "GET", url: `${STATUS_SITE}/proof`, expect: "200, an HTML page", pass: isHtml },
  { key: "try", label: "/try", method: "GET", url: `${STATUS_SITE}/try`, expect: "200, an HTML page", pass: isHtml },
  {
    key: "health", label: "/health", method: "GET", url: `${STATUS_SITE}/health`, expect: "200 or 503 (an alarm), /health's JSON: a status and a list of alerts",
    // 503 is /health's own way of saying a live run has an alarm (worker/src/core.ts): the address answered as designed.
    pass: (status, _type, body) => { const b = obj(parsed(body)); return (status === 200 || status === 503) && !!b && typeof b.status === "string" && Array.isArray(b.alerts); },
  },
  {
    key: "try_api", label: "/try API, read (GET /v1/try/stage/stats)", method: "GET", url: `${STATUS_SITE}/v1/try/stage/stats`, expect: "200, JSON with the engine's counts",
    pass: (status, _type, body) => { const b = obj(parsed(body)); return status === 200 && !!b && !!obj(b.counts) && typeof b.live === "boolean"; },
  },
  {
    key: "mcp", label: "MCP initialize (POST /mcp, Purser Cloud)", method: "POST", url: `${STATUS_CLOUD}/mcp`, body: MCP_INITIALIZE,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${DEMO_TOKEN}` },
    expect: "200, a JSON-RPC result whose serverInfo.name is purser",
    pass: (status, _type, body) => { const b = obj(parsed(body)); const info = obj(obj(b?.result)?.serverInfo); return status === 200 && b?.jsonrpc === "2.0" && info?.name === "purser"; },
  },
];

/** One check of one address. status 0: no HTTP answer at all (a timeout or a network error, said in `error`). */
export interface CheckRow { at: string; target: string; status: number; ms: number; ok: boolean; error: string | null }

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Asks every address once, one after the other, timing each to its full answer on the clock given. */
export async function runChecks(fetchFn: FetchLike, now: () => number, targets: readonly CheckTarget[] = CHECK_TARGETS, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const t of targets) {
    const start = now();
    const at = new Date(start).toISOString();
    let status = 0, ok = false, error: string | null = null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(t.url, { method: t.method, headers: { "user-agent": "purser-status-check/1 (+/status)", ...t.headers }, ...(t.body ? { body: t.body } : {}), redirect: "manual", signal: ac.signal });
      status = res.status;
      const body = (await res.text()).slice(0, MAX_BODY);
      ok = t.pass(status, (res.headers.get("content-type") ?? "").toLowerCase(), body);
      if (!ok) error = `unexpected answer (expected ${t.expect})`;
    } catch (e) {
      error = ac.signal.aborted ? `no answer within ${timeoutMs / 1000} s` : `network error: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
    } finally {
      clearTimeout(timer);
    }
    rows.push({ at, target: t.key, status, ms: Math.max(0, Math.round(now() - start)), ok, error });
  }
  return rows;
}

/** The p-th percentile (0 < p <= 100) of sorted numbers, nearest-rank: a value that was measured, never interpolated. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]!;
}

export interface WindowStats {
  checks: number;
  passed: number;
  /** passed / checks, in percent with two decimals; null with no check in the window. */
  uptime_pct: number | null;
  /** Over the checks that got an HTTP answer (a timeout has no latency); null with none. */
  p50_ms: number | null;
  p95_ms: number | null;
}
export type WindowKey = "24h" | "7d" | "all";
export const WINDOWS: readonly { key: WindowKey; ms: number | null; label: string }[] = [
  { key: "24h", ms: 24 * 3600_000, label: "Last 24 h" },
  { key: "7d", ms: 7 * 24 * 3600_000, label: "Last 7 days" },
  { key: "all", ms: null, label: "Since start" },
];

export interface EndpointSummary {
  key: string; label: string; method: string; url: string; expect: string;
  last: { at: string; ok: boolean; status: number; ms: number; error: string | null } | null;
  windows: Record<WindowKey, WindowStats>;
}
export interface StatusSummary {
  /** "no_checks_yet" until the first check has run: no number is shown before that. */
  state: "no_checks_yet" | "checked";
  since: string;
  generated_at: string;
  first_check_at: string | null;
  last_check_at: string | null;
  checks: number;
  interval: string;
  method: string;
  endpoints: EndpointSummary[];
}

export const SUMMARY_METHOD = "Each address is asked once an hour by the site's own Worker (a Cloudflare cron trigger), over the public internet, with a 10 s limit. A check passes when the address answers with its own shape (see each address's expect). Uptime is passed checks over checks in the window. Latency is the time to the full answer, p50 and p95 by nearest rank over the checks that got an HTTP answer. Only checks that ran are counted: nothing is backfilled or estimated.";

function stats(rows: readonly CheckRow[]): WindowStats {
  const passed = rows.filter((r) => r.ok).length;
  const ms = rows.filter((r) => r.status > 0).map((r) => r.ms).sort((a, b) => a - b);
  return { checks: rows.length, passed, uptime_pct: rows.length ? Math.round((passed / rows.length) * 10_000) / 100 : null, p50_ms: percentile(ms, 50), p95_ms: percentile(ms, 95) };
}

/** Adds the stored rows up, as of `nowMs`. Rows before STATUS_SINCE, or in the future, are not counted. */
export function summarize(all: readonly CheckRow[], nowMs: number, targets: readonly CheckTarget[] = CHECK_TARGETS): StatusSummary {
  const rows = all.filter((r) => { const t = Date.parse(r.at); return Number.isFinite(t) && t >= SINCE_MS && t <= nowMs; }).sort((a, b) => a.at.localeCompare(b.at));
  const endpoints = targets.map((t): EndpointSummary => {
    const mine = rows.filter((r) => r.target === t.key);
    const last = mine.at(-1);
    const windows = Object.fromEntries(WINDOWS.map((w) => [w.key, stats(w.ms === null ? mine : mine.filter((r) => Date.parse(r.at) > nowMs - w.ms!))])) as Record<WindowKey, WindowStats>;
    return { key: t.key, label: t.label, method: t.method, url: t.url, expect: t.expect, last: last ? { at: last.at, ok: last.ok, status: last.status, ms: last.ms, error: last.error } : null, windows };
  });
  return {
    state: rows.length ? "checked" : "no_checks_yet", since: STATUS_SINCE, generated_at: new Date(nowMs).toISOString(),
    first_check_at: rows[0]?.at ?? null, last_check_at: rows.at(-1)?.at ?? null, checks: rows.length, interval: "hourly", method: SUMMARY_METHOD, endpoints,
  };
}

// ── /status's card, rendered by the Worker into the page (no script: the numbers are in the HTML) ──

/** The card's place in /status's HTML (src/redesign/status.ts): the Worker replaces what is between the two. */
export const CHECKS_START = "<!--status-checks-->";
export const CHECKS_END = "<!--/status-checks-->";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (iso: string) => `${day(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;
const pct = (s: WindowStats) => (s.uptime_pct === null ? "—" : `${s.uptime_pct.toFixed(2)}%`);
const lat = (s: WindowStats) => (s.p50_ms === null ? "—" : `${s.p50_ms} / ${s.p95_ms} ms`);

/** The card's inner HTML for a summary; null: the checks could not be read just now. Text from the store is escaped. */
export function checksHtml(s: StatusSummary | null): string {
  if (!s) return `<p>The hourly checks could not be read just now.</p>`;
  const sinceWords = `Hourly checks, added on ${day(`${s.since}T00:00:00Z`)}`;
  if (s.state === "no_checks_yet") return `<p>${esc(sinceWords)}. No check has run yet: the first runs at the next hour. Nothing before it is shown or filled in.</p>`;
  const first = s.first_check_at!;
  const head = first.slice(0, 10) === s.since ? `Hourly checks since ${day(first)} (first check ${when(first)})` : `${sinceWords}; first check on record ${when(first)}`;
  const rows = s.endpoints.map((e) => `<tr><th scope="row">${esc(e.label)}</th><td>${e.last ? `${e.last.ok ? "Pass" : "Fail"} <span class="muted">${e.last.status || "no answer"}</span>` : "—"}</td>${WINDOWS.map((w) => `<td>${pct(e.windows[w.key])}<br><span class="muted">${e.windows[w.key].checks} checks · ${lat(e.windows[w.key])}</span></td>`).join("")}</tr>`).join("");
  return `<p>${esc(head)}. ${s.checks} checks on record, the latest ${when(s.last_check_at!)}.</p>
    <div class="ck-wrap"><table class="ck"><thead><tr><th scope="col">Address</th><th scope="col">Last</th>${WINDOWS.map((w) => `<th scope="col">${w.key === "all" ? `Since ${esc(day(first))}` : esc(w.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted">Uptime, then checks · p50 / p95 latency to the full answer.</p>`;
}

/** /status with the checks' card filled in (the page as built, with the card's static text between the markers). */
export function withChecks(page: string, s: StatusSummary | null): string {
  const a = page.indexOf(CHECKS_START), b = page.indexOf(CHECKS_END);
  if (a < 0 || b < a) return page;
  return page.slice(0, a + CHECKS_START.length) + checksHtml(s) + page.slice(b);
}
