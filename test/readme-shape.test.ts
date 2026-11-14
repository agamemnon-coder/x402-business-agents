// The README's shape after the jury panel of 12 November ("README under 150 lines with one first screen"): at most 150
// lines; the pitch once, then one line of links, one badge row and "For reviewers in 30 seconds"; "Why this is a
// company" within the first 60 lines; no run codes (a juror reads runs by their plain names; the codes stay in
// docs/in-depth.md and the run logs); a five-row table of what ran live, one id per rail, each id read here from its
// run record; the offline check of the real approval of 7 November is one npm script on the receipt Home's hero reads.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HERO_RECEIPT_FILE } from "../src/redesign/heroReceipt.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
const lines = README.split("\n");
const json = <T>(p: string) => JSON.parse(read(p)) as T;

describe("the README's shape (jury panel, 12 Nov)", () => {
  it("is at most 360 lines, with one badge row and 'The business hypothesis' in the first 170 lines", () => {
    // 150 lines until 13 Nov; the owner then asked for the diagrams and the charts inline, so the cap was 300; the
    // restored header (the mark and the three buttons, 13 Nov, evening) added four lines; the README upgrade (13 Nov,
    // evening: Watch it, the 3 steps, Built with, the gallery, the collapsibles) makes it 360.
    expect(README.endsWith("\n") ? lines.length - 1 : lines.length).toBeLessThanOrEqual(360);
    expect(lines.filter((l) => /\[!\[[^\]]*\]\(https:\/\/(img\.shields\.io|github\.com\/[^)]*badge)/.test(l))).toHaveLength(1);
    expect(lines.indexOf("## The business hypothesis")).toBeGreaterThan(0);
    // Within the first 60 lines until 13 Nov; the README upgrade put the one-line diagram, the judges' 3 minutes and the
    // table of what is live above it, so within the first 90.
    expect(lines.indexOf("## The business hypothesis")).toBeLessThan(170); // 110 since the Visa and Metal Award sections came in; 170 since the README upgrade
  });

  it("names no run by its code", () => {
    // In the words a reader reads: a file path (a link's target, a command's output) may carry its code.
    const prose = README.replace(/```[\s\S]*?```/g, "").replace(/\]\([^)]*\)/g, "]").replace(/(src|href)="[^"]*"/g, "");
    for (const code of ["awx-1", "vic-2", "rel-1", "main-1"]) expect({ code, found: prose.includes(code) }).toEqual({ code, found: false });
  });

  // The final review (13 Nov): "For reviewers in 30 seconds" under 120 words, its table of one id per rail moved to
  // docs/in-depth.md, "What ran live, one id per rail", which the block links.
  it("keeps 'For judges: 3 minutes' under 120 words, linking the table of one id per rail", () => {
    const start = README.indexOf("## For judges: 3 minutes");
    const block = README.slice(start + "## For judges: 3 minutes".length, README.indexOf("\n## ", start + 5)).split("<picture>")[0]!;
    const words = block.replace(/\]\([^)]*\)/g, "]").replace(/<[^>]+>/g, " ").replace(/\\/g, " ").split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThan(120);
    expect(block).toContain("](docs/in-depth.md#what-ran-live-one-id-per-rail)");
  });

  it("gives one id per rail in docs/in-depth.md, 'What ran live, one id per rail', each read from its run record", () => {
    const DEPTH = read("docs/in-depth.md");
    const block = DEPTH.slice(DEPTH.indexOf("## What ran live, one id per rail"), DEPTH.indexOf("\n## ", DEPTH.indexOf("## What ran live, one id per rail") + 5));
    const rows = block.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Rail") && !l.startsWith("|---"));
    expect(rows.map((r) => r.split("|")[1]!.trim())).toEqual(["Airwallex", "Alta", "Visa", "Claude", "x402"]); // Alta since 14 Nov (Metal renamed itself)
    const row = (rail: string) => rows.find((r) => r.split("|")[1]!.trim() === rail)!;
    // Airwallex: its own decline of an agent's card in the Airwallex-only run of 7 November.
    const awx = json<{ card_transactions: { id: string; approved: boolean; decline_code: string | null; amount: string }[] }>("docs/demo/airwallex-run.json");
    const decline = awx.card_transactions.find((t) => !t.approved && t.decline_code === "LIMIT_EXCEEDED")!;
    expect(row("Airwallex")).toContain(decline.id);
    expect(row("Airwallex")).toContain(`EUR ${decline.amount}`);
    // Metal: the refusal on chain in the main run (the same tx the record holds).
    const main = read("docs/demo/main-run.json");
    const tx = /testnet\.metalntwx\.com\/tx\/(0x[0-9a-f]{64})/.exec(row("Alta"))![1]!;
    expect(main).toContain(tx);
    // Visa: the Airi run's purchase above the limit, paid only after the CFO's Face ID; a scripted purchase, no model call.
    const airi = json<{ purchases: { proposal_id?: string; payment_intent_id?: string }[] }>("docs/demo/airi-run.json");
    expect(row("Visa")).toContain(airi.purchases.find((p) => p.proposal_id && p.payment_intent_id)!.payment_intent_id!);
    expect(row("Visa")).toContain("scripted purchase with no model call");
    expect(read("docs/runs/2026-11-07-vic-1.md")).toContain("**Claude:** 0 calls (this run has no Claude step)");
    // Claude: a request id of a decision by Claude in the main run's record.
    const req = /`(req_[A-Za-z0-9]+)`/.exec(row("Claude"))![1]!;
    const byClaude: string[] = [];
    JSON.parse(main, (_k, v: unknown) => {
      const o = v as { model?: unknown; request_id?: unknown };
      if (o && typeof o === "object" && typeof o.model === "string" && o.model.startsWith("claude-") && typeof o.request_id === "string") byClaude.push(o.request_id);
      return v;
    });
    expect(byClaude).toContain(req);
    // x402: the main run's first sale, paid on Metal, and its counts.
    const trace = json<{ payments: { kind: string; rail: string; rail_id: string }[] }>("docs/demo/main-run-trace.json");
    const sales = trace.payments.filter((p) => p.kind === "sale");
    expect(row("x402")).toContain(sales[0]!.rail_id);
    expect(row("x402")).toContain(`${sales.length} sales among the main run's ${trace.payments.filter((p) => p.rail === "metal").length} test-USD payments`);
  });

  it("checks the real approval of 7 November offline with one script, on the receipt Home's hero reads", () => {
    const pkg = json<{ scripts: Record<string, string> }>("package.json");
    expect(pkg.scripts["verify-approval"]).toBe(`tsx src/cli/verifyReceipt.ts ${HERO_RECEIPT_FILE}`);
    expect(README).toContain("`npm run verify-approval`");
  });
});
