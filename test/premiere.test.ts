// The premiere (src/film/premiere.ts, premiereScript.ts, premiere.html): every figure on screen and in the voice-over
// is the main run's record's (docs/demo/main-run.json), counted here again from the raw record; the build stops when a
// figure is missing; the page types in no figure of its own; the /try/sign mock says what the live page says; and the
// script, subtitles and read-aloud script in docs/video/ are the ones the code writes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_CREDIT, BACKGROUND, CLOSING, CORE_LINE, END_CREDITS, THANKS, MAIN_RUN_FILE, TRY_SIGN_URL, TRY_SIGN_WORDS, buildPremiere, premiereFacts, premierePage, spoken, testLine, trySignExample, voiceScript, type MainRun, type PremiereData } from "../src/film/premiere.js";
import { MASTER_CLIPS, OVERLAYS, PREMIERE_SCENES, scenesJson, clock, factsUsed, pageScenes, lineSeconds, premiereBeats, premiereReadAloud, premiereSeconds, premiereSrt, premiereTable, premiereTimeline, voiceTimeline } from "../src/film/premiereScript.js";
import { agentRun, payments } from "../src/redesign/run.js";
import { TRY_URL } from "../src/submission/deck.js";
import { TRY_SIGN_LABEL, TRY_SIGN_SCREENS, trySignPage } from "../src/try/sign.js";
import { DEFENSE_IN_DEPTH } from "../src/config/brand.js";
import { CARDS, INITIAL_MANDATES } from "../src/config/policy.js";
import { maskExpr, parseSlotArgs, slotBox, slotFilter, slotSpeed } from "../src/film/slots.js";
import { FIXED_PROPOSALS, TEST_BALANCES, TEST_RULES, canonical, checkPayment } from "../worker/src/trySign.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
const raw = () => JSON.parse(read(MAIN_RUN_FILE)) as MainRun & { ledger: NonNullable<MainRun["ledger"]> };
const data = buildPremiere(raw(), README);
const fact = (k: string) => data.facts[k]!.value;
const screen = (id: string) => data.screen[id] as Record<string, unknown>;
const toSeconds = (t: string) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s!.replace(",", ".")); };
const timeline = premiereTimeline();
const scenesForPage = pageScenes();

describe("the premiere's figures are the main run's record's", () => {
  // Counted again here from the raw record, by other code than the film's.
  const r = raw();
  const ev = r.ledger.events;
  const byEvent = (name: string) => ev.filter((e) => e.event === name);

  it("the price rise: 0.02 → 0.04 over the 0.03 cap, let through once, refused by Metal, its tx on chain", () => {
    const lt = byEvent("upstream.let_through")[0]!;
    const chain = byEvent("upstream.refused_on_chain")[0]!;
    const first = r.snapshot.flows.find((f) => f.kind === "upstream" && !f.refused)!;
    expect({ old: fact("price.old"), new: fact("price.new"), cap: fact("price.cap"), tx: fact("price.tx"), at: fact("price.txAt") })
      .toEqual({ old: (Number(first.amount) / first.count!).toFixed(2), new: lt.payload.amount, cap: lt.payload.bound_cap, tx: chain.payload.tx, at: chain.ts.slice(11, 19) });
    expect(fact("price.tx")).toBe("0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect([fact("price.old"), fact("price.new"), fact("price.cap")]).toEqual(["0.02", "0.04", "0.03"]);
    expect(screen("05-price")).toMatchObject({ from: "0.02", to: "0.04", capValue: "0.03", tx: "0x2e92f9cb…1871", txWhere: "testnet.metalntwx.com · 11:23:33 UTC" });
    // The run's own label, word for word, and the short honest line Max asked for.
    expect(screen("05-price").label).toBe(DEFENSE_IN_DEPTH);
    expect(screen("05-price").letThrough).toBe("Let through on purpose. Purser normally refuses first.");
  });

  it("the dispute: 12 orders, all signed; #7, #10, #13 refunded by Support (0.15); the other 9 rejected with Face ID", () => {
    const d = r.ledger.disputes[0]!;
    const refunds = byEvent("refund.paid").filter((e) => e.actor === "support");
    const batch = r.ledger.proposals.find((p) => p.kind === "refund_batch")!;
    expect(screen("07-dispute").orders).toEqual(d.claims.sale_refs.map((n) => `#${n}`));
    expect(screen("07-dispute").refunded).toEqual(refunds.map((e) => `#${e.subject}`));
    expect({ count: fact("dispute.count"), signed: fact("dispute.signed"), refunded: fact("dispute.refunded"), total: fact("dispute.refundTotal"), rest: fact("dispute.rest"), proposal: fact("dispute.proposal") })
      .toEqual({ count: "12", signed: String(d.evidence.filter((e) => e.signed_order).length), refunded: "#7 #10 #13", total: (refunds.reduce((n, e) => n + Number(e.payload.amount), 0)).toFixed(2), rest: String((batch.terms.refunds as unknown[]).length), proposal: batch.proposal_id });
    expect([fact("dispute.signed"), fact("dispute.refundTotal"), fact("dispute.rest")]).toEqual(["12", "0.15", "9"]);
    expect(batch.status).toBe("REJECTED");
    expect(fact("dispute.rejectedAt")).toBe(byEvent("proposal.rejected")[0]!.ts.slice(11, 19));
    expect(screen("07-dispute").claim).toBe("“Our agent never placed orders #5 to #16.”");
  });

  it("6 seconds from Face ID to PAID, as the run log says; transfer 03360bfa…3985 and its FX first", () => {
    const approved = byEvent("proposal.approved").find((e) => e.subject === "P-0005")!;
    const paid = byEvent("transfer.status").find((e) => e.payload.status === "PAID")!;
    const ms = Date.parse(paid.ts) - Date.parse(approved.ts);
    expect(ms).toBeGreaterThan(5500);
    expect(ms).toBeLessThan(6500);
    expect(fact("paid.seconds")).toBe("6");
    expect(read("docs/runs/2026-11-03-main-run.md")).toContain("6 s from Face ID to PAID");
    expect(fact("paid.transfer")).toBe("03360bfa-afce-457b-89d1-e1097fbe3985");
    expect(screen("09-six")).toMatchObject({ big: "6", unit: "seconds", transfer: "03360bfa-afce-457b-89d1-e1097fbe3985" });
    expect(screen("09-six").steps).toEqual([["11:31:18", "Face ID"], ["11:31:19", "FX · EUR 110.00 for USD 124.29"], ["11:31:21", "SWIFT · EUR 240.00"], ["11:31:23", "SENT (simulated)"], ["11:31:24", "PAID (simulated)"]]);
  });

  it("says that the sandbox settlement is simulated: SENT and PAID are Purser's own calls to Airwallex's simulation API", () => {
    // The record: SENT, then PAID, each written by the executor (settleInSandbox, src/executors/invoicePayment.ts).
    const transfer = fact("paid.transfer");
    const statuses = byEvent("transfer.status").filter((e) => e.subject === transfer);
    expect(statuses.map((e) => [e.actor, e.payload.status])).toEqual([["awx-executor", "SENT"], ["awx-executor", "PAID"]]);
    expect(read("src/executors/invoicePayment.ts")).toMatch(/async function settleInSandbox[\s\S]*?for \(const to of \["SENT", "PAID"\] as const\)[\s\S]*?sim\.transitionTransfer/);
    expect(read("src/airwallex/adapter.ts")).toContain("/simulation/transfers/${id}/transition");
    // On screen, as a line of its own, and in the footnote; in the voice-over, the narrator's line as written.
    expect(screen("09-six")).toMatchObject({ simulated: "In the sandbox, the settlement is simulated.", look: "Every id is on /proof", where: "kit11.max-31b.workers.dev/proof" });
    expect(screen("09-six").foot).toBe("Purser moved the transfer to SENT and then PAID itself, through Airwallex's sandbox simulation API. Test money.");
    const s9 = timeline.find((s) => s.id === "09-six")!;
    expect(data.voice["09-six"]!.map((l) => [clock(s9.start + l.at), l.text])).toEqual([
      ["1:14", "Six seconds later, Airwallex pays the euro invoice by SWIFT, in its sandbox. Every I.D. is published."],
    ]);
    // A sandbox transfer id cannot be looked up publicly: nothing asks anyone to.
    expect(JSON.stringify(data.screen) + JSON.stringify(data.voice) + premiereTable(data)).not.toMatch(/look it up/i);
  });

  it("shows the second approval only as what it was: a labelled test passkey, never a second person", () => {
    // Four eyes is said once, small, and with what the second approver was (05b-treasury).
    const cosign = String(screen("05b-treasury").second);
    expect(cosign).toBe("four eyes · second approver: a labelled test passkey");
    const words = (JSON.stringify(data.screen) + JSON.stringify(data.voice)).replace(cosign, "");
    expect(words).not.toMatch(/four eyes|2 of 2|two signatures|co-?sign|second person|test-controller|two people/i);
    expect([...words.matchAll(/second approver[^"]*/gi)].map((m) => m[0])).toEqual(["second approver: a labelled test passkey", "second approver. Test money only."]);
    expect(data.voice["14-real"]![0]!.text).toContain("a test second approver");
  });
  it("the approval card is P-0005's exact terms: the Treasury agent's plan, its hash the one Max signed", () => {
    const p = r.ledger.proposals.find((x) => x.proposal_id === "P-0005")!;
    const approved = byEvent("proposal.approved").find((e) => e.subject === "P-0005")!;
    expect(screen("08-faceid").what).toBe(`Pay ${p.terms.vendor} EUR ${p.terms.amount} by ${p.terms.method}`);
    expect(screen("08-faceid").rows).toEqual([["Invoice", p.terms.invoice_no], ["Buy first", "EUR 110.00 for USD 124.29"], ["Fee at most", `EUR ${p.terms.fee_max}`], ["Planned by", "Treasury agent · Claude Opus"], ["Expires", "11:45:01 UTC"]]);
    expect(fact("licence.hash")).toBe(approved.payload.terms_sha256);
    expect(String(screen("08-faceid").hash)).toBe(`${fact("licence.hash").slice(0, 16)}…${fact("licence.hash").slice(-8)}`);
  });

  it("the proof cards (Max, 5 November, second round): 24/24 by Claude, then the run's stops", () => {
    const cards = screen("13-proof").cards as { big?: string; label?: string; small?: string; stops?: boolean }[];
    const st = r.snapshot.agent_stats;
    expect(cards[0]!.big).toBe(`${st.reduce((n, a) => n + a.by_claude, 0)}/${st.reduce((n, a) => n + a.decisions, 0)}`);
    expect(cards[0]!.small).toBe("Sourcing 11 · Support 4 · Treasury 9 · 0 fallbacks");
    expect(cards[1]!.stops).toBe(true);
    // Two cards, one on each beat; the stops take the rest of the 13 s, as the voice names them.
    expect(cards).toHaveLength(2);
    expect(timeline.find((x) => x.id === "13-proof")).toMatchObject({ seconds: 13, beats: [0, 2.6] });
  });

  it("shows the test count the README shows, in its line and its badge, and refuses to render when they disagree", () => {
    const line = testLine(README).tests, badge = /badge\/tests-(\d+)%20passing/.exec(README)![1];
    expect(badge).toBe(line);
    expect(fact("specs.tests")).toBe(line);
    expect(() => buildPremiere(raw(), README.replace(/badge\/tests-\d+%20passing/, "badge/tests-1%20passing"))).toThrow(/badge .* disagree/);
  });

  it("the Metal card (v5): every Metal payment its own transaction, counted from the record; the render stops without it", () => {
    const flows = r.snapshot.flows as { rail?: string; refused?: unknown; count?: number; proof: { href: string | null } }[];
    const paid = flows.filter((f) => f.rail === "metal" && !f.refused).reduce((n, f) => n + (f.count ?? 1), 0);
    expect(paid).toBe(86);
    expect(fact("metal.payments")).toBe(String(paid));
    // The same count the pitch and the README use (src/redesign/run.ts, payments()).
    expect(Number(fact("metal.payments"))).toBe(payments(r as unknown as Parameters<typeof payments>[0]).onChain);
    const budgets = (r.snapshot as unknown as { budgets: { agents: unknown[]; counterparty: unknown } }).budgets;
    expect(Number(fact("metal.mandates"))).toBe(budgets.agents.length + 1 + byEvent("mandate.replaced").filter((e) => e.payload.tx).length);
    expect([fact("metal.mandates"), fact("metal.chainRefusals")]).toEqual(["6", "1"]);
    expect(screen("06-metal")).toEqual({ big: "86", label: "payments", line: "each its own transaction on Metal testnet · no emulator", small: "+ 6 mandate transactions · 1 refusal on chain" });
    expect(README).toContain("86 test-USD payments, each its own transaction");
    const broken = raw();
    for (const f of broken.snapshot.flows as { rail?: string }[]) if (f.rail === "metal") f.rail = "elsewhere";
    expect(() => buildPremiere(broken, README)).toThrow(/payment on Metal/);
  });

  it("Treasury's two options (v5): A and B from the record, the same total, A signed with Face ID at the record's time", () => {
    const p = (id: string) => r.ledger.proposals.find((x) => x.proposal_id === id)!;
    const [a, b] = [p("P-0002"), p("P-0003")];
    expect([a.terms.option, b.terms.option, a.created_by, b.created_by]).toEqual(["A", "B", "treasury", "treasury"]);
    expect(screen("05b-treasury")).toMatchObject({
      kicker: "The Treasury agent's two options · 11:24:07 UTC",
      options: [
        { tag: "A", id: "P-0002", lines: ["The Sourcing agent's cap to 0.04", "Our price stays 0.05"] },
        { tag: "B", id: "P-0003", lines: ["Our price to 0.07"] },
      ],
      within: "Within the same 20.00", signed: "Signed", signedWhen: "P-0002 · Face ID, 11:26:28 UTC",
    });
    expect([a.terms.total_budget, b.terms.total_budget, a.terms.query_price, b.terms.query_price]).toEqual(["20.00", "20.00", "0.05", "0.07"]);
    expect(((a.terms.steps as { agent: string; cap: string }[]).find((x) => x.agent === "sourcing"))!.cap).toBe("0.04");
    const cosigned = byEvent("proposal.cosigned").find((e) => e.subject === "P-0002")!;
    expect([cosigned.ts.slice(11, 19), cosigned.payload.approver, cosigned.payload.method]).toEqual(["11:26:28", "max", "passkey"]);
    // The run log says the same: the options at 11:24:07, Max's signature at 11:26:28.
    const log = read("docs/runs/2026-11-03-main-run.md");
    expect(log).toContain("| 11:24:07 | Treasury's options | P-0002 (A, recommended: cap 0.04, price 0.05) and P-0003 (B, price 0.07). Total stays 20.00. |");
    expect(log).toMatch(/\| 11:26:28 \/ 11:26:46 \| Four eyes \| Max signed P-0002 \(1 of 2\)/);
    // The voice says the record's total; a script that says another stops the build.
    expect(data.voice["05b-treasury"]![0]!.text).toBe("Treasury proposes two ways to stay within the same twenty dollars. The CFO picks one, with Face ID.");
    expect(() => buildPremiere(raw(), README, read("docs/video/narrator-script.md").replace("same twenty dollars", "same thirty dollars"))).toThrow(/05b-treasury line does not say "within the same twenty dollars"/);
    const broken = raw();
    broken.ledger.proposals = broken.ledger.proposals.filter((x) => x.proposal_id !== "P-0003");
    expect(() => buildPremiere(broken, README)).toThrow(/option B/);
  });

  it("the value line (v5, 13b): the agents do the work; the CFO, on screen and in the narrator's voice alike", () => {
    expect(screen("13b-value")).toEqual({ line: ["The agents do the work.", "The CFO signs only the exceptions."] });
    expect(data.voice["13b-value"]!.map((l) => l.text)).toEqual(["The agents do the work. The CFO signs only the exceptions."]);
    // Eleven words in 4 s: read a little faster than the calm pace, from the scene's start, never over 3 words a second.
    const [l] = data.voice["13b-value"]!;
    expect([l!.at, l!.seconds]).toEqual([0, 3.95]);
    expect(11 / l!.seconds).toBeLessThanOrEqual(3);
    expect(() => buildPremiere(raw(), README, read("docs/video/narrator-script.md").replace("The CFO signs only the exceptions. |", "The CFO signs only the exceptions. Every one of them, today. |"))).toThrow(/13b-value line takes/);
  });
  it("the stops card (Max, 5 November, second round: \"1 + 1\" told too little): the run's stops, who stopped what, nothing paid over a limit", () => {
    // Counted again here from the raw record: the refusal rows by who stopped them, the record's own count and proof.
    const rows = r.snapshot.refusals!;
    const claude = rows.filter((x) => /own buy policy/.test(x.reason)).length, metal = rows.filter((x) => /refused on chain/.test(x.reason)).length;
    const cfo = rows.filter((x) => x.what === "Proposal rejected").length, planted = rows.filter((x) => /planted instruction/i.test(x.what)).length;
    expect([claude, metal, cfo, planted]).toEqual([12, 2, 1, 1]);
    expect(claude + metal + cfo + planted).toBe(r.snapshot.counts!.blocked);
    expect([r.snapshot.counts!.blocked, r.proof!.chain_refusals, r.proof!.over_limit_eur]).toEqual([16, metal, "0.00"]);
    expect(byEvent("proposal.rejected").length).toBe(cfo);
    const card = (screen("13-proof").cards as Record<string, unknown>[])[1]!;
    expect(card).toEqual({
      stops: true, figure: "16 stops", sub: "nothing paid over a limit",
      rows: [
        { big: "12", label: "Claude skipped an overpriced check" },
        { big: "2", label: "Metal refused a purchase" },
        { big: "1", label: "the CFO rejected a proposal" },
        { big: "1", label: "planted instruction changed nothing" },
      ],
    });
    expect([fact("specs.stops"), fact("specs.stopsClaude"), fact("specs.stopsMetal"), fact("specs.stopsCfo"), fact("specs.stopsPlanted"), fact("specs.overLimit")]).toEqual(["16", "12", "2", "1", "1", "nothing"]);
    const film = JSON.stringify(data.screen) + JSON.stringify(data.voice);
    expect(film + premiereTable(data)).not.toMatch(/\d\s*\+\s*\d/);
    expect(film).not.toMatch(/\d+ stopped at a limit|over its cap/i);
    // The voice says the stops as the script has them, each the record's figure.
    expect(data.voice["13-proof"]!.map((l) => l.text).join(" ")).toBe("All twenty-four decisions by Claude. Sixteen stops, nothing paid over a limit: twelve skipped by Claude, two refused by Metal, one rejected by the CFO, and one planted instruction ignored.");
    // A record whose parts do not add up, or whose Metal count differs from its refusals on chain, renders nothing.
    const more = raw(); more.snapshot.counts!.blocked = 17;
    expect(() => buildPremiere(more, README)).toThrow(/add up/);
    const chain = raw(); chain.proof!.chain_refusals = 1;
    expect(() => buildPremiere(chain, README)).toThrow(/chain_refusals/);
    const paid = raw(); paid.proof!.over_limit_eur = "0.04";
    expect(() => buildPremiere(paid, README)).toThrow(/over_limit_eur/);
    // The rows come in as the voice names them; the figures are shown as they are, never counted up.
    const page = read("src/film/premiere.html");
    expect(page).toMatch(/n\.parts = c\.rows\.map\(function \(r\) \{ return E\("div", "srow", null, \[E\("b", "tn", r\.big\)/);
    expect(page).toMatch(/\.srow \{ display: flex;/);
  });
  it("agrees with the site's own counts (src/redesign/run.ts): stopped at a limit, Face ID to PAID, decisions", () => {
    const d = agentRun().derived;
    expect({ stopped: fact("specs.stops"), faceToPaid: fact("paid.seconds"), byClaude: fact("specs.byClaude"), decisions: fact("specs.decisions"), faceIds: fact("run.faceIds") })
      .toEqual({ stopped: d.stopped, faceToPaid: d.faceToPaid, byClaude: d.byClaude, decisions: d.decisions, faceIds: d.faceId });
  });

  it("says the figures the same way in the voice-over, and stops the build when the script says another", () => {
    const said = Object.values(data.voice).flat().map((l) => l.text).join(" ");
    for (const w of ["twelve orders", "Only the three with wrong data", "Six seconds later", "Sixteen stops, nothing paid over a limit", "All twenty-four decisions by Claude", "Three Claude agents", "doubles its price", "Eighty-six of them"]) expect(said).toContain(w);
    expect(spoken(24)).toBe("twenty-four");
    expect(spoken(86)).toBe("eighty-six");
    expect(() => spoken(120)).toThrow();
    const script = read("docs/video/narrator-script.md");
    for (const [from, to, id] of [["Eighty-six of them", "Eighty-five of them", "06-metal"], ["disputes twelve orders", "disputes eleven orders", "07-dispute"], ["Six seconds later", "Five seconds later", "09-six"], ["All twenty-four", "Twenty of twenty-four", "13-proof"], ["Sixteen stops", "Fifteen stops", "13-proof"], ["twelve skipped by Claude", "eleven skipped by Claude", "13-proof"], ["two refused by Metal", "one refused by Metal", "13-proof"]] as const) {
      expect(() => buildPremiere(raw(), README, script.replace(from, to))).toThrow(new RegExp(`${id} line does not say`));
    }
    expect(() => buildPremiere(raw(), README, script.replace(/^\| 06-metal .*$/m, ""))).toThrow(/voice line for 06-metal/);
  });
  it("the intro: three Claude agents, each with its one model and its job, as the record has them", () => {
    const st = r.snapshot.agent_stats as { agent: string; models: string[] }[];
    const agents = (r.snapshot as unknown as { agents: { id: string; job: string; alone: string[] }[] }).agents;
    expect(st.map((a) => [a.agent, a.models])).toEqual([["sourcing", ["claude-haiku-5-5"]], ["support", ["claude-sonnet-5-5"]], ["treasury", ["claude-opus-5-5"]]]);
    expect(screen("03-agents").agents).toEqual([
      { name: "Sourcing agent", model: "Claude Haiku 5.5", job: "Buys data per query, over x402 on Metal", card: "EUR 30.00 a purchase · 100.00 a month", mandate: "0.03 test USD a payment · 10.00 in all" },
      { name: "Support agent", model: "Claude Sonnet 5.5", job: "Handles disputes and refunds", card: "EUR 60.00 a purchase · 150.00 a month", mandate: "0.10 test USD a payment · 4.00 in all" },
      { name: "Treasury agent", model: "Claude Opus 5.5", job: "FX, SWIFT, budgets", card: "EUR 25.00 a purchase · 50.00 a month", mandate: "6.00 test USD a payment · 6.00 in all" },
    ]);
    // Each job in the film's words is the record's own description of that agent, and what the agent did in the run.
    expect(agents.find((a) => a.id === "sourcing")!.job).toContain("buys upstream data per query");
    expect(agents.find((a) => a.id === "sourcing")!.alone.join(" ")).toContain("on chain (x402)");
    expect(agents.find((a) => a.id === "support")!.job).toContain("refunds customers when a dispute holds");
    expect(agents.find((a) => a.id === "treasury")!.job).toContain("Airwallex FX and SWIFT");
    expect(r.ledger.proposals.filter((p) => p.created_by === "treasury").map((p) => p.kind)).toContain("mandate_replace");
    expect(screen("03-agents")).toMatchObject({ head: "Three Claude agents run a small company's money.", cardLabel: "Its own Airwallex card", mandateLabel: "Its own Metal mandate", note: "Each agent's limits as the run began · test money", limits: "The rails and the code hold the limits." });
    expect(data.voice["03-agents"]!.map((l) => l.text)).toEqual(["Three Claude agents run a small company that sells live stock data. Each has its own Airwallex card, and its own Metal mandate."]);
  });

  it("the intro's limits: each agent's own card and own mandate as the run began, the config's, as the record shows them", () => {
    // The Sourcing agent's card was raised in the run (P-0006): it started at the config's limits.
    const synced = byEvent("card.limits_synced").find((e) => e.subject === "sourcing")!;
    expect(synced.payload.from).toBe(`${(CARDS.sourcing.perTxCents / 100).toFixed(2)} / ${(CARDS.sourcing.monthlyCents / 100).toFixed(2)}`);
    // The other cards are the config's at the end of the run too.
    const cards = (r.snapshot as unknown as { cards: { agent: string; per_tx: string; monthly: string }[] }).cards;
    for (const a of ["support", "treasury"] as const) expect(cards.find((c) => c.agent === a)).toMatchObject({ per_tx: (CARDS[a].perTxCents / 100).toFixed(2), monthly: (CARDS[a].monthlyCents / 100).toFixed(2) });
    // The Sourcing agent's mandate was let through to Metal at the config's cap, the one the price rise crossed (05).
    expect(byEvent("upstream.let_through")[0]!.payload.bound_cap).toBe((INITIAL_MANDATES.sourcing.capCents / 100).toFixed(2));
    expect(fact("team.sourcingMandate").startsWith(`${fact("price.cap")} test USD a payment`)).toBe(true);
    // The Support agent's mandate was never replaced: the config's at the end of the run.
    const support = (r.snapshot as unknown as { budgets: { agents: { agent: string; cap: string; budget: string }[] } }).budgets.agents.find((x) => x.agent === "support")!;
    expect([support.cap, support.budget]).toEqual([(INITIAL_MANDATES.support.capCents / 100).toFixed(2), (INITIAL_MANDATES.support.budgetCents / 100).toFixed(2)]);
    // A record that disagrees stops the build.
    const broken = raw();
    for (const e of broken.ledger.events) if (e.event === "card.limits_synced") e.payload.from = "99.00 / 100.00";
    expect(() => buildPremiere(broken, README)).toThrow(/team\.sourcingCard/);
  });

  it("the hook and the wordmark (Max, 5 November; v5): the line slams in on black, the question, then the wordmark and the core line", () => {
    expect(screen("01-hook")).toEqual({ line: "AI agents can now spend money.", question: "So who signs off?" });
    expect(screen("02-purser")).toMatchObject({ title: "Purser", sub: "Starter Kit 11" });
    expect(CORE_LINE.join(" ")).toBe("Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them.");
    // The film was recorded on 5 November with this line; on 6 November Max moved the README's core line to the
    // three locks, so the film keeps its own line and the README carries the new one.
    expect(README).toContain("**Claude agents propose and pay; Purser's code, Airwallex and Metal each hold a limit; above them, the CFO signs the exact terms with Face ID.**");
    expect(screen("02-purser").core).toEqual(CORE_LINE);
    // The narrator's opening, word for word, from the script: in the third person, who built it.
    expect([...data.voice["01-hook"]!, ...data.voice["02-purser"]!].map((l) => l.text).join(" ")).toBe("AI agents can now spend money. So who signs off? This is Purser, built by Max Geurtsen.");
    const page = read("src/film/premiere.html");
    expect(page).toContain('var h = put(L, E("div", "slam c", S.line), 0, 350);');
    expect(page).toMatch(/var Q = 3\.2;/);
    expect(page).toContain('pathLength: 1 });');
    expect(page).toContain("lockup(L, S.title, 92)");
  });
  it("the Face ID scene is a labelled reconstruction of P-0005's approval sheet, at the real Face ID's time", () => {
    const approved = byEvent("proposal.approved").find((e) => e.subject === "P-0005")!;
    expect(screen("08-faceid")).toMatchObject({ what: screen("08-faceid").what, rows: screen("08-faceid").rows, hash: screen("08-faceid").hash, button: "Confirm with Face ID", approved: "Approved" });
    expect(screen("08-faceid").recon).toBe(`Reconstruction of the approval screen · the real Face ID was at ${approved.ts.slice(11, 19)} UTC (main run)`);
    expect(screen("08-faceid").recon).toBe("Reconstruction of the approval screen · the real Face ID was at 11:31:18 UTC (main run)");
  });

  it("lists a source for every figure a scene uses", () => {
    for (const s of PREMIERE_SCENES) for (const k of factsUsed(s.id)) expect({ scene: s.id, k, source: !!data.facts[k]?.source }).toEqual({ scene: s.id, k, source: true });
  });
});

describe("the premiere refuses to render when a figure is missing", () => {
  const broken: [string, (r: ReturnType<typeof raw>) => void, RegExp][] = [
    ["the purchase let through", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "upstream.let_through"); }, /upstream\.let_through/],
    ["the refusal on chain", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "upstream.refused_on_chain"); }, /refused_on_chain/],
    ["the transfer's PAID", (r) => { r.ledger.events = r.ledger.events.filter((e) => !(e.event === "transfer.status" && e.payload.status === "PAID")); }, /transfer\.status/],
    ["the transfer's SENT", (r) => { r.ledger.events = r.ledger.events.filter((e) => !(e.event === "transfer.status" && e.payload.status === "SENT")); }, /transfer\.status/],
    ["the sandbox settlement by the executor", (r) => { for (const e of r.ledger.events) if (e.event === "transfer.status") e.actor = "someone"; }, /sandbox settlement/],
    ["the Face ID on the licence", (r) => { r.ledger.events = r.ledger.events.filter((e) => !(e.event === "proposal.approved" && e.subject === "P-0005")); }, /proposal\.approved/],
    ["the FX", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "fx.converted"); }, /fx\.converted/],
    ["the dispute", (r) => { r.ledger.disputes = []; }, /dispute case/],
    ["the Support agent's refunds", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "refund.paid"); }, /refund by the Support agent/],
    ["the CFO's rejection", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "proposal.rejected"); }, /proposal\.rejected/],
    ["the agents' statistics", (r) => { r.snapshot.agent_stats = []; }, /agent statistics/],
    ["an agent's model", (r) => { delete r.snapshot.agent_stats[1]!.models; }, /support agent's model/],
    ["an agent with two models", (r) => { r.snapshot.agent_stats[0]!.models = ["claude-haiku-5-5", "claude-opus-5-5"]; }, /Claude model id/],
    ["the agents' descriptions", (r) => { delete r.snapshot.agents; }, /snapshot\.agents/],
    ["a job the record does not say", (r) => { r.snapshot.agents!.find((a) => a.id === "treasury")!.job = "watches spending"; }, /team\.treasuryJob/],
    ["an intact audit chain", (r) => { r.snapshot.audit.intact = false; }, /intact audit chain/],
    ["the ledger", (r) => { delete (r as Partial<MainRun>).ledger; }, /ledger/],
    ["a refund the totals do not add up to", (r) => { r.ledger.disputes[0]!.claims.sale_refs.push(99); }, /do not add up/],
  ];
  for (const [what, breakIt, why] of broken) {
    it(`without ${what}`, () => {
      const r = raw();
      breakIt(r);
      expect(() => buildPremiere(r, README)).toThrow(why);
      expect(() => buildPremiere(r, README)).toThrow(/^premiere: /);
    });
  }

  it("without the README's test line", () => {
    expect(() => buildPremiere(raw(), README.replace(/\*\*\d+ tests in \d+ files, all passing\*\*/, "the tests"))).toThrow(/README has no test line/);
    expect(testLine("**2,181 tests in 241 files, all passing**")).toEqual({ tests: "2181", files: "241" });
  });

  it("builds nothing it cannot fill: the page is made from the data alone", () => {
    const html = premierePage(data, scenesForPage);
    expect(html).not.toContain("__PREMIERE_JSON__");
    const block = /<script type="application\/json" id="premiere-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(block)).toEqual({ screen: data.screen, scenes: scenesForPage, credits: data.credits, background: { ...BACKGROUND, start: 6 } });
  });
});

describe("the premiere's page", () => {
  const template = read("src/film/premiere.html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)![1]!;

  it("types in no figure: no string in its script holds a digit (every figure is in the data)", () => {
    const literals = [...script.replace(/\/\/[^\n]*/g, "").matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!);
    expect(literals.length).toBeGreaterThan(100);
    // Scene ids ("05-price") are names, not figures; so is the canvas API's "2d".
    expect(literals.filter((s) => /\d/.test(s) && s !== "2d" && !PREMIERE_SCENES.some((x) => x.id === s))).toEqual([]);
  });

  it("draws every scene of the script, and nothing else", () => {
    const built = [...script.matchAll(/^ {4}"(\d\d[a-z]?-[a-z0-9-]+)": function/gm)].map((m) => m[1]);
    expect(built).toEqual(PREMIERE_SCENES.map((s) => s.id));
    for (const s of PREMIERE_SCENES) expect({ s: s.id, screen: !!data.screen[s.id] }).toEqual({ s: s.id, screen: true });
  });

  it("shows no logo of others and letterboxes to 2.39:1 inside 1920x1080", () => {
    expect(template).not.toMatch(/<img|logo-|\.png|\.svg"/);
    expect(template).toMatch(/#pic \{[^}]*top: 138px; width: 1920px; height: 804px;/);
    expect(1920 / 804).toBeCloseTo(2.39, 2);
    expect(template).toMatch(/\.bar\.top \{ top: 0; \} \.bar\.bot \{ top: 942px; \}/);
  });
});

describe("the /try/sign mock says what the live page says", () => {
  const page = trySignPage();
  it("word for word, from the page's own code", () => {
    for (const [k, w] of Object.entries(TRY_SIGN_WORDS)) {
      // The film was recorded with the page of 4 November; the story of 7 November (five screens) calls the tamper
      // "Now try to cheat: change one cent". That one word is checked as it is on the page now, the rest as filmed.
      if (k === "tamper") { expect(w).toBe("Try to tamper: change the amount by 0.01"); expect(page).toContain(TRY_SIGN_SCREENS.signed.cheat); continue; }
      // The hash note is two strings on the page ("… which your passkey signs" + " (checked on this device):").
      for (const part of k === "hashNote" ? w.split(/(?= \()/) : [w]) expect({ k, on: page.includes(part) }).toEqual({ k, on: true });
    }
    expect(screen("11-turn").label).toBe(TRY_SIGN_LABEL);
  });

  it("with the page's own proposal and its tamper step: EUR 1,850.00, then EUR 1,850.01", () => {
    const p = FIXED_PROPOSALS.find((x) => x.id === fact("try.proposal"))!;
    const c = checkPayment(p.amount, TEST_BALANCES, TEST_RULES, { rate: { usdPerEur: "1.10", from: "a rate" } });
    expect(c.check).toBe("pass");
    expect(screen("11-turn")).toMatchObject({ says: p.says, waits: c.check === "pass" ? c.waits : "" });
    expect(screen("11-turn").facts).toEqual([["Pay", p.payee], ["Amount", "EUR 1,850.00"], ["Reference", p.reference], ["Proposal", p.id]]);
    expect(screen("12-tamper")).toMatchObject({ from: "EUR 1,850.00", plus: "+0.01", to: "EUR 1,850.01", last: "One cent. Worthless." });
    expect(fact("try.hash")).toMatch(/^[0-9a-f]{64}$/);
    expect(fact("try.tamperedHash")).not.toBe(fact("try.hash"));
  });

  it("points at the live page, the same address as the deck's", () => {
    expect(TRY_SIGN_URL).toBe(`${TRY_URL}/sign`);
    expect(screen("16-end").url).toBe("https://kit11.max-31b.workers.dev/try/sign");
  });
});

describe("the premiere's script", () => {
  it("runs 2:42 (v5), under three minutes: Max's scene lengths, in his order", () => {
    expect(premiereSeconds()).toBeLessThan(180);
    expect(premiereSeconds()).toBe(162);
    expect(timeline.at(-1)!.start + timeline.at(-1)!.seconds).toBe(premiereSeconds());
    expect(timeline.map((s) => [s.id, s.seconds])).toEqual([["01-hook", 6], ["02-purser", 4], ["03-agents", 10], ["04-how", 8], ["05-price", 12], ["05b-treasury", 8], ["06-metal", 8], ["07-dispute", 10], ["08-faceid", 8], ["09-six", 10], ["10-why", 10], ["11-turn", 7], ["12-tamper", 8], ["13-proof", 13], ["13b-value", 4], ["14-real", 10], ["15-close", 13], ["16-end", 13]]);
    // 6 seconds → Why Face ID → Your turn → One cent → the proof → what's real → the close.
    const order = ["09-six", "10-why", "11-turn", "12-tamper", "13-proof", "14-real", "15-close"].map((id) => timeline.findIndex((s) => s.id === id));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    for (const s of timeline) expect({ id: s.id, whole: Number.isInteger(s.start) && Number.isInteger(s.seconds) }).toEqual({ id: s.id, whole: true });
    // The final film is the rendered clips only: no scene waits for a recording (5 November, the AI voice).
    expect(PREMIERE_SCENES.filter((s) => s.kind === "slot" || s.slot).map((s) => s.id)).toEqual([]);
    expect(OVERLAYS).toEqual(["08-faceid", "11-turn"]);
    // "AI-generated" only in the end card's credit for the voice and the music, nowhere else on screen.
    expect(JSON.stringify(data.screen).replace(String(screen("16-end").credit), "")).not.toMatch(/AI-generated|AI hook/);
  });

  it("writes scenes-v5.json for the mix: each scene's id, start and end; 09-six, where the drop goes, at 1:14", () => {
    expect(scenesJson()).toEqual(timeline.map((s) => ({ id: s.id, start: s.start, end: s.start + s.seconds })));
    expect(scenesJson().find((s) => s.id === "09-six")).toEqual({ id: "09-six", start: 74, end: 84 });
    expect(JSON.parse(read("docs/video/scenes-v5.json"))).toEqual(scenesJson());
  });
  it("keeps a second of silence before \"One cent. Worthless.\" and counts the 6 seconds up from 09's cut", () => {
    const [change, worthless] = data.voice["12-tamper"]!;
    expect([change!.text, worthless!.text]).toEqual(["Change one cent, and the same signature is refused.", "One cent. Worthless."]);
    expect(worthless!.at - (change!.at + lineSeconds(change!.text))).toBeCloseTo(1, 5);
    const page = read("src/film/premiere.html");
    // On screen "One cent. Worthless." comes in as it is said.
    expect(page).toMatch(/var flip = t >= 1\.2, W = 5\.1;/);
    expect(worthless!.at).toBe(5.1);
    expect(page).toContain("rise(six, t, 0, null, 40); count(big, t, 0);");
    const s13 = timeline.find((s) => s.id === "13-proof")!;
    expect(s13.beats).toEqual([0, 2.6]);
    expect(pageScenes().find((x) => x.id === "13-proof")!.beats).toEqual(s13.beats);
  });

  it("gives the agent cards at least 9 s together on screen, each lit 3 s in turn (v5)", () => {
    const s3 = /\n {4}"03-agents": function[\s\S]*?\n {4}\},/.exec(read("src/film/premiere.html"))![0];
    const at = /at = \[([^\]]+)\], ON = ([.\d]+)/.exec(s3)!;
    const appear = at[1]!.split(",").map(Number), on = Number(at[2]);
    const scene = timeline.find((s) => s.id === "03-agents")!.seconds;
    expect(scene - appear[0]!).toBeGreaterThanOrEqual(9);
    for (const a of appear) expect(scene - a).toBeGreaterThanOrEqual(8);
    expect(s3).toContain('c.classList.toggle("on", t >= ON + i * 3 && t < ON + (i + 1) * 3);');
    expect(on + 3 * 3).toBeLessThanOrEqual(scene);
  });
  it("records one clip per scene from the page, the end card with the one credit for the AI voice and music", () => {
    const beats = premiereBeats(data);
    expect(beats.map((b) => b.id)).toEqual(PREMIERE_SCENES.map((s) => s.id));
    expect(beats.map((b) => b.shots[0]!.path)).toEqual(timeline.map((s) => `/premiere?manual&from=${s.start}`));
    expect(MASTER_CLIPS).toEqual(PREMIERE_SCENES.map((s) => s.id));
    expect(read("src/film/premiere.html")).not.toMatch(/credits=ai|q\.get\("credits"\)/);
  });

  it("gives each voice-over line time to be said before the next one and inside its scene", () => {
    for (const s of timeline) {
      const lines = data.voice[s.id] ?? [];
      lines.forEach((l, i) => {
        const end = l.at + l.seconds;
        const next = i + 1 < lines.length ? lines[i + 1]!.at : s.seconds;
        expect({ scene: s.id, line: l.text.slice(0, 30), fits: end <= next }).toEqual({ scene: s.id, line: l.text.slice(0, 30), fits: true });
      });
    }
  });

  it("lets the narrator (an AI voice, ElevenLabs) read the whole voice-over, the script word for word, in the third person", () => {
    for (const lines of Object.values(data.voice)) for (const l of lines) expect(l.who).toBe("Narrator (AI voice, ElevenLabs)");
    // Nobody says "I", "my" or "me": the narrator is not Max.
    expect(Object.values(data.voice).flat().map((l) => l.text).join(" ")).not.toMatch(/\b(I'm|my|me)\b|(^|\s)I[\s,]/);
    const script = voiceScript(read("docs/video/narrator-script.md"));
    for (const [id, lines] of Object.entries(data.voice)) expect({ id, said: lines.map((l) => l.text).join(" ") }).toEqual({ id, said: script[id]!.replace(/\s*(?:…\s*)+/g, " ").trim() });
    expect(data.voice["15-close"]!.map((l) => l.text).join(" ")).toBe(CLOSING.join(" "));
    // Each line about half a second into its scene (a long one a little earlier).
    for (const [id, lines] of Object.entries(data.voice)) expect({ id, early: lines[0]!.at <= 0.5 && lines[0]!.at >= (id === "13b-value" || id === "08-faceid" ? 0 : 0.3) }).toEqual({ id, early: true });
  });
  it("times the subtitles in order, inside the film, carrying every word of the voice-over", () => {
    const cues = premiereSrt(data).trim().split(/\n\n/).map((c) => { const [, time, ...text] = c.split("\n"); const [a, b] = time!.split(" --> "); return { a: toSeconds(a!), b: toSeconds(b!), text: text.join(" ") }; });
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i]!.b).toBeGreaterThan(cues[i]!.a);
      if (i) expect(cues[i]!.a).toBeGreaterThanOrEqual(cues[i - 1]!.b);
      expect(cues[i]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
    expect(cues.at(-1)!.b).toBeLessThanOrEqual(premiereSeconds());
    expect(cues.map((c) => c.text).join(" ").split(/\s+/)).toEqual(voiceTimeline(data).map((l) => l.text).join(" ").split(/\s+/));
    // Nothing new is said in the second before "One cent. Worthless.": its cue starts with it.
    const cent = timeline.find((s) => s.id === "12-tamper")!, w = cent.start + data.voice["12-tamper"]![1]!.at;
    expect(cues.filter((c) => c.a > w - 1 && c.a < w - 0.01)).toEqual([]);
    expect(cues.find((c) => c.text === "One cent. Worthless.")!.a).toBeCloseTo(w, 5);
  });
  it("claims nothing the run does not support", () => {
    const words = JSON.stringify(data.screen) + JSON.stringify(data.voice) + premiereTable(data);
    expect(words).not.toMatch(/code decides|certif|0 unsafe|never fails|cannot be broken|guarantee/i);
    // T:0 is not in the film at all (premiere v3), not even as "not live".
    expect(words).not.toMatch(/T:0/);
    // The server checks the signature; it does not prove Face ID (no attestation on /try/sign).
    expect(JSON.stringify(data.voice["11-turn"])).not.toMatch(/proves?|verif(y|ies) (your )?Face ID/i);
    // Who is real and who is ours, as the README says it.
    expect(screen("14-real")).toMatchObject({ real: ["the Airwallex sandbox", "Metal testnet", "Claude", "Face ID"], ours: ["the suppliers", "the customer", "the merchant", "the second approver: a labelled test passkey"] });
    expect(String(screen("07-dispute").kicker)).toContain("a simulated customer");
    expect(String(screen("08-faceid").label)).toMatch(/after the run, on a test proposal \(test money\)/);
  });
});

describe("docs/video/ holds what the code writes", () => {
  // The film no longer shows the test count (13-proof is 24/24 and the stops, 5 November), so the script table does not
  // depend on the README's test line; the film still reads it and refuses to render when its badge disagrees.
  const table = read("docs/video/premiere-script.md");
  const asWritten: PremiereData = buildPremiere(raw(), README, read("docs/video/narrator-script.md"));

  it("premiere-script.md, subtitles-v5.srt and script.md: npm run video -- --docs writes them again", () => {
    expect(table).not.toMatch(/tests = `\d+`/);
    expect(table).toBe(premiereTable(asWritten));
    expect(read("docs/video/subtitles-v5.srt")).toBe(premiereSrt(asWritten));
    expect(read("docs/video/script.md")).toBe(premiereReadAloud(asWritten));
  });

  it("says the film's length and pace as the code has them, and its voice as what it is (5 November, the last round)", () => {
    const words = voiceTimeline(asWritten).reduce((k, l) => k + l.text.split(/\s+/).length, 0);
    const length = clock(premiereSeconds());
    expect([words, length]).toEqual([319, "2:42"]);
    expect(read("docs/claims.md")).toContain(`| Pace | The film is the premiere: ${words} words in ${length} (`);
    expect(README).toContain(`[Film, ${length}](https://youtu.be/jaqO2M2V6NY)`);
    expect(read("docs/submission/checklist-max.md")).toContain(`de film duurt ${length}.`);
    // The voice-over is an AI voice and the music AI-generated, both ElevenLabs; nowhere does Max voice the film.
    const docs = ["docs/video/README.md", "docs/video/narrator-script.md", "docs/video/opnames-max.md", "docs/video-script.md", "docs/requirements-matrix.md", "docs/claims.md",
      "docs/submission/README.md", "docs/submission/release-notes.md", "docs/submission/checklist-max.md", "docs/video/premiere-script.md", "docs/video/script.md"];
    for (const f of docs) expect({ f, max: /Max (records|reads|speaks|voices)\b|his (own )?voice|Max on camera|on Max's voice|\*\*Max:\*\*/i.test(read(f)) }).toEqual({ f, max: false });
    for (const f of ["docs/video/README.md", "docs/video/narrator-script.md", "docs/submission/README.md", "docs/requirements-matrix.md"]) expect({ f, eleven: /AI-generated voice[^.]*ElevenLabs/.test(read(f).replace(/\s+/g, " ")) }).toEqual({ f, eleven: true });
  });

  it("the film itself reads the README's test line as it is now", () => {
    expect(premiereFacts(raw(), README)["specs.tests"]!.value).toBe(testLine(README).tests);
    expect(premiereFacts(raw(), README)["specs.files"]!.value).toBe(testLine(README).files);
  });

  it("names every clip, every slot and the music in the edit guide", () => {
    const guide = read("docs/video/README.md");
    for (const s of PREMIERE_SCENES) expect({ clip: s.id, named: guide.includes(`${s.id}.mp4`) }).toEqual({ clip: s.id, named: true });
    for (const o of OVERLAYS) expect({ overlay: o, named: guide.includes(`overlays/${o}.png`) }).toEqual({ overlay: o, named: true });
    // The guide's times are typed by hand: each row's time is its clip's start in the timeline, and the lengths
    // without the hook and with a 10-second one are the script's.
    const rows = [...guide.matchAll(/^\| (\d:\d\d) \| `(\d\d[a-z]?-[a-z-]+)\.mp4` \|/gm)].map((m) => [m[2], m[1]]);
    expect(rows).toEqual(timeline.map((s) => [s.id, clock(s.start)]));
    expect(guide).toContain(`**Purser in ${clock(premiereSeconds())}**`);
    // No music in this render (v5); the drop goes on 09-six's cut, at the timeline's time.
    const at = (id: string) => clock(timeline.find((s) => s.id === id)!.start);
    expect(guide).toContain(`**The drop goes on the cut to\n\`09-six.mp4\` (${at("09-six")}).**`);
    expect(guide).toMatch(/no music and no audio track/);
    expect(guide).toContain("`scenes-v5.json`");
    expect(guide).not.toMatch(/AI hook|02-hook|without the hook|10-second hook/i);
    expect(guide).toMatch(/unlisted/i);
    expect(guide).not.toMatch(/16-end-ai-voice/);
  });

  it("shows the hashes of the mock's example terms, as the page hashes them: one cent changes all of it", () => {
    const x = trySignExample();
    const h = (t: unknown) => createHash("sha256").update(canonical(t as Parameters<typeof canonical>[0])).digest("hex");
    expect([fact("try.hash"), fact("try.tamperedHash")]).toEqual([h(x.terms), h(x.tampered)]);
    expect({ ...x.tampered, amount: x.terms.amount }).toEqual(x.terms);
    expect([x.terms.amount, x.tampered.amount]).toEqual(["1850.00", "1850.01"]);
  });
});

describe("the premiere's look (Max, 4 November)", () => {
  const template = read("src/film/premiere.html");
  const root = /:root \{([^}]*)\}/.exec(template)![1]!;
  const colour = (name: string) => /#[0-9a-f]{6}/.exec(new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(root)![1]!)![0];
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);

  it("draws a calm background: deep navy, a faint static dot grid, a vignette, a hardly seen drift, from 0:06", () => {
    expect(BACKGROUND).toMatchObject({ base: "#0a1020", grid: 36, dot: 0.07 });
    expect(colour("pic")).toBe(BACKGROUND.base);
    expect(template).toMatch(/<div id="pic"><div id="bg"><div id="dots"><\/div><div id="vig"><\/div><\/div><\/div>/);
    // The page's CSS is the constant's: one dot every grid px, white at dot.
    expect(template).toContain(`radial-gradient(circle, rgba(255,255,255,${String(BACKGROUND.dot).replace(/^0/, "")}) 1.3px, transparent 1.8px); background-size: ${BACKGROUND.grid}px ${BACKGROUND.grid}px;`);
    expect(template).toContain(`rgba(0,0,0,${String(BACKGROUND.vignette).replace(/^0/, "")}) 100%`);
    // No flowing gradient, no grain; the drift is under a pixel a second.
    expect(template).not.toMatch(/<canvas|grain|createRadialGradient|mix-blend-mode/);
    expect(Math.hypot(...BACKGROUND.drift)).toBeLessThan(1);
    expect(pageScenes().find((x) => x.credits)!.start).toBe(6);
  });

  it("keeps every text colour at WCAG AA over the brightest point of the background", () => {
    // The brightest point: a dot, white at `dot` over the base (the vignette only darkens).
    const base = rgb(colour("pic"));
    const brightest = lum(base.map((v) => v + BACKGROUND.dot * (1 - v)));
    for (const name of ["text", "muted", "faint", "accent", "ok", "bad", "wait"]) {
      const ratio = (lum(rgb(colour(name))) + 0.05) / (brightest + 0.05);
      expect({ name, aa: ratio >= 4.5 }).toEqual({ name, aa: true });
    }
  });

  it("shows the corner credits in the top bar, 0:06 to 2:29, quiet (grey, 20 px) and text only (no logos of others)", () => {
    expect(data.credits).toEqual({ left: "Max Geurtsen · Purser", right: "Built on Airwallex · Metal · Claude" });
    const on = pageScenes().filter((x) => x.credits);
    expect([clock(on[0]!.start), clock(on.at(-1)!.start + on.at(-1)!.seconds)]).toEqual(["0:06", "2:29"]);
    expect(pageScenes().filter((x) => !x.credits).map((x) => x.id)).toEqual(["01-hook", "16-end"]);
    const m = /\.credit \{ position: absolute; top: 0; height: 138px; display: flex; align-items: center; font-size: 20px; font-weight: 500; color: rgba\(255,255,255,(\.\d+)\)/.exec(template);
    expect(m).toBeTruthy();
    // White at 40 to 46%: grey on the black bar, and still WCAG AA there.
    const alpha = Number(m![1]);
    expect(alpha).toBeGreaterThanOrEqual(0.4);
    expect(alpha).toBeLessThanOrEqual(0.46);
    expect((lum([alpha, alpha, alpha]) + 0.05) / 0.05).toBeGreaterThanOrEqual(4.5);
    expect(template).toMatch(/#cl \{ left: 64px; \} #cr \{ right: 64px; \}/);
  });

  it("ends with the credits, text only (Max, 5 November): who does what, the thanks, the AI voice and music, test money only", () => {
    const end = timeline.find((s) => s.id === "16-end")!;
    expect(end.seconds).toBe(13);
    expect(END_CREDITS).toEqual([
      ["Built by Max Geurtsen", "Purser: the CFO's limits, Face ID approvals, the agents' tools, the audit log"],
      ["Airwallex", "the agents' cards and card limits, FX, the SWIFT euro payout (sandbox)"],
      ["Metal", "the on-chain mandates and the agents' payments (testnet)"],
      ["Claude by Anthropic", "the three agents' decisions"],
    ]);
    expect(screen("16-end")).toMatchObject({ head: "Who does what", roll: END_CREDITS, thanks: THANKS, credit: AI_CREDIT, last: "Test money only", short: "kit11.max-31b.workers.dev/try/sign" });
    // Each partner's line as the README's "Who does what" says it.
    for (const [who, what] of END_CREDITS.slice(1)) expect({ who, said: read("README.md").includes(who) && read("README.md").includes(what.replace(/ \((sandbox|testnet)\)$/, "")) }).toEqual({ who, said: true });
    // The credits come in at 4.3 s and stay to the end: 8 to 10 seconds on screen.
    expect(template).toContain("var A = [mk, ct, url, ft, mt], out = 3.6, at = 4.3;");
    expect(end.seconds - 4.3).toBeGreaterThanOrEqual(8);
    expect(end.seconds - 4.3).toBeLessThanOrEqual(10);
  });

  it("credits the AI-generated voice and music on the end card and in the edit guide, and never Max's voice", () => {
    expect(screen("16-end").credit).toBe("Voice-over: an AI-generated voice (ElevenLabs) · Music: AI-generated (ElevenLabs)");
    expect(JSON.stringify(screen("16-end"))).not.toMatch(/Voice: Max|Mixkit|Techno Fest/);
    expect(read("docs/video/README.md")).toContain(AI_CREDIT);
  });
});

describe("the premiere's animations (Max, 5 November): pulses, the price chart, count-ups, the camera push-ins", () => {
  const template = read("src/film/premiere.html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)![1]!;
  const scene = (id: string) => new RegExp(`\n {4}"${id}": function[\\s\\S]*?\n {4}\\},`).exec(script)![0];
  // The page's own count-up, run here as the page runs it (its helpers taken from the page's script).
  const part = (re: RegExp) => re.exec(script)![0];
  const counting = new Function("n", "t", "t0", [
    part(/function clamp\(v\) \{[^\n]*\}/), part(/function prog\(t, a, b\) \{[^\n]*\}/), part(/function out3\(p\) \{[^\n]*\}/),
    part(/var COUNT = [.\d]+;/), part(/function count\(n, t, t0\) \{[\s\S]*?\n {2}\}/), "count(n, t, t0); return n.lastChild.textContent;",
  ].join("\n")) as (n: { target: string; lastChild: { textContent: string } }, t: number, t0: number) => string;
  const COUNT = Number(/var COUNT = ([.\d]+);/.exec(script)![1]);

  it("counts each big figure up in under a second, never past it, and rests on exactly the record's string", () => {
    const cards = screen("13-proof").cards as { big?: string }[];
    const bigs = [String(screen("09-six").big), String(screen("06-metal").big), cards[0]!.big!];
    expect(bigs).toEqual(["6", "86", "24/24"]);
    expect(COUNT).toBeLessThan(1);
    for (const big of bigs) {
      const n = { target: big, lastChild: { textContent: "" } };
      const shown = Array.from({ length: 61 }, (_, f) => counting(n, f / 60, 0));
      const first = (s: string) => Number(/\d+/.exec(s)![0]);
      expect({ big, rest: shown.slice(Math.ceil(COUNT * 60)) }).toEqual({ big, rest: Array(61 - Math.ceil(COUNT * 60)).fill(big) });
      for (let f = 1; f < shown.length; f++) expect(first(shown[f]!)).toBeGreaterThanOrEqual(first(shown[f - 1]!));
      expect(Math.max(...shown.map(first))).toBe(first(big));
      // Only the first figure counts ("24/24" counts up to 24 of 24).
      expect(shown.every((s) => s.replace(/^\d+/, "") === big.replace(/^\d+/, ""))).toBe(true);
    }
    expect(scene("09-six")).toContain('counter("mega", S.big)');
    expect(scene("13-proof")).toContain("counter(null, c.big)");
    // The stops are shown as they are, never counted up.
    expect(scene("13-proof")).not.toContain("counter(null, r.big)");
    expect(scene("06-metal")).toContain("counter(null, S.big)");
  });

  it("draws the price as a line across the cap from the record's levels, and Metal's refusal appears as it crosses", () => {
    const s5 = scene("05-price");
    expect(s5).toContain("var from = Number(S.from), to = Number(S.to), capV = Number(S.capValue)");
    expect(s5).toContain("rise(ref, t, TC)");
    // The crossing: the cap's share of the rise, eased (in-out) over the rise; it falls inside the voice's line
    // "… doubled its price, past the mandate's cap.".
    const [r0, r1] = /var R0 = ([.\d]+), R1 = ([.\d]+),/.exec(s5)!.slice(1).map(Number) as [number, number];
    const k = (Number(fact("price.cap")) - Number(fact("price.old"))) / (Number(fact("price.new")) - Number(fact("price.old")));
    const tc = r0 + (r1 - r0) * Math.acos(1 - 2 * k) / Math.PI;
    const line = data.voice["05-price"]!.find((l) => /past the Sourcing agent's cap/.test(l.text))!;
    expect(tc).toBeGreaterThan(line.at);
    expect(tc).toBeLessThan(line.at + lineSeconds(line.text));
  });

  it("sends a light pulse through the diagram and stops a red one at Airwallex or Metal, the boxes unchanged", () => {
    const s4 = scene("04-how");
    expect(s4).toContain('var d = E("div", "node", null, [E("b", null, n.t), E("span", null, n.s)]);');
    expect(s4).toMatch(/var p1 = pulse\(\), p2 = pulse\(\)/);
    // The red pulse stops before the fourth box (index 3: Airwallex or Metal), never reaching the books.
    expect(s4).toContain("Math.min(Math.floor((t - T2) / HOP), 2)");
    expect((screen("04-how").nodes as { t: string }[])[3]!.t).toBe("Airwallex or Metal");
  });

  it("makes the refusal legible (Max, 5 November): where the red pulse stops, the box flashes red and says so, then both fade", () => {
    const s4 = scene("04-how");
    expect(screen("04-how").refusedTag).toBe("Refused at the limit");
    // The red pulse arrives at the end of its third hop; the box flashes red for 0.4 s from then.
    expect(s4).toContain("var ARR = T2 + 2 * HOP + HOP * .9, GONE = ARR + .6;");
    expect(s4).toContain('nodes[3].classList.toggle("bad", t >= ARR && t < ARR + .4);');
    // The pulse and the tag fade out together, within a second of the arrival, before the scene ends.
    expect(s4).toContain("tag.style.opacity = prog(t, ARR, ARR + .2) * (1 - prog(t, GONE, GONE + .4));");
    expect(s4).toContain("prog(p, 0, .2) * (1 - prog(t, GONE, GONE + .4))");
    const at = /at = \[([^\]]+)\]/.exec(s4)![1]!.split(",").map(Number);
    const [t2, hop] = [at[4]! + Number(/T2 = at\[4\] \+ ([.\d]+)/.exec(s4)![1]), Number(/HOP = ([.\d]+)/.exec(s4)![1])];
    const arr = t2 + 2 * hop + hop * 0.9, gone = arr + 0.6 + 0.4;
    expect(gone - arr).toBeLessThanOrEqual(1);
    expect(gone).toBeLessThanOrEqual(timeline.find((s) => s.id === "04-how")!.seconds - 0.4);
    expect(read("src/film/premiere.html")).toMatch(/\.node\.bad \{ border-color: var\(--bad\);/);
  });

  it("ends as the intro began (Max, 5 November): three beats, the closing line in two lines, the intro's wordmark lockup", () => {
    const s15 = scene("15-close");
    expect(screen("15-close")).toMatchObject({ beats: ["A price shock.", "A dispute.", "A euro bill."], title: "Purser", sub: "Starter Kit 11", name: "Max Geurtsen", role: "Purser · Starter Kit 11" });
    expect(screen("15-close").line).toEqual(["Claude decided. Airwallex and Metal held the limits.", "The CFO signed only what went beyond them."]);
    // The spoken closing as short sentences on screen: the same words, but for the "and" before "the CFO signed".
    const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/);
    const spokenWords = words(CLOSING.join(" ")).filter((w, i, all) => !(w === "and" && all[i - 1] === "limits"));
    expect(words([...(screen("15-close").beats as string[]), ...(screen("15-close").line as string[]), "Purser, Starter Kit 11."].join(" "))).toEqual(spokenWords);
    // The intro's lockup, drawn by the same code, and no longer the purple "Purser, Starter Kit 11." line.
    expect(s15).toContain("lock = lockup(wg, S.title, 92)");
    expect(scene("02-purser")).toContain("var lock = lockup(L, S.title, 92);");
    expect(s15).not.toMatch(/hl c acc/);
    // The name card stays lower left; each step comes in after its words begin to be said.
    expect(s15).toContain('put(L, E("div", "lower", null, [E("b", null, S.name), E("span", null, S.role)]), 48, 616);');
    const lines = data.voice["15-close"]!;
    expect(Number(/WORD = ([.\d]+)/.exec(s15)![1])).toBeLessThanOrEqual(lines[2]!.at);
  });

  it("pushes the camera in slowly on the Face ID phone and the one cent only, inside the letterbox", () => {
    const pushes = [...script.matchAll(/\n {4}"([\w-]+)": function[\s\S]*?\n {4}\},/g)].filter((m) => /L\.push = /.test(m[0])).map((m) => m[1]);
    expect(pushes).toEqual(["08-faceid", "12-tamper"]);
    for (const m of script.matchAll(/L\.push = \{ to: ([.\d]+)/g)) { expect(Number(m[1])).toBeGreaterThanOrEqual(1.03); expect(Number(m[1])).toBeLessThanOrEqual(1.05); }
    // The scenes' layers are inside the picture; the bars and the corner credits are outside it, so they never move.
    expect(script).toContain('var L = E("div", "layer"); pic.appendChild(L);');
    expect(template).toMatch(/<div id="stage"><div id="pic">[\s\S]*?<\/div><\/div><\/div><div class="bar top"><\/div><div class="bar bot"><\/div><div class="credit" id="cl">/);
    // A recording laid in keeps still in its frame.
    expect(script).toMatch(/if \(sc\.L\.classList\.contains\("still"\)\) sc\.L\.style\.transform = "";/);
  });
});

describe("optional recordings (unused in the final film), laid in by npm run video -- --slot", () => {
  it("reads --slot with a window, and refuses what cannot work", () => {
    expect(parseSlotArgs(["13-proof", "--slot", "08-faceid=a b.mov@1.5-9", "--slot=11-turn=x.mp4", "--check"])).toEqual({
      slots: [{ id: "08-faceid", file: "a b.mov", from: 1.5, to: 9 }, { id: "11-turn", file: "x.mp4", from: null, to: null }], rest: ["13-proof", "--check"],
    });
    expect(() => parseSlotArgs(["--slot", "05-price=a.mov"])).toThrow(/only 08-faceid and 11-turn/);
    expect(() => parseSlotArgs(["--slot", "08-faceid=a.mov@9-3"])).toThrow(/ends before it starts/);
    expect(() => parseSlotArgs(["--slot"])).toThrow(/needs/);
  });

  it("frames a portrait recording 700 px tall inside the picture, and refuses a landscape one", () => {
    expect(slotBox("11-turn", 9 / 16)).toEqual({ x: 190, y: 190, w: 394, h: 700 });
    expect(slotBox("08-faceid", 886 / 1920)).toEqual({ x: 360, y: 190, w: 324, h: 700 });
    for (const id of ["08-faceid", "11-turn"] as const) { const b = slotBox(id, 9 / 16); expect(b.y >= 138 && b.y + b.h <= 942).toBe(true); }
    expect(() => slotBox("08-faceid", 16 / 9)).toThrow(/portrait/);
  });

  it("plays a longer window faster to fit (and the scene says so), holds a shorter one, rounds the corners", () => {
    expect([slotSpeed(20, 16), slotSpeed(8, 8), slotSpeed(5, 8)]).toEqual([1.25, 1, 1]);
    const f = slotFilter({ box: { x: 190, y: 190, w: 394, h: 700 }, seconds: 16, speed: 1.25, fade: [0.45, 0.5] });
    for (const part of ["setpts=(PTS-STARTPTS)/1.25", "scale=394:700:force_original_aspect_ratio=increase,crop=394:700", "tpad=stop_mode=clone", "alphamerge", "fade=t=out:st=15.500:d=0.5:alpha=1", "overlay=190:190"]) expect(f).toContain(part);
    expect(maskExpr(44)).toMatch(/^255\*not\(lt\(X,44\)\*lt\(Y,44\)\*gt\(hypot/);
    expect(read("src/film/premiere.html")).toContain('"Shown at " + rec.speed + "× speed"');
  });

  it("renders sharp and delivers a clean master: drawn at twice the size, lanczos, x264 slow at CRF 14, no burned-in subtitles", () => {
    const cli = read("src/cli/video.ts");
    expect(cli).toContain("const PREMIERE_SCALE = 2;");
    expect(cli).toContain('"scale=1920:1080:flags=lanczos"');
    expect(cli).toContain('const X264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS)];');
    expect(cli).not.toMatch(/"-preset", "medium"|"-crf", "20"|ass=/);
    // A preview (VIDEO_PREVIEW=1: 1x, x264 veryfast) only when asked; the deliverable is drawn at 2x and encoded slow.
    expect(cli).toContain('const PREVIEW = process.env.VIDEO_PREVIEW === "1";');
    expect(cli).toMatch(/const ENCODE = PREVIEW \? \[[^\n]*\] : X264;/);
    expect(cli).toContain("scale: PREVIEW ? 1 : PREMIERE_SCALE");
    expect(cli).toMatch(/if \(film\) await ffmpeg\(\[[^\n]*master-subtitled\.mp4/);
  });

  it("keeps the honesty labels when a recording is laid in", () => {
    expect(screen("08-faceid")).toMatchObject({ recHead: "Real Face ID.", recLine: "On Max's own iPhone, filmed after the run on a test proposal, with test money.", sub: "In the main run: P-0005 approved with Face ID at 11:31:18 UTC" });
    expect(screen("11-turn")).toMatchObject({ label: TRY_SIGN_LABEL, overlay: "Max's iPhone · the live page" });
  });
});
