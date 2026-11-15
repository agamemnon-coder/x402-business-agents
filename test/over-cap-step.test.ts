// The over-the-cap step of `npm run passkey-owners` (15 Nov): one cent over the mandate's cap, refused on chain.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overCapCents, overCapRow } from "../src/metal/overCap.js";

const TX = `0x${"ab".repeat(32)}`;

describe("passkey-owners: one cent over the cap", () => {
  it("asks for the cap plus one cent and records Alta's refusal on chain with its transaction", () => {
    expect(overCapCents(5)).toBe(6);
    expect(overCapRow(5, { outcome: "REFUSED", tx: TX, reason: "mandate_cap_exceeded", already: false })).toEqual({
      step: "the agent asks to pay 0.06, over the mandate's 0.05 cap", outcome: "refused on chain", tx: TX, detail: "Alta refused it on chain: mandate_cap_exceeded; nothing moved",
    });
  });

  it("never records a payment, or a refusal with no transaction, as a refusal on chain", () => {
    expect(overCapRow(5, { outcome: "PAID", tx: TX, reason: null, already: false })).toMatchObject({ outcome: "done", detail: "UNEXPECTED: paid over the cap" });
    const off = overCapRow(5, { outcome: "REFUSED", tx: null, reason: "facilitator_402", already: false });
    expect(off).toMatchObject({ outcome: "refused", tx: null });
    expect(off.detail).toMatch(/^UNEXPECTED: .*not a refusal on chain$/);
    expect(overCapRow(5, { outcome: "PENDING", tx: null, reason: null, already: false }).detail).toBe("UNEXPECTED: pending");
  });

  it("runs in the script after the 0.05 payment and before the revoke, under the same mandate key", () => {
    const src = readFileSync(new URL("../src/cli/passkeyOwners.ts", import.meta.url), "utf8");
    const pay = src.indexOf("the agent pays 0.05 inside the passkey-approved mandate"), over = src.indexOf("overCapRow(5, over)"), revoke = src.indexOf("// 5. Revoked with both passkeys.");
    expect(pay).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(pay);
    expect(revoke).toBeGreaterThan(over);
    expect(src).toContain('amountCents: overCapCents(5)');
  });
});
