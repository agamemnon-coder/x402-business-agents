// "Signed by a real person": Alta proves the customer's owner key bound the mandate; it does not prove a person holds
// that key. Purser's optional addition: the customer's owner confirms the mandate with a passkey (user verification,
// e.g. Face ID), and the seller checks that confirmation. Each test breaks if a confirmation counts that should not.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { confirmationChallenge, mandatePasskey, recordMandateConfirmation, registerCustomerPasskey } from "../src/seller/humanProof.js";

const REF = `0x${"2f".repeat(32)}`;
const ORIGIN = "https://summit.example";
const RP = "summit.example";

async function setup() {
  const db = openDb(":memory:");
  const auth = new FakeAuthenticator();
  const reg = await registerCustomerPasskey(db, { label: "Summit Outfitters owner", rpId: RP, origin: ORIGIN, challenge: "Y2hhbGxlbmdl" }, auth.register({ challenge: "Y2hhbGxlbmdl", origin: ORIGIN, rpId: RP }));
  expect(reg.ok).toBe(true);
  return { db, auth };
}

describe("a mandate confirmed with the customer's passkey", () => {
  it("counts when the owner's passkey signed this mandate's challenge with user verification", async () => {
    const { db, auth } = await setup();
    const assertion = auth.sign({ challenge: Buffer.from(confirmationChallenge(REF), "hex").toString("base64url"), origin: ORIGIN, rpId: RP, counter: 1 });
    expect(await recordMandateConfirmation(db, REF, assertion)).toMatchObject({ ok: true });
    expect(mandatePasskey(db)(REF)).toEqual({ label: "Summit Outfitters owner", verified: true });
  });

  it("does not count a signature over another mandate, or without user verification", async () => {
    const { db, auth } = await setup();
    const other = auth.sign({ challenge: Buffer.from(confirmationChallenge(`0x${"aa".repeat(32)}`), "hex").toString("base64url"), origin: ORIGIN, rpId: RP, counter: 1 });
    expect(await recordMandateConfirmation(db, REF, other)).toMatchObject({ ok: false });
    const noUv = auth.sign({ challenge: Buffer.from(confirmationChallenge(REF), "hex").toString("base64url"), origin: ORIGIN, rpId: RP, counter: 2, userVerified: false });
    expect(await recordMandateConfirmation(db, REF, noUv)).toMatchObject({ ok: false });
    expect(mandatePasskey(db)(REF)).toBeNull();
  });

  it("does not count a passkey the seller never registered", async () => {
    const { db } = await setup();
    const stranger = new FakeAuthenticator();
    const a = stranger.sign({ challenge: Buffer.from(confirmationChallenge(REF), "hex").toString("base64url"), origin: ORIGIN, rpId: RP, counter: 1 });
    expect(await recordMandateConfirmation(db, REF, a)).toMatchObject({ ok: false });
  });
});
