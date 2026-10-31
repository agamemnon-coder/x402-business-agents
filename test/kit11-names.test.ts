// The agents carry Kit 11's names, word for word: Sourcing agent, Support agent, Treasury agent. Nothing a guest can
// open shows the names they had before (every page the relay serves, with the recorded data inside it, and the
// documents a juror reads). Until the live run with Max is recorded, the pages that show the 30 October recording
// say plainly that it was made before the rename.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_DISPLAY, NORTHWIND_LINE, RECORDING_NAMES_NOTE } from "../src/config/brand.js";
import { deckHtml } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";
import { CARDS, INITIAL_MANDATES, PLANS, TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { kit11NamesRecorded, PRE_KIT11_NAMES, preKit11NamesIn } from "../src/demo/oldNames.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const dir = (p: string, re: RegExp) => readdirSync(new URL(`../${p}`, import.meta.url)).filter((f) => re.test(f)).map((f) => `${p}/${f}`);

/** What a juror reads besides the pages: the README, the submission pack, the video, the claims and the dossiers. */
const GUEST_DOCS = [
  "README.md", "docs/claims.md", "docs/requirements-matrix.md", "docs/metal-award.md", "docs/airwallex.md",
  "docs/controls-matrix.md", "docs/uitleg-voor-max.md", "docs/cfo-policy.md", "docs/cards-and-clearing.md",
  ...dir("docs/submission", /\.md$/), ...dir("docs/video", /\.(md|srt)$/),
  "docs/demo/story.json", "docs/demo/snapshot.json", "docs/demo/metal.json", "docs/lab/results.json", "docs/redteam/report.json",
  ...dir("docs/runs", /^visa-tap.*\.json$/),
];

describe("Kit 11's agent names, word for word", () => {
  it("names the agents as Kit 11 does", () => {
    expect(Object.fromEntries(Object.entries(AGENT_DISPLAY).map(([id, a]) => [id, a.name]))).toEqual({
      sourcing: "Sourcing agent", support: "Support agent", treasury: "Treasury agent",
    });
  });

  // Breaks if an old name comes back in any page, script or recorded data the relay serves to guests.
  it("shows no earlier agent name on any page the relay serves", () => {
    const pages = buildPages();
    for (const [name, body] of Object.entries(pages)) {
      if (typeof body !== "string") continue;
      expect({ page: name, old: preKit11NamesIn(body) }).toEqual({ page: name, old: [] });
    }
  });

  // Breaks if a page or document goes back to mapping a name onto Kit 11's ("Sourcing agent = sourcing agent").
  it("maps no name onto Kit 11's: the names are Kit 11's own", () => {
    const mapping = /(sourcing|support|treasury) agent\s*=\s*(kit 11's )?(sourcing|support|treasury) agent|= kit 11's/i;
    for (const [name, body] of Object.entries(buildPages())) if (typeof body === "string") expect({ page: name, mapped: mapping.exec(body)?.[0] ?? null }).toEqual({ page: name, mapped: null });
    for (const f of GUEST_DOCS) expect({ f, mapped: mapping.exec(read(f))?.[0] ?? null }).toEqual({ f, mapped: null });
  });

  // Breaks if the old names come back as a bare list ("Operations, Sales and Finance"), which the guard above misses.
  it("lists no earlier names without the word agent either", () => {
    const list = /\b(Operations|Sales|Finance)\b(, | and | or )(Operations|Sales|Finance|Support|Treasury)\b/;
    for (const [name, body] of Object.entries(buildPages())) if (typeof body === "string") expect({ page: name, list: list.exec(body)?.[0] ?? null }).toEqual({ page: name, list: null });
    for (const f of GUEST_DOCS) expect({ f, list: list.exec(read(f))?.[0] ?? null }).toEqual({ f, list: null });
  });

  // Breaks if Northwind is described differently in the places a juror meets it first.
  it("describes Northwind in one sentence everywhere a juror meets it", () => {
    const pages = buildPages();
    const flat = (t: string) => t.replace(/\s+/g, " ");
    for (const [where, text] of [["landing", pages.dashboard], ["metal", pages.metal], ["README", read("README.md")], ["form text", read("docs/submission/README.md")], ["deck", deckHtml(packFacts(), {} as never, "")]] as const) {
      expect({ where, has: flat(text as string).includes(NORTHWIND_LINE) }).toEqual({ where, has: true });
    }
  });

  it("shows no earlier agent name in what a juror reads", () => {
    for (const f of GUEST_DOCS) expect({ f, old: preKit11NamesIn(read(f)) }).toEqual({ f, old: [] });
  });

  it("finds the names it guards against, in any case and with a card", () => {
    expect(preKit11NamesIn("the Operations agent paid; the sales card; FINANCE AGENT's")).toEqual(["Operations agent", "Finance agent", "Sales card"]);
    expect(preKit11NamesIn("the Sourcing agent, the Support agent's card, the Treasury agent; sales and finance teams")).toEqual([]);
    expect(PRE_KIT11_NAMES).toHaveLength(6);
  });

  it("gives each agent the card its Kit 11 job needs", () => {
    expect(CARDS.sourcing.buys).toMatch(/warehouse|data/);
    expect(CARDS.support.buys).toMatch(/helpdesk/);
    expect(CARDS.treasury.buys).toMatch(/bookkeeping/);
    const supportPlans = Object.values(PLANS).filter((p) => p.agent === "support" && p.merchant !== "Packwise");
    expect(supportPlans.length).toBeGreaterThan(0);
    for (const p of supportPlans) expect(p.label).toMatch(/helpdesk/i);
    expect(JSON.stringify(PLANS)).not.toMatch(/\bads?\b|advertis/i);
  });

  it("keeps the brief's budgets: 10 / 4 / 6 = 20, at most 3 cents a purchase", () => {
    expect([INITIAL_MANDATES.sourcing.budgetCents, INITIAL_MANDATES.support.budgetCents, INITIAL_MANDATES.treasury.budgetCents]).toEqual([1000, 400, 600]);
    expect(TOTAL_BUDGET_CENTS).toBe(2000);
    expect(INITIAL_MANDATES.sourcing.capCents).toBe(3);
  });

  // Breaks if the 30 October recording is shown without saying it predates the Kit 11 names.
  it("labels the recording made before the rename on every page that shows it", () => {
    if (kit11NamesRecorded()) return;
    const pages = buildPages();
    for (const name of ["dashboard", "demo", "live", "film", "metal"] as const) {
      expect({ page: name, labelled: (pages[name] as string).includes(RECORDING_NAMES_NOTE) }).toEqual({ page: name, labelled: true });
    }
  });
});
