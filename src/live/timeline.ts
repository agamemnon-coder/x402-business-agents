// "Purser live" (storyboard: docs/plans/purser-live-storyboard.md): one working day at Northwind as an animation.
// Every number on screen comes from a recorded live run: the demo story and dashboard recorded from Friday run 1
// (docs/demo/), and for the three moments recorded elsewhere, their run logs (LIVE_RUNS below). A fact that cannot
// be found stops the build: the page never invents one.

import type { Story } from "../demo/story.js";
import type { Recorded } from "../demo/recorded.js";

export interface LiveFact { label: string; value: string; href: string | null }
export interface LiveScene {
  id: string;
  /** What draws the scene. */
  kind: "title" | "coins" | "card" | "refuse" | "faceid" | "invoice" | "dispute" | "ask" | "fx" | "wall" | "end";
  seconds: number;
  /** The agent or party acting, highlighted on the left. */
  actor: "ops" | "sales" | "finance" | "cfo" | "customer" | "stranger" | null;
  title: string;
  line: string;
  facts: LiveFact[];
  /** Which Claude model did what, as small labels (advice, never a decision). */
  models: { model: "Haiku" | "Sonnet" | "Opus"; did: string }[];
  /** Where the numbers come from. */
  source: string;
}
export interface LiveTimeline { company: string; recorded_at: string; run: string; scenes: LiveScene[] }

/**
 * The moments recorded after Friday run 1, in their own live runs. Kept here, in the run logs' words (their result
 * column, without the decline codes), so the page can show them without a ledger.
 */
export const LIVE_RUNS = {
  task: {
    source: "Live in the Airwallex sandbox, 30 October (docs/runs/2026-10-30-single-use.md)",
    ask: "Book a flight to Berlin on 12 November, at most €150", card: "Single-use flight card •••• 8653, at most 150.00 EUR, until 12 Nov",
    booked: "Skyline Air 120.00 EUR: approved by Airwallex", second: "A second charge, 20.00 EUR: declined, the card had closed itself",
  },
  quarantine: {
    source: "Live on Metal testnet, 30 October (docs/metal-award.md, section 5)",
    held: "0.02 test USD from 0xA262…b646: held by Metal's receive policy", returned: "Returned to the sender after the CFO's Face ID",
    tx: "0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c",
  },
} as const;

const EXPLORER = "https://testnet.metalntwx.com/tx/";

export function buildLiveTimeline(story: Story, recorded: Recorded): LiveTimeline {
  const step = (id: string) => {
    const s = story.steps.find((x) => x.id === id);
    if (!s) throw new Error(`the recorded story has no step "${id}"`);
    return s;
  };
  const fact = (id: string, label: RegExp): LiveFact => {
    const f = (step(id).facts ?? []).find((x) => label.test(x.label));
    if (!f) throw new Error(`the recorded step "${id}" has no fact matching ${label}`);
    // On screen, chain money reads "test USD", as on every page.
    return { label: f.label, value: f.value.replace(/\*?USDZ( \(testnet dollars\))?/g, "test USD"), href: f.href ?? null };
  };
  const snap = recorded.snapshot as unknown as { disputes?: { case_id: string; claim: string; outcome: string; refund: string; sales: { order: string; chain: boolean }[] }[] };
  const dispute = snap.disputes?.[0];
  if (!dispute) throw new Error("the recorded dashboard has no Dispute desk case");
  const verified = dispute.sales.filter((s) => s.chain && s.order.startsWith("signed")).length;
  const company = story.company ?? "Northwind Outdoor";
  const run = "Friday run 1, 30 October 2026 (Metal testnet, Airwallex sandbox)";

  const scenes: LiveScene[] = [
    { id: "title", kind: "title", seconds: 6, actor: null, title: `A working day at ${company}`, line: "Three AI agents. One CFO. Real rails, test money.", facts: [], models: [], source: run },
    { id: "coins", kind: "coins", seconds: 9, actor: "ops", title: "Agents pay per request, on their own", line: "A retailer's agent pays us for each stock check; our agent buys the data from the supplier, cents at a time, under on-chain mandates.",
      facts: [fact("buy", /Sales/), fact("buy", /first payment/i)], models: [], source: run },
    { id: "card", kind: "card", seconds: 8, actor: "ops", title: "Its own company card", line: "The Operations agent pays for software on its own Airwallex card, within the limit the CFO set.",
      facts: [fact("card", /^Approved/), fact("card", /^Declined/)], models: [], source: run },
    { id: "refuse", kind: "refuse", seconds: 10, actor: "ops", title: "The limit holds, on chain", line: "The supplier doubles its price. The payment bounces off the mandate: nothing moves, the customer is not charged.",
      facts: [fact("refused", /^Refusal/), fact("refused", /Option A/), fact("refused", /Option B/)],
      models: [{ model: "Haiku", did: "sorted the notice" }, { model: "Sonnet", did: "read the new price" }], source: run },
    { id: "faceid", kind: "faceid", seconds: 9, actor: "cfo", title: "The CFO decides, with Face ID", line: "The phone shows the exact terms. Face ID signs their hash; the mandates are replaced in a safe order.",
      facts: [{ label: "Approved", value: step("faceid").approval?.proposal ? `${step("faceid").approval!.proposal}: ${step("faceid").approval!.what}` : "", href: null }, fact("faceid", /mandate replaced/i)],
      models: [{ model: "Opus", did: fact("faceid", /Advice/).value.replace(/^Opus (advised )?/, "") + " (advice)" }], source: run },
    { id: "invoice", kind: "invoice", seconds: 8, actor: "finance", title: "A fake invoice goes nowhere", line: "Changed bank details and a planted \"pre-approved\" line: blocked before any money moves.",
      facts: [fact("stopped", /Invoice blocked/), fact("stopped", /Planted/)],
      models: [{ model: "Haiku", did: "sorted the document" }, { model: "Sonnet", did: "read the invoice" }, { model: "Opus", did: "do not pay (advice)" }], source: run },
    { id: "dispute", kind: "dispute", seconds: 10, actor: "customer", title: "\"Our agent never ordered this\"", line: "Northwind checks what it can prove: each order the agent signed, each payment against the customer's mandate on chain.",
      facts: [{ label: `Dispute ${dispute.case_id}`, value: `${verified} of ${dispute.sales.length} orders signed and verified on chain`, href: null }, { label: "Decision by code", value: dispute.outcome === "rejected" ? `Not refunded (${dispute.refund})` : `Refund ${dispute.refund}`, href: null }],
      models: [{ model: "Opus", did: "explained the decision (advice)" }], source: `${run}, with a Dispute desk case afterwards` },
    { id: "ask", kind: "ask", seconds: 9, actor: "cfo", title: "Ask Purser", line: `"${LIVE_RUNS.task.ask}"`,
      facts: [{ label: "Issued", value: LIVE_RUNS.task.card, href: null }, { label: "Booked", value: LIVE_RUNS.task.booked, href: null }, { label: "Then", value: LIVE_RUNS.task.second, href: null }],
      models: [{ model: "Sonnet", did: "read the request" }], source: LIVE_RUNS.task.source },
    { id: "fx", kind: "fx", seconds: 9, actor: "finance", title: "The euro bill", line: "Only the missing euros are bought, on a checked rate; the SWIFT payment carries the approval's hash.",
      facts: [fact("swift", /Conversion/), fact("swift", /SWIFT/)], models: [], source: run },
    { id: "wall", kind: "wall", seconds: 8, actor: "stranger", title: "Money from a stranger", line: "A payment from an unknown address stops at Metal's receive policy. The CFO decides what happens to it.",
      facts: [{ label: "Held", value: LIVE_RUNS.quarantine.held, href: null }, { label: "Returned", value: LIVE_RUNS.quarantine.returned, href: `${EXPLORER}${LIVE_RUNS.quarantine.tx}` }], models: [], source: LIVE_RUNS.quarantine.source },
    { id: "end", kind: "end", seconds: 7, actor: null, title: "Every euro has a proof.", line: "The CFO keeps the pen.", facts: [fact("audit", /Audit rows/)], models: [], source: run },
  ];
  for (const s of scenes) for (const f of s.facts) if (!f.value) throw new Error(`scene ${s.id}: empty fact ${f.label}`);
  return { company, recorded_at: story.recorded_at, run, scenes };
}
