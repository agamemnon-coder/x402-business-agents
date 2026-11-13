// /claude, measured, not asserted (jury panel, 12 Nov; src/redesign/claudeEvidence.ts): each figure on top read from its
// record and linked to it; each agent on each model as the sweep of 6 November measured it; the Treasury choice as
// measured; the failure story; the MCP session read from its record, which the server in this commit still answers the
// same way (its tools, its name); the hostile-model line only when its report exists.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { agentId } from "../src/platform/externalAgents.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import {
  AGENT_EVALS, HOLDOUTS_RECORD, HOSTILE_EVAL, INJECTION_LINE, MCP_TRANSCRIPT, SWEEP_RECORD, VARIATION_FIX_SUMMARY, VARIATION_RECORD, VARIATION_SUMMARY, ZERO_TRUST_REPORT,
  claudeEvidence, firstTry, holdoutsOf, hostileOf, mcpOf, modelLines, sweepOf, variationOf,
} from "../src/redesign/claudeEvidence.js";
import { hostileTileLabel, proofTiles, splitSentence } from "../src/redesign/claudePage.js";
import { agentRun, faceIdDecisions, split } from "../src/redesign/run.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { HOSTILE_RECORD_FILE, hostileClaimText } from "../src/redesign/partners.js";
import { esc } from "../src/redesign/ui.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { CLAUDE_PAGE } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** Text as read, the drawings (and their tooltips) left out. */
const shown = (html: string) => text(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ")).replace(/\s+/g, " ").trim();
const main = /<main[\s\S]*<\/main>/.exec(CLAUDE_PAGE)![0];
const block = /<section class="cev tiles card"[\s\S]*?<\/section>/.exec(main)?.[0] ?? "";
const ev = claudeEvidence();

describe("the figures on /claude, each from its record", () => {
  it("reads the 40 simulated worlds and their re-run after the fix", () => {
    expect(variationOf(read(VARIATION_SUMMARY))).toEqual({ runs: 40, worlds: 40, unsafe: 2, decisions: 408, claudePct: 100, usd: "4.8789" });
    expect(variationOf(read(VARIATION_FIX_SUMMARY))).toMatchObject({ runs: 6, worlds: 2, unsafe: 0 });
    // The night batch's record says the same, in its own words.
    expect(read(VARIATION_RECORD)).toContain("408 decisions, 408 by Claude, 0 fallbacks");
    expect(variationOf(null)).toBeNull();
  });

  it("reads the blind holdouts: 10 run, 10 safe, H3 passing on the code's rule only", () => {
    expect(holdoutsOf(read(HOLDOUTS_RECORD))).toEqual({ run: 10, safe: 10, partial: "H3" });
    expect(holdoutsOf("nothing")).toBeNull();
  });

  it("measures each agent on each model from the sweep, and the Treasury first tries", () => {
    const s = sweepOf(read(SWEEP_RECORD))!;
    const lines = modelLines(s);
    expect(lines).toHaveLength(9);
    for (const l of lines) {
      const rows = s.rows.filter((r) => r.agent === l.agent && r.model === l.model);
      expect(l.passed).toBe(rows.reduce((n, r) => n + r.passed, 0));
      expect(l.runs).toBe(rows.reduce((n, r) => n + r.runs, 0));
    }
    const haikuSupport = s.rows.find((r) => r.case === "support-outside" && /haiku/.test(r.model))!;
    expect([haikuSupport.passed, haikuSupport.runs]).toEqual([0, 10]);
    expect(haikuSupport.details.every((d) => /refused by code/.test(d))).toBe(true);
    expect(firstTry(s, "claude-haiku-5-5")).toEqual({ first: 8, of: 40 });
    expect(firstTry(s, "claude-opus-5-5")).toEqual({ first: 18, of: 20 });
    expect(lines.find((l) => l.agent === "treasury" && /haiku/.test(l.model))).toMatchObject({ passed: 70, runs: 70 });
  });
});

describe("/claude's split, agents and proof tiles (13 Nov: more visuals and data, each from its record)", () => {
  const run = agentRun(), sp = split(run.record), st = run.record.snapshot.agent_stats;

  it("draws the split under the title: routine payments to code, the exceptions to Claude, the high-risk ones on to Face ID", () => {
    const fig = /<figure class="csplit card" id="split">[\s\S]*?<\/figure>/.exec(main)?.[0] ?? "";
    expect(main.indexOf("<h1>")).toBeLessThan(main.indexOf(fig));
    const f = { ...sp, calls: st.reduce((n, a) => n + a.claude_calls, 0), faceId: faceIdDecisions(run.record) };
    expect([f.routine, f.decisions, f.byClaude, f.faceId, f.calls]).toEqual([82, 24, 24, 5, 50]);
    // Two drawings (wide, phone), each named by the same sentence; the caption holds the rest.
    expect([...fig.matchAll(/<svg class="(wid|nar)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([["wid", esc(splitSentence(f))], ["nar", esc(splitSentence(f))]]);
    expect(splitSentence(f)).toBe("Payment requests: 82 routine payments by code; 24 exceptions decided by Claude; 5 high-risk ones on to the CFO's Face ID.");
    expect(text(/<figcaption>[\s\S]*?<\/figcaption>/.exec(fig)![0]).trim()).toBe("All 24 decisions by Claude, holds included; 0 fallbacks · 50 Claude calls, each logged");
    // The page's CSP hashes its one style block: no style attribute anywhere in it, no script.
    expect(CLAUDE_PAGE).not.toMatch(/\sstyle="/);
    // No pass-rate fraction anywhere on the page (13 Nov, from the judge run): words instead ("all 24", "50 of 60"). The
    // one fraction left is a cost ratio, Treasury's Haiku at 1/24 of Opus's cost per pass (in the sweep's fold).
    expect(text(main).replace(/at 1\/\d+ of Opus's cost per pass/, " ").match(/\b\d+\/\d+\b/g)).toBeNull();
  });

  it("shows the three agents as cards, each with its model, its decisions as a bar and its Claude calls", () => {
    const cards = [...main.matchAll(/<article class="cag card" data-agent="(\w+)">([\s\S]*?)<\/article>/g)];
    expect(cards.map((c) => [c[1], shown(c[2]!)])).toEqual(run.agents.map((a) => {
      const x = st.find((y) => y.agent === a.id)!;
      return [a.id, `${a.short} ${a.family} ${x.decisions}decisions ${x.claude_calls} Claude calls`.replace(/(\d)decisions/, "$1 decisions")];
    }));
    expect(cards.map((c) => /<rect class="fil" width="([\d.]+)%"/.exec(c[2]!)?.[1])).toEqual(st.map((x) => String(Math.round(x.decisions / sp.decisions * 1000) / 10)));
    expect(cards.map((c) => c[1])).toEqual(["sourcing", "support", "treasury"]);
  });

  it("shows five proof tiles, each an icon, one number, a short label and its record", () => {
    expect(main.indexOf('id="split"')).toBeLessThan(main.indexOf('<section class="cev tiles card"'));
    const tiles = [...block.matchAll(/<li class="ctile" data-rec="([^"]+)">([\s\S]*?)<\/li>/g)];
    expect(tiles.map((t) => t[1])).toEqual([VARIATION_RECORD, HOLDOUTS_RECORD, AGENT_EVALS, SWEEP_RECORD, HOSTILE_EVAL]);
    for (const t of tiles) { expect(t[2]).toMatch(/^<span class="ic"><svg/); expect(t[2]!.match(/<span class="tv">/g)).toHaveLength(1); }
    const said = tiles.map((t) => text(t[2]!.replace(/<span class="r">[\s\S]*$/, "")).replace(/\s+/g, " ").trim());
    expect(said).toEqual([
      "408 decisions in 40 simulated worlds, all by Claude; 2 unsafe actions, fixed", "10 blind holdouts, all safe; H3 on code's rule only",
      "0 of 10 Haiku as Support on one attack; code refused each stray call", "9 model and agent pairs, measured",
      "380 hostile tool calls on the payables agents' 62 test invoices: 370 refused by code, 0 unsafe by the ledger verdict"]);
    // The hostile-model eval's figures as CI wrote them (the same record as /security's line).
    expect(HOSTILE_EVAL).toBe(HOSTILE_RECORD_FILE);
    expect(hostileOf(read(HOSTILE_EVAL))).toEqual({ calls: 380, refused: 370, unsafe: 0, cases: 62 });
    expect(hostileOf("{}")).toBeNull();
    const links = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links).toEqual([VARIATION_RECORD, HOLDOUTS_RECORD, AGENT_EVALS, SWEEP_RECORD, HOSTILE_EVAL, ...(ev.zeroTrust ? [ZERO_TRUST_REPORT] : [])].map((f) => `${REPO_BLOB}${f}`));
    for (const f of [VARIATION_RECORD, HOLDOUTS_RECORD, AGENT_EVALS, SWEEP_RECORD, MCP_TRANSCRIPT, HOSTILE_EVAL]) expect(existsSync(new URL(`../${f}`, import.meta.url)), f).toBe(true);
    // The injection screen, as code holds it, in its own fold.
    expect(text(/<details class="fold" id="injection">[\s\S]*?<\/details>/.exec(main)?.[0] ?? "")).toContain(INJECTION_LINE);
    // Never the word the site keeps off its pages, never a claim of no unsafe action. The exceptions, as in
    // test/site-v4.test.ts: the hostile-model eval's figures, whose "0 unsafe" CI computes and its record holds.
    expect(CLAUDE_PAGE.replace(esc(hostileClaimText()) || "\u0000", " ").replace(esc(hostileTileLabel(ev.hostile!)), " ")).not.toMatch(/stand-in|\b0 unsafe\b/i);
  });

  it("links the zero-trust report only when it exists", () => {
    expect(ev.zeroTrust).toBe(existsSync(new URL(`../${ZERO_TRUST_REPORT}`, import.meta.url)));
    expect(proofTiles({ ...ev, zeroTrust: false })).not.toContain(ZERO_TRUST_REPORT);
    expect(proofTiles({ ...ev, zeroTrust: true })).toContain(`${REPO_BLOB}${ZERO_TRUST_REPORT}`);
    expect(proofTiles({ ...ev, hostile: null })).not.toContain(HOSTILE_EVAL);
  });

  it("charts each agent on each model: a bar of runs passed, the cost per pass and the time, the models in use marked", () => {
    const chart = /<article class="cmodels card" data-rec="([^"]+)"[\s\S]*?<\/article>/.exec(main);
    expect(chart?.[1]).toBe(SWEEP_RECORD);
    const rows = [...chart![0].matchAll(/<div class="cmr">([\s\S]*?)<\/span><\/div>/g)].map((m) => m[1]!);
    const lines = modelLines(ev.sweep!);
    expect(rows).toHaveLength(9);
    lines.forEach((l, i) => {
      const w = /<rect class="fil(?: alt)?" width="([\d.]+)%"/.exec(rows[i]!)?.[1];
      expect(Number(w)).toBe(Math.round(l.passed / l.runs * 1000) / 10);
      expect(text(rows[i]!)).toContain(l.passed === l.runs ? `all ${l.runs}` : `${l.passed} of ${l.runs}`);
    });
    expect(shown(chart![0])).toContain("Haiku all 130 · $0.0005 · 4.8s · in use");
    expect(shown(chart![0])).toContain("Haiku 50 of 60 · $0.0029 · 10.0s");
    expect((chart![0].match(/class="use"/g) ?? []).length).toBe(3);
  });

});

describe("/claude's folds", () => {
  it("folds each agent on each model with its verdict, the Treasury choice as measured, and the failure in three lines", () => {
    const sweep = /<summary>Each agent on each model \(6 Nov\)<\/summary>([\s\S]*?)<\/details>/.exec(main)?.[1] ?? "";
    expect(sweep).not.toBe("");
    expect(text(sweep)).toContain("Sourcing Haiku all 130 0.0005 4.8 s in use");
    expect(text(sweep)).toContain("Support Haiku 50 of 60 0.0029 10.0 s misses 10");
    expect(text(sweep)).toContain("Treasury: Haiku passed every Treasury run (all 70) at 1/24 of Opus's cost per pass, but its first plan passed code's checks in 8 of 40 rebalance runs, Opus's in 18 of 20. Treasury runs on Opus.");
    const failure = /<summary>What went wrong<\/summary><ul class="pl">([\s\S]*?)<\/ul>/.exec(main)?.[1] ?? "";
    expect(failure.match(/<li>/g)).toHaveLength(3);
    expect(text(failure)).toContain("In 2 of 40 simulated worlds, an agent passed an unvetted payee address to another agent.");
  });
});

describe("the MCP session on /claude", () => {
  const rec = mcpOf(read(MCP_TRANSCRIPT))!;
  it("is read from its record, made in-process with no network, every call and answer shown", () => {
    expect(rec).not.toBeNull();
    const fold = /<details class="fold" id="mcp"[^>]*>([\s\S]*?)<\/details>/.exec(main)?.[1] ?? "";
    for (const s of rec.steps) {
      expect(text(fold)).toContain(`→ ${s.call}`);
      expect(text(fold)).toContain(s.answer.replace(/\s*\n\s*/g, " ").slice(0, 60));
    }
    expect(text(fold)).toContain("(the CFO approves P-0001; here in code, not Face ID; the card is issued)");
    expect(text(fold)).toContain("None can approve.");
  });

  it("matches the server in this commit: its name and its tools", async () => {
    const server = agentApiServer(openDb(":memory:"), agentId("acme-research"), new FakeIssuing());
    const client = new Client({ name: "check", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getServerVersion()?.name).toBe(rec.server);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(rec.tools);
    await client.close();
  });
});
