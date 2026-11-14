// Security scan, 14 Nov: a 429 tells the caller when to come back; other errors do not carry the header.
import { describe, expect, it } from "vitest";
import { err } from "../cloud/src/app.js";
import { adminPageHeaders } from "../cloud/src/try/adminPage.js";

describe("error responses and the admin page's headers", () => {
  it("a 429 carries retry-after: 60, a 400 does not", () => {
    expect(err(429, "slow down").headers.get("retry-after")).toBe("60");
    expect(err(400, "bad").headers.get("retry-after")).toBeNull();
  });
  it("the admin token page has HSTS, no framing and the same permissions policy as the other pages", () => {
    const h = adminPageHeaders("n");
    expect(h["strict-transport-security"]).toContain("max-age=31536000");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["permissions-policy"]).toContain("payment=()");
  });
});
