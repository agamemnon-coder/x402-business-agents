// Final jury, 13 Nov: /security showed three attack totals (zero-trust, the hostile model, the red team) in three places
// with no line that names them together. One line under the headline names each test with its total, from its record,
// and says the red team's "not prevented (detected after)" there, not only in its card.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redTeamRound, REDTEAM_REPORT, securityLead, securityPage } from "../src/redesign/security.js";

const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as Record<string, number>;

describe("/security: the three attack tests, named with their totals under the headline", () => {
  it("reads each total from its record", () => {
    const zt = json("docs/zero-trust/report.json"), he = json("docs/evals/ap-hostile.json"), rt = json(REDTEAM_REPORT);
    expect(securityLead()).toBe(`Three attack tests: zero trust, ${zt.attacks_run} attacks on the payment path, ${zt.attacks_stopped === zt.attacks_run ? "all" : zt.attacks_stopped} stopped; a hostile model, ${he.calls} tool calls, ${he.unsafe === 0 ? "none" : he.unsafe} unsafe by the ledger verdict; the red team, ${rt.attempts} attacks, ${rt.caught_after} not prevented (detected after).`);
    expect(redTeamRound([REDTEAM_REPORT]).after).toBe(rt.caught_after);
  });

  // The final jury, 13 Nov: the headline's attack count and this line's must be one number from one report.
  it("says the same zero-trust count as the layers headline on the same page", () => {
    const page = securityPage();
    // Judge review, 13 Nov: the hero names its set and day, so 53 never reads as every attack Purser faced.
    expect(page).toMatch(/<p class="zsub"><b>\d+ attacks on the payment path<\/b>, all stopped \(zero-trust harness, 13 November\)/);
    const headline = /<p class="zsub"><b>(\d+) attacks on the payment path<\/b>/.exec(page)?.[1];
    const line = /zero trust, (\d+) attacks on the payment path/.exec(securityLead())?.[1];
    expect(headline).toBeDefined();
    expect(line).toBe(headline);
    expect(Number(line)).toBe(json("docs/zero-trust/report.json").attacks_run);
  });

  it("is the line right under the page's heading", () => {
    const page = securityPage();
    const h1 = page.indexOf("<h1"), lead = page.indexOf('<p class="lead">');
    expect(h1).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(h1);
    expect(page.slice(lead, page.indexOf("</p>", lead))).toContain("not prevented (detected after)");
  });
});
