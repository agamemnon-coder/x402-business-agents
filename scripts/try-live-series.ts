// A series of recorded walks through the public /try, one at a time, for docs/runs/2026-11-19-mega-run.md: each walk is
// scripts/try-live-record.ts in its own process. Polite to the site: a walk starts only when the one before has ended
// and at least GAP seconds have passed (and at least 30 s after the previous start); if a walk saw a 429 or a 5xx from
// the site, the next one waits 60 s more, then 120 s more if it happens again in a row. It stops by itself after 3 walks
// in a row that failed or in which Claude fell back to the parser, and on a full disk. Test money only.
// What it keeps beside the runs: series.json, one line per walk (when, which profile and browser, its exit, the
// statuses it saw, the back-offs); the recorder's console goes to <log dir>, outside the repository.
//   npx tsx scripts/try-live-series.ts <out dir> <log dir> [first run] [last run]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";

const [out, logs, firstArg, lastArg] = process.argv.slice(2);
if (!out || !logs) throw new Error("usage: try-live-series.ts <out dir> <log dir> [first] [last]");
const first = Number(firstArg ?? 1), last = Number(lastArg ?? 50);
const GAP_S = 35;
mkdirSync(out, { recursive: true });
mkdirSync(logs, { recursive: true });

/** Which profile and browser walk n takes: 6 at 768 (tablet), 6 in Firefox, the rest alternating 1440 light / 390 dark. */
function plan(n: number): { profile: string; browser: string } {
  const tablet = [5, 13, 21, 29, 37, 45], firefox = [9, 17, 25, 33, 41, 49];
  if (tablet.includes(n)) return { profile: tablet.indexOf(n) % 2 ? "tablet-dark" : "tablet", browser: "chromium" };
  if (firefox.includes(n)) return { profile: firefox.indexOf(n) % 2 ? "phone" : "desktop", browser: "firefox" };
  const k = Array.from({ length: n }, (_, i) => i + 1).filter((i) => !tablet.includes(i) && !firefox.includes(i)).length;
  return { profile: k % 2 ? "desktop" : "phone", browser: "chromium" };
}

interface Line { run: number; profile: string; browser: string; started_at: string; finished_at: string; exit: number | null; ok: boolean; failures: string[]; http_429_5xx: { path: string; status: number }[]; fallbacks: number; waited_s: number; backoff_s: number; note?: string }
const seriesFile = join(out, "series.json");
const series: Line[] = existsSync(seriesFile) ? (JSON.parse(readFileSync(seriesFile, "utf8")) as { walks: Line[] }).walks : [];
const save = () => writeFileSync(seriesFile, JSON.stringify({ what: "The order of the walks of docs/runs/2026-11-19-mega-run.md, written by scripts/try-live-series.ts as they ran.", gap_s: GAP_S, walks: series }, null, 1) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let badInRow = 0, errInRow = 0;
let lastEnd = series.length ? Date.parse(series.at(-1)!.finished_at) : 0;
let lastStart = series.length ? Date.parse(series.at(-1)!.started_at) : 0;
let backoff = 0;
for (let n = first; n <= last; n++) {
  const { profile, browser } = plan(n);
  const due = Math.max(lastEnd + GAP_S * 1000 + backoff * 1000, lastStart + 30_000);
  const waited = Math.max(0, due - Date.now());
  if (waited) await wait(waited);
  const started_at = new Date().toISOString();
  console.log(`${started_at}  run ${n}: ${profile}, ${browser}${backoff ? ` (after a back-off of ${backoff} s)` : ""}`);
  const log = createWriteStream(join(logs, `run-${n}.log`));
  const exit = await new Promise<number | null>((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", "scripts/try-live-record.ts", String(n), profile, out], { env: { ...process.env, BROWSER: browser }, stdio: ["ignore", "pipe", "pipe"] });
    const kill = setTimeout(() => p.kill("SIGKILL"), 8 * 60_000);
    p.stdout.pipe(log, { end: false });
    p.stderr.pipe(log, { end: false });
    p.on("close", (code) => { clearTimeout(kill); resolve(code); });
  });
  log.end();
  const finished_at = new Date().toISOString();
  const said = readFileSync(join(logs, `run-${n}.log`), "utf8");
  const file = join(out, `run-${n}.json`);
  const rec = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { ok: boolean; failures: string[]; calls: { path: string; status: number }[]; events: { main: { event: string; subject: string | null; fields: Record<string, unknown> }[]; cash: { event: string; subject: string | null; fields: Record<string, unknown> }[] } }) : null;
  const http = (rec?.calls ?? []).filter((c) => c.status === 429 || c.status >= 500).map((c) => ({ path: c.path.split("?")[0]!, status: c.status }));
  const evs = rec ? [...rec.events.main, ...rec.events.cash] : [];
  const fallbacks = evs.filter((e) => (e.event === "claude.read" && e.fields.source !== "claude") || (e.event === "agent.run" && e.fields.status !== "done") || (/^ap\.(checker_decided|payer_proposed|coded)$/.test(e.event) && e.fields.source !== "claude")).length;
  const line: Line = { run: n, profile, browser, started_at, finished_at, exit, ok: !!rec?.ok, failures: rec?.failures ?? ["no record written"], http_429_5xx: http, fallbacks, waited_s: Math.round(waited / 1000), backoff_s: backoff };
  series.push(line);
  save();
  console.log(`${finished_at}  run ${n}: ${line.ok ? "ok" : `FAILED (${line.failures.join("; ")})`}, ${http.length} 429/5xx, ${fallbacks} fallbacks`);
  lastEnd = Date.parse(finished_at);
  lastStart = Date.parse(started_at);
  if (/ENOSPC|no space left/i.test(said)) { console.log("stopped: the disk is full"); break; }
  errInRow = http.length ? errInRow + 1 : 0;
  backoff = errInRow === 0 ? 0 : errInRow === 1 ? 60 : 120;
  badInRow = !line.ok || fallbacks > 0 ? badInRow + 1 : 0;
  if (badInRow >= 3) { console.log("stopped: 3 walks in a row failed or fell back"); break; }
}
