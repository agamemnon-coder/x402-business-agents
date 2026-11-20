// Every figure a page shows, and the record it leads to (the owner, 20 Nov: "every figure, count, hash, transaction id
// and claim on /proof must lead to a committed record a reader can open and check"). A figure is a visible token with a
// digit in it (a count, an amount, a percentage, a date, a hash, an id); it is traced when an element around it names
// its record (data-rec, the convention of docs/claims.md and src/redesign) or links to it: a file in this repository
// (on GitHub) or one of the outside sites a reader checks it on (Airwallex, Alta's explorer, YouTube, GitHub,
// scorecard.dev, bestpractices.dev). A link to another page of the site is not a record.
//
// The page is walked character by character (a small tag stack, no HTML-filtering regular expression; the same way as
// test/support/scriptBlocks.ts): script and style blocks are skipped, and so is everything outside <main>.
// Used by test/proof-trace.test.ts (the guard) and src/cli/proofIndex.ts (docs/evidence/proof-index.md). Build time and
// tests only: the Worker never imports it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/";

/** Outside sites a figure may link to, where a reader checks it (exact hosts, or a host under one of these). */
export const ALLOWED_HOSTS = ["airwallex.com", "testnet.metalntwx.com", "youtu.be", "youtube.com", "github.com", "scorecard.dev", "bestpractices.dev"] as const;

/**
 * Tokens with a digit that are names, not figures: a protocol (x402), a product (T:0), an algorithm (SHA-256, P-256),
 * a standard (ISO 20022, EIP-712, ERC-20), a model family's version is never shown. Each is a name the page uses for a
 * thing, and none can differ from a record.
 */
export const NAMES = new Set(["x402", "x402.", "x402:", "T:0", "T:0's", "T:0:", "T:0.", "SHA-256", "SHA-256.", "SHA-256:", "P-256", "(P-256)", "WebAuthn/P-256", "ISO", "20022", "EIP-712", "ERC-20", "ERC-4337", "ES256", "secp256r1", "secp256k1", "2-of-2", "24/7", "P-256,", "SHA-256,", "x402,"]);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon", "use", "stop", "ellipse"]);
export interface El { tag: string; attrs: Record<string, string> }
export interface TextNode { text: string; stack: El[] }

const decode = (s: string) => s.split("&nbsp;").join(" ").split("&quot;").join('"').split("&#39;").join("'").split("&lt;").join("<").split("&gt;").join(">")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).split("&amp;").join("&");

function parseAttrs(tag: string, from: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = from;
  const n = tag.length;
  for (;;) {
    while (i < n && /[\s/]/.test(tag[i]!)) i++;
    if (i >= n || tag[i] === ">") return attrs;
    let name = "";
    while (i < n && !/[\s=/>]/.test(tag[i]!)) name += tag[i++];
    while (i < n && /\s/.test(tag[i]!)) i++;
    let value = "";
    if (tag[i] === "=") {
      i++;
      while (i < n && /\s/.test(tag[i]!)) i++;
      const q = tag[i];
      if (q === '"' || q === "'") { const e = tag.indexOf(q, i + 1); value = tag.slice(i + 1, e < 0 ? n : e); i = e < 0 ? n : e + 1; }
      else { while (i < n && !/[\s>]/.test(tag[i]!)) value += tag[i++]; }
    }
    if (name) attrs[name.toLowerCase()] = decode(value);
  }
}

/** The text nodes of a page, each with the elements open around it (outermost first). */
export function textNodes(html: string): TextNode[] {
  const out: TextNode[] = [], stack: El[] = [], low = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const text = html.slice(i, lt < 0 ? html.length : lt);
    if (text.trim()) out.push({ text: decode(text), stack: stack.slice() });
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt); i = e < 0 ? html.length : e + 3; continue; }
    let j = lt + 1, q = "";
    for (; j < html.length; j++) { const c = html[j]!; if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    const tag = html.slice(lt, j + 1);
    i = j + 1;
    if (tag[1] === "!" || tag[1] === "?") continue;
    const close = tag[1] === "/";
    let k = close ? 2 : 1, name = "";
    while (k < tag.length && /[A-Za-z0-9-]/.test(tag[k]!)) name += tag[k++];
    name = name.toLowerCase();
    if (!name) continue;
    if (close) { const at = stack.map((e) => e.tag).lastIndexOf(name); if (at >= 0) stack.length = at; continue; }
    if (name === "script" || name === "style") { const e = low.indexOf(`</${name}`, i); i = e < 0 ? html.length : html.indexOf(">", e) + 1 || html.length; continue; }
    if (VOID.has(name) || tag.endsWith("/>")) continue;
    stack.push({ tag: name, attrs: parseAttrs(tag, k) });
  }
  return out;
}

/** A shown figure: the token, the sentence it stands in, and what the elements around it name. */
export interface Figure { token: string; text: string; recs: string[]; hrefs: string[]; where: string }

// A comma inside a number ("8,574") stays in its token; elsewhere it ends one.
const TOKEN = /(?:[^\s()[\],;"“”]|,(?=\d))*\d(?:[^\s()[\],;"“”]|,(?=\d{3}))*/g;

/** Every figure inside <main> (or the whole fragment, when it has no <main>). */
export function figures(html: string): Figure[] {
  const nodes = textNodes(html), hasMain = nodes.some((n) => n.stack.some((e) => e.tag === "main"));
  const out: Figure[] = [];
  for (const n of nodes) {
    if (hasMain && !n.stack.some((e) => e.tag === "main")) continue;
    for (const token of n.text.match(TOKEN) ?? []) {
      if (NAMES.has(token)) continue;
      out.push({
        token, text: n.text.trim().replace(/\s+/g, " "),
        recs: n.stack.flatMap((e) => (e.attrs["data-rec"] ? e.attrs["data-rec"].split(/\s+/).filter(Boolean) : [])),
        hrefs: n.stack.map((e) => (e.tag === "a" ? e.attrs.href : undefined)).filter((h): h is string => !!h),
        where: n.stack.filter((e) => e.attrs.id).map((e) => e.attrs.id).join(">"),
      });
    }
  }
  return out;
}

/** A data-rec path, without its #fragment, exists in this repository. */
export const recExists = (p: string) => existsSync(`${ROOT}${p.split("#")[0]}`);

/** A link is a record: a file of this repository on GitHub, or one of the outside sites where a reader checks a figure. */
export function hrefIsRecord(href: string): boolean {
  if (href.startsWith(REPO)) {
    const m = /^(?:blob|tree)\/[^/]+\/([^#?]*)/.exec(href.slice(REPO.length));
    return m ? recExists(decodeURIComponent(m[1]!)) : true;
  }
  let u: URL;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/** Why a figure is not traced, or null when it is. */
export function gap(f: Figure): string | null {
  if (f.recs.length) {
    const missing = f.recs.filter((r) => !recExists(r));
    return missing.length ? `data-rec names a file that is not in the repository: ${missing.join(", ")}` : null;
  }
  if (f.hrefs.some(hrefIsRecord)) return null;
  return f.hrefs.length ? `links only to ${f.hrefs.join(", ")}, not a record` : "no record (no data-rec, no link to one)";
}

// ── Distinctive figures: a hash, an id, an amount with cents, a long number. Each must be found in a record it names. ──

export type Kind = "hash" | "id" | "amount" | "number";
/** What a token is, and the parts to look for in a record (a cut hash "797d4483…cdab" by its two ends), or null. */
export function distinctive(token: string): { kind: Kind; parts: string[] } | null {
  const t = token.replace(/(?:'s|’s)$/, "").replace(/[.,;:!?)]+$/, "").replace(/^[(#·]+/, "");
  const cut = /^(0x[0-9a-f]{4,}|[0-9a-f]{6,}(?:-[0-9a-f]{1,})*)…([0-9a-f-]{3,})?$/i.exec(t);
  if (cut && /[a-f]/i.test(t)) return { kind: "hash", parts: [cut[1]!.toLowerCase(), ...(cut[2] ? [cut[2].toLowerCase()] : [])] };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return { kind: "id", parts: [t.toLowerCase()] };
  if (/^(?:0x)?[0-9a-f]{7,}$/i.test(t) && /[a-f]/i.test(t) && /\d/.test(t)) return { kind: "hash", parts: [t.toLowerCase()] };
  if (/^(?:mdt|int|req|acct|ben|je_prod|cus|con)_[A-Za-z0-9_-]{6,}$/.test(t)) return { kind: "id", parts: [t] };
  const amount = /^(?:EUR|USD|€|\$)?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(t);
  if (amount) return { kind: "amount", parts: [`${amount[1]!.replace(/,/g, "")}.${amount[2]}`] };
  if (/^\d{6,}$/.test(t)) return { kind: "number", parts: [t] };
  return null;
}

/** Is a distinctive figure in this text: the whole value, or a cut hash's two ends within one value (80 characters). */
export function foundIn(d: { kind: Kind; parts: string[] }, text: string): boolean {
  const low = d.kind === "id" && !/^[0-9a-f-]+$/.test(d.parts[0]!) ? text : text.toLowerCase();
  const [a, b] = d.parts as [string, string | undefined];
  if (d.kind === "amount") {
    const n = Number(a), cents = String(Math.round(n * 100));
    return low.includes(a) || new RegExp(`(?<![\\d.])${a.replace(/\.00$/, "").replace(".", "\\.")}(?![\\d]|\\.\\d)`).test(low) || new RegExp(`(?<![\\d.])${cents}(?![\\d.])`).test(low) || low.includes(Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2 }));
  }
  if (!b) return low.includes(a);
  for (let i = low.indexOf(a); i >= 0; i = low.indexOf(a, i + 1)) { const j = low.indexOf(b, i + a.length); if (j >= 0 && j - i < 80) return true; }
  return false;
}

const cache = new Map<string, string>();
/** A record's text (a folder reads as empty), cached. */
export function recordText(path: string): string {
  const p = path.split("#")[0]!;
  if (!cache.has(p)) { try { cache.set(p, statSync(`${ROOT}${p}`).isDirectory() ? "" : readFileSync(`${ROOT}${p}`, "utf8")); } catch { cache.set(p, ""); } }
  return cache.get(p)!;
}

/** The repository files a figure names: its data-rec paths and the files of this repository it links to. */
export function recordsOf(f: Figure): string[] {
  const linked = f.hrefs.filter((h) => h.startsWith(REPO)).map((h) => /^(?:blob|tree)\/[^/]+\/([^#?]*)/.exec(h.slice(REPO.length))?.[1]).filter((x): x is string => !!x).map(decodeURIComponent);
  return [...new Set([...f.recs.map((r) => r.split("#")[0]!), ...linked])];
}

/** Why a distinctive figure does not equal its record (not found in any record it names), or null. */
export function valueGap(f: Figure): string | null {
  const d = distinctive(f.token);
  if (!d) return null;
  const recs = recordsOf(f);
  return recs.some((r) => foundIn(d, recordText(r))) ? null : `${d.kind} ${f.token} is in none of its records (${recs.join(", ") || "none"})`;
}

/** Where in a JSON record a distinctive figure is: the path of the first value that holds it ("snapshot.audit.rows"). */
export function fieldOf(d: { kind: Kind; parts: string[] }, path: string): string | null {
  const text = recordText(path);
  if (!text) return null;
  if (!path.endsWith(".json")) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) => foundIn(d, l));
    return i >= 0 ? `line ${i + 1}` : null;
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const walk = (v: unknown, at: string): string | null => {
    if (v !== null && typeof v === "object") {
      for (const [k, x] of Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>)) {
        const hit = walk(x, Array.isArray(v) ? `${at}[${k}]` : at ? `${at}.${k}` : k);
        if (hit) return hit;
      }
      return null;
    }
    return (typeof v === "string" || typeof v === "number") && foundIn(d, String(v)) ? at || "(the record)" : null;
  };
  return walk(json, "");
}
