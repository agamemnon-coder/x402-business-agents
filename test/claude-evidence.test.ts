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
  AGENT_EVALS, HOLDOUTS_RECORD, INJECTION_LINE, MCP_TRANSCRIPT, SWEEP_RECORD, VARIATION_FIX_SUMMARY, VARIATION_RECORD, VARIATION_SUMMARY, ZERO_TRUST_REPORT,
  claudeEvidence, firstTry, holdoutsOf, mcpOf, measuredBlock, modelLines, sweepOf, variationOf,
} from "../src/redesign/claudeEvidence.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { hostileClaimText } from "../src/redesign/partners.js";
import { esc } from "../src/redesign/ui.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { CLAUDE_PAGE } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const main = /<main[\s\S]*<\/main>/.exec(CLAUDE_PAGE)![0];
const block = /<section class="cev card"[\s\S]*?<\/section>/.exec(main)?.[0] ?? "";
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

describe("/claude's measured block", () => {
  it("shows the four figures on top, each linking its record, and the injection screen", () => {
    expect(main.indexOf('<section class="cev card"')).toBeLessThan(main.indexOf('class="flow card"'));
    const t = text(block);
    for (const line of ["Measured, not asserted", "408 decisions in 40 simulated worlds, all by Claude; 2 unsafe actions, fixed.", "10 blind holdouts, 10 safe; H3 only on code's rule.",
      "0 of 10 : Haiku as Support on one attack; code refused each stray call.", "9 model and agent pairs: pass rate, cost, time.", INJECTION_LINE]) expect(t).toContain(line);
    const links = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    // The zero-trust report's line links it too, once the report is in the tree (zero-trust-1112, merged 12 Nov).
    expect(links).toEqual([VARIATION_RECORD, HOLDOUTS_RECORD, AGENT_EVALS, SWEEP_RECORD, ...(ev.zeroTrust ? [ZERO_TRUST_REPORT] : [])].map((f) => `${REPO_BLOB}${f}`));
    for (const f of [VARIATION_RECORD, HOLDOUTS_RECORD, AGENT_EVALS, SWEEP_RECORD, MCP_TRANSCRIPT]) expect(existsSync(new URL(`../${f}`, import.meta.url)), f).toBe(true);
    // Never the word the site keeps off its pages, never a claim of no unsafe action. One exception, as in
    // test/site-v4.test.ts: the hostile-model eval's line (12 Nov), whose "0 unsafe" CI computes and its record holds.
    expect(CLAUDE_PAGE.replace(esc(hostileClaimText()) || "\u0000", " ")).not.toMatch(/stand-in|\b0 unsafe\b/i);
  });

  it("says the hostile model only when its report exists", () => {
    expect(ev.zeroTrust).toBe(existsSync(new URL(`../${ZERO_TRUST_REPORT}`, import.meta.url)));
    expect(measuredBlock({ ...ev, zeroTrust: false })).not.toMatch(/hostile/);
    expect(measuredBlock({ ...ev, zeroTrust: true })).toMatch(/hostile model/);
    expect(CLAUDE_PAGE.includes("hostile model")).toBe(ev.zeroTrust);
  });

  it("folds each agent on each model with its verdict, the Treasury choice as measured, and the failure in three lines", () => {
    const sweep = /<summary>Each agent on each model \(6 Nov\)<\/summary>([\s\S]*?)<\/details>/.exec(main)?.[1] ?? "";
    expect(sweep).not.toBe("");
    expect(text(sweep)).toContain("Sourcing Haiku 130/130 0.0005 4.8 s in use");
    expect(text(sweep)).toContain("Support Haiku 50/60 0.0029 10.0 s misses 10");
    expect(text(sweep)).toContain("Treasury: Haiku passed every Treasury run (70 of 70) at 1/24 of Opus's cost per pass, but its first plan passed code's checks in 8 of 40 rebalance runs, Opus's in 18 of 20. Treasury runs on Opus.");
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
