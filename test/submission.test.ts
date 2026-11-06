// The submission pack (awards item 6): the form text must fit the form and say what the recorded files say.
// Breaks when a re-recording, a red-team rerun or a Lab rerun changes a figure that the form text still states.
// Since 5 Nov (Max) the form's Description is short (under 4,000 characters); the long text it replaced is
// docs/submission/long-description.md, linked from it, and checked here figure by figure as before.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packFacts } from "../src/submission/facts.js";
import { T0_STATUS, stopsLine } from "../src/submission/deck.js";
import { CAVEAT_LINE, CHAIN_TEST, DIFFERENTIATORS, KIT11_RUN_LINE } from "../src/config/brand.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const raw = read("docs/submission/README.md");
const longRaw = read("docs/submission/long-description.md");
// Markdown wraps lines; the form shows one paragraph, so the checks read it with whitespace collapsed.
const collapse = (t: string) => t.replace(/[ \t]*\n[ \t]*(?![#\n-]|\d+\.)/g, " ");
const pack = collapse(raw);
const long = collapse(longRaw);
/** The form's Description, as Max pastes it: the text between its markers. */
const description = raw.split("<!-- description -->")[1]!.split("<!-- /description -->")[0]!.trim();
const RECORD = read("docs/demo/main-run.json");
const f = packFacts();
const eur = (v: string) => `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe("the submission pack", () => {
  it("has a synopsis of at most 500 characters", () => {
    const synopsis = raw.split("<!-- synopsis -->")[1]!.split("<!-- /synopsis -->")[0]!.trim();
    expect(synopsis.length).toBeGreaterThan(200);
    expect(synopsis.length).toBeLessThanOrEqual(500);
  });

  it("explains Metal and Airwallex under their own headings, in the long text", () => {
    expect(longRaw).toMatch(/^### How we use Airwallex$/m);
    expect(longRaw).toMatch(/^### How we use Metal$/m);
  });

  it("no longer heads with the 30 October run's figures; the card story and the stops are the main run's (Max, 4 Nov)", () => {
    for (const t of [pack, long]) {
      expect(t).not.toContain(`From ${f.run}:`);
      expect(t).not.toContain(`${f.stopped} stops by the card, the chain, the fraud checks or the CFO`);
      expect(t).not.toContain(`${eur(f.kept_out_eur)} kept out for good`);
      expect(t).not.toMatch(/in the recorded run it declined/);
      // Max, 5 Nov (review round): who stopped what, in words, with the main run's counts.
      expect(t).toContain(f.main.stop_line);
      expect(f.main.stop_line).toBe(stopsLine(f.main.stops));
    }
    // The separate TAP run's decline: in the long text, not in the form (jury review, 6 Nov, #7: TAP off the form).
    expect(long).toContain(f.main.tap_limit_line);
    expect(pack).not.toContain(f.main.tap_limit_line);
    const c = f.main.card_raise;
    expect(c).toEqual({ proposal: "P-0006", from: "30.00", to: "46.00", auth: "01a1a12f-4113-7000-b76d-014677710007", amount: "45.00" });
    expect(long).toContain(`asked for a card raise first (${c.proposal}, EUR ${c.from} → ${c.to})`);
    expect(long).toContain(`approved the TAP-signed EUR ${c.amount} purchase (authorization \`${c.auth}\`)`);
  });

  it("tells only the main run up front; every other run under one dated heading (jury review, 4 Nov)", () => {
    const m = f.main;
    for (const t of [pack, long]) {
      // The dispute, one text (the same on Home and in the README).
      expect(t).toContain(`A simulated customer disputes ${m.disputed} orders, saying its agent never placed them.`);
      expect(t).toContain(`"Refund the other ${m.disputed - m.refunded.length}" goes to the CFO, who rejects it with Face ID.`);
      // The licence, the main run's: not the 30 October €1,850 invoice.
      expect(t).toContain(`${m.fx_buy} bought by FX for ${m.fx_sell}`);
      expect(t).toContain(`transfer \`${m.licence_transfer}\``);
      expect(t).not.toMatch(/1,850|418\.40|370\.00|13\.41|recorded run, 30 October|\$0\.093/);
      expect(t).not.toMatch(/Track 1|Adaptive Treasury Controller/);
      expect(t).toContain("Starter Kit 11 (x402 Business Agents)");
    }
    // The mandates as bound and after the CFO's Face ID.
    expect(m.kit11.map((k) => `${k.bound}→${k.now}`)).toEqual(["10.00→14.00", "4.00→4.00", "6.00→2.00"]);
    expect(long).toContain("Sourcing 10.00 → 14.00 (cap 0.03 → 0.04 a purchase); Support 4.00 (cap 0.10); Treasury 6.00 → 2.00");
    // One payment breakdown, the site's own; 14 queries that got an error, counted.
    // One canonical set (jury review, 6 Nov, #5): no 87 beside the 86.
    for (const t of [pack, long]) {
      expect(t).toContain("86 Metal payments + 1 card charge, all inside the limits");
      expect(t).not.toMatch(/87 inside the limits/);
    }
    expect(long).toContain("14 queries got an error and were not charged");
    expect(long.indexOf("### Other live tests (separate worlds, dated)")).toBeGreaterThan(long.indexOf("### Proof from the main run (3 November)"));
    // The short Description has no other run's figures: only the TAP run's decline, on its labelled line.
    expect(description).not.toMatch(/30 October|31 October|Other live tests|red team|Scenario Lab/i);
  });

  it("opens the synopsis with the three sentences, then the Kit 11 line (jury review, 6 Nov), and says the Visa paragraph once, with TAP's status as one note (Metal Award only)", () => {
    const synopsis = raw.split("<!-- synopsis -->")[1]!.split("<!-- /synopsis -->")[0]!.trim();
    expect(synopsis).toBe(`${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE}`);
    for (const t of [pack, long]) {
      expect(t.match(/Trusted Agent Protocol/g)).toHaveLength(1);
      // Visa, 5 Nov: TAP is not eligible Visa tooling for this hackathon; Max's wording, once, and the entry is Metal only.
      expect(t.match(/built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon \(Visa, 5 Nov\)/g)).toHaveLength(1);
      expect(t).not.toMatch(/still being confirmed with Visa|entered for[^.]{0,40}Visa Award|\+ Visa Award/i);
      expect(t).toContain("Starter Kit 11 (x402 Business Agents), entered for the Metal Award");
      expect(t).not.toMatch(/open[- ]source/i);
    }
  });

  it("states the main run's figures as its record has them (3 November)", () => {
    const m = f.main;
    expect([m.by_claude, m.decisions, m.fallbacks, m.claude_calls, m.claude_usd]).toEqual([24, 24, 0, 50, "0.3170"]);
    // The short Description.
    expect(pack).toContain(`${m.by_claude} of ${m.decisions} decisions by Claude, ${m.fallbacks} fallbacks; ${m.face_id} decisions signed with Face ID (+1 co-signature)`);
    expect(pack).toContain(`two options ${m.to_options_s} s after the refusal`);
    // The caveats in one line in the form, the second approver in full in the long text (jury review, 6 Nov, #7).
    expect(pack).toContain(CAVEAT_LINE);
    expect(long).toContain("in production the second approver is a second person");
    // The let-through framed as the test it was, both layers (jury review, 6 Nov, #8).
    for (const t of [pack, long]) expect(t).toContain(CHAIN_TEST);
    expect(pack).toContain(`${CHAIN_TEST} That was purchase #24; the refusal is recorded on chain`);
    for (const t of [pack, long]) {
      expect(t).toContain(`PAID ${m.face_to_paid_s} s after Face ID`);
      expect(t).toContain(`tx \`${m.let_through_tx.slice(0, 10)}…${m.let_through_tx.slice(-4)}\``);
    }
    // The long text.
    expect(long).toContain(`made ${m.decisions} decisions, all by Claude, ${m.fallbacks} fallbacks, in ${m.claude_calls} calls`);
    expect(long).toContain(`USD ${m.claude_usd} at list prices`);
    expect(long).toContain(`Treasury's options ${m.to_options_s} s after the refusal`);
    expect(long).toContain(`${m.fx_buy} bought by FX for the shortfall`);
    expect(long).toContain(`fee ${m.licence_fee}`);
    expect(long).toContain(`${m.face_id} decisions signed with Face ID by the CFO`);
    expect(long).toContain("Second approver: a labelled test passkey in this demo. In production this is a second person.");
    expect(long).toContain("Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved");
  });

  it("states the red team and the Lab as their reports have them, never counting inconclusive as stopped", () => {
    const rt = f.redteam;
    expect(long).toContain(`${rt.attempts - rt.documents} scripted attacks plus ${rt.documents} documents written by Claude Opus`);
    // Final review, 4 Nov: not "39 of 39 attacks failed": 2 of them were only detected afterwards (stand-ins).
    expect(long).toContain(`${rt.before} of ${rt.attempts} stopped, ${rt.after} detected afterwards, not prevented`);
    expect(long).toContain(`by \`npm run verify\`), ${rt.inconclusive} inconclusive`);
    for (const t of [pack, long]) expect(t).not.toContain(`${rt.failed} of ${rt.attempts} attacks failed`);
    expect(rt.before + rt.after + rt.inconclusive).toBeLessThanOrEqual(rt.attempts);
    expect(long).toContain(`Scenario Lab: ${f.lab.passed} of ${f.lab.total} stories as expected`);
  });

  it("does not claim what was not shown live", () => {
    expect(long).toMatch(/Payout and conversion events are subscribed but were not caused live/);
    expect(long).toMatch(/tested against\s+stand-ins, not yet run live/);
    for (const t of [pack, long]) {
      expect(t).not.toMatch(/\bblocked\b/i);
      expect(t).not.toMatch(/production-ready|guarantee|bank-grade|fully compliant/i);
    }
  });
});

describe("the short Description (Max, 5 Nov)", () => {
  // As read: Markdown bold gone, white space single.
  const flat = description.replace(/\*\*/g, "").replace(/\s+/g, " ");

  it("stays under 4,000 characters, and the count the README states is its own", () => {
    expect(description.length).toBeLessThan(4000);
    expect(description.length).toBeGreaterThanOrEqual(3000);
    const stated = /Characters: \*\*([\d,]+)\*\*/.exec(raw);
    expect(Number(stated?.[1]?.replace(/,/g, ""))).toBe(description.length);
  });

  it("goes the three sentences, the Kit 11 line, story, one caveat line, proof, real, links, with Max's lines word for word (jury review, 6 Nov)", () => {
    const at = (s: string) => { const i = flat.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i; };
    // The three sentences first, word for word.
    expect(flat.startsWith(DIFFERENTIATORS[0])).toBe(true);
    const order = [...DIFFERENTIATORS.map(at), at(KIT11_RUN_LINE), at("A supplier doubles its price."), at(`${CAVEAT_LINE} Details →`), at("Proof: the main run (3 November, world `main-1`)."), at("1. The price rise."), at("2. The dispute."), at("3. The euro bill."),
      at(f.main.stop_line), at("Who does what."), at("What is real."), at("Links.")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const line of ["Max's passkey (Face ID on his phone)", "Max plays the CFO", "Metal tx: on chain, checkable.", "Airwallex ids: published on /proof."]) at(line);
    // The caveats are one line plus a link: no T:0 error codes, no Visa TAP, no TAP run in the form's Description (they
    // stay in the long text and the claims).
    expect(flat).not.toMatch(/CAPI\d+|T:0|Visa|TAP/);
    expect(flat).toContain("Details → https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md#what-is-real-and-what-is-simulated");
    expect(long).toContain(T0_STATUS);
    expect(longRaw).toMatch(/^### What is real and what is simulated$/m);
    // Who does what (Max, 5 Nov): what Max built, and what each partner provides, in words, no logos.
    expect(flat).toContain("Who does what. Max Geurtsen built Purser (limits, approvals, agent tools, site, audit log, books, tests). Airwallex: cards and limits, FX, SWIFT. Metal: mandates, payments. Claude: the agents' decisions.");
  });

  it("links the site, /try/sign, /watch, /proof, the repo, the offline judge and the long text", () => {
    for (const l of ["https://kit11.max-31b.workers.dev/", "https://kit11.max-31b.workers.dev/try/sign", "https://kit11.max-31b.workers.dev/watch", "https://kit11.max-31b.workers.dev/proof",
      "https://github.com/agamemnon-coder/x402-business-agents", "`npm ci && npm run judge`", "https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md"]) expect(flat).toContain(l);
  });

  it("names only ids the main run's record holds", () => {
    const ids = [...flat.matchAll(/P-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|0x[0-9a-f]{8}(?=…)/g)].map((m) => m[0]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) expect({ id, inRecord: RECORD.includes(id) }).toEqual({ id, inRecord: true });
    // The refunded orders, as the record has them.
    expect(flat).toContain(`Refunds #${f.main.refunded.slice(0, -1).join(", #")} and #${f.main.refunded.at(-1)}, each on chain`);
  });

  it("claims no status and nothing absolute", () => {
    expect(flat).not.toMatch(/code decides|shortlisted|finalist|certified|guarantee|unhackable|bank-grade|\bsafe\b|\bsecure\b|cannot be|never fails/i);
  });
});
