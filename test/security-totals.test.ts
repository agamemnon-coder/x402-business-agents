// /security's line under the headline. Final jury, 13 Nov: one line names the attack tests with their totals. Since
// 21 Nov (the owner: "we still have a lot of old things on the new page") it names the newest two, each figure exactly
// as its evidence item on the same page shows it, and each item read from its record.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { securityLead, securityPage } from "../src/redesign/security.js";
import { evidenceItems } from "../src/redesign/securityEvidence.js";
import { countOf } from "../src/redesign/ui.js";

const json = <T>(p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as T;

describe("/security: the attack tests, named with their totals under the headline", () => {
  it("reads each total from its record", () => {
    const zt = json<{ attacks_run: number; attacks_stopped: number }>("docs/zero-trust/report.json");
    const wall = json<{ groups: { tiles: { key: string; fig: string }[] }[] }>("docs/evidence/evidence-wall.json");
    const api = wall.groups.flatMap((g) => g.tiles).find((t) => t.key === "redteam-api")!.fig;
    expect(securityLead()).toBe(`Five layers that do not trust each other. Attacked on purpose: ${countOf(zt.attacks_stopped, zt.attacks_run).toLowerCase()} attacks on the payment path stopped, ${api.toLowerCase()} attacks on the public API held.`);
  });

  it("says the same figures as the evidence items on the same page", () => {
    const page = securityPage(), items = evidenceItems();
    for (const id of ["e-zerotrust", "e-redteam"]) {
      const fig = items.find((i) => i.id === id)!.fig;
      expect(page).toContain(`>${fig}<`);
      expect(securityLead()).toContain(fig.toLowerCase());
    }
  });

  it("is the line right under the page's heading", () => {
    const page = securityPage();
    const h1 = page.indexOf("<h1"), lead = page.indexOf('<p class="lead">');
    expect(h1).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(h1);
    expect(page.slice(lead, page.indexOf("</p>", lead))).toContain("attacks on the payment path stopped");
  });
});
