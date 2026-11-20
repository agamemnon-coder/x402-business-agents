// The run log of the Alta refusals run (src/proof/altaRefusalsMd.ts): the committed page is exactly what the record
// renders to (so no figure on it is typed by hand), and each part of the page comes from its field: a step not sent
// says so, a refusal shows its reason, a pipe in a field cannot break the table, an empty field is a dash, the note
// and the "refused before sending" sentence appear only when the record has them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { altaRefusalsMarkdown, type AltaRefusalsRecord } from "../src/proof/altaRefusalsMd.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const record = () => JSON.parse(read("docs/runs/2026-11-20-alta-refusals.json")) as AltaRefusalsRecord;

describe("the Alta refusals run log", () => {
  it("is the committed page, written from its record", () => {
    expect(altaRefusalsMarkdown(record())).toBe(read("docs/runs/2026-11-20-alta-refusals.md"));
  });

  it("takes every figure of its result line from the record's summary", () => {
    const r = record();
    const md = altaRefusalsMarkdown(r);
    const s = r.summary;
    expect(md).toContain(`**Result:** ${s.payments_paid} payments paid inside their mandates (${s.paid_total} test USD); ${s.refused_on_chain} of ${s.refusals_sent} refusals sent were refused on chain`);
    expect(md).toContain(`${s.transactions} transactions in all; ${s.unexpected} unexpected.`);
    expect(md.split("\n")[0]).toBe(`# Alta testnet: four more mandate refusals on chain, and one the CLI stops before sending (${r.ran_at.slice(0, 10)})`);
  });

  it("writes a step not sent, a refusal's reason, a pipe escaped and empty fields as dashes", () => {
    const r = record();
    r.note = "A note of the run.";
    r.summary = { ...r.summary, refused_before_sending: 0 };
    r.mandates = [{ mandate: "M9", reference: "ref-9", terms: "cap 1 | budget 2", starts: null, expiry: null, bound: null, revoked: null, spent: null, payments: null }];
    r.steps = [
      { n: 1, mandate: "M9", kind: "pay", step: "pay a | b", outcome: "refused", tx: null, block: null, reason: "MandateRevoked", detail: "" },
      { n: 2, mandate: "M9", kind: "pay", step: "pay", outcome: "paid", tx: `0x${"ab".repeat(32)}`, block: 123, expected: "paid", event: "Pulled", payee_delta: "+0.01", account_delta: "-0.01", detail: "" },
    ];
    const md = altaRefusalsMarkdown(r);
    expect(md).toContain("**Note.** A note of the run.");
    expect(md).not.toContain("refused by the pinned CLI before it signed anything");
    expect(md).toContain("| M9 | cap 1 \\| budget 2 | – | – | – | – | – | `ref-9` |");
    expect(md).toContain("| 1 | M9 | pay a \\| b | refused (MandateRevoked) | – | – | – | – | – | not sent |");
    expect(md).toContain(`| 2 | M9 | pay | paid | paid | Pulled | +0.01 | -0.01 | 123 | [\`0xabababab…abab\`](https://testnet.metalntwx.com/tx/0x${"ab".repeat(32)}) |`);
  });

  it("says how many the CLI refused before sending, when it did", () => {
    const r = record();
    r.summary = { ...r.summary, refused_before_sending: 1 };
    delete r.note;
    const md = altaRefusalsMarkdown(r);
    expect(md).toContain("1 more (a payment signed by another key) was refused by the pinned CLI before it signed anything");
    expect(md).not.toContain("**Note.**");
  });
});
