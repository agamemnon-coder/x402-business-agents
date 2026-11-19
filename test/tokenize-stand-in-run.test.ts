// The invoice token's whole flow on the in-memory chain, in this process (src/tokenize/standInRun.ts; the CLI runs the
// same function in a child process, which coverage in the test process does not see): mint, finance at a discount,
// settle, verify against the ledger and the document, then the five refusals, each by its own reason.
import { describe, expect, it } from "vitest";
import { standInRun } from "../src/tokenize/standInRun.js";

describe("npm run tokenize -- stand-in, in process", () => {
  it("finances at the discount, settles to the holder, matches the ledger and refuses each of the five", async () => {
    const lines: string[] = [];
    const ok = await standInRun((l) => lines.push(l), { debtor: "Northwind Outdoor", divisor: 100, discountBps: 250 });
    const text = lines.join("\n");
    expect(ok, text).toBe(true);
    expect(text).toMatch(/^IN-MEMORY CHAIN \(ethereumjs, chain id \d+\)/);
    expect(text).toMatch(/approved by passkey/);
    expect(text).toMatch(/\(2\.5% discount\): the creditor received .*; holder is now the financier: true/);
    expect(text).toMatch(/SETTLE {3}the holder \(financier\) received .*; token burned/);
    expect(text).toContain("VERIFY   the chain record matches the ledger and the document");
    expect(text).toContain("REFUSED  settle a second time: AlreadySettled");
    expect(text).toContain("REFUSED  mint the same invoice again: AlreadyTokenized");
    expect(text).toContain("REFUSED  mint by a key that is not Purser's issuer: NotIssuer");
    expect(text).toMatch(/REFUSED {2}mint an invoice nobody approved with a passkey: not tokenized/);
    expect(text).toMatch(/REFUSED {2}mint from a changed document: not tokenized/);
    expect(text).not.toContain("NOT REFUSED");
    expect(text).toMatch(/STAND-IN OK: \d+ RPC requests on the in-memory chain/);
  }, 180_000);
});
