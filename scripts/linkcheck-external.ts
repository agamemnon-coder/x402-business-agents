// The external link check (master list 526, part 2): every external link and explorer URL in the README, llms.txt, the
// docs and the site's pages, asked once with HEAD (GET when a host refuses HEAD), within a fixed budget of requests.
// Never part of the test run: it uses the network. Run it once, on merged main:
//   npm run links:external -- --out docs/runs/2026-11-14-link-check.md            (at most 400 requests)
//   npm run links:external -- --dry-run                                           (lists the URLs; no request)
// Options: --max <n> (budget, default 400, never above 400), --out <file> (the Markdown report), --dry-run.
// It sends no cookie, no key and no header but a plain User-Agent; it never follows a link into a page's own links.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_REQUESTS = 400;
const ROOT = resolve(import.meta.dirname, "..");

/** A URL and the files or pages it was found in. */
export interface Found { url: string; where: string[] }
export interface Checked extends Found { status: number | null; method: "HEAD" | "GET" | null; ok: boolean; note: string }

/** Hosts never asked: local, example and placeholder hosts, and the deployed site itself (served by the offline judge). */
const SKIP_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$|(^|\.)example(\.|$)|\.invalid$|\.test$|\.local$/i;

/** The external http(s) URLs in a text (Markdown or HTML), cleaned of trailing punctuation; placeholders skipped. */
export function urlsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>`)\]|\\]+/g)) {
    let u = m[0].replace(/[.,;:!?…*_]+$/, "").replace(/&amp;/g, "&");
    if (u.includes("${") || /[{}]/.test(u)) continue; // a template, not a link
    try {
      const p = new URL(u);
      if (SKIP_HOST.test(p.hostname)) continue;
      p.hash = "";
      u = p.toString();
    } catch { continue; }
    out.add(u);
  }
  return [...out];
}

/** Every URL in the given sources, deduplicated, each with where it was found, sorted by URL. */
export function collect(sources: [where: string, text: string][]): Found[] {
  const by = new Map<string, Set<string>>();
  for (const [where, text] of sources) for (const u of urlsIn(text)) (by.get(u) ?? by.set(u, new Set()).get(u)!).add(where);
  return [...by.entries()].map(([url, w]) => ({ url, where: [...w].sort() })).sort((a, b) => a.url.localeCompare(b.url));
}

/** How soon a URL is asked: the README, llms.txt and the site's pages first, then the submission and claims, then the rest. */
export function priority(f: Found): number {
  if (f.where.some((w) => w === "README.md" || w === "llms.txt" || w.startsWith("page "))) return 0;
  if (f.where.some((w) => w.startsWith("docs/submission/") || w === "docs/claims.md")) return 1;
  return 2;
}

/** The URLs in the order they are asked. The budget (at most MAX_REQUESTS) is held by check(), which stops when it is spent. */
export function plan(found: Found[]): Found[] {
  return [...found].sort((a, b) => priority(a) - priority(b) || a.url.localeCompare(b.url));
}

/**
 * Asks each URL once with HEAD, then with GET when the host refuses HEAD (403, 405, 501) or fails it; never more than
 * `budget` requests in all. A status below 400 is ok; 429 is reported as rate-limited, not as a dead link.
 */
export async function check(ask: Found[], o: { fetch?: typeof fetch; budget?: number; timeoutMs?: number; concurrency?: number } = {}): Promise<{ results: Checked[]; requests: number }> {
  const f = o.fetch ?? fetch, budget = Math.min(MAX_REQUESTS, o.budget ?? MAX_REQUESTS), timeoutMs = o.timeoutMs ?? 15_000;
  let requests = 0;
  const one = async (method: "HEAD" | "GET", url: string): Promise<number | string> => {
    if (requests >= budget) return "budget spent";
    requests++;
    try {
      const r = await f(url, { method, redirect: "follow", headers: { "user-agent": "purser-linkcheck/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
      if (method === "GET") await r.body?.cancel().catch(() => {});
      return r.status;
    } catch (e) {
      return (e as Error).name === "TimeoutError" ? "timeout" : `network error (${(e as Error).message.slice(0, 80)})`;
    }
  };
  const results: Checked[] = new Array(ask.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < ask.length; i = next++) {
      const a = ask[i]!;
      if (requests >= budget) { results[i] = { ...a, status: null, method: null, ok: false, note: "not asked: budget spent" }; continue; }
      let method: "HEAD" | "GET" = "HEAD";
      let r = await one("HEAD", a.url);
      if (typeof r !== "number" || [403, 405, 501].includes(r)) { method = "GET"; r = await one("GET", a.url); }
      const status = typeof r === "number" ? r : null;
      const ok = status !== null && status < 400;
      results[i] = { ...a, status, method: status === null && r === "budget spent" ? null : method, ok, note: status === null ? String(r) : status === 429 ? "rate-limited (not a dead link)" : "" };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  return { results, requests };
}

/** The report, as a run record: what was asked, how many requests, every failure first. */
export function report(r: { results: Checked[]; requests: number; at: string; budget: number }): string {
  const left = r.results.filter((x) => x.method === null);
  const asked = r.results.filter((x) => x.method !== null);
  const bad = asked.filter((x) => !x.ok);
  const row = (x: Checked) => `| ${x.ok ? "ok" : "**fail**"} | ${x.status ?? "–"} | ${x.method ?? "–"} | ${x.url} | ${x.where.slice(0, 3).join(", ")}${x.where.length > 3 ? ` and ${x.where.length - 3} more` : ""} | ${x.note} |`;
  return [
    `# External link check, ${r.at.slice(0, 10)}`, "",
    `Run by \`npm run links:external\` (scripts/linkcheck-external.ts) at ${r.at}: every external link and explorer URL in`,
    "README.md, llms.txt, the docs and the site's pages, asked with HEAD, then GET where a host refuses HEAD.", "",
    `- **URLs found:** ${r.results.length}; **asked:** ${asked.length}; **left out by the budget:** ${left.length} (asked in order: the README, llms.txt and the site's pages first, then the submission and claims, then the other docs).`,
    `- **Requests:** ${r.requests} of a budget of ${r.budget}.`,
    `- **Failed:** ${bad.length}; **ok:** ${asked.length - bad.length}.`, "",
    "| | Status | Method | URL | Found in | Note |", "|---|---|---|---|---|---|",
    ...bad.map(row), ...asked.filter((x) => x.ok).map(row), "",
    ...(left.length ? ["## Not asked (over the budget)", "", ...left.map((x) => `- ${x.url}`), ""] : []),
  ].join("\n");
}

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** README.md, llms.txt, every Markdown file under docs/ (not the archive), and the site's pages. */
export async function sources(root = ROOT): Promise<[string, string][]> {
  const docs = walk(join(root, "docs")).filter((f) => f.endsWith(".md") && !f.includes(`${join(root, "docs", "archive")}`));
  const out: [string, string][] = [["README.md", readFileSync(join(root, "README.md"), "utf8")], ["llms.txt", readFileSync(join(root, "llms.txt"), "utf8")],
    ...docs.map((f): [string, string] => [relative(root, f), readFileSync(f, "utf8")])];
  const { buildPages } = await import("../src/relay/assets.js");
  for (const [k, v] of Object.entries(buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>)) out.push([`page ${k}`, typeof v === "string" ? v : JSON.stringify(v)]);
  return out;
}

async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const budget = Math.min(MAX_REQUESTS, Number(arg("--max") ?? MAX_REQUESTS));
  if (!Number.isFinite(budget) || budget < 1) { console.error("--max must be a number from 1 to 400"); return 2; }
  const ask = plan(collect(await sources()));
  if (argv.includes("--dry-run")) {
    for (const [i, f] of ask.entries()) console.log(`${String(i + 1).padStart(3)}  p${priority(f)}  ${f.url}`);
    console.log(`${ask.length} URLs, in the order they would be asked; at most ${budget} requests; no request sent`);
    return 0;
  }
  const r = await check(ask, { budget });
  const at = new Date().toISOString();
  const md = report({ ...r, at, budget });
  const out = arg("--out");
  if (out) writeFileSync(resolve(out), `${md}\n`);
  else console.log(md);
  const bad = r.results.filter((x) => x.method !== null && !x.ok);
  console.log(`${r.results.length - r.results.filter((x) => x.method === null).length} asked, ${bad.length} failed, ${r.requests} requests of ${budget}${out ? `; report in ${out}` : ""}`);
  return bad.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
