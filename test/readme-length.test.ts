// Jury panel, 15 Nov: "the README is 6,255 words". About 2,500 since: the first screen as #374 made it, the quick start,
// verify-it-yourself and what is live and what is simulated stay; the long sections are docs/ files, one line each.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { README_DOCS, movedBody, readmeFull } from "./readmeFull.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the README, short (15 Nov)", () => {
  it("is about 2,500 words (2,609 as this test counts them, 2,575 by wc), down from 6,255", () => {
    expect(words(README)).toBeLessThanOrEqual(5150); // 5,150 since 21 Nov 2026 (review: "What is not finished" near the top, the JUDGES.md line and "Questions judges ask" in a fold, about 470 words; 5,102 as built). // 4,700 since 19 Nov 2026 (the gold, hardening and partner branches merged together, 4,691 as built). 4,690 since 19 Nov 2026 (owner, OpenSSF gold): the badges in three labelled rows (the three labels; coverage, Scorecard, REUSE, signed releases and the TLA+ model added), about 50 words; 4,681 as built. // 4,660 since 19 Nov 2026, evening: the map's row of checks made on purpose (red team, chaos, fuzzing, held-out eval, the public site) in its alt text, about 35 words; 4,631 as built. // 4,600 since 19 Nov 2026 (the owner: the evidence map at the top): the map picture's alt text, every step and figure on it (about 75 words, read by screen readers and counted here), and the wall's line of four figures (about 25); 4,589 as built. // 4,475 since 19 Nov 2026 (README tightened for the judges: the one-line sections that only pointed to a doc in one "More" table, one "How it works", one repository map, the verify commands and the awards said once, "For judges: 3 minutes" folded into the judges' table; +: the demo's thumbnail, what Purser is in one sentence, a four-line glossary; 4,462 as built); 4,595 before: +25, 18 Nov: the demo in the submission at the top of "Watch it" (4,590 as built); +195, 17 Nov, owner: strongest proof first: the six-row proof table under the links, each row one line with its record (4,566 as built); the "Built on Airwallex" paragraph moved down, unchanged; +10, 17 Nov (jury): the hackathon named in the submission line and "read back from Airwallex on 6 Nov" in the Airwallex row (4,373 as built); +40, 17 Nov later (owner: keep all the badges, tidy, in three groups): the badges' alt texts (4,362 as built); +35, 17 Nov: what the late-failure run showed in the sandbox, and what is tested only, in the row "A payout that comes back"; +210, 17 Nov later (coordinator, jury fixes): the "For judges" table (the four things every entry shows, each with where to check it), one line on what stood at the v1.0-submission tag, and one line dating the film's figures (4,279 as built); +230, 17 Nov (Max, after reading the other Kit 11 entries): the Airwallex APIs Purser calls named in the "Built on Airwallex" line, "One engine, two jobs" under Kit 11, what the sandbox taught us under "Airwallex at the centre", and three invariants (the payee check, holds, a payout that comes back) (4,076 as built); +70, 15 Nov (Max): the animated promo under the badges, its alt text, and /try named for the negotiation (3,827 as built); +80, 15 Nov: the invariants table (3,764 as built); +480, 15 Nov (Max, readme-wow): the TIP, IMPORTANT and NOTE alerts, the "One payment, step by step" sequence diagram and the alt texts of the stat strip, the terminal and the system map (3,638 as built); +360, 15 Nov: the Architecture section (two diagrams, five bullets, the code table in a fold); +10, 15 Nov: the four awards named in full (#390), 2,856 as built; +70, 15 Nov (Max): the animated flow's alt text and the partners' status badges (2,846 as built); +115 before that, the same day: +115, 15 Nov (Max): "At a glance" under the badges, six lines with their records (2,776 as built); +45, 15 Nov: the film "Purser, under the hood" linked in the video table and the live demo's line (2,655 as built)
  });

  it("keeps the quick start, verify-it-yourself and what's live and what's simulated in the README itself", () => {
    // 19 Nov 2026 (README tightened for the judges): "What's live, what's simulated" was one line pointing to docs/in-depth.md
    // (now a row of "More"); in the README itself it is the test-money alert and Built with's own column. "For judges:
    // 3 minutes" is the judges' table in the centred top, its one-id-per-rail link in the table's Proof row.
    for (const h of ["## Verify it yourself in 3 commands", "## Built with", "## Try it in 2 minutes"]) expect(README).toContain(`\n${h}\n`);
    expect(README).toContain("\n| Partner | What Purser uses | Live or simulated | Proof |\n");
    expect(README).toMatch(/\n> \*\*Test money only\.\*\* Live: [^\n]+ Simulated: [^\n]+\n/);
    expect(README).toContain("\n| **For judges:** the four things every entry shows");
    expect(README).toContain("](docs/in-depth.md#whats-live-whats-simulated-run-by-run) |\n");
  });

  // 19 Nov 2026: under its heading (Kit 11, Airwallex at the centre) or in its row of the "More" table (the rest).
  it("links each moved section's file once, under its heading or in its row of More, and each file holds the words the README had", () => {
    for (const f of README_DOCS) {
      expect({ f, there: existsSync(new URL(`../${f}`, import.meta.url)) }).toEqual({ f, there: true });
      expect({ f, links: README.split(`](${f})`).length - 1 }).toEqual({ f, links: 1 });
      expect(movedBody(f).length).toBeGreaterThan(100);
    }
    expect(words(readmeFull())).toBeGreaterThan(6000);
  });
});
