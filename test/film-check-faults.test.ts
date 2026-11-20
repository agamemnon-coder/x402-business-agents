// The film's own checks on cuts that break every rule (src/film/cuts.ts checkCut), and the letterboxed burn-in of film
// v10 (src/film/captions.ts): what each fault is reported as, and what the letterboxed ASS draws where. The real cuts
// pass their check (test/film-cuts.test.ts); these cuts are made to fail it, one rule at a time.
import { describe, expect, it } from "vitest";
import { assFile, wrap } from "../src/film/captions.js";
import { HANDIN10, checkCut, onScreen, resolveCut, type Cut, type Row } from "../src/film/cuts.js";

const cam = (id: string, words: string, seconds: number, extra: Partial<Row> = {}): Row => ({ id, kind: "cam", words, segs: [{ own: "M1", seconds }], claims: ["C01"], ...extra });

describe("checkCut names each broken rule", () => {
  const bad: Cut = {
    id: "submission-3", title: "A cut that breaks the rules", file: "bad", limit: 30,
    rows: [
      // The opening says nothing of what Purser does, runs over 20 s on camera, and calls the CFO "she".
      cam("b01", "Hello there. She signs.", 25),
      {
        id: "b02", kind: "vo",
        words: "A revolutionary payout was PAID. Metal refused it. Then 987654321 people watched the long words go by in a row that is far too short for them.",
        segs: [
          { shot: ["NO-SUCH-SHOT"], seconds: 0.5, caption: "A caption with far too many words to be read on screen" },
          { own: "P1a", seconds: 2, caption: "EUR 5 on screen", badge: "awx" },
          { rec: "no-such-recording", seconds: 2, caption: "EUR 7 shown here" },
          { own: "ZZ" as "M1", seconds: 2, caption: [{ from: 0, to: 2, text: "first" }, { from: 1, to: 2, text: "second" }] },
        ],
        claims: ["C09"],
      },
    ],
  };
  const problems = checkCut(bad);
  const has = (re: RegExp) => expect(problems.some((p) => re.test(p)), `${re} in ${JSON.stringify(problems, null, 1)}`).toBe(true);

  it("times: over the limit, a row too short for its words, Max on camera too long", () => {
    has(/^submission-3: \d+(\.\d+)? s is over 30 s$/);
    has(/^b02: needs \d+(\.\d+)? s, has 6\.5$/);
    has(/^b01: Max on camera longer than 20 s$/);
  });

  it("footage: a shot, own footage or recording that does not exist", () => {
    has(/^b02: no shot NO-SUCH-SHOT$/);
    has(/^b02: no own footage ZZ$/);
    has(/^b02: no recording no-such-recording$/);
  });

  it("honesty: a number not in the records, PAID without simulated settlement", () => {
    has(/^b02: said number 987654321 is not in the records of C09$/);
    has(/^b02: PAID without "settlement simulated"$/);
  });

  it("captions: too long, too brief, two at once, money without a badge, the phone walk without the test-world badge", () => {
    has(/caption "A caption with far too many words to be read on screen" is over 8 words or 48 characters/);
    has(/caption "A caption with far too many words to be read on screen" on screen too briefly/);
    has(/^b02: two captions at once$/);
    has(/^b02: money on screen without a badge \("EUR 7 shown here"\)$/);
    has(/^b02: the phone walk needs the test-world badge$/);
  });

  it("words: the opening, a gendered pronoun, a forbidden word, the Metal refusal without \"on purpose\"", () => {
    has(/^the opening does not say what Purser does within 15 s$/);
    has(/^b01: a gendered pronoun$/);
    has(/^b02: a forbidden word$/);
    has(/^b02: the Metal refusal without "on purpose"$/);
  });

  it("an unknown claim is reported, not thrown", () => {
    const unknown: Cut = { ...bad, rows: [cam("u01", "Hi, I'm Max. Purser lets AI agents pay company bills.", 5, { claims: ["C999"] })] };
    expect(checkCut(unknown)).toContain("u01: unknown claim C999");
  });

  it("a row whose needs fail and that has no fallback gives its seconds to the row it names", () => {
    const cut: Cut = { ...bad, rows: [cam("g01", "One.", 4), cam("g02", "Two.", 3, { needs: ["never"], give: { g01: 5, g03: 1 } })] };
    const placed = resolveCut(cut, { holds: () => false });
    expect(placed.map((p) => [p.row.id, p.seconds])).toEqual([["g01", 9]]);
  });
});

describe("film v10's letterboxed burn-in", () => {
  const placed = resolveCut(HANDIN10);
  const ass = assFile(placed, { letterbox: true, draft: true, notes: [{ at: 1, to: 2, text: "the {last} shot" }] });

  it("puts the credit and the badges in the bars, the titles large, and a recording's step beside the phone", () => {
    expect(ass).toMatch(/Corner,,0,0,0,,\{\\an4\\pos\(64,69\)\\fad\(600,300\)\}Purser · Starter Kit 11/);
    expect(ass).toMatch(/BarBadge,.*Simulated bank · test money/);
    expect(ass).toMatch(/Title,.*What is not done/);
    expect(ass).toMatch(/Step,.*Your own test company/);
    expect(ass).toContain("Recorded from the live page · virtual test passkey");
    // The end card's credits sit in the bar below.
    expect(ass).toMatch(/\\pos\(960,1011\)\\fs24\\fad\(400,0\)\}Test money only/);
  });

  it("does not repeat a recording's step in the bar, but captions a shot that is not a recording", () => {
    const bar = ass.split("\n").filter((l) => l.includes(",BarCaption,"));
    expect(bar.some((l) => l.endsWith("Your own test company"))).toBe(false);
    expect(bar.some((l) => l.includes("Purser Cloud · where a company runs Purser"))).toBe(true);
    const captions = onScreen(placed).filter((x) => x.kind === "caption");
    expect(bar.length).toBeLessThan(captions.length);
  });

  it("marks what is not captured yet, and runs the narration as a VO line in a draft", () => {
    expect(ass).toContain("NOT CAPTURED YET");
    expect(ass).toContain("the (last) shot");
    expect(ass).toMatch(/,Draft,,0,0,0,,VO: /);
    expect(assFile(placed, { letterbox: true })).not.toMatch(/,Draft,/);
  });

  it("the plain burn-in marks a shot not captured yet too", () => {
    expect(assFile(resolveCut(HANDIN10).slice(0, 1), { notes: [{ at: 0, to: 1, text: "x" }] })).toContain("NOT CAPTURED YET");
  });

  it("wraps a line at spaces", () => {
    expect(wrap("one two three four", 9)).toBe("one two\nthree\nfour");
    expect(wrap("", 9)).toBe("");
  });
});
