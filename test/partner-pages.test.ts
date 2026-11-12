// The partner pages (/airwallex, /claude): every id, tx and figure on them comes from the recorded files, every
// agent's model from code; each is short with its details folded; the nav keeps its tabs (Home, Try, Proof; no Watch since 12 Nov).
import { readFileSync } from "node:fs";
import { WATCH_IN_MENU } from "../src/config/film.js";
import { describe, expect, it } from "vitest";
import { AGENT_MODELS, airwallexData, claudeData } from "../src/partners/data.js";
import { AIRWALLEX_PAGE, CLAUDE_PAGE } from "../src/servers/dashboard.js";
import { NAV_MAIN } from "../src/ui/nav.js";
import { loadRecord } from "../src/redesign/run.js";
import { OPEN_TARGET_JS } from "../src/redesign/ui.js";
import { AWX_PAGE_LABEL, CONNECTED_KEY, PLATFORM_FACTS_FILE, PLATFORM_FOLD_ID, TWO_LOCKS_KEY, approvalsTile, twoLocksLogs, twoLocksOfRecord, twoLocksState } from "../src/redesign/airwallexProducts.js";
import { liveRuns } from "../src/redesign/runs.js";
import { scriptBlocks } from "./support/scriptBlocks.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const AGENT_RUN = loadRecord().file;
// awx-1 (7 Nov), the separate Airwallex-only run on /airwallex: its ids come from its own record.
const RECORDED = read("docs/demo/snapshot.json") + read(AGENT_RUN) + read("docs/demo/airwallex-run.json");
const auto = JSON.parse(read(AGENT_RUN)) as { snapshot: { agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; models: string[] }[] } };

const CONNECTED_RUN = read("docs/runs/2026-11-10-connected-accounts-sandbox.md");
const TWO_LOCKS_RUN = read("docs/runs/2026-11-10-airwallex-two-locks.md");

describe("the partner pages", () => {
  // /airwallex since the jury panel of 12 Nov: no sentence about a run is typed into the page; test/airwallex-products.test.ts
  // holds each tile to its record. Here: the two runs whose record is a run log.
  it("carry the first connected-accounts run (10 Nov) only as its run record has it: every id and amount", () => {
    const row = liveRuns().find((r) => r.key === CONNECTED_KEY)!;
    const fold = new RegExp(`<details class="fold" id="${PLATFORM_FOLD_ID}"[\\s\\S]*?</details>`).exec(buildPages().airwallex!)![0];
    const line = /<li>The first connected-account run[^<]*<\/li>/.exec(fold)![0];
    // The account and the payout, as the runs list names them too.
    for (const i of row.ids.filter((x) => /^acct_|^[0-9a-f]{8}-/.test(x.value) && /account|payout/i.test(x.label))) { expect(line).toContain(i.value); expect(CONNECTED_RUN).toContain(i.value); }
    expect((line.match(/acct_[A-Za-z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []).length).toBe(2);
    const amounts = line.match(/€\d+\.\d{2}/g) ?? [];
    expect(amounts.length).toBe(2);
    for (const amount of amounts) expect(CONNECTED_RUN).toContain(amount.replace("€", "EUR "));
    expect(CONNECTED_RUN).toMatch(/\*\*`PAID`\*\*/);
    expect(line).toMatch(/simulat/);
  });

  it("carry the two-locks run as its newest run log has it today: the page shows what the record says", () => {
    const page = buildPages().airwallex!;
    const tile = /<article class="awt card[^"]*" id="p-approvals"[\s\S]*?<\/article>/.exec(page)![0].replace(/<[^>]+>/g, " ");
    const s = twoLocksOfRecord()!;
    expect(s.source).toBe("record");
    // The newest log of the run (by the date in its name); the log of 10 Nov until a later one is published.
    const TWO_LOCKS_RUN = read(s.file!);
    expect(s.file).toBe(`docs/runs/${twoLocksLogs()[0]!.name}`);
    expect(twoLocksState(TWO_LOCKS_RUN, liveRuns().find((r) => r.key === TWO_LOCKS_KEY))!.now).toBe(s.now);
    const ids = page.match(new RegExp(s.transferId.slice(0, 8), "g")) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(TWO_LOCKS_RUN).toContain(s.transferId);
    expect(TWO_LOCKS_RUN).toContain(`EUR ${s.amount}`);
    // The state on create and the state now are the run log's own words, whatever they are when the site is built.
    expect(TWO_LOCKS_RUN).toContain(s.held!);
    expect(TWO_LOCKS_RUN).toContain(s.now);
    for (const x of approvalsTile(s)!.states!) expect(tile).toContain(x.text);
    expect(tile).toContain(`${s.held} at Airwallex`);
    expect(tile).toContain(`Now: ${s.now}`);
    // Unfinished is said only while the record says so.
    expect(/not paid/.test(tile)).toBe(!s.finished);
    expect(/\*\*Not completed\.\*\*/.test(TWO_LOCKS_RUN) ? s.finished : false).toBe(false);
  });

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
      for (const id of page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) expect(RECORDED + CONNECTED_RUN + TWO_LOCKS_RUN + (page === AIRWALLEX_PAGE ? read(PLATFORM_FACTS_FILE) : "")).toContain(id);
      for (const req of page.match(/req_[A-Za-z0-9]{10,}/g) ?? []) expect(RECORDED + read("docs/runs/2026-11-01-try-world-dev.md")).toContain(req);
    }
    expect(AIRWALLEX_PAGE).toMatch(/LIMIT_EXCEEDED|over the card's limit/);
    const reqs = (JSON.parse(read(AGENT_RUN)) as { snapshot: { flows: { request?: string; model: string | null }[] } }).snapshot.flows.filter((f) => f.request && f.model).map((f) => f.request!);
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) expect(CLAUDE_PAGE).toContain(r);
  });

  it("are short, label the run, link the partner's docs (folded), and show no Visa logo and no script", () => {
    for (const [page, docs] of [[AIRWALLEX_PAGE, "https://www.airwallex.com/docs/"], [CLAUDE_PAGE, "https://platform.claude.com/docs/"]] as const) {
      // /airwallex shows several runs, each dated on its own block (jury panel, 12 Nov): its label is true for all of them.
      if (page === AIRWALLEX_PAGE) { expect(page).toContain(AWX_PAGE_LABEL); expect(page.replace(/<footer[\s\S]*<\/footer>/, "")).not.toMatch(/Replay of the main run/); }
      else expect(page).toMatch(/Replay of the main run, 3 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions/);
      // /claude since 12 Nov (jury panel): measured, not asserted, in place of its docs fold (test/claude-evidence.test.ts).
      if (page === CLAUDE_PAGE) expect(page).toContain('<section class="cev card" aria-labelledby="cev-h"><h2 id="cev-h">Measured, not asserted</h2>');
      else {
        expect(page).toMatch(/<details class="fold"><summary>The (Airwallex|Claude) [^<]*docs/);
        expect(page.split(docs).length - 1).toBeGreaterThanOrEqual(4);
      }
      expect(page).not.toMatch(/<img[^>]*visa/i);
      expect(page).not.toMatch(/\b(null|undefined|NaN)\b/);
      // No script on /claude; /airwallex has one, the shared OPEN_TARGET_JS (a link into its cards' fold opens it).
      expect(scriptBlocks(page)).toEqual(page === AIRWALLEX_PAGE ? [`<script>\n${OPEN_TARGET_JS}</script>`] : []);
    }
    expect(scriptBlocks(CLAUDE_PAGE)).toEqual([]);
    for (const f of airwallexData().features) for (const d of f.docs) expect(d.href.startsWith("https://www.airwallex.com/docs/")).toBe(true);
  });

  it("are reached from Proof, with the main nav four tabs, and served by the relay", () => {
    // Watch is a tab once the film is on /watch (src/config/film.ts).
    expect(NAV_MAIN.map(([k]) => k)).toEqual(WATCH_IN_MENU ? ["home", "watch", "try", "proof"] : ["home", "try", "proof"]);
    const pages = buildPages();
    expect(pages.airwallex).toBe(AIRWALLEX_PAGE);
    expect(pages.claude).toBe(CLAUDE_PAGE);
    expect(pages.csp.claude).toMatch(/^default-src 'none'; style-src 'sha256-/);
    // /airwallex: its one script, hashed like its style; it connects nowhere.
    expect(pages.csp.airwallex).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
    // Live QA (7 Nov, Lighthouse): on the jury's pages no heading skips a level (/airwallex went h1 to h3), Proof's
    // "More" links each name their partner for screen readers, /metal's tx links are at least 24 px tall, and the
    // stage never fades its words below readable contrast (it greys them instead).
    const jury = { home: pages.home, watch: pages.watch, replay: pages.replay, proof: pages.proof, airwallex: pages.airwallex, metal: pages.metal, claude: pages.claude, visa: pages.visa };
    for (const [name, html] of Object.entries(jury)) {
      const levels = [...String(html).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      expect({ name, skips: levels.filter((l, i) => i > 0 && l > levels[i - 1]! + 1) }).toEqual({ name, skips: [] });
    }
    expect([...String(pages.proof).matchAll(/<a class="open" href="(metal|airwallex|claude)">More<span class="vh"> about ([A-Za-z]+)<\/span>/g)].map((m) => m[2]!.toLowerCase())).toEqual(["airwallex", "metal", "claude"]);
    // /metal since 12 Nov (jury panel): its table's and its cards' links are 44 px tall, as a phone's tap target.
    expect(String(pages.metal)).toContain(".mtab td a.pf, .mcov td a.pf { display: inline-flex; align-items: center; min-height: 44px; }");
    expect(String(pages.metal)).toContain(".mc .tx2 a.pf { display: inline-flex; align-items: center; min-height: 44px; }");
    expect(String(pages.home)).not.toMatch(/\.lane\.past \{ opacity|\.ag:not\(\.on\) \{ opacity|\.coin\.ghost \{ opacity/);
  });
});
