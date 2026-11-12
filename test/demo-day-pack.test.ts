// The Demo Day pack (6 Nov): the Q&A has at least 15 questions, each answered in 3 sentences or fewer that point to
// evidence (a link or a path); the 3-minute Demo Day pitch fits about 2.3 words a second per part, as its own table
// says; the runbook has the three fallbacks; the cheat sheet is one A4 page with the three sentences. Breaks when an
// answer grows, loses its evidence, or a part of the pitch runs over its time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIFFERENTIATORS } from "../src/config/brand.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** HTML comments cut out by position, not by a regex (an unclosed "<!--" drops the rest, so none is left behind). */
const dropComments = (s: string) => {
  let out = "", i = 0;
  for (;;) {
    const a = s.indexOf("<!--", i);
    if (a < 0) return out + s.slice(i);
    const b = s.indexOf("-->", a + 4);
    out += s.slice(i, a);
    if (b < 0) return out;
    i = b + 3;
  }
};
/** Prose as read: comments gone, links to their text, code spans to one word, emphasis marks gone, white space single. */
const prose = (s: string) => dropComments(s).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`[^`]*`/g, "code")
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

describe("the seven near-certain questions (qa.md, 27 to 33)", () => {
  const qa = read("docs/submission/qa.md");
  const QS = ["What if Claude makes a mistake?", "Why not a spending limit or 2FA?", "Do you hold money? Are you regulated?", "Why Metal?",
    "How do you make money?", "Customers?", "What is real and what is simulated?"];
  const block = (q: string) => {
    const at = qa.indexOf(`. ${q}\n`);
    const body = qa.slice(qa.indexOf("\n", at) + 1).split(/^#{2,3} /m)[0]!;
    const answer = body.split("\n\n").filter((p) => p.trim() && !p.trim().startsWith("**Evidence:**")).join("\n");
    const evidence = body.split("\n\n").filter((p) => p.trim().startsWith("**Evidence:**")).join("\n");
    return { at, answer, evidence };
  };

  it("asks all seven, numbered 27 to 33, each answered in at most 2 sentences", () => {
    QS.forEach((q, i) => {
      const b = block(q);
      expect({ q, found: b.at > 0 }).toEqual({ q, found: true });
      expect({ q, heading: qa.includes(`### ${27 + i}. ${q}\n`) }).toEqual({ q, heading: true });
      const n = sentences(b.answer);
      expect({ q, sentences: n >= 1 && n <= 2 }).toEqual({ q, sentences: true });
    });
  });

  it("finds every figure in an answer in a record or doc it links", () => {
    for (const q of QS) {
      const b = block(q);
      const files = [...b.evidence.matchAll(/\]\((\.\.\/[^)#]+)(?:#[^)]*)?\)/g)].map((m) => readFileSync(new URL(m[1]!, new URL("../docs/submission/", import.meta.url)), "utf8"));
      const said = dropComments(b.answer).replace(/`[^`]*`/g, " ");
      for (const num of said.match(/\d+(?:[.,]\d+)*/g) ?? []) expect({ q, num, found: files.some((t) => t.includes(num)) }).toEqual({ q, num, found: true });
    }
  });

  it("types no price by hand: the price line is the pricing config's, or carries no figure", async () => {
    const line = /<!-- PRICING-LINE -->([\s\S]*?)<!-- \/PRICING-LINE -->/.exec(qa)?.[1] ?? "";
    expect(line.length).toBeGreaterThan(0);
    const cfg = new URL("../src/config/pricing.ts", import.meta.url);
    const pricing = existsSync(cfg) ? ((await import(/* @vite-ignore */ cfg.href)) as { PRICING_LINE?: string }) : null;
    if (pricing?.PRICING_LINE && line.trim() === pricing.PRICING_LINE) return;
    expect(line).not.toMatch(/€|EUR|USD|\$|\d/);
  });

  it("says plainly: no paying customers yet, design partners wanted, tokens not live, no licence", () => {
    const t = prose(qa.slice(qa.indexOf("### 27. ")));
    for (const s of ["no paying customers", "looking for design partners", "have not run live yet", "not licensed, certified or audited", "no legal advice"]) expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
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

  it("demos /try/sign live (sign, try to cheat, change the rule), shows the three proofs and ends on the ask", () => {
    const t = prose(demo);
    for (const s of ["Tap Sign with Face ID", "Now try to cheat: change one cent", "One cent changed. The signature is worthless.", "Next: change the rule", "A looser rule needs my signature too.", "paid alone, no signature needed",
      "Proof one", "Proof two", "Proof three: Claude made 24 of 24 decisions, with 0 fallbacks.", "we're looking for design partners on Airwallex"]) expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
  });
});

describe("the Demo Day runbook, cheat sheet and after-submission list", () => {
  it("gives the runbook in the recorded-video format: the slot, the backups, the Q&A technique and the 3-minute path", () => {
    const raw = read("docs/submission/demo-day.md"), t = prose(raw);
    expect(t).toContain("19 November 2026, 17:00–19:00 PT, which is 02:00–04:00 in the Netherlands");
    expect(t).toMatch(/play our recorded video/);
    expect(t).toMatch(/backup video link/i);
    expect(t).toMatch(/backup demo link/i);
    expect(raw).toMatch(/network is down\*\* \| [^\n]*`npm run judge`/i);
    for (const s of ["Repeat the question", "Answer in two sentences", "not tested yet", "Point to the QR code"]) expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
    // The old start-up list of tabs (the live pitch of 7 November) is gone.
    expect(raw).not.toMatch(/Start-up list|\/watch\?scene=1|tab 7/);
    // The 3-minute path: eight steps from 0:00 to 3:00 without a gap, each with a URL and a fallback.
    const path = raw.slice(raw.indexOf("## 5. The 3-minute demo path"), raw.indexOf("## 6. "));
    const rows = path.split("\n").filter((l) => /^\| \d\. /.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
    expect(rows.map((r) => r[0]!.replace(/^\d\. /, ""))).toEqual(["The problem", "The invoice", "Forged IBAN refused", "Face ID, then Airwallex",
      "T:0, Moneybird and the vault", "The token on Metal", "The agent overview", "The proof"]);
    const times = rows.map((r) => r[1]!.split("–"));
    expect(times[0]![0]).toBe("0:00");
    expect(times.at(-1)![1]).toBe("3:00");
    for (let i = 1; i < times.length; i++) expect(times[i]![0]).toBe(times[i - 1]![1]);
    for (const r of rows) expect({ step: r[0], url: r[2]!.length > 0 && /\/|http/.test(r[2]!), fallback: r[4]!.length > 0 }).toEqual({ step: r[0], url: true, fallback: true });
    // The token on Metal is said by its record's status.
    const tokenizeRun = readdirSync(new URL("../docs/runs/", import.meta.url)).some((f) => /tokeni[sz]/i.test(f) && /\.md$/.test(f));
    if (!tokenizeRun) expect(prose(rows[5]!.join(" "))).toContain("live run pending");
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

describe("the Demo Day video script (docs/submission/demo-day-video.md)", () => {
  const doc = read("docs/submission/demo-day-video.md");
  const budget = (sec: number) => Math.floor((sec * 23) / 10);
  const secs = (t: string) => { const [m, s] = t.split(":").map(Number); return m! * 60 + s!; };
  const words = (s: string) => prose(s).split(/\s+/).filter(Boolean).length;
  const beats = [...doc.matchAll(/^### Beat (\d+) · (\d:\d\d)–(\d:\d\d) · ([^\n]+)\n([\s\S]*?)(?=^##|$(?![\s\S]))/gm)].map((m) => {
    const body = m[5]!;
    const says = /^- \*\*Max says:\*\* "([^"]+)"\s*$/m.exec(body)?.[1] ?? "";
    const source = /^- \*\*Source:\*\* ([\s\S]*?)(?=^- \*\*|^$)/m.exec(body)?.[1] ?? "";
    return { n: Number(m[1]), from: secs(m[2]!), to: secs(m[3]!), title: m[4]!.trim(), says, source, body };
  });
  const tokenizeRun = readdirSync(new URL("../docs/runs/", import.meta.url)).some((f) => /tokeni[sz]/i.test(f) && /\.md$/.test(f));

  it("has the nine beats in order, from 0:00 without a gap, ending before 3:00", () => {
    expect(beats.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(beats[0]!.from).toBe(0);
    for (let i = 1; i < beats.length; i++) expect({ beat: beats[i]!.n, from: beats[i]!.from }).toEqual({ beat: beats[i]!.n, from: beats[i - 1]!.to });
    expect(beats.at(-1)!.to).toBeLessThan(180);
  });

  it("keeps each beat's words within its seconds at about 2.3 words a second, as its own list says", () => {
    for (const b of beats) {
      expect(b.says.length, `beat ${b.n} has words`).toBeGreaterThan(0);
      const n = words(b.says), max = budget(b.to - b.from);
      expect({ beat: b.n, over: n > max }).toEqual({ beat: b.n, over: false });
      const esc = b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const line = new RegExp(`^- \\*\\*${esc}:\\*\\* [^;]+; budget (\\d+) words; written (\\d+) words`, "m").exec(doc);
      expect({ beat: b.n, budget: Number(line?.[1]), written: Number(line?.[2]) }).toEqual({ beat: b.n, budget: max, written: n });
    }
    const total = /^- \*\*Total:\*\* (\d:\d\d); budget (\d+) words; written (\d+) words/m.exec(doc);
    expect([total?.[1], Number(total?.[2]), Number(total?.[3])]).toEqual([
      `${Math.floor(beats.at(-1)!.to / 60)}:${String(beats.at(-1)!.to % 60).padStart(2, "0")}`,
      beats.reduce((a, b) => a + budget(b.to - b.from), 0), beats.reduce((a, b) => a + words(b.says), 0)]);
  });

  it("gives every beat a source that exists, and every number Max says is in one of that beat's sources", () => {
    for (const b of beats) {
      const links = [...b.source.matchAll(/\]\((\.\.\/[^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!);
      expect({ beat: b.n, sources: links.length > 0 }).toEqual({ beat: b.n, sources: true });
      const texts = links.map((l) => readFileSync(new URL(l, new URL("../docs/submission/", import.meta.url)), "utf8"));
      for (const num of b.says.match(/\d+(?:[.,]\d+)*/g) ?? []) {
        expect({ beat: b.n, num, found: texts.some((t) => t.includes(num)) }).toEqual({ beat: b.n, num, found: true });
      }
    }
  });

  it("names the beats the organiser asked for and says the stand-ins and what has not run plainly", () => {
    const said = beats.map((b) => b.says).join(" ");
    for (const s of ["bank account has changed", "over the agent's limit", "Face ID", "change one cent", "Airwallex", "PAID, with settlement simulated",
      "Moneybird", "vault", "Airwallex declined it", "Metal refused it", "test money", "Exact next", "looking for design partners", "Try it yourself"]) {
      expect({ s, said: said.includes(s) }).toEqual({ s, said: true });
    }
    const next = beats.find((b) => b.title === "What's next")!.says;
    if (tokenizeRun) expect(next).toMatch(/Metal/);
    else { expect(next).toContain("live run still pending"); expect(next).not.toMatch(/live on testnet/i); }
    expect(doc).toContain("<short URL from /go>");
  });

  it("has no founder lines, no quotes from others, no competitors and no R2", () => {
    const t = prose(doc);
    expect(t).not.toMatch(/\bR2\b|certified|endorsed|approved by|founder|“|”/i);
  });
});

describe("the Demo Day recording pack (docs/submission/demo-day-recording.md)", () => {
  const raw = read("docs/submission/demo-day-recording.md"), t = prose(raw);

  it("copies the organiser's checklist as a tickable list", () => {
    const list = raw.slice(raw.indexOf("## 1. The organiser's checklist"), raw.indexOf("## 2. "));
    for (const s of ["Under 4 minutes", "within 30–45 seconds", "No slides", "One use case", "Legible", "Camera and light", "Followable without context",
      "why it matters", "what's next", "Watched fully"]) expect({ s, ticked: new RegExp(`^- \\[ \\] [^\\n]*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(list) }).toEqual({ s, ticked: true });
  });

  it("covers the practice, the tabs, the fixed scenario, the iPhone mirroring, the order and the retakes", () => {
    for (const h of ["Practice checklist", "Which tabs to open", "The fixed scenario", "iPhone mirroring", "The recording order", "On a retake"]) expect({ h, has: raw.includes(h) }).toEqual({ h, has: true });
    for (const s of ["/try", "purser-try", "docs/cloud.md", "src/demoworld/companies.ts", "<short URL from /go>"]) expect({ s, has: raw.includes(s) }).toEqual({ s, has: true });
    expect(t).not.toMatch(/\bR2\b|certified|endorsed/);
  });
});
