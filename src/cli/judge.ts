// npm run judge: the recorded demo and the simulated month, on this computer, with no keys and no network.
// A fresh clone needs only `npm ci` first. It serves:
//   /       the start page (the CFO's live dashboard needs the runner; a guest sees the way to the demo)
//   /demo   the recorded live run, step by step (docs/demo/story.json)
//   /month  a month in 90 seconds (simulated, seeded)
//   /?recorded  the CFO's dashboard as it stood at the end of a recorded live run (docs/demo/snapshot.json)
// and opens the browser. `--no-open` only serves; `--check` serves, fetches each page once and exits.

import { spawn } from "node:child_process";
import type { Server } from "node:http";
import express from "express";
import { CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, METAL_CSP, METAL_PAGE, METAL_REPORT, METAL_REPORT_CSP, MONTH_CSP, PAGE, TRY_CSP, TRY_PAGE, demoPage, filmPage, labPage, livePage, monthPage } from "../servers/dashboard.js";
import { TRY_MAX_CHARS, tryPurserSafely } from "../try/engine.js";

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
  app.get("/", page(CSP, () => PAGE));
  app.get("/demo", page(DEMO_CSP, () => demo));
  app.get("/month", page(MONTH_CSP, () => month));
  const live = livePage();
  app.get("/live", page(LIVE_CSP, () => live));
  const film = filmPage();
  app.get("/film", page(FILM_CSP, () => film));
  app.get("/try", page(TRY_CSP, () => TRY_PAGE));
  // Try Purser without keys: code reads the request; the hosted relay page asks Claude.
  app.post("/api/try", express.json({ limit: "2kb" }), async (req, res) => {
    const text = typeof (req.body as { text?: unknown })?.text === "string" ? (req.body as { text: string }).text.trim() : "";
    if (!text) return void res.status(400).json({ error: "type what an agent should do" });
    if (text.length > TRY_MAX_CHARS) return void res.status(413).json({ error: `at most ${TRY_MAX_CHARS} characters` });
    res.json(await tryPurserSafely(text, null, new Date(), "this offline copy asks no model; the hosted page does"));
  });
  const lab = labPage();
  app.get("/lab", page(LAB_CSP, () => lab));
  app.get("/metal", page(METAL_CSP, () => METAL_PAGE));
  const report = METAL_REPORT;
  if (report) app.get("/metal/report", page(METAL_REPORT_CSP, () => report));
  app.get("/assets/inter.woff2", (_req, res) => { res.type("font/woff2").send(FONT); });
  for (const [name, logo] of Object.entries(LOGOS)) app.get(`/assets/${name}`, (_req, res) => { res.type(logo.type).send(logo.body); });
  // Nothing live here: the start page asks for no data without a viewer key, and nothing else answers.
  app.use((_req, res) => { res.status(404).type("text/plain").send("not found: this is the recorded demo; try /demo or /month"); });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });
  const addr = server.address();
  return { server, url: `http://localhost:${typeof addr === "object" && addr ? addr.port : port}` };
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
    for (const path of ["/", "/metal", "/metal/report", "/?recorded", "/demo", "/live", "/film", "/try", "/month", "/lab"]) {
      const res = await fetch(`${url}${path}`);
      const body = await res.text();
      const good = res.status === 200 && body.length > 1000;
      ok &&= good;
      console.log(`${good ? "ok  " : "FAIL"}  ${path}  ${res.status}  ${body.length} bytes`);
    }
    server.close();
    process.exit(ok ? 0 : 1);
  }
  console.log([
    `Purser, the recorded run, offline (no keys, nothing live). Start here: ${url}/`,
    `  ${url}/metal         how Purser uses Metal, every proof linked to the explorer`,
    `  ${url}/?recorded     the CFO dashboard at the end of the recorded run`,
    `  ${url}/live          the working day on two rails, Airwallex and Metal`,
    `  ${url}/try           type a task for an agent (offline, code reads it)`,
    `  ${url}/demo          the run, step by step`,
    `  ${url}/month         a simulated month in 90 seconds`,
    `  ${url}/lab           the Scenario Lab, 18 stories`,
    "Stop with Ctrl+C.",
  ].join("\n"));
  if (!args.includes("--no-open")) openBrowser(`${url}/`);
}
