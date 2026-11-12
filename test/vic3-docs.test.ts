// The vic-3 plan and the committed STAND-IN dry-run record: their numbers come from the code and from a run of it, not
// from a hand. A fresh dry run on the stand-ins (no network) is compared with what the documents say.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { AMOUNTS, BUDGETS, runVic3, standInClaude, type Vic3Record } from "../src/airi/vic3.js";
import { openDb } from "../src/db/open.js";
import { decide, resuming } from "../src/policy/approvals.js";

const PLAN = readFileSync(new URL("../docs/runs/vic-3-plan.md", import.meta.url), "utf8");
const STANDIN = readFileSync(new URL("../docs/runs/2026-11-12-vic-3-standin.md", import.meta.url), "utf8");
afterEach(() => { resuming.clear(); });

async function dry(): Promise<Vic3Record> {
  const db = openDb(":memory:");
  return runVic3({
    db, mode: "dry", airi: new StandInAiriClient(), checkout: new StandInCheckout(), claude: standInClaude(), env: { KIT11_AIRI_RAIL: "on" },
    tmpRoot: mkdtempSync(join(tmpdir(), "vic3-docs-")), sleep: async () => {}, showPasskeyUrl: () => {}, log: () => {},
    awaitCfo: async (id) => {
      const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
      decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not the CFO)", method: "cli" });
      return "APPROVED";
    },
  });
}

describe("docs/runs/vic-3-plan.md", () => {
  it("names the budgets the code holds, and the dry run's call counts", async () => {
    const r = await dry();
    expect(PLAN).toContain(`| Anthropic (Claude Haiku) | ${r.budgets.anthropic.used} (as in the dry run) | **${BUDGETS.anthropic}** |`);
    expect(PLAN).toContain(`| Airwallex sandbox API | ${r.budgets.airwallex.used} (as in the dry run), plus 1 or 2 logins | **${BUDGETS.airwallex}** |`);
    expect(PLAN).toContain(`| airi-cli | ${r.budgets.airi.used} (as in the dry run), plus \`version\` | **${BUDGETS.airi}** |`);
  });

  it("each step's amount and expected calls are the code's and the dry run's", async () => {
    const r = await dry();
    for (const p of r.purchases) {
      const row = PLAN.split("\n").find((l) => l.startsWith(`| ${p.step} |`));
      expect(row, p.step).toBeTruthy();
      expect(row!.endsWith(`| ${p.calls.anthropic} / ${p.calls.airwallex} / ${p.calls.airi} |`), `${p.step}: ${row}`).toBe(true);
      expect(row).toContain(p.step === "F1" ? `${AMOUNTS.F1_MANDATE} / ${AMOUNTS.F1_INTENT}` : p.request!.amount);
    }
    expect(r.budgets.anthropic.used).toBe(3);
  });

  it("requires KIT11_AIRI_RAIL=on and VIC3_GO=yes, and names no Visa decision", () => {
    expect(PLAN).toContain("KIT11_AIRI_RAIL=on");
    expect(PLAN).toContain("VIC3_GO=yes npm run airi:vic-3 -- live");
    expect(PLAN).not.toMatch(/Visa (refused|declined|approved)|Claude decided to use Visa|policy is the Visa mandate/i);
  });
});

describe("docs/runs/2026-11-12-vic-3-standin.md", () => {
  it("is labelled STAND-IN, not live, on its first line and on every purchase and check row", () => {
    expect(STANDIN.split("\n")[0]).toBe("# vic-3: STAND-IN dry run, not live");
    const rows = STANDIN.split("\n").filter((l) => /^\| (STAND-IN )?\S+ \|/.test(l) && !/^\| (Check|---)/.test(l) && !l.startsWith("| |"));
    expect(rows).toHaveLength(7 + 14);
    for (const l of rows) expect(l).toMatch(/^\| STAND-IN /);
  });

  it("holds what a dry run of this code produces: every check, every purchase's calls and outcome", async () => {
    const r = await dry();
    for (const [k, c] of Object.entries(r.checks)) expect(STANDIN).toContain(`| STAND-IN ${k} | ${c.ok ? "ok" : "FAIL"} |`);
    for (const p of r.purchases) {
      const row = STANDIN.split("\n").find((l) => l.startsWith(`| STAND-IN ${p.step} |`))!;
      expect(row.endsWith(`| ${p.calls.anthropic} / ${p.calls.airwallex} / ${p.calls.airi} |`)).toBe(true);
    }
    expect(STANDIN).toContain(`Anthropic ${r.budgets.anthropic.used} of ${BUDGETS.anthropic}; Airwallex ${r.budgets.airwallex.used} of ${BUDGETS.airwallex}; airi-cli ${r.budgets.airi.used} of ${BUDGETS.airi}`);
  });
});
