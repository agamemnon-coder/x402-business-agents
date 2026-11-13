// The two films' cut lists (src/film/cuts.ts): the 3:00 is 3:00, the walkthrough is under five minutes whichever
// streams have merged, every row fits its words at 150 a minute, every caption is short, and every number on screen or
// in the narration is found in the record of a claim the row names (src/film/claims.ts).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIMS, claim } from "../src/film/claims.js";
import { BADGES, CUTS, ROOT, SUBMISSION, WALKTHROUGH, captionWords, checkCut, inText, chapters, claimHolds, needed, numbers, onScreen, resolveCut, scriptMarkdown, spokenWords, srt, total, type Cut } from "../src/film/cuts.js";
import { SHOTS } from "../src/film/shots.js";

const read = (p: string) => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), "utf8") : null);
const sourcesOf = (ids: string[]) => ids.flatMap((c) => claim(c).sources).map(read).filter((x): x is string => x !== null).join("\n");
const ALL = (_: string) => true, NONE = (n: string) => n !== "demo-deployment" && !["C17", "C20", "C21", "C26p", "C30"].includes(n) && claimHolds(n);

describe("the check passes as the films are cut today", () => {
  it("both cuts and the Demo Day close have no problem", () => {
    expect(checkCut(SUBMISSION)).toEqual([]);
    expect(checkCut(SUBMISSION, { demoDay: true })).toEqual([]);
    expect(checkCut(WALKTHROUGH)).toEqual([]);
  });

  it("the 3:00 is 180 s; the walkthrough is under five minutes, about 4:45, with or without the streams still on their branches", () => {
    expect(total(resolveCut(SUBMISSION))).toBe(180);
    for (const holds of [ALL, NONE]) {
      const t = total(resolveCut(WALKTHROUGH, { holds }));
      expect(t).toBeLessThan(300);
      expect(t).toBeGreaterThanOrEqual(270);
    }
    expect(total(resolveCut(WALKTHROUGH, { holds: ALL }))).toBe(285);
  });

  it("a row whose record is not here falls back to its timed words, or is dropped and its seconds given", () => {
    const today = resolveCut(WALKTHROUGH, { holds: NONE });
    expect(today.find((p) => p.row.id === "w08")!.row.segs[0]!.shot).toEqual(["T13"]);
    expect(today.find((p) => p.row.id === "w12")).toBeUndefined();
    expect(today.find((p) => p.row.id === "w05")!.seconds).toBe(23);
    expect(today.find((p) => p.row.id === "w04")!.row.claims).toEqual(["C20b", "C32", "C10"]);
    const later = resolveCut(WALKTHROUGH, { holds: ALL });
    expect(later.find((p) => p.row.id === "w12")!.row.claims).toEqual(["C30"]);
    expect(later.find((p) => p.row.id === "w05")!.seconds).toBe(19);
    // Every variant's words fit their row (the fallbacks are timed too).
    for (const holds of [ALL, NONE]) for (const p of resolveCut(WALKTHROUGH, { holds })) expect({ row: p.row.id, fits: needed(p.row) <= p.seconds }).toEqual({ row: p.row.id, fits: true });
  });
});

describe("timing: 150 words a minute, numbers as spoken", () => {
  it("counts numbers as they are read", () => {
    expect(spokenWords("An invoice for 1,850 euros")).toBe(3 + 5 + 1);
    expect(spokenWords("6.3 seconds")).toBe(4);
    expect(spokenWords("the missing 623 euros 50.")).toBe(2 + 3 + 1 + 1);
    expect(spokenWords("95 journal entries")).toBe(3);
    expect(spokenWords("T:0's sandbox")).toBe(3);
    expect(spokenWords("a 240 euro invoice")).toBe(1 + 3 + 2);
  });

  it("the opening says what Purser does by 15 s, and Max's rows stay within 20 and 15 s", () => {
    for (const cut of [SUBMISSION, WALKTHROUGH]) {
      const p = resolveCut(cut);
      const first = p[0]!.row.words;
      const upTo = first.slice(0, first.indexOf("company bills") + "company bills".length);
      expect((spokenWords(upTo) / 150) * 60).toBeLessThan(15);
      const cams = p.filter((x) => x.row.kind === "cam");
      expect(cams.map((x) => x.seconds)).toEqual([20, 15]);
    }
  });
});

describe("every number on screen and in the narration is in its source file", () => {
  for (const cut of Object.values(CUTS) as Cut[]) {
    it(`${cut.id}: each caption's numbers`, () => {
      const placed = resolveCut(cut);
      const shown = onScreen(placed).filter((x) => x.kind === "caption");
      expect(shown.length).toBeGreaterThan(10);
      for (const x of shown) {
        const src = sourcesOf(x.row.claims);
        for (const n of numbers(x.text)) expect({ caption: x.text, n, found: inText(n, src) }).toEqual({ caption: x.text, n, found: true });
      }
    });
    it(`${cut.id}: each spoken number (or its stated rounding)`, () => {
      for (const p of resolveCut(cut)) {
        const src = sourcesOf(p.row.claims);
        for (const n of numbers(p.row.words)) {
          const rd = p.row.rounded?.find(([said]) => said === n);
          const found = inText(n, src) || (!!rd && inText(rd[1], src) && Math.round(Number(rd[1]) / rd[2]) === Number(n));
          expect({ row: p.row.id, n, found }).toEqual({ row: p.row.id, n, found: true });
        }
      }
    });
  }

  it("the check catches a number that is in no record, and a claim that does not hold", () => {
    const bad: Cut = { ...SUBMISSION, rows: SUBMISSION.rows.map((r) => (r.id === "s07" ? { ...r, words: r.words.replace("45 euro", "73.25 euro") } : r.id === "s10" ? { ...r, segs: [{ ...r.segs[0]!, caption: "T:0 sandbox · 10 Nov · 196 of 196" }] } : r)) };
    const problems = checkCut(bad);
    expect(problems).toContain("s07: said number 73.25 is not in the records of C12");
    expect(problems).toContain("s10: shown number 196 is not in the records of C16");
    const unheld: Cut = { ...SUBMISSION, rows: SUBMISSION.rows.map((r) => (r.id === "s10" ? { ...r, claims: ["C30"] } : r)) };
    expect(checkCut(unheld).some((p) => p.startsWith("s10: claim C30 does not hold"))).toBe(true);
  });


  it("the claims the cuts use today all hold; the ones still on a branch are only in rows that wait for them", () => {
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const p of resolveCut(cut)) for (const c of p.row.claims) expect({ row: p.row.id, c, holds: claimHolds(c) }).toEqual({ row: p.row.id, c, holds: true });
    const waiting = CLAIMS.filter((c) => !claimHolds(c.id)).map((c) => c.id);
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const r of cut.rows) for (const c of r.claims) if (waiting.includes(c)) expect({ row: r.id, c, waits: (r.needs ?? []).includes(c) }).toEqual({ row: r.id, c, waits: true });
  });
});

describe("captions, badges and wording", () => {
  it("a caption is at most 8 words and 48 characters, one at a time, and money on screen carries a badge", () => {
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const holds of [ALL, NONE]) {
      const placed = resolveCut(cut, { holds });
      for (const x of onScreen(placed).filter((y) => y.kind === "caption")) {
        expect({ c: x.text, short: captionWords(x.text) <= 8 && x.text.length <= 48 }).toEqual({ c: x.text, short: true });
      }
      for (const p of placed) for (const g of p.segs) if (g.own?.startsWith("P1")) expect(g.badge).toBe("testworld");
      for (const p of placed) for (const g of p.segs) if (typeof g.caption === "string" && /EUR|PAID|LIMIT_EXCEEDED|payout|refused/.test(g.caption)) expect({ c: g.caption, badge: !!g.badge }).toEqual({ c: g.caption, badge: true });
    }
    expect(Object.values(BADGES)).toContain("Test world · no money moves");
  });

  it("PAID comes with simulated settlement; Metal's refusal with \"on purpose\"; no gendered pronoun, no partner claim", () => {
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const p of resolveCut(cut, { holds: ALL })) {
      const r = p.row, all = `${r.words} ${JSON.stringify(r.segs)}`;
      // A stand-in world (C21) settles nothing; everywhere else PAID is said with its simulated settlement.
      if (/\bPAID\b|\bpaid\b/.test(all) && r.kind === "vo") expect({ row: r.id, simulated: /simulat/i.test(all) || r.claims.includes("C10") || r.claims.includes("C21") }).toEqual({ row: r.id, simulated: true });
      if (/Metal refused/.test(r.words)) expect(r.words).toContain("on purpose");
      expect(r.words).not.toMatch(/\b(he|she|his|her|him)\b/i);
      expect(r.words).not.toMatch(/certified|endorsed|partnered|revolutionary|seamless|guaranteed/i);
    }
  });

  it("every shot a cut names is in the shot list", () => {
    const ids = new Set(SHOTS.map((s) => s.id));
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const r of cut.rows.flatMap((x) => [x, ...(x.fallback ? [x.fallback] : [])])) for (const g of r.segs) if (g.shot) expect({ row: r.id, shot: g.shot, known: g.shot.some((s) => ids.has(s)) }).toEqual({ row: r.id, shot: g.shot, known: true });
  });
});

describe("what the cut writes", () => {
  it("the .srt is in order and inside the film; the chapters start at 0:00 and are at least 10 s apart (YouTube's rule)", () => {
    const placed = resolveCut(WALKTHROUGH);
    const blocks = srt(placed).trim().split(/\n\n/);
    expect(blocks.length).toBeGreaterThan(40);
    const times = blocks.map((b) => b.split("\n")[1]!.split(" --> ").map((t) => { const [h, m, s] = t.split(":"); return +h! * 3600 + +m! * 60 + +s!.replace(",", "."); }));
    for (let i = 1; i < times.length; i++) expect(times[i]![0]!).toBeGreaterThanOrEqual(times[i - 1]![1]! - 0.001);
    expect(times.at(-1)![1]!).toBeLessThan(total(placed));
    const ch = chapters(placed);
    expect(ch[0]).toEqual({ at: 0, title: "What Purser does" });
    for (let i = 1; i < ch.length; i++) expect(ch[i]!.at - ch[i - 1]!.at).toBeGreaterThanOrEqual(10);
  });

  it("the script table names every claim and every placeholder", () => {
    const md = scriptMarkdown(SUBMISSION, resolveCut(SUBMISSION));
    expect(md).toContain("# Purser in three minutes (3:00)");
    for (const id of ["M1", "P1a", "P1b", "P1c", "P1d", "M2"]) expect(md).toContain(`**${id}** (placeholder:`);
    for (const c of ["C01", "C09", "C12", "C13", "C15", "C16", "C18", "C19"]) expect(md).toContain(c);
  });
});

describe("the hand-in film (13 Nov): under 4:45, every line from a record, its docs written by the code", () => {
  it("passes its check and stays under 4:45 (the owner's limit for the hand-in)", async () => {
    const { HANDIN, shotListMarkdown } = await import("../src/film/cuts.js");
    expect(checkCut(HANDIN)).toEqual([]);
    expect(total(resolveCut(HANDIN))).toBeLessThan(285);
    // The scenes the owner asked for, in order.
    expect(resolveCut(HANDIN).map((p) => p.row.chapter).filter(Boolean)).toEqual(["The problem", "Kit 11's core", "Try it: your own test company", "Face ID, checked on chain", "Refused on chain", "Airwallex: the card limit", "Visa via Airi", "Two locks on one payout", "The books, coded by Claude", "Purser Cloud", "The proof", "What is not done", "Close"]);
    const placed = resolveCut(HANDIN);
    // The docs in docs/video/ are what the code writes (npm run cut -- --docs handin-5).
    expect(readFileSync(resolve(ROOT, "docs/video/handin-script.md"), "utf8")).toBe(scriptMarkdown(HANDIN, placed));
    expect(readFileSync(resolve(ROOT, "docs/video/handin-shots.md"), "utf8")).toBe(shotListMarkdown(HANDIN, placed));
    expect(readFileSync(resolve(ROOT, "docs/video/handin.srt"), "utf8")).toBe(srt(placed));
  });

  it("says a test passkey where one signed, Face ID only where the owner's own phone signed, and what is not done", async () => {
    const { HANDIN } = await import("../src/film/cuts.js");
    const words = (id: string) => HANDIN.rows.find((r) => r.id === id)!.words;
    expect(words("h04")).toContain("a labelled test passkey");
    // 13 Nov: Max's own Face ID opened Purser's lock, and the payout is still held; PAID is 12 Nov's, with a test passkey.
    expect(words("h08")).toContain("Face ID on Max's own iPhone");
    expect(words("h08")).toContain("signed with a test passkey");
    expect(words("h08")).toContain("simulated settlement");
    expect(words("h12")).toContain("still waits at Airwallex");
    // vic-4 (13 Nov): Purser refused a reused credential and one shown for another amount.
    expect(words("h07")).toContain("was refused by Purser");
    // The hands-on demo with Claude on (13 Nov record): Claude reads, Purser's code holds every limit.
    expect(words("h03")).toContain("Claude reads it");
    expect(words("h03")).toContain("Purser's code holds every limit");
  });
});
