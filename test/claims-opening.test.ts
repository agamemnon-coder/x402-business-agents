// docs/claims.md opens with the main run of 3 November and the site as it stands (jury panel, 12 Nov): its opening
// table's numbers are read here from the run records and the code, each row names its run, and its "Last checked"
// date is not older than the newest date the file gives a claim. Offline: files and code only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV_MAIN } from "../src/ui/nav.js";
import { MORE_LINKS } from "../src/ui/more.js";
import { loadRecord, stopStory, stopsLine } from "../src/redesign/run.js";
import { worstCaseWords } from "../src/policy/exposureSources.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const CLAIMS = read("docs/claims.md");
const main = JSON.parse(read("docs/demo/main-run.json")) as {
  proof: { alone: number; blocked: number; face_id: number; chain_refusals: number };
  snapshot: {
    counts: { alone: number; blocked: number };
    audit: { rows: number; intact: boolean };
    claude: { calls: number; cost_usd_micros: number; fallbacks: number };
    agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; models: string[] }[];
    tower: { money_out: { label: string; rail: string; unit: string; amount: string; count: number; proof: { ref: string } }[] };
  };
  ledger: { proposals: { proposal_id: string; kind: string; status: string; terms: { invoice_no?: string; amount?: string; currency?: string; conversion?: { buy_amount: string; sell_amount: string } } }[] };
};
const awx = JSON.parse(read("docs/demo/airwallex-run.json")) as {
  checks: Record<string, { ok: boolean; detail: string }>;
  proposals: { proposal_id: string; kind: string; status: string; terms_sha256: string }[];
  webhooks: { name: string; object_id: string; amount_cents: number }[];
};
const LOG = read("docs/runs/2026-11-03-main-run.md");

/** The opening: from the top to the next "## " heading after the main run's. */
const OPENING = CLAIMS.slice(0, CLAIMS.indexOf("\n## ", CLAIMS.indexOf("## The main run (3 November) and the site as it stands") + 4));
const flat = OPENING.replace(/\s+/g, " ");
const rows = OPENING.split("\n").filter((l) => /^\| /.test(l) && !/^\| (Claim|---)/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const row = (claim: string) => {
  const r = rows.find((c) => c[0] === claim);
  expect(r, claim).toBeDefined();
  return { value: r![1]!, run: r![2]!, where: r![3]! };
};
const usd = (micros: number) => (micros / 1e6).toFixed(2);

describe("docs/claims.md opens with the main run", () => {
  it("its first section is the main run's and the site's, before the archive of 30 October", () => {
    const headings = CLAIMS.split("\n").filter((l) => /^## /.test(l));
    expect(headings[0]).toBe("## The main run (3 November) and the site as it stands");
    expect(CLAIMS.indexOf("## The main run (3 November)")).toBeLessThan(CLAIMS.indexOf("## The earlier recorded run, 30 October"));
    // The 30 October figures are not in the opening.
    expect(flat).not.toMatch(/\b106\b|\b8 stops\b/);
    expect(flat).toContain("docs/demo/main-run.json");
    expect(flat).toContain("docs/demo/airwallex-run.json");
  });

  it("each row's 'Where it is said' names README and docs/in-depth.md sections that exist, and the claim is there", () => {
    const heads = (file: string) => read(file).split("\n").filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, ""));
    const files: Record<string, string[]> = { README: heads("README.md"), "docs/in-depth.md": heads("docs/in-depth.md") };
    for (const r of rows) {
      for (const m of r[3]!.matchAll(/(README|docs\/in-depth\.md), "([^"]+)"( and "([^"]+)")?/g)) {
        for (const h of [m[2], m[4]].filter(Boolean) as string[]) expect({ claim: r[0], file: m[1], heading: h, found: files[m[1]!]!.includes(h) }).toEqual({ claim: r[0], file: m[1], heading: h, found: true });
      }
      // A bare "README" is not a place: every README citation names its section.
      expect({ claim: r[0], bare: /\bREADME(?![,"]| ")(;|$)/.test(r[3]!) || /\bREADME;/.test(r[3]!) }).toEqual({ claim: r[0], bare: false });
    }
    // The ids of the reviewers' table (in docs/in-depth.md since the final review, 13 Nov) are the ones this table traces.
    const readme = read("docs/in-depth.md");
    for (const id of ["0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871", "01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38"]) {
      expect(readme).toContain(id);
      expect(flat).toContain(id);
    }
    // What moved to docs/in-depth.md is there: the main run's stops and its transfer.
    const depth = read("docs/in-depth.md").replace(/\s+/g, " ");
    expect(depth).toContain(row("Stops").value);
    expect(depth).toContain("03360bfa-afce-457b-89d1-e1097fbe3985");
  });

  it("each row names its run, or the code it is computed by", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) expect({ claim: r[0], named: /^(Main run|awx-1):|^Computed by|`[^`]+\.ts`/.test(r[2]!) }).toEqual({ claim: r[0], named: true });
  });

  it("'Last checked' is not older than the newest date the file gives a claim", () => {
    const last = /Last checked on (\d{1,2}) November 2026/.exec(CLAIMS);
    expect(last).not.toBeNull();
    expect(CLAIMS.match(/Last checked on/g)).toHaveLength(1);
    const days = [...CLAIMS.matchAll(/\b(\d{1,2}) (?:November|Nov)\b/g)].map((m) => Number(m[1]));
    expect(Math.max(...days)).toBeLessThanOrEqual(Number(last![1]));
  });
});

describe("the opening table's numbers are the records' and the code's", () => {
  it("the main run: its world, time and commit from the log", () => {
    const r = row("The main run");
    for (const want of ["main-1", "11:16", "11:33", "35e1cac"]) {
      expect(LOG).toContain(want);
      expect(r.value).toContain(want);
    }
  });

  it("decisions by Claude, per agent, and the Claude calls and cost", () => {
    const s = main.snapshot.agent_stats;
    const decisions = s.reduce((n, a) => n + a.decisions, 0), byClaude = s.reduce((n, a) => n + a.by_claude, 0), fallbacks = s.reduce((n, a) => n + a.fallback, 0);
    const family = (m: string) => (/haiku/.test(m) ? "Haiku" : /sonnet/.test(m) ? "Sonnet" : "Opus");
    const name = (a: string) => `${a[0]!.toUpperCase()}${a.slice(1)}`;
    const order = ["sourcing", "support", "treasury"].map((id) => s.find((a) => a.agent === id)!);
    expect(row("Decisions by Claude").value).toBe(`${byClaude} of ${decisions}, ${fallbacks} fallbacks: ${order.map((a) => `${name(a.agent)} (${family(a.models[0]!)}) ${a.decisions}`).join(", ")}`);
    const c = main.snapshot.claude, agentCalls = s.reduce((n, a) => n + a.claude_calls, 0);
    expect(row("Claude calls and cost").value).toBe(`${c.calls} calls, USD ${usd(c.cost_usd_micros)} at list prices: ${agentCalls} by the three agents, ${c.calls - agentCalls} that sort, read or review documents`);
  });

  it("payments, stops and Face ID", () => {
    const card = main.snapshot.tower.money_out.filter((f) => f.label === "Card spend").reduce((n, f) => n + f.count, 0);
    expect(main.snapshot.counts.alone).toBe(main.proof.alone);
    expect(row("Payments within the limits, no approval at the time").value).toBe(`${main.proof.alone}: ${main.proof.alone - card} Alta payments + ${card} card charge`);
    const record = loadRecord().record;
    expect(row("Stops").value).toBe(stopsLine(stopStory(record)));
    expect(stopStory(record).total).toBe(main.snapshot.counts.blocked);
    expect(row("Signed with Face ID").value).toBe(`${main.proof.face_id} times, by the CFO`);
  });

  it("the main run's EUR payment and the transfer that carries the signed hash", () => {
    const p = main.ledger.proposals.find((x) => x.kind === "invoice_payment" && x.status === "EXECUTED")!;
    const out = main.snapshot.tower.money_out.find((f) => f.label === "Supplier payouts")!;
    const r = row("The signed hash in Airwallex's record, main run");
    expect(r.value).toContain(`EUR ${p.terms.amount} by SWIFT for invoice ${p.terms.invoice_no} (${p.proposal_id}), transfer \`${out.proof.ref}\``);
    expect(out.amount).toBe(p.terms.amount);
    expect(r.value).toContain(`EUR ${p.terms.conversion!.buy_amount} bought for USD ${p.terms.conversion!.sell_amount}`);
    // The main run's section (docs/in-depth.md since 12 Nov) gives the same transfer.
    expect(read("docs/in-depth.md")).toContain(out.proof.ref);
  });

  it("Alta's refusal on chain, as Home and the README's table of one id per rail (docs/in-depth.md) give it", () => {
    const tx = /tx `(0x[0-9a-f]{64})`/.exec(row("Alta refused on chain").value)![1]!;
    expect(read("docs/in-depth.md")).toContain(tx);
    expect(JSON.stringify(main)).toContain(tx);
    expect(main.proof.chain_refusals).toBeGreaterThanOrEqual(1);
  });

  it("awx-1, the run behind Home's hero and its two Airwallex rows: its own ids, said as awx-1's", () => {
    const r = row("Home's hero, steps 1 to 3, and Home's two Airwallex rows: awx-1");
    const p2 = awx.proposals.find((p) => p.proposal_id === "P-0002" && p.kind === "invoice_payment")!;
    expect(r.value).toContain(`terms hash \`${p2.terms_sha256.slice(0, 8)}…\``);
    const transfer = awx.webhooks.find((w) => w.name.startsWith("payout.transfer") && w.amount_cents === 24000)!.object_id;
    expect(r.value).toContain(`transfer \`${transfer}\``);
    const declined = /^(\S+): 45\.00 EUR over the 30\.00 limit, declined by Airwallex LIMIT_EXCEEDED$/.exec(awx.checks.c!.detail)![1]!;
    expect(r.value).toContain(`card transaction \`${declined}\``);
    const checks = Object.values(awx.checks);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(r.value).toContain(`${checks.length} of ${checks.length} checks passed`);
    expect(r.run.startsWith("awx-1:")).toBe(true);
  });

  it("the worst case, in the words exposureWords gives it", () => {
    expect(row("The worst case, set by policy").value.startsWith(`"${worstCaseWords().headline}"`)).toBe(true);
  });

  it("the menu and the tour, from the code", () => {
    const v = row("The menu and the tour").value;
    expect(v.startsWith(`The menu: ${NAV_MAIN.map(([, label]) => label).join(", ")}.`)).toBe(true);
    expect(v).toContain("The product tour (/tour) and Pricing (/pricing) were taken out on 13 November (owner)");
    for (const gone of ["tour", "pricing"]) expect(MORE_LINKS.map((l): string => l.key)).not.toContain(gone);
  });

  it("the audit log's rows", () => {
    expect(main.snapshot.audit.intact).toBe(true);
    expect(row("Check it without keys").value).toContain(`${main.snapshot.audit.rows} rows in the main run, chain intact`);
  });
});
