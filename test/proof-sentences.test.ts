// Section D (6 Nov): the proof, one sentence per partner, word for word wherever it appears (the README, Home, the
// form's Description, the deck), from one source (PROOF_SENTENCES in src/config/brand.ts). Every number in a sentence is
// read here from its record, never typed in: breaks when a record changes and a sentence still says the old figure.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROOF_HEADING, PROOF_SENTENCES } from "../src/config/brand.js";
import { cardControlRows, hashTravel } from "../src/redesign/airwallexProof.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { loadRecord, split } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { record } = loadRecord();
const text = (partner: string) => PROOF_SENTENCES.find((p) => p.partner === partner)!.text;
/** Decodes the few entities Home's escaping writes, by plain replacement. */
const decode = (s: string) => s.split("&#39;").join("'").split("&quot;").join('"').split("&amp;").join("&");

describe("the proof, one sentence per partner (section D, 6 Nov)", () => {
  it("has one sentence each for Airwallex, Metal and Claude, each labelled with what is not production", () => {
    expect(PROOF_SENTENCES.map((p) => p.partner)).toEqual(["Airwallex", "Metal", "Claude"]);
    expect(text("Airwallex").startsWith("Airwallex (sandbox): ")).toBe(true);
    expect(text("Metal").startsWith("Metal (testnet): ")).toBe(true);
    // One sentence each: one full stop, at the end.
    for (const p of PROOF_SENTENCES) expect({ p: p.partner, stops: p.text.split(". ").length }).toEqual({ p: p.partner, stops: 1 });
  });

  it("Airwallex: the signed hash is in Airwallex's own record of the EUR 240.00 SWIFT payment; 3 of 3 cards carry the policy", () => {
    const h = hashTravel(record)!;
    expect(h).not.toBeNull();
    expect([h.match, h.carried, h.method, h.transferMethod, h.currency, h.amount]).toEqual([true, h.signed, "passkey", "SWIFT", "EUR", "240.00"]);
    expect(text("Airwallex")).toContain(`the ${h.currency} ${h.amount} ${h.transferMethod} payment`);
    const rows = cardControlRows(record);
    const n = rows.filter((r) => r.match).length;
    expect([n, rows.length]).toEqual([3, 3]);
    // "all 3", not "3 of 3" (13 Nov: no N/N fraction in the submission either), and only because every card matches.
    expect(n).toBe(rows.length);
    expect(text("Airwallex")).toContain(`all ${rows.length} agent cards carry the CFO's policy as Airwallex's own controls`);
  });

  it("Metal: a mandate per agent, 86 payments each its own transaction, #24 refused on chain, the mandates replaced after Face ID", () => {
    const m = metalStory(record);
    expect(m.mandates.map((x) => x.agent)).toEqual(["sourcing", "support", "treasury"]);
    for (const x of m.mandates) expect(x.proof.href).toMatch(/^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/);
    expect(text("Metal")).toContain(`${m.payments.total} payments, each its own transaction`);
    expect(m.payments.total).toBe(86);
    expect(m.refusal).toMatchObject({ seq: "24", code: "mandate_cap_exceeded" });
    expect(text("Metal")).toContain(`purchase #${m.refusal!.seq} refused on chain (${m.refusal!.code})`);
    // Replaced after the CFO's Face ID: P-0002, signed by Max first (four eyes: the second signature is the labelled test passkey).
    expect(m.replace!.proposal).toBe("P-0002");
    expect(m.replace!.signers[0]).toBe("max");
    expect(m.replace!.steps.map((x) => x.agent).sort()).toEqual(["sourcing", "treasury"]);
    expect(m.replace!.signers[1]).toBe("test-controller");
    expect(text("Metal")).toContain("the mandates replaced on chain by the owner key after the CFO's Face ID in Purser (four eyes; second approver a labelled test passkey)");
  });

  it("Claude: 24 of 24, 0 fallbacks; the reliability run's fault and its fix, 6/10 before and 10/10 after", () => {
    const sp = split(record);
    expect(sp.byClaude).toBe(sp.decisions); // all of them by Claude, so the sentence says "all" (13 Nov, judge run: no fraction)
    expect(text("Claude")).toContain(`all ${sp.decisions} decisions in the main run by Claude, ${sp.fallbacks} fallbacks`);
    expect([sp.byClaude, sp.decisions, sp.fallbacks]).toEqual([24, 24, 0]);
    // rel-1 did not pass, at the card raise; its record says why.
    const rel = JSON.parse(read("docs/demo/reliability.json")) as { run: string; passed: boolean; stopped_at: string | null }[];
    expect(rel.find((r) => r.run === "rel-1")).toMatchObject({ passed: false, stopped_at: "20 TAP card purchase in this world" });
    const log = read("docs/runs/reliability-2026-11.md").replace(/\s+/g, " ");
    expect(log).toContain("| `treasury-card-raise` | Opus | Treasury's wake on Sourcing's message | 6/10 before the fix.");
    expect(log).toContain("After the fix, `treasury-card-raise` passed **10/10**");
    // The 10/10 after, in the eval record itself.
    const evals = JSON.parse(read("docs/evals/agents.json")) as { rows: { case: string; model: string; passed: number; runs: number }[] };
    expect(evals.rows.filter((r) => r.case === "treasury-card-raise").map((r) => [r.model, r.passed, r.runs])).toEqual([["claude-opus-5-5", 10, 10]]);
    // Each number where it belongs: 6/10 → 10/10 is the eval rebuilt from rel-1's moment, before and after the fix
    // (commit 856cb64); "passed every step" is rel-1b, on code with the fix (c231196).
    // Since 13 Nov (judge run) no pass-rate fraction in the sentence: the eval record above holds the 10 of 10.
    expect(text("Claude")).toContain("a reliability run (rel-1) found a fault in how the agents hand off a card raise, and after the fix the eval rebuilt from that moment now passes every run, and the next run (rel-1b) passed every step");
    expect(rel.find((r) => r.run === "rel-1b")).toMatchObject({ passed: true, stopped_at: null });
    expect(log).toContain("The fix** is commit 856cb64");
    expect(log).toContain("**Code:** c231196, which includes the fix.");
    expect(log).toContain("**Every step, every check and every acceptance row passed.**");
  });

  it("is word for word in the deck: Airwallex and Metal on their own slides, Claude on the agents' slide", () => {
    const slides = deckHtml(packFacts(), new Proxy({}, { get: () => "" }) as DeckShots, "").split("<section").slice(1).map(decode);
    expect(slides[5]).toContain(text("Airwallex"));
    expect(slides[6]).toContain(text("Metal"));
    expect(slides[7]).toContain(text("Claude"));
  });

  it("is word for word in docs/in-depth.md (the README's sections, moved there on 12 Nov) and the form's Description; Home no longer carries it (Max, 7 Nov)", () => {
    const readme = read("docs/in-depth.md");
    expect(read("README.md")).toContain("](docs/in-depth.md)");
    const home = decode(buildPages().home!);
    const form = read("docs/submission/README.md");
    const desc = form.slice(form.indexOf("<!-- description -->"), form.indexOf("<!-- /description -->"));
    expect(readme).toContain(`## ${PROOF_HEADING}`);
    expect(home).not.toContain(PROOF_HEADING);
    for (const p of PROOF_SENTENCES) {
      for (const [where, body] of [["docs/in-depth.md", readme], ["form", desc]] as const) expect({ where, p: p.partner, has: body.includes(p.text) }).toEqual({ where, p: p.partner, has: true });
      // Each partner's place on /proof, where the sentences point.
      expect(buildPages().proof!).toContain(`id="${p.anchor}"`);
    }
  });
});
