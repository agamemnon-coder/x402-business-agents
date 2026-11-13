// npm run judge: the recorded demo and the simulated month, on this computer, with no keys and no network.
// A fresh clone needs only `npm ci` first. It serves:
//   /       Home, as on the hosted relay (with a query, such as ?autonomy, the CFO dashboard's page)
//   /demo   the recorded live run, step by step (docs/demo/story.json)
//   /month  a month in 90 seconds (simulated, seeded)
//   /?autonomy  the main run's CFO dashboard (docs/demo/main-run.json, the run every page plays)
//   /?recorded  the CFO's dashboard at the end of the 30 October run, an earlier recording (docs/demo/snapshot.json)
// and opens the browser. `--no-open` only serves; `--check` serves, fetches each page once and exits.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { AIRWALLEX_CSP, AIRWALLEX_PAGE, CLAUDE_CSP, CLAUDE_PAGE, HOME_CSP, HOME_PAGE, NOT_FOUND_CSP, NOT_FOUND_PAGE, PROOF_CSP, PROOF_PAGE, REDIRECTS, TRACE_CSP, TRACE_PAGE, RUNS_CSP, RUNS_PAGE, AGENT_PAGES, AGENT_CSPS, WATCH_CSP, WATCH_PAGE, FILM_WATCH_CSP, FILM_WATCH_PAGE, CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, FILM_STILLS, DOWNLOADS, METAL_CSP, METAL_PAGE, METAL_REPORT, METAL_REPORT_CSP, MONTH_CSP, VISA_CSP, VISA_PAGE, PAGE, TRY_CSP, TRY_PAGE_OFFLINE, demoPage, filmPage, labPage, livePage, monthPage, T0_CSP, T0_PAGE, BOOKS_CSP, BOOKS_PAGE, sendInspector, PRICING_CSP, PRICING_PAGE, SECURITY_CSP, SECURITY_PAGE, DOCS_CSP, DOCS_PAGE, MOVED, TOUR_CSP, TOUR_PAGE, STATUS_OFFLINE_CSP, STATUS_PAGE_OFFLINE } from "../servers/dashboard.js";
import { readFileSync } from "node:fs";
import { loadRecord } from "../redesign/run.js";
import { localTryAnswer } from "../try/local.js";
import { METAL_INSPECTOR_PATH } from "../../worker/src/metalInspector.js";

export async function startJudge(port: number): Promise<{ server: Server; url: string }> {
  const app = express();
  app.disable("x-powered-by");
  const page = (csp: string, html: () => string) => (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.type("html").send(html());
  };
  const demo = demoPage();
  const month = monthPage();
  // "/" as the relay answers it (worker/src/core.ts): Home itself, and with a query (?recorded, ?autonomy, ?signin…) the
  // CFO dashboard's page.
  const dashboard = page(CSP, () => PAGE);
  const home = page(HOME_CSP, () => HOME_PAGE);
  app.get("/", (req, res) => (new URL(req.originalUrl, "http://judge.local").search ? dashboard : home)(req, res));
  app.get("/home", home);
  app.get("/watch", page(FILM_WATCH_CSP, () => FILM_WATCH_PAGE));
  app.get("/replay", page(WATCH_CSP, () => WATCH_PAGE));
  app.get("/proof", page(PROOF_CSP, () => PROOF_PAGE));
  app.get("/trace", page(TRACE_CSP, () => TRACE_PAGE));
  app.get("/runs", page(RUNS_CSP, () => RUNS_PAGE));
  for (const id of Object.keys(AGENT_PAGES)) app.get(`/agents/${id}`, page(AGENT_CSPS[id]!, () => AGENT_PAGES[id]!));
  for (const [from, to] of Object.entries(REDIRECTS)) app.get(from, (_req, res) => { res.redirect(302, to); });
  for (const [from, to] of Object.entries(MOVED)) app.get(from, (_req, res) => { res.redirect(301, to); });
  app.get("/demo", page(DEMO_CSP, () => demo));
  app.get("/month", page(MONTH_CSP, () => month));
  const live = livePage();
  app.get("/live", page(LIVE_CSP, () => live));
  const film = filmPage();
  app.get("/film", page(FILM_CSP, () => film));
  app.get("/try", page(TRY_CSP, () => TRY_PAGE_OFFLINE));
  // Try Purser without keys: code reads the request; the hosted relay page asks Claude.
  app.post("/api/try", express.json({ limit: "2kb" }), async (req, res) => {
    const a = await localTryAnswer(req.body, "this offline copy asks no model; the hosted page does");
    res.status(a.status).json(a.json);
  });
  const lab = labPage();
  app.get("/lab", page(LAB_CSP, () => lab));
  app.get("/metal", page(METAL_CSP, () => METAL_PAGE));
  // /metal's read-only inspector, as a local copy answers it: the record's read of 12 November, no chain call, no secret.
  app.get(METAL_INSPECTOR_PATH, (_req, res) => { void sendInspector(res); });
  app.get("/visa", page(VISA_CSP, () => VISA_PAGE));
  app.get("/airwallex", page(AIRWALLEX_CSP, () => AIRWALLEX_PAGE));
  app.get("/claude", page(CLAUDE_CSP, () => CLAUDE_PAGE));
  app.get("/pricing", page(PRICING_CSP, () => PRICING_PAGE));
  app.get("/security", page(SECURITY_CSP, () => SECURITY_PAGE));
  app.get("/docs", page(DOCS_CSP, () => DOCS_PAGE));
  // The 3-minute product tour (13 Nov); /judge, its old address, answers 301 to it (MOVED, above).
  app.get("/tour", page(TOUR_CSP, () => TOUR_PAGE));
  // /status, the offline copy: this server has no /health and no runner, so the page says so (no script, no request).
  app.get("/status", page(STATUS_OFFLINE_CSP, () => STATUS_PAGE_OFFLINE));
  app.get("/t0", page(T0_CSP, () => T0_PAGE));
  app.get("/books", page(BOOKS_CSP, () => BOOKS_PAGE));
  const report = METAL_REPORT;
  if (report) app.get("/metal/report", page(METAL_REPORT_CSP, () => report));
  app.get("/assets/inter.woff2", (_req, res) => { res.type("font/woff2").send(FONT); });
  for (const [name, logo] of Object.entries({ ...LOGOS, ...FILM_STILLS, ...DOWNLOADS })) app.get(`/assets/${name}`, (_req, res) => { res.type(logo.type).send(logo.body); });
  // As on the relay: /favicon.ico is Purser's mark, so a page with no icon link asks for nothing missing.
  app.get("/favicon.ico", (_req, res) => { res.type(LOGOS["favicon.svg"]!.type).send(LOGOS["favicon.svg"]!.body); });
  // The CFO's own pages (policy, approvals, passkey enrolment) need the runner and a passkey. Offline they say so and
  // point at the recording, so a juror who follows the emergency stop's link (policy?freeze=on) never meets a 404.
  const liveOnly = (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Security-Policy", LIVE_ONLY_CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.type("html").send(LIVE_ONLY_PAGE);
  };
  app.get(["/policy", "/enrol", "/approve", "/approve/:id"], liveOnly);
  // Nothing live here: anything else is the clean 404 page, with the four tabs.
  app.use((_req, res) => { res.status(404).setHeader("Content-Security-Policy", NOT_FOUND_CSP); res.type("html").send(NOT_FOUND_PAGE); });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });
  const addr = server.address();
  return { server, url: `http://localhost:${typeof addr === "object" && addr ? addr.port : port}` };
}

const LIVE_ONLY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Purser · live only</title><style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#14171f}
main{max-width:34rem;margin:12vh auto;padding:0 16px}
.card{background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:24px}
h1{font-size:1.25rem;font-weight:600;margin:0 0 8px}p{margin:0 0 12px;color:#4a5160}
a{display:inline-block;margin-top:4px;padding:10px 16px;border-radius:8px;background:#14171f;color:#fff;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#0e1015;color:#eef0f4}.card{background:#171a21;border-color:#2a2f3a}p{color:#a9b0bf}a{background:#eef0f4;color:#0e1015}}
</style></head><body><main><div class="card">
<h1>Live only: the CFO's phone page</h1>
<p>This page is where the CFO reviews exact terms and signs them with Face ID (a passkey). It needs the live runner and the CFO's passkey, so this offline copy does not serve it.</p>
<p>The recorded run shows every decision the CFO signed, with its proof.</p>
<a href="/?recorded">Open the recorded run</a>
</div></main></body></html>`;
/** Its one inline style by hash, not 'unsafe-inline' (A3). */
const LIVE_ONLY_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(/<style>([\s\S]*?)<\/style>/.exec(LIVE_ONLY_PAGE)![1]!, "utf8").digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** The pages `--check` fetches once each: every page a juror reaches, both CFO dashboards included. */
export const CHECK_PATHS = ["/", "/home", "/watch", "/replay", "/proof", "/trace", "/runs", "/agents/sourcing", "/agents/support", "/agents/treasury", "/metal", "/metal/report", "/visa", "/airwallex", "/claude", "/pricing", "/security", "/docs", "/tour", "/status", "/t0", "/books", "/?autonomy", "/?recorded", "/demo", "/live", "/film", "/try", "/month", "/lab"];

/**
 * The menu printed at start. The main run's CFO dashboard comes first, and each dashboard is named by its own run, its
 * day read from its record (final review, 4 Nov: /?recorded was offered as "the CFO dashboard at the end of the recorded
 * run", which is the 30 October run, not the main run).
 */
export function judgeMenu(url: string): string[] {
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
  const main = day(loadRecord().record.recorded_at);
  const earlier = day((JSON.parse(readFileSync(new URL("../../docs/demo/snapshot.json", import.meta.url), "utf8")) as { recorded_at: string }).recorded_at);
  return [
    `Purser, the recorded runs, offline (no keys, nothing live). Start here: ${url}/`,
    `  ${url}/?autonomy     the main run's CFO dashboard (${main})`,
    `  ${url}/trace         any payment of the main run, step by step`,
    `  ${url}/runs          every live run, newest first, with its ids and records`,
    `  ${url}/metal         how Purser uses Metal, every proof linked to the explorer`,
    `  ${url}/live          the working day on two rails, Airwallex and Metal`,
    `  ${url}/try           type a task for an agent (offline, code reads it)`,
    `  ${url}/airwallex     how Purser uses Airwallex, with this week's proof`,
    `  ${url}/claude        how Purser uses Claude: each agent's model, cost and decisions`,
    `  ${url}/visa          agent recognition, then the agent's own Airwallex Visa card`,
    `  ${url}/demo          the run, step by step`,
    `  ${url}/month         a simulated month in 90 seconds`,
    `  ${url}/lab           the Scenario Lab, 18 stories`,
    `  ${url}/?recorded     the CFO dashboard of the ${earlier} run (an earlier recording)`,
    "Stop with Ctrl+C.",
  ];
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // No browser here (a server, CI): the address is printed below.
  }
}

if (process.argv[1] && /judge\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const { server, url } = await startJudge(Number(process.env.PORT ?? 4311));
  if (args.includes("--check")) {
    let ok = true;
    for (const path of CHECK_PATHS) {
      const res = await fetch(`${url}${path}`);
      const body = await res.text();
      const good = res.status === 200 && body.length > 1000;
      ok &&= good;
      console.log(`${good ? "ok  " : "FAIL"}  ${path}  ${res.status}  ${body.length} bytes`);
    }
    server.close();
    process.exit(ok ? 0 : 1);
  }
  console.log(judgeMenu(url).join("\n"));
  if (!args.includes("--no-open")) openBrowser(`${url}/`);
}
