// "What is not finished" and the judges' questions (review, 21 Nov; src/redesign/notFinished.ts): the same five lines in
// the README (near the top), in JUDGES.md and on /security (#not-finished, the anchor /proof links), the README's
// "Questions judges ask" word for word as /security and /business answer them, and JUDGES.md linked from the README's top.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faqs } from "../src/redesign/business.js";
import { ASVS_DOC, ASVS_SAYS, NOT_FINISHED, NOT_FINISHED_ID, RED_TEAM_RECORD, judgeQuestions, notFinishedMarkdown, redTeamRerun } from "../src/redesign/notFinished.js";
import { securityPage } from "../src/redesign/security.js";
import { MOVED } from "../src/servers/dashboard.js";
import { TOUR_START_HREF } from "../src/redesign/tour.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md"), JUDGES = read("JUDGES.md");
const unesc = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("what is not finished", () => {
  it("is five lines: the security review, production money, a second approver, customers, the go-live doc", () => {
    expect(NOT_FINISHED.map((x) => x.id)).toEqual(["review", "money", "approver", "customers", "go-live"]);
    expect(read(ASVS_DOC)).toContain(ASVS_SAYS);
  });
  it("is the same in the README, near the top, and in JUDGES.md, which the README's top links", () => {
    const at = README.indexOf(notFinishedMarkdown());
    expect(at).toBeGreaterThan(0);
    expect(README.slice(0, at).split("\n").length).toBeLessThan(50);
    expect(JUDGES).toContain(notFinishedMarkdown());
    const link = README.indexOf("**For judges:** [JUDGES.md](JUDGES.md)");
    expect(link).toBeGreaterThan(0);
    expect(link).toBeLessThan(at);
    for (const h of ["## The 2-minute path", "## What is real, and what is sandbox", "## How to verify it yourself", "## The honest limits"]) expect(JUDGES).toContain(`\n${h}\n`);
  });
  it("is on /security as its own section, #not-finished, with the judges' questions", () => {
    const html = unesc(securityPage());
    expect(html).toContain(`id="${NOT_FINISHED_ID}"`);
    for (const x of NOT_FINISHED) expect(html).toContain(x.line);
    for (const q of judgeQuestions()) expect(html).toContain(`<details id="jq-${q.id}"><summary>${q.q}</summary><p>${q.a}</p>`);
  });
});

describe("the judges' questions", () => {
  it("say what the red team's figure is, from its record: internal and scripted, not an independent penetration test", () => {
    const r = JSON.parse(read(RED_TEAM_RECORD)) as { attempts: number; blocked: number; model: string | null };
    expect(redTeamRerun()).toMatchObject({ attempts: r.attempts, blocked: r.blocked, model: r.model });
    const a = judgeQuestions().find((q) => q.id === "redteam")!.a;
    expect(a).toContain("not an independent penetration test");
    expect(a).toContain(r.blocked === r.attempts ? `All ${r.attempts} were stopped` : `${r.blocked} of ${r.attempts}`);
    expect(judgeQuestions().find((q) => q.id === "asvs")!.a).toMatch(/^No: the document is a self-assessment, not a certification and not an audit\./);
  });
  it("are in the README word for word, as /security and /business answer them", () => {
    const b = Object.fromEntries(faqs().map((f) => [f.id, f]));
    const j = Object.fromEntries(judgeQuestions().map((f) => [f.id, f]));
    for (const q of [j.bypass!, b.moat!, b.tools!, b.airwallex!, j.asvs!, j.redteam!, j.cent!]) expect(README).toContain(`- **${q.q}** ${q.a}`);
    // The bypass answer is one and the same on both pages.
    expect(b.bypass!.a).toBe(j.bypass!.a);
  });
});

describe("/judge (review, 21 Nov)", () => {
  it("opens the judge tour on Home", () => {
    expect(MOVED["/judge"]).toBe(`/${TOUR_START_HREF}`);
  });
});
