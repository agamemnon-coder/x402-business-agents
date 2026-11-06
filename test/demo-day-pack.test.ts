// The Demo Day pack (6 Nov): the Q&A has at least 15 questions, each answered in 3 sentences or fewer that point to
// evidence (a link or a path); the 3-minute Demo Day pitch fits about 2.3 words a second per part, as its own table
// says; the runbook has the three fallbacks; the cheat sheet is one A4 page with the three sentences. Breaks when an
// answer grows, loses its evidence, or a part of the pitch runs over its time.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIFFERENTIATORS } from "../src/config/brand.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Prose as read: comments gone, links to their text, code spans to one word, emphasis marks gone, white space single. */
const prose = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`[^`]*`/g, "code")
  .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
/** Sentences end at . ! or ? before a space or the end (decimals, paths and ids have no space after the dot). */
const sentences = (s: string) => (prose(s).match(/[.!?](?=\s|$)/g) ?? []).length;

describe("the Q&A (docs/submission/qa.md)", () => {
  const qa = read("docs/submission/qa.md");
  const blocks = qa.split(/^### /m).slice(1).filter((b) => /^\d+\. /.test(b)).map((b) => {
    const [head, ...rest] = b.split("\n");
    const body = rest.join("\n").split(/^## /m)[0]!;
    const evidence = body.split("\n\n").filter((p) => p.trim().startsWith("**Evidence:**")).join("\n");
    const answer = body.split("\n\n").filter((p) => p.trim() && !p.trim().startsWith("**Evidence:**")).join("\n");
    return { q: head!.trim(), answer, evidence, body };
  });

  it("asks at least 15 questions, numbered in order", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(15);
    expect(blocks.map((b) => Number(/^(\d+)\./.exec(b.q)![1]))).toEqual(blocks.map((_, i) => i + 1));
  });

  it("answers each in 3 sentences or fewer", () => {
    const long = blocks.map((b) => ({ q: b.q, n: sentences(b.answer) })).filter((x) => x.n < 1 || x.n > 3);
    expect(long).toEqual([]);
  });

  it("points each answer to evidence: at least one link or path", () => {
    const evidence = /\]\([^)]+\)|https?:\/\/|`[^`]*[/.][^`]*`/;
    expect(blocks.filter((b) => !b.evidence.trim() || !evidence.test(b.body)).map((b) => b.q)).toEqual([]);
  });

  it("includes the questions the jury will ask hardest", () => {
    for (const q of ["Was #24's refusal staged?", "Was the second approver a test passkey?", "It's all sandbox and testnet: what's real?",
      "What if Airwallex builds this itself?", "Why a blockchain?", "Why Claude, and what does it cost?", "Who pays for this, and how much?",
      "What if the agent gets a prompt injection?", "What if Purser's server is hacked?", "How does this scale to 1000 agents?",
      "Why Face ID and not a password or a button?", "What would you do in the first month after the hackathon?"]) {
      expect({ q, asked: blocks.some((b) => b.q.includes(q)) }).toEqual({ q, asked: true });
    }
  });

  it("says the limits plainly: attestation none, test money, the business case not validated", () => {
    const t = prose(qa);
    expect(t).toContain('attestation is "none"');
    expect(t).toContain("all money is test money");
    expect(t).toContain("we have not validated demand");
  });
});

describe("the Demo Day pitch (docs/submission/pitch.md)", () => {
  const pitch = read("docs/submission/pitch.md");
  const demo = pitch.slice(pitch.indexOf("## Demo Day: the 3-minute pitch"), pitch.indexOf("## 1. The elevator pitch"));
  /** About 2.3 words a second, in whole words (integer arithmetic: 50 × 2.3 is 114.999… in floating point). */
  const budget = (sec: number) => Math.floor((sec * 23) / 10);
  const secs = (t: string) => { const [m, s] = t.split(":").map(Number); return m! * 60 + s!; };
  /** The "Max says" cell of each row, as spoken. */
  const said = (part: string) => part.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length === 3 && c[1] !== "Max says").map((c) => prose(c[1]!)).filter(Boolean);
  const words = (lines: string[]) => lines.join(" ").split(/\s+/).filter(Boolean).length;
  const parts = [...demo.matchAll(/^### (\d:\d\d)–(\d:\d\d) · ([^\n]+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .map((m) => ({ from: secs(m[1]!), to: secs(m[2]!), title: m[3]!.replace(/ \(.*$/, ""), words: words(said(m[4]!)) }));

  it("has four parts that run 0:00 to 3:00 without a gap", () => {
    expect(parts.map((p) => [p.from, p.to])).toEqual([[0, 20], [20, 90], [90, 140], [140, 180]]);
  });

  it("keeps each part's words within its seconds at about 2.3 words a second, as its own table says", () => {
    for (const p of parts) {
      expect({ part: p.title, over: p.words > budget(p.to - p.from) }).toEqual({ part: p.title, over: false });
      // The list at the top of the section says each part's budget and its written words.
      const line = new RegExp(`^- \\*\\*${p.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\* [^;]+; budget (\\d+) words; written (\\d+) words`, "m").exec(demo);
      expect({ part: p.title, listed: Boolean(line) }).toEqual({ part: p.title, listed: true });
      expect({ part: p.title, budget: Number(line![1]), written: Number(line![2]) }).toEqual({ part: p.title, budget: budget(p.to - p.from), written: p.words });
    }
    const total = /^- \*\*Total:\*\* 3:00; budget (\d+) words; written (\d+) words/m.exec(demo);
    expect([Number(total?.[1]), Number(total?.[2])]).toEqual([parts.reduce((a, p) => a + budget(p.to - p.from), 0), parts.reduce((a, p) => a + p.words, 0)]);
  });

  it("demos /try/sign live (sign, then tamper), shows the three proofs and ends on the ask", () => {
    const t = prose(demo);
    for (const s of ["Tap Start: show me the proposal", "Sign with Face ID", "Try to tamper: change the amount by 0.01", "One cent changed. The signature is worthless.",
      "Proof one", "Proof two", "Proof three: Claude made 24 of 24 decisions, with 0 fallbacks.", "we're looking for design partners on Airwallex"]) expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
  });
});

describe("the Demo Day runbook, cheat sheet and after-submission list", () => {
  it("gives the three fallbacks in the runbook", () => {
    const t = prose(read("docs/submission/demo-day.md"));
    expect(t).toMatch(/Network down[^|]*\/watch/);
    expect(t).toMatch(/Face ID fails[^|]*second device[^|]*recorded run/);
    expect(t).toMatch(/quote expires[^|]*Get a new quote/i);
  });

  it("prints the cheat sheet on one A4 page, with the three sentences", () => {
    const pdf = readFileSync(new URL("../docs/submission/cheat-sheet.pdf", import.meta.url)).toString("latin1");
    expect((pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
    // A4 is 595 × 842 points; Chromium writes it as about 594.96 × 841.92.
    expect(pdf).toMatch(/\/MediaBox\s*\[\s*0 0 59[45]\.\d+ 84[12]\.\d+\s*\]/);
    const md = prose(read("docs/submission/cheat-sheet.md"));
    for (const d of DIFFERENTIATORS) expect(md).toContain(d);
  });

  it("keeps the after-submission list a list, nothing done", () => {
    const t = read("docs/internal/after-submission.md");
    expect(t).not.toMatch(/\[x\]/i);
    for (const s of ["Film v4", "VIC", "MFA", "Dependabot", "Playwright", "branch", "T:0"]) expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
  });
});
