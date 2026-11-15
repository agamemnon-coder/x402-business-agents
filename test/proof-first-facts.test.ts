// The three facts that open /proof and /visa (competitive judge panel, 15 Nov): each with one link and its id, every
// value read from its record, never typed in.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { awxRun } from "../src/redesign/awxRun.js";
import { proofFirstFacts, visaFirstFacts, visaLimitsLine } from "../src/redesign/proofFirst.js";
import { proofPage } from "../src/redesign/proof.js";
import { visaPage } from "../src/redesign/partners.js";
import { VIC3_RUN_FILE } from "../src/redesign/vic3Run.js";

const vic = JSON.parse(readFileSync(VIC3_RUN_FILE, "utf8")) as { run: string; budgets: { anthropic: { used: number } }; purchases: { step: string; request: { amount: string }; payment_intent_id: string | null; mandate_id: string | null; outcome: { status: string; code?: string } }[] };

describe("/proof opens with three facts", () => {
  const f = proofFirstFacts();
  it("Airwallex's own decline at the card's limit, Alta's refusal on chain, the offline passkey check: in that order", () => {
    expect(f.map((x) => x.icon)).toEqual(["ban", "link-2", "shield-check"]);
    const t = awxRun()!.card_transactions.find((x) => x.id === f[0]!.id)!;
    expect([t.approved, t.decline_code]).toEqual([false, "LIMIT_EXCEEDED"]);
    expect(f[0]!.head).toBe("Airwallex declined the card: LIMIT_EXCEEDED");
    expect(f[1]!.href).toBe(`https://testnet.metalntwx.com/tx/${f[1]!.id}`);
    expect(f[2]!.text.startsWith("npm run verify-approval:")).toBe(true);
    expect(f[2]!.id).toBe("receipt-P-0002.json");
  });
  it("comes right under the lead line, before anything else", () => {
    const h = proofPage();
    expect(h.indexOf('<ol class="pfirst"')).toBeGreaterThan(h.indexOf('<p class="plead">'));
    expect(h.indexOf('<ol class="pfirst"')).toBeLessThan(h.indexOf('<p class="pwatch">'));
  });
});

describe("/visa leads with the vic-5 run", () => {
  it("its three facts come from the record", () => {
    const f = visaFirstFacts(vic as never, VIC3_RUN_FILE, "#visa-reuse");
    const paid = vic.purchases.find((p) => p.outcome.status === "succeeded")!;
    const reused = vic.purchases.find((p) => p.outcome.code === "PURSER_CREDENTIAL_ALREADY_USED")!;
    const cap = vic.purchases.find((p) => p.outcome.code === "PURSER_ABOVE_HARD_CAP")!;
    expect(f.map((x) => x.id)).toEqual([paid.payment_intent_id, reused.mandate_id, `${vic.run}, step ${cap.step}`]);
    expect(f[0]!.head).toBe(`Paid after Face ID: EUR ${paid.request.amount}`);
    expect(f[2]!.head).toBe(`Over the hard cap: EUR ${cap.request.amount}`);
  });
  it("says in one line what the run is and is not, Claude's calls from the record", () => {
    expect(vic.budgets.anthropic.used).toBe(1);
    expect(visaLimitsLine(vic as never)).toBe("The run of 14 Nov (vic-5): Airi's credential on Airi's test card, not a Visa network token; the Airwallex sandbox, test money. Claude was called once, to choose the rail; Purser's code held the limits.");
    expect(visaPage()).toContain('<ol class="pfirst"');
  });
});
