// Every labelled figure on Home, Proof and Watch is the figure the record says for that label (Max's rescan, 2 Nov:
// Proof showed 5 Face ID decisions in one card and "6 decisions signed" in another). Each figure is read off the page
// with its label and compared with a value counted here, straight from the raw files (docs/demo/main-run.json, the
// TAP run, the eval and red-team records), not through the page code. A labelled figure this test
// does not know fails too, so a new number cannot slip in unchecked.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { cardControlRows } from "../src/redesign/airwallexProof.js";
import { loadRecord } from "../src/redesign/run.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
interface Raw {
  snapshot: {
    flows: { at: string; agent: string | null; kind: string; rail: string; amount: string; unit: string; count?: number; decided: string; proof: { href: string | null }; refused?: { by: string; reason: string } | null }[];
    agent_stats: { decisions: number; by_claude: number; fallback: number; claude_calls: number; cost_usd_micros: number }[];
    decisions: { status: string }[]; audit: { rows: number };
    traces: { agent: string; task: string; steps: { tool: string | null; input: unknown }[] }[];
  };
  proof: { face_id: number };
  ledger: { events: { event: string; subject: string | null; payload: Record<string, unknown> }[] };
}
const R = JSON.parse(read("docs/demo/main-run.json")) as Raw;
const tapFile = readdirSync(new URL("../docs/runs/", import.meta.url)).filter((f) => /^visa-tap-live.*\.json$/.test(f)).sort().pop()!;
const TAP = JSON.parse(read(`docs/runs/${tapFile}`)) as { reference: { commit: string }; steps: { airwallex: { approved: boolean; failure_reason: string | null } }[] };
const VAR = JSON.parse(read("docs/evals/autonomy-variation.json")) as { summary: { runs: number; by_claude: number } };
const RED = JSON.parse(read("docs/redteam/report.json")) as { attempts: number; results: { caught?: string }[] };

/** The figures, counted from the raw records, by the label the pages put next to them. */
function expected(): Record<string, string | string[]> {
  const s = R.snapshot, ev = R.ledger.events;
  const sum = (f: (a: Raw["snapshot"]["agent_stats"][number]) => number) => s.agent_stats.reduce((n, a) => n + f(a), 0);
  const decisions = sum((a) => a.decisions), byClaude = sum((a) => a.by_claude), fallbacks = sum((a) => a.fallback);
  const n = (f: { count?: number }) => f.count ?? 1;
  const faceIds = new Set(ev.filter((e) => /^proposal\.(approved|rejected)$/.test(e.event) && /\bmax\b/i.test(String(e.payload.approver ?? ""))).map((e) => e.subject)).size;
  const signatures = ev.filter((e) => /^proposal\.(approved|rejected|cosigned)$/.test(e.event)).length;
  // At the cap; a refusal because the mandate had just been replaced is shown apart, not as a limit.
  // The main run's purchase let through to Metal has two rows (the facilitator's 402, then its record on chain): one attempt.
  const atCap = s.flows.filter((f) => f.refused?.by === "metal" && !/mandate_revoked/.test(f.refused.reason));
  const metalRefusals = atCap.filter((f) => !(!f.proof.href && atCap.some((g) => g !== f && g.proof.href && g.agent === f.agent && Date.parse(g.at) >= Date.parse(f.at) && Date.parse(g.at) - Date.parse(f.at) < 15_000))).length;
  const fx = ev.find((e) => e.event === "fx.converted");
  const ownTap = ev.some((e) => e.event === "tap.checkout_verified") && ev.some((e) => e.event === "card.charge_approved");
  const revoked = s.flows.filter((f) => f.refused?.by === "metal" && /mandate_revoked/.test(f.refused.reason)).length;
  const tapDeclines = TAP.steps.filter((x) => !x.airwallex.approved && x.airwallex.failure_reason === "LIMIT_EXCEEDED").length;
  const stopRows = (s as unknown as { refusals: unknown[] }).refusals.length;
  const dispute = s.traces.find((t) => t.agent === "support" && t.task.startsWith("dispute"))!;
  const orders = new Set(dispute.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size;
  const refunds = s.flows.filter((f) => f.kind === "refund" && !f.refused).length;
  const failedThenPaid = ev.filter((e) => e.event === "proposal.failed").length;
  const sweep = s.flows.find((f) => f.kind === "sweep" && !f.refused)!, booked = s.flows.find((f) => f.kind === "booked" && !f.refused)!;
  const licence = s.flows.find((f) => f.rail === "airwallex_swift" && !f.refused)!;
  return {
    // Proof writes the count, /claude the ratio.
    [`decisions by Claude (${fallbacks} fallbacks)`]: [String(byClaude), `${byClaude}/${decisions}`],
    "routine payments by code": String(s.flows.filter((f) => !f.refused && (f.kind === "sale" || (f.kind === "upstream" && f.decided.startsWith("code")))).reduce((k, f) => k + n(f), 0)),
    "Face ID decisions": String(faceIds),
    // The main run's stops, all of them (Max, 5 Nov): every refusal row of the record once, with "nothing paid over a
    // limit" under the figure only when the record says so; the separate TAP run's decline is a labelled line below
    // it, not counted (Max, 4 Nov). Counted here from the raw rows, not the record's own count.
    [Number((R.proof as { over_limit_eur?: string }).over_limit_eur) === 0 ? "nothing paid over a limit" : "paid over a limit"]: `${stopRows} stops`,
    "Claude cost per decision": `$${(sum((a) => a.cost_usd_micros) / decisions / 1e6).toFixed(4)}`,
    // Proof's tile says which cost it is (jury review, 7 Nov, #20): the agents' calls, as summed here.
    "Claude cost per decision (agent calls)": `$${(sum((a) => a.cost_usd_micros) / decisions / 1e6).toFixed(4)}`,
    "payments on chain": String(s.flows.filter((f) => (f.rail === "metal" || f.rail === "purser") && !f.refused).reduce((k, f) => k + n(f), 0)),
    "refused by Metal at the cap": String(metalRefusals),
    // Proof's cards in plain words (Max, 7 Nov): the same counts.
    "refused by Metal at the limit": String(metalRefusals),
    "limits replaced on chain": String(ev.filter((e) => e.event === "mandate.replaced").length),
    "calls to Claude, each logged": String(sum((a) => a.claude_calls)),
    "cards carry the CFO's limits": (() => { const rows = cardControlRows(loadRecord().record); return `${rows.filter((r) => r.match).length} of ${rows.length}`; })(),
    // Proof's Airwallex tile (12 Nov): the same count, from the same card read-back.
    "cards carry the CFO's policy as Airwallex's own controls": (() => { const rows = cardControlRows(loadRecord().record); return `${rows.filter((r) => r.match).length} of ${rows.length}`; })(),
    "refused by Metal: mandate just replaced": String(revoked),
    "mandates replaced": String(ev.filter((e) => e.event === "mandate.replaced").length),
    // The FX conversion (fx.converted in the ledger) is a movement at Airwallex too.
    "movements at Airwallex": String(s.flows.filter((f) => f.rail.startsWith("airwallex") && !f.refused).length + (fx ? 1 : 0)),
    "card declines by Airwallex (TAP run and awx-1)": String(tapDeclines + (JSON.parse(read("docs/demo/airwallex-run.json")) as { declines_met: unknown[] }).declines_met.length),
    "signed checkouts (TAP run)": String(TAP.steps.length),
    "reference commit": TAP.reference.commit.slice(0, 7),
    "decisions by Claude": `${byClaude}/${decisions}`,
    "calls, each with a request id": String(sum((a) => a.claude_calls)),
    "Claude calls, each with a request id": String(sum((a) => a.claude_calls)),
    "Face ID decisions by the CFO": String(faceIds),
    "test USD swept after finality": sweep.amount,
    "USD booked after finality": booked.amount,
    "licence paid by SWIFT": `€${licence.amount.replace(/\.00$/, "")}`,
    "earlier attempt, nothing paid": String(failedThenPaid),
    "bought by FX for the shortfall": fx ? String(fx.payload.buy).replace(/^EUR /, "€").replace(/\.00$/, "") : "",
    "signed checkout in this run": ownTap ? "1" : "0",
    "orders disputed": String(orders),
    "variation runs by Claude": `${VAR.summary.by_claude}/${VAR.summary.runs}`,
    // Stopped before anything moved; the ones only found afterwards are not "stopped" (final review, 4 Nov: "39/39 attacks failed").
    "attacks stopped": `${RED.results.filter((r) => r.caught === "before").length}/${RED.attempts}`,
    "audit rows": String(s.audit.rows),
    // Home's tiles (the Home before the v4 animation).
    "decisions made by Claude": `${byClaude}/${decisions}`,
    "payments inside the limits": String((R.snapshot as unknown as { counts: { alone: number } }).counts.alone),
    // One canonical set (jury review, 6 Nov, #5): "86 Metal payments + 1 card charge"; "5 decisions signed with Face ID (+1 co-signature)".
    [`Metal payments + ${s.flows.filter((f) => f.rail === "airwallex_card" && !f.refused).length} card charge`]: String(s.flows.filter((f) => (f.rail === "metal" || f.rail === "purser") && !f.refused).reduce((k, f) => k + n(f), 0)),
    [`decisions signed with Face ID (+${signatures - faceIds} co-signature)`]: String(faceIds),
    "signatures": String(signatures),
    "decisions +": String(faceIds),
    "co-signature": String(signatures - faceIds),
    "valid": String(orders - refunds),
    "refunded": String(refunds),
  };
}

const decode = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** Every number on a page with the label written next to it, in the forms the pages use. */
export function figures(html: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const add = (re: RegExp, v: number, l: number) => { for (const m of html.matchAll(re)) out.push({ value: decode(m[v]!).trim(), label: decode(m[l]!).trim() }); };
  add(/<span class="v">([^<]+)<\/span><span class="l">([^<]+)<\/span>/g, 1, 2); // number cards
  add(/<span class="fact"><b>([^<]+)<\/b> ([^<]+)<\/span>/g, 1, 2); // partner facts
  add(/<span class="n">([^<]+)<\/span>([^<]+)<\/h3>/g, 1, 2); // the checks' headings
  // Prose that counts Face ID, signatures or decisions, anywhere (the form the old mismatch had).
  add(/(?<!of )\b(\d+) (signatures|decisions \+|co-signatures?|Face ID decisions|decisions signed[^.<"]*)/g, 1, 2);
  add(/\b(\d+) (valid|refunded)\b/g, 1, 2);
  return out;
}
export function mismatches(html: string, want = expected()): string[] {
  return figures(html).flatMap(({ value, label }) => {
    const key = label === "co-signatures" ? "co-signature" : label;
    if (!(key in want)) return [`unknown figure: ${value} "${label}"`];
    const ok = ([] as string[]).concat(want[key]!);
    return ok.includes(value) ? [] : [`${value} "${label}", the record says ${ok.join(" or ")}`];
  });
}

describe("every labelled figure on Home, Proof and Watch", () => {
  const pages = buildPages();
  it("is the figure the record holds for that label", () => {
    for (const name of ["home", "proof", "watch", "metal", "airwallex", "visa", "claude"] as const) {
      const html = String((pages as unknown as Record<string, string>)[name]);
      expect({ name, wrong: mismatches(html) }).toEqual({ name, wrong: [] });
    }
    // Proof shows its numbers: at least the four cards (five until 12 Nov), the facts and the checks' headings.
    expect(figures(pages.proof!).length).toBeGreaterThanOrEqual(15);
  });

  it("would have caught the Face ID mismatch of 2 Nov (5 on one card, 6 on another)", () => {
    const old = pages.proof!.replace("</main>", `<div class="card" id="faceid2"><h3>Face ID decisions</h3><p>6 decisions signed on the CFO's phone.</p></div></main>`);
    expect(mismatches(old).join("\n")).toMatch(/6 "decisions signed on the CFO's phone"/);
    // The Face ID figure is the check's heading under #faceid since 12 Nov (before: also a tile in the row of numbers).
    const five = pages.proof!.replace(/<span class="n">\d+<\/span>decisions signed with Face ID \(\+1 co-signature\)<\/h3>/, '<span class="n">6</span>decisions signed with Face ID (+1 co-signature)</h3>');
    expect(five).not.toBe(pages.proof);
    expect(mismatches(five).join("\n")).toMatch(/6 "decisions signed with Face ID \(\+1 co-signature\)", the record says 5/);
  });

  it("holds the one Face ID number the record's own count gives", () => {
    expect(expected()["Face ID decisions"]).toBe(String(R.proof.face_id));
  });
});
