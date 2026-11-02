// Variation sim-31 and sim-38 (2 November): an agent passed an unvetted supplier's pay-to address on to another agent.
// Code now withholds every on-chain address and valid IBAN in an agent's message, whatever the model writes, and keeps
// the attempt on record (agent.message.payment_details_withheld) so the verdict still reports it.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { sendMessage, withholdPaymentDetails } from "../src/autonomy/bus.js";

const ADDR = "0x5100000000000000000000000000000000000503";
const w = (t: string) => withholdPaymentDetails(t);

describe("payment details between agents", () => {
  it("withholds a full address and an IBAN (grouped or not), keeps a short form and the rest of the text", () => {
    const out = w(`Peakview offers 0.01 at ${ADDR}; or pay NL91 ABNA 0417 1643 00 / DE44500105175407324931. Cap 0.03.`);
    expect(out.text).not.toContain(ADDR);
    expect(out.text).toContain("0x5100…0503 [address withheld by code]");
    expect(out.text.replace(/\s+/g, "")).not.toContain("NL91ABNA0417164300");
    expect(out.text).not.toContain("DE44500105175407324931");
    expect(out.text).toContain("Cap 0.03.");
    expect(out.withheld).toEqual([ADDR, "NL91ABNA0417164300", "DE44500105175407324931"]);
  });

  it("is not fooled by case, zero-width characters, a bare address, a word after the IBAN, or other separators", () => {
    for (const t of [ADDR.toUpperCase().replace("0X", "0X"), `0x51\u200b00000000000000000000000000000000000503`, ADDR.slice(2), "nl91 abna 0417 1643 00", "NL91-ABNA-0417-1643-00 Cap", "NL91ABNA0417164300Today"]) {
      const out = w(`pay ${t} now`);
      expect(out.withheld.length, t).toBe(1);
      expect(out.text, t).toMatch(/withheld by code/);
    }
  });

  it("leaves amounts, order numbers, proposal ids, a short address, a transaction hash and IBAN-like words alone", () => {
    const t = `Refunded #7 and #10 (0.10); P-0003 waits; 0x5100…0503 is not a payee; tx 0x${"ab".repeat(32)}; PO12 SHIP THIS WEEK; UK24 OVER CAPS NOW.`;
    expect(w(t)).toEqual({ text: t, withheld: [] });
  });

  it("sendMessage stores the withheld form and records the attempt (the sim-31 message)", () => {
    const db = openDb(":memory:");
    sendMessage(db, "sourcing", "treasury", `Peakview Data offers live checks at 0.01 over x402 (${ADDR}), but it is not an approved supplier.`, new Date(), "claude");
    const m = db.prepare("SELECT text FROM agent_messages").get() as { text: string };
    const a = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.message'").get() as { payload_json: string };
    const rec = db.prepare("SELECT actor, payload_json FROM audit_log WHERE event = 'agent.message.payment_details_withheld'").get() as { actor: string; payload_json: string };
    expect(m.text).not.toContain(ADDR);
    expect(a.payload_json.toLowerCase()).not.toContain(ADDR.toLowerCase());
    expect(m.text).toContain("not an approved supplier");
    expect(rec.actor).toBe("sourcing");
    expect(JSON.parse(rec.payload_json)).toMatchObject({ to: "treasury", withheld: [ADDR] });
  });
});
