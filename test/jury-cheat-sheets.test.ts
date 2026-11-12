// The per-company jury cheat sheets (docs/submission/jury/*.md, master list 230): each answer is one or two sentences,
// every figure in an answer is in docs/claims.md or a run record (docs/runs, docs/demo), every source it links exists,
// and none says "certified", "endorsed" or "approved by", names a competitor, or quotes anyone. Breaks when an answer
// grows, a figure has no record, or a banned word slips in.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "docs/submission/jury");
const COMPANIES = ["anthropic", "aws", "visa", "metal", "coinbase", "base44"];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const RECORDS = [join(ROOT, "docs/claims.md"), ...walk(join(ROOT, "docs/runs")), ...walk(join(ROOT, "docs/demo"))].map((f) => readFileSync(f, "utf8")).join("\n");
/** Prose as read: links to their text, code spans out, emphasis gone, white space single. */
const prose = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`[^`]*`/g, "code").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
const sentences = (s: string) => (prose(s).match(/[.!?](?=\s|$)/g) ?? []).length;
/** Companies Purser competes with or could be compared to: never named in a sheet. */
const COMPETITORS = /\b(Ramp|Brex|Pleo|Spendesk|Payhawk|Mercury|Revolut|Wise|Stripe|Adyen|Skyfire|Payman|Nekuda|Natural|Paid\.ai|Bill\.com|Tipalti|Coupa)\b/;

function sheet(company: string) {
  const text = readFileSync(join(DIR, `${company}.md`), "utf8");
  const qs = text.split(/^## /m).slice(1).map((b) => {
    const [head, ...rest] = b.split("\n");
    const body = rest.join("\n");
    const paras = body.split("\n\n").map((p) => p.trim()).filter(Boolean);
    return { q: head!.trim(), answer: paras.filter((p) => !p.startsWith("**Source:**")).join("\n"), source: paras.find((p) => p.startsWith("**Source:**")) ?? "" };
  });
  return { text, qs };
}

describe("the jury cheat sheets", () => {
  it("has one sheet per jury company, each with numbered questions in order and at most about 40", () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()).toEqual(COMPANIES.map((c) => `${c}.md`).sort());
    for (const c of COMPANIES) {
      const { qs } = sheet(c);
      expect({ c, n: qs.length >= 5 && qs.length <= 40 }).toEqual({ c, n: true });
      expect(qs.map((x) => Number(/^(\d+)\. /.exec(x.q)?.[1]))).toEqual(qs.map((_, i) => i + 1));
    }
  });

  it("answers each in one or two sentences, with a source", () => {
    for (const c of COMPANIES) for (const x of sheet(c).qs) {
      const n = sentences(x.answer);
      expect({ c, q: x.q, sentences: n >= 1 && n <= 2, source: x.source.length > 12 }).toEqual({ c, q: x.q, sentences: true, source: true });
    }
  });

  it("links only to files that exist", () => {
    for (const c of COMPANIES) for (const x of sheet(c).qs) {
      for (const m of x.source.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) expect({ c, q: x.q, link: m[1], exists: existsSync(resolve(DIR, m[1]!)) }).toEqual({ c, q: x.q, link: m[1], exists: true });
      for (const m of x.source.matchAll(/`((?:src|test|worker|docs|\.github)\/[^`\s]+)`/g)) expect({ c, q: x.q, path: m[1], exists: existsSync(join(ROOT, m[1]!)) || m[1] === "src/config/pricing.ts" }).toEqual({ c, q: x.q, path: m[1], exists: true });
    }
  });

  it("finds every figure in an answer in docs/claims.md or a run record", () => {
    for (const c of COMPANIES) for (const x of sheet(c).qs) {
      const said = x.answer.replace(/`[^`]*`/g, " ").replace(/\[[^\]]*\]\([^)]*\)/g, " ");
      for (const num of said.match(/\d+(?:[.,]\d+)*/g) ?? []) expect({ c, q: x.q, num, inRecords: RECORDS.includes(num) }).toEqual({ c, q: x.q, num, inRecords: true });
    }
  });

  it("never says certified, endorsed or approved by, names no competitor, quotes no one, and has no founder lines", () => {
    for (const c of COMPANIES) {
      const { text, qs } = sheet(c);
      expect({ c, banned: /\b(certified|endorsed|approved by)\b/i.exec(prose(qs.map((x) => x.answer).join(" ")))?.[0] ?? null }).toEqual({ c, banned: null });
      expect({ c, competitor: COMPETITORS.exec(text)?.[0] ?? null }).toEqual({ c, competitor: null });
      for (const x of qs) expect({ c, q: x.q, quote: /[“”"]/.test(x.answer) }).toEqual({ c, q: x.q, quote: false });
      expect({ c, founder: /\bfounder|\bbio\b|\bR2\b/i.test(text) }).toEqual({ c, founder: false });
    }
  });

  it("says plainly what has not run: tokens on Metal pending, Exact next, no customers, testnet and sandbox", () => {
    const all = COMPANIES.map((c) => prose(sheet(c).text)).join(" ");
    for (const s of ["live run on Metal testnet is pending", "Exact next", "no customers yet", "testnet and test money only", "not tested yet"]) expect({ s, said: all.includes(s) }).toEqual({ s, said: true });
    expect(all).not.toMatch(/tokens? (?:are|is) live on (?:Metal )?testnet/i);
  });
});
