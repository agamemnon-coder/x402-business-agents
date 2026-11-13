// Final jury, 13 Nov: "single-use Visa card" contradicted the vic-3 record, where a credential reused and one used on a
// higher amount both came back SUCCEEDED in the sandbox; vic-4 shows Purser's own credential check refusing both. The
// README and the site say what holds: a Visa credential Purser binds to one purchase, enforced by Purser, not the sandbox.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SINGLE_USE_VISA = /single-use (?:Visa|card) credential|single-use Visa card|Single-use Visa credential/i;

describe("the Visa credential is never called single-use", () => {
  it("the records: vic-3's sandbox accepted the reuse and the higher amount; vic-4's Purser refused both", () => {
    const vic3 = read("docs/runs/2026-11-12-vic-3.md"), vic4 = read("docs/runs/2026-11-13-vic-4.md");
    expect(vic3).toMatch(/F1: not refused by Airi\/Airwallex sandbox/);
    expect(vic3).toMatch(/F2: not refused by Airi\/Airwallex sandbox/);
    expect(vic4).toContain("PURSER_CREDENTIAL_AMOUNT_MISMATCH");
    expect(vic4).toContain("PURSER_CREDENTIAL_ALREADY_USED");
  });

  it("the README says what holds, with both records, and no single-use claim", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(SINGLE_USE_VISA);
    expect(readme).toContain("a Visa credential Purser binds to one purchase; in the sandbox Airi/Airwallex did not refuse a reuse or a higher amount ([vic-3](docs/runs/2026-11-12-vic-3.md)), Purser did ([vic-4](docs/runs/2026-11-13-vic-4.md))");
  });

  it("no page of the site calls it single-use", () => {
    for (const [name, html] of Object.entries(buildPages({} as NodeJS.ProcessEnv) as unknown as Record<string, unknown>)) {
      if (typeof html === "string") expect(html, name).not.toMatch(SINGLE_USE_VISA);
    }
  });
});

// Jury review, 13 Nov: the footer said "3 Visa runs" on some pages and "3 live Visa runs" on others. One string now.
describe("the Visa runs, in one phrase everywhere", () => {
  it("reads the same in the linked footer, the plain footer and the README", async () => {
    const { visaRunsLine } = await import("../src/redesign/partners.js");
    const line = visaRunsLine()!;
    expect(line).not.toMatch(/\blive\b/);
    const pages = buildPages({} as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
    for (const [name, html] of Object.entries(pages)) if (typeof html === "string" && html.includes("Visa (VIC through Airwallex's Airi): ")) expect(html, name).toContain(`Visa (VIC through Airwallex's Airi): ${line.replace(/'/g, "&#39;")}`);
    expect(read("README.md")).not.toMatch(/live Visa runs?\b/);
  });
});
