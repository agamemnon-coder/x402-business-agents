// Variation sim-31 and sim-38 (2 November): an agent passed an unvetted supplier's pay-to address on to another agent.
// Code now withholds every full address and IBAN in an agent's message, whatever the model writes.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { sendMessage, withholdPaymentDetails } from "../src/autonomy/bus.js";

const ADDR = "0x5100000000000000000000000000000000000503";

describe("payment details between agents", () => {
  it("withholds a full address and an IBAN (grouped or not), keeps a short form and the rest of the text", () => {
    const out = withholdPaymentDetails(`Peakview offers 0.01 at ${ADDR}; or pay NL91 ABNA 0417 1643 00 / DE44500105175407324931. Cap 0.03.`);
    expect(out).not.toContain(ADDR);
    expect(out).toContain("0x5100…0503 [address withheld by code]");
    expect(out.replace(/\s+/g, "")).not.toContain("NL91ABNA0417164300");
    expect(out).not.toContain("DE44500105175407324931");
    expect(out).toContain("Cap 0.03.");
  });

  it("leaves amounts, order numbers, proposal ids and a short address alone", () => {
    const t = "Refunded #7 and #10 (0.10); P-0003 waits; Stockline 0.04 over the 0.03 cap; 0x5100…0503 is not a payee.";
    expect(withholdPaymentDetails(t)).toBe(t);
  });

  it("sendMessage stores the withheld form, in the message and in the audit row (the sim-31 message)", () => {
    const db = openDb(":memory:");
    sendMessage(db, "sourcing", "treasury", `Peakview Data offers live checks at 0.01 over x402 (${ADDR}), but it is not an approved supplier.`, new Date(), "claude");
    const m = db.prepare("SELECT text FROM agent_messages").get() as { text: string };
    const a = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.message'").get() as { payload_json: string };
    expect(m.text).not.toContain(ADDR);
    expect(a.payload_json.toLowerCase()).not.toContain(ADDR.toLowerCase());
    expect(m.text).toContain("not an approved supplier");
  });
});
