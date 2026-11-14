// /metal links every Alta transaction of the main run, one by one (review 9 Nov), in a list made from the trace the
// tests hold to the record, and says on the replace card who signs on chain and who the second approver was.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metalStory } from "../src/redesign/metalStory.js";
import { METAL_TX_LIST, metalPage, metalTxList, metalTxs } from "../src/redesign/partners.js";
import { agentRun, payments } from "../src/redesign/run.js";

describe("/metal, one by one", () => {
  const run = agentRun();
  const page = metalPage(run);
  it("lists as many distinct transactions as the page's headline counts, each a link to Alta's explorer, in the committed list", () => {
    const txs = metalTxs();
    expect(txs.length).toBe(metalStory(run.record).payments.total);
    expect(txs.length).toBe(payments(run.record).onChain);
    expect(new Set(txs.map((t) => t.tx)).size).toBe(txs.length);
    const doc = readFileSync(new URL(`../${METAL_TX_LIST}`, import.meta.url), "utf8");
    expect(doc).toBe(metalTxList());
    for (const t of txs) expect(doc).toContain(`(https://testnet.metalntwx.com/tx/${t.tx})`);
    expect(page).toContain(`All ${txs.length} transactions`);
    expect(page).toContain(`blob/main/${METAL_TX_LIST}`);
  });
  it("says who signed the replace on chain and names the second approver plainly", () => {
    // Jury panel, 12 Nov: the sentence matches the transactions: one owner key held by the runner signed them.
    // Since the redesign (13 Nov) the replace is three steps: Face ID in Purser, then the new mandates on chain.
    const p = page.replace(/&#39;/g, "'");
    expect(p).toContain("P-0002: the CFO's Face ID and a test passkey approved it in Purser.");
    expect(p).toContain("One owner key, held by Purser's runner, signed on chain. The chain did not check Face ID.");
  });
});
