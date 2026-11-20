// The public pages without the main run's record (src/redesign/run.ts loadRecord): they play the newest autonomous dry
// run (docs/demo/autonomy.json) instead, under its own name, and every figure on them is that run's own. The main run's
// file is hidden from this test's file system only; nothing is written.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (orig) => {
  const fs = await orig<typeof import("node:fs")>();
  const hidden = (p: unknown) => String(p).replace(/\\/g, "/").endsWith("docs/demo/main-run.json");
  const existsSync = (p: Parameters<typeof fs.existsSync>[0]) => (hidden(p) ? false : fs.existsSync(p));
  return { ...fs, default: { ...fs, existsSync }, existsSync };
});

const { agentRun, loadRecord, runLabel, runName, STAND_IN_FILE } = await import("../src/redesign/run.js");
const { homePage } = await import("../src/redesign/home.js");
const { watchPage } = await import("../src/redesign/watch.js");
const { proofPage } = await import("../src/redesign/proof.js");
const P = await import("../src/redesign/partners.js");

interface Stand { run: string; snapshot: { agent_stats: { decisions: number; by_claude: number; fallback: number }[]; decisions: { proposal_id: string; by: string | null }[] } }
const stand = JSON.parse(readFileSync(new URL(`../${STAND_IN_FILE}`, import.meta.url), "utf8")) as Stand;
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("without the main run's record, the pages play the newest dry run", () => {
  const run = agentRun();

  it("loads the dry run, labelled as a stand-in under its own name", () => {
    expect(loadRecord()).toMatchObject({ file: STAND_IN_FILE, standIn: true });
    expect(run).toMatchObject({ file: STAND_IN_FILE, standIn: true, name: runName(run.record as never) });
    expect(run.name).toBe("Autonomous dry run dry-118");
    expect(run.label).toBe(runLabel(run.record as never));
    expect(run.label).toMatch(/^Replay of Autonomous dry run dry-118, 1 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · /);
  });

  it("counts its decisions from its own agent stats, and its signatures from its own decisions (it has no ledger)", () => {
    const s = stand.snapshot.agent_stats;
    const decisions = s.reduce((n, a) => n + a.decisions, 0), byClaude = s.reduce((n, a) => n + a.by_claude, 0), fallbacks = s.reduce((n, a) => n + a.fallback, 0);
    expect(run.derived).toMatchObject({ decisions: String(decisions), byClaude: String(byClaude), fallbacks: String(fallbacks) });
    expect(run.tiles[0]!.value).toBe(`${byClaude}/${decisions}`);
    // Each decision someone signed is a Face ID step; a superseded one (nobody signed it) is not.
    const signed = stand.snapshot.decisions.filter((d) => d.by).map((d) => d.proposal_id).sort();
    expect(run.events.filter((e) => e.k === "face").map((e) => (e as { id: string }).id).sort()).toEqual(signed);
  });

  it("every page renders from it and names it, never the main run's figures", { timeout: 60_000 }, () => {
    const pages = { home: homePage(run), watch: watchPage(run), proof: proofPage(run), metal: P.metalPage(run), airwallex: P.airwallexPage(run), visa: P.visaPage(run), claude: P.claudePage(run), books: P.booksPage(run), notFound: P.notFoundPage(run) };
    for (const [name, html] of Object.entries(pages)) {
      expect(html.startsWith("<!doctype html>"), name).toBe(true);
      expect(text(html), name).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
    expect(text(pages.watch)).toContain("dry-118");
    expect(text(pages.proof)).toContain("dry-118");
  });
});
