// npm run site:check: the public site as a judge opens it, read-only (17 Nov). GET only, nothing is changed or paid.
// For every page: 200, the content type it should have, and no image, script, stylesheet or frame from another host
// (a page whose load waits on another host is what made the judge job's browser check time out on 17 Nov).
//   npm run site:check                      the live site (SITE_CHECK_ORIGIN, default the public site)
//   SITE_CHECK_ORIGIN=http://127.0.0.1:8787 npm run site:check
// Exit 1 when any page fails, with each problem on its own line.

import { pathToFileURL } from "node:url";

export const SITE_CHECK_ORIGIN = "https://kit11.max-31b.workers.dev";

/** The pages a judge opens: the home page, the demo, the proof pages and the partners' pages. */
export const SITE_CHECK_PAGES: readonly { path: string; type: "html" | "json" | "png" }[] = [
  { path: "/", type: "html" }, { path: "/try", type: "html" }, { path: "/try?present=1&phone=0", type: "html" },
  { path: "/proof", type: "html" }, { path: "/verify", type: "html" }, { path: "/runs", type: "html" }, { path: "/books", type: "html" },
  { path: "/airwallex", type: "html" }, { path: "/airwallex/calls", type: "html" }, { path: "/alta", type: "html" }, { path: "/visa", type: "html" },
  { path: "/t0", type: "html" }, { path: "/claude", type: "html" }, { path: "/health", type: "json" }, { path: "/assets/logo-airwallex.png", type: "png" },
];

const TYPE: Record<"html" | "json" | "png", RegExp> = { html: /^text\/html\b/, json: /^application\/json\b/, png: /^image\/png\b/ };

/** What is wrong with one answer: its status, its type, and (for a page) each asset it loads from another host. */
export function pageProblems(status: number, contentType: string, body: string, want: "html" | "json" | "png"): string[] {
  const out: string[] = [];
  if (status !== 200) out.push(`status ${status}`);
  if (!TYPE[want].test(contentType)) out.push(`content type ${contentType || "(none)"}, not ${want}`);
  if (want !== "html") return out;
  const tags = body.match(/<(?:img|script|iframe|source|video|audio)\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>|<link\b[^>]*>/gi) ?? [];
  for (const t of tags) {
    if (/^<link/i.test(t)) {
      // A link loads something only as a stylesheet, an icon, a preload or a manifest; canonical and alternate do not.
      if (!/\brel="(?:[^"]*\s)?(?:stylesheet|icon|preload|modulepreload|manifest|apple-touch-icon)(?:\s[^"]*)?"/i.test(t)) continue;
      const href = /\bhref="(https?:\/\/[^"]*)"/i.exec(t)?.[1];
      if (href) out.push(`loads ${href} from another host`);
      continue;
    }
    out.push(`loads ${/\bsrc="([^"]*)"/i.exec(t)![1]} from another host`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const origin = (process.env.SITE_CHECK_ORIGIN ?? SITE_CHECK_ORIGIN).replace(/\/$/, "");
  let failed = 0;
  for (const p of SITE_CHECK_PAGES) {
    const started = Date.now();
    let problems: string[];
    try {
      const res = await fetch(`${origin}${p.path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      const body = p.type === "png" ? "" : await res.text();
      problems = pageProblems(res.status, res.headers.get("content-type") ?? "", body, p.type);
    } catch (e) {
      problems = [`no answer: ${(e as Error).message.slice(0, 120)}`];
    }
    const ms = Date.now() - started;
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "ok  "}  ${p.path.padEnd(26)} ${String(ms).padStart(5)} ms${problems.length ? `  ${problems.join("; ")}` : ""}`);
  }
  console.log(failed ? `${failed} of ${SITE_CHECK_PAGES.length} pages failed (${origin})` : `all ${SITE_CHECK_PAGES.length} pages ok (${origin})`);
  process.exitCode = failed ? 1 : 0;
}
