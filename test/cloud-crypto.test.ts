// The cloud's HMAC check (cloud/src/crypto.ts hmacValid) accepts only the one spelling hmacB64u writes. base64url keeps
// two padding bits in the last character of a 32-byte MAC, so other text can decode to the same bytes; a token checked
// or spent by its text (a consent form's, by its hash) could then be replayed under a second spelling. Breaks if a
// re-spelled, padded or standard-base64 signature is accepted, or the signer's own spelling is not.
import { describe, expect, it } from "vitest";
import { hmacB64u, hmacValid } from "../cloud/src/crypto.js";

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("hmacValid", () => {
  it("accepts the signer's own spelling and refuses every other spelling of the same bytes", async () => {
    for (let i = 0; i < 40; i++) {
      const msg = `message ${i}`, sig = await hmacB64u("k", msg);
      expect(await hmacValid("k", msg, sig)).toBe(true);
      // The last character with a padding bit flipped: the same 32 bytes, other text.
      const respelled = sig.replace(/.$/, (ch) => B64U[B64U.indexOf(ch) ^ 1]!);
      expect(Buffer.from(respelled, "base64url").equals(Buffer.from(sig, "base64url"))).toBe(true);
      expect(await hmacValid("k", msg, respelled)).toBe(false);
      // Padded, or in standard base64.
      expect(await hmacValid("k", msg, `${sig}=`)).toBe(false);
      const std = sig.replace(/-/g, "+").replace(/_/g, "/");
      if (std !== sig) expect(await hmacValid("k", msg, std)).toBe(false);
      // Another message, or another key.
      expect(await hmacValid("k", `${msg}!`, sig)).toBe(false);
      expect(await hmacValid("k2", msg, sig)).toBe(false);
    }
  });
});
