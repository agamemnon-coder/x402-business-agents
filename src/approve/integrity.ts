// Approval page integrity (outside audit, finding 1.5: "the relay serves the approval page; a compromised relay could
// serve a different script and mislead the human. Make approval UI integrity independently verifiable").
//
// The phone's pages (approve, enrol, policy) are one document each: their script and stylesheet inline, under a CSP
// that runs only that exact script and applies only that exact stylesheet (script-src and style-src are their SHA-256
// hashes; no 'self', no 'unsafe-inline'). So the bytes of the served HTML are the whole of what runs, and their SHA-256
// is fixed at build time. `npm run approval-page-record` publishes that hash (and the CSP) in
// docs/evidence/approval-page.json; test/approval-page-integrity.test.ts fails when the code and the record differ; and
// `npm run verify-approval-page -- <url>` fetches the live page and compares it with the record, from any machine,
// without trusting the relay. Purser Cloud's console, where an owner or CFO approves in the browser, is recorded the
// same way, its per-response nonces and its deployment's own addresses (origin, RP id, mail domain) set to placeholders
// before hashing, as test/cloud-console.test.ts reads them.
//
// Each page also shows a short build id (the first 48 bits of the hash of its template, script and stylesheet), so a
// person can see which build is in front of them. A lying relay can print any id: the id says which build is claimed;
// the check from outside says which build is served.

import { createHash } from "node:crypto";

/** Where the build id goes in a phone page's template. */
export const BUILD_PLACEHOLDER = "__PURSER_PAGE_BUILD__";
/** The committed record. */
export const RECORD_PATH = "docs/evidence/approval-page.json";
/** What a nonce and the console's per-deployment addresses become before hashing. */
export const NONCE_PLACEHOLDER = "NONCE";
export const CLOUD_CFG_PLACEHOLDER = { origin: "https://ORIGIN", rpId: "RP_ID", mailDomain: "MAIL_DOMAIN" } as const;

const STYLESHEET_TAG = '<link rel="stylesheet" href="/assets/approve.css">';
const SCRIPT_TAG = '<script type="module" src="/assets/approve.js"></script>';

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sha256B64 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

/** The CSP of a phone page whose one script and one stylesheet are inline: each allowed by its hash only. */
export function phoneCsp(script: string, style: string): string {
  return [
    "default-src 'none'", `script-src 'sha256-${sha256B64(script)}'`, `style-src 'sha256-${sha256B64(style)}'`,
    "connect-src 'self'", "font-src 'self'", "img-src 'self'",
    // The installed app (src/pwa/): its manifest and its service worker, both from this origin only.
    "manifest-src 'self'", "worker-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
}

/** The build id a page shows: 12 hex of the hash of its template, script and stylesheet, in groups of four. */
export function buildId(template: string, script: string, style: string): string {
  return sha256Hex(`${template}\u0000${script}\u0000${style}`).slice(0, 12).toUpperCase().match(/.{4}/g)!.join("-");
}

/**
 * A phone page as the relay serves it: the template with its stylesheet and script inline, its build id filled in, and
 * the CSP that runs exactly that script. Refuses a template without the two tags or the placeholder, and a script or
 * stylesheet that would end its element early.
 */
export function inlinePhonePage(template: string, script: string, style: string): { page: string; csp: string; build: string } {
  if (!template.includes(STYLESHEET_TAG) || !template.includes(SCRIPT_TAG)) throw new Error("a phone page links /assets/approve.css and /assets/approve.js once each");
  if (!template.includes(BUILD_PLACEHOLDER)) throw new Error(`a phone page shows its build id (${BUILD_PLACEHOLDER})`);
  if (/<\/script/i.test(script) || /<!--/.test(script)) throw new Error("the phone script would end its inline element early");
  if (/<\/style/i.test(style)) throw new Error("the stylesheet would end its inline element early");
  const build = buildId(template, script, style);
  const page = template.replace(STYLESHEET_TAG, () => `<style>${style}</style>`).replace(SCRIPT_TAG, () => `<script type="module">${script}</script>`).split(BUILD_PLACEHOLDER).join(build);
  return { page, csp: phoneCsp(script, style), build };
}

/** One recorded page: where it is served, what kind of page it is, the hash of its HTML as normalised, and its CSP. */
export interface RecordedPage { name: string; path: string; served_by: "relay" | "cloud"; sha256: string; csp: string; build?: string }
export interface PageRecord { what: string; pages: RecordedPage[] }

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * The console page and its CSP with the parts that differ per response or per deployment set to placeholders: the
 * nonces, and the origin, RP id and mail domain in its config tag (which must agree with the address it was fetched
 * from: `origin` when given). Throws when the config tag is missing or names another origin.
 */
export function normaliseConsole(html: string, csp: string, origin?: string): { html: string; csp: string } {
  const nonces = new Set([...html.matchAll(/ nonce="([^"]+)"/g)].map((m) => m[1]!));
  const fromCsp = [...csp.matchAll(/'nonce-([^']+)'/g)].map((m) => m[1]!);
  for (const n of fromCsp) nonces.add(n);
  let out = html;
  let outCsp = csp;
  for (const n of nonces) {
    out = out.split(` nonce="${n}"`).join(` nonce="${NONCE_PLACEHOLDER}"`);
    outCsp = outCsp.split(`'nonce-${n}'`).join(`'nonce-${NONCE_PLACEHOLDER}'`);
  }
  const tag = /<meta name="purser-cloud" content="([^"]*)">/.exec(out);
  if (!tag) throw new Error("not Purser Cloud's console: no purser-cloud config tag");
  const cfg = JSON.parse(unescAttr(tag[1]!)) as Record<string, unknown>;
  if (origin !== undefined && cfg.origin !== origin) throw new Error(`the console's config names ${String(cfg.origin)}, not ${origin}, the address it was fetched from`);
  const fixed = { ...cfg, ...(typeof cfg.origin === "string" ? { origin: CLOUD_CFG_PLACEHOLDER.origin } : {}), ...(typeof cfg.rpId === "string" ? { rpId: CLOUD_CFG_PLACEHOLDER.rpId } : {}), ...(typeof cfg.mailDomain === "string" ? { mailDomain: CLOUD_CFG_PLACEHOLDER.mailDomain } : {}) };
  out = out.replace(tag[0], () => `<meta name="purser-cloud" content="${escAttr(JSON.stringify(fixed))}">`);
  return { html: out, csp: outCsp };
}

/** The build id a phone page shows, or null. */
export function shownBuild(html: string): string | null {
  return /data-build="([0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4})"/.exec(html)?.[1] ?? null;
}

export interface PageCheck { ok: boolean; page: string | null; problems: string[]; sha256: string; build: string | null }

/**
 * Checks a page as fetched from `url` against the record: which recorded page it is (by path), that its HTML (normalised
 * for the console) hashes to the recorded hash, and that its CSP is the recorded one. Never trusts what the page says
 * about itself: the build id it shows is reported, and must agree, but the hash decides.
 */
export function checkServedPage(record: PageRecord, url: string, html: string, csp: string | null): PageCheck {
  const u = new URL(url);
  const want = record.pages.find((p) => (p.path.endsWith("/*") ? u.pathname.startsWith(p.path.slice(0, -1)) : u.pathname === p.path));
  const problems: string[] = [];
  if (!want) return { ok: false, page: null, problems: [`no recorded approval page is served at ${u.pathname}`], sha256: sha256Hex(html), build: null };
  let body = html, policy = csp ?? "";
  if (want.served_by === "cloud") {
    try { ({ html: body, csp: policy } = normaliseConsole(html, csp ?? "", u.origin)); } catch (e) { problems.push((e as Error).message); }
  }
  const sha256 = sha256Hex(body);
  if (sha256 !== want.sha256) problems.push(`the served ${want.name} page hashes to ${sha256}, not the recorded ${want.sha256}: its HTML or script differs from the published build`);
  if (!csp) problems.push("the page came with no Content-Security-Policy header");
  else if (policy !== want.csp) problems.push(`its Content-Security-Policy is not the recorded one: ${csp}`);
  const build = shownBuild(html);
  if (want.build && build !== want.build) problems.push(`it shows build ${build ?? "none"}, not ${want.build}`);
  return { ok: problems.length === 0, page: want.name, problems, sha256, build };
}

/**
 * Fetches each address and checks it against the record (npm run verify-approval-page). A site address with no path
 * checks the relay's three phone pages, or Purser Cloud's console when that is what answers at /.
 */
export async function verifyApprovalPages(urls: string[], record: PageRecord, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const get = async (url: string) => {
    const res = await fetchImpl(url, { redirect: "manual", headers: { "cache-control": "no-cache" } });
    return { status: res.status, html: await res.text(), csp: res.headers.get("content-security-policy") };
  };
  for (const raw of urls) {
    const base = new URL(raw);
    let targets = [base.href];
    if (base.pathname === "/" && !/<meta name="purser-cloud"/.test((await get(base.href)).html)) targets = ["/approve/P-0001", "/enrol", "/policy"].map((p) => new URL(p, base).href);
    for (const url of targets) {
      const r = await get(url);
      if (r.status !== 200) { ok = false; lines.push(`FAIL  ${url}  answered ${r.status}`); continue; }
      const c = checkServedPage(record, url, r.html, r.csp);
      if (!c.ok) ok = false;
      lines.push(c.ok ? `ok    ${url}  ${c.page} page, sha256 ${c.sha256}${c.build ? `, build ${c.build}` : ""}: as published` : `FAIL  ${url}  ${c.problems.join("; ")}`);
    }
  }
  return { ok, lines };
}
