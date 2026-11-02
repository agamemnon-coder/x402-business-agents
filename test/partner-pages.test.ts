// The partner pages (/airwallex, /claude): every id, tx and figure on them comes from the recorded files, every
// agent's model from code; the five parts are on each; the nav keeps five main links with both pages under "More".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_MODELS, airwallexData, claudeData } from "../src/partners/data.js";
import { AIRWALLEX_PAGE, CLAUDE_PAGE } from "../src/servers/dashboard.js";
import { NAV_MAIN, NAV_MORE } from "../src/ui/nav.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const RECORDED = read("docs/demo/snapshot.json") + read("docs/demo/autonomy.json");
const auto = JSON.parse(read("docs/demo/autonomy.json")) as { snapshot: { agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; models: string[] }[] } };

describe("the partner pages", () => {
  it("take each agent's model from code, and it is the model the dry run recorded", () => {
    expect(read("src/autonomy/sourcingProfile.ts")).toMatch(/name: "sourcing".*model: MODELS\.classify/);
    expect(read("src/autonomy/teamProfiles.ts")).toMatch(/name: "support".*model: MODELS\.act/);
    expect(read("src/autonomy/teamProfiles.ts")).toMatch(/name: "treasury".*model: MODELS\.review/);
    for (const a of claudeData().agents) {
      expect(a.model).toBe(AGENT_MODELS[a.id]);
      expect(a.recordedModels).toEqual([a.model]);
    }
  });

  it("show each agent's decisions, fallbacks and calls exactly as recorded", () => {
    for (const a of claudeData().agents) {
      const s = auto.snapshot.agent_stats.find((x) => x.agent === a.id)!;
      expect({ d: a.decisions, c: a.byClaude, f: a.fallback, calls: a.calls }).toEqual({ d: s.decisions, c: s.by_claude, f: s.fallback, calls: s.claude_calls });
    }
    const d = claudeData();
    expect(d.decisions.length).toBe(auto.snapshot.agent_stats.reduce((n, s) => n + s.decisions, 0));
  });

  it("invent no id: every Airwallex id, tx and request id on them is in the recorded files", () => {
    for (const page of [AIRWALLEX_PAGE, CLAUDE_PAGE]) {
      for (const tx of page.match(/0x[0-9a-f]{64}/g) ?? []) expect(RECORDED).toContain(tx);
      for (const id of page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) expect(RECORDED).toContain(id);
      for (const req of page.match(/req_[A-Za-z0-9]{10,}/g) ?? []) expect(RECORDED + read("docs/runs/2026-11-01-try-world-dev.md")).toContain(req);
    }
    expect(AIRWALLEX_PAGE).toMatch(/LIMIT_EXCEEDED|over the card's limit/);
    expect(CLAUDE_PAGE).toContain("req_011CgcUUJMu4AyUHz2TcgPQL");
  });

  it("carry the five parts, label every run, link the partner's docs, and show no Visa logo", () => {
    for (const [page, docs] of [[AIRWALLEX_PAGE, "https://www.airwallex.com/docs/"], [CLAUDE_PAGE, "https://platform.claude.com/docs/"]] as const) {
      for (const part of ["In our story", "What we use, and the proof", "Why an agent needs it", "What we do not do, or only simulate"]) expect(page).toContain(part);
      expect(page).toMatch(/Autonomous dry run · .* · test passkeys and test money · not a live run/);
      expect(page).toMatch(/Recorded run · .* · test money/);
      expect(page.split(docs).length - 1).toBeGreaterThanOrEqual(4);
      expect(page).not.toMatch(/<img[^>]*visa/i);
      expect(page).not.toMatch(/\b(null|undefined|NaN)\b/);
      expect(page).not.toMatch(/<script/);
    }
    for (const f of airwallexData().features) for (const d of f.docs) expect(d.href.startsWith("https://www.airwallex.com/docs/")).toBe(true);
  });

  it("are under More, with the main nav still five links, and served by the relay", () => {
    expect(NAV_MAIN).toHaveLength(5);
    expect(NAV_MORE.map(([k]) => k)).toEqual(expect.arrayContaining(["airwallex", "claude"]));
    const pages = buildPages();
    expect(pages.airwallex).toBe(AIRWALLEX_PAGE);
    expect(pages.claude).toBe(CLAUDE_PAGE);
    expect(pages.csp.airwallex).toMatch(/^default-src 'none'; style-src 'sha256-/);
  });
});
