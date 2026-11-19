// CodeQL (19 Nov 2026) flagged the UBL root check: a regex over leading comments could backtrack exponentially on
// "<!--" followed by many "--><!--". afterProlog() now skips the declaration and comments by index; these tests hold
// that the same inputs are read the same way and that the hostile one returns at once.
import { describe, expect, it } from "vitest";
import { afterProlog, looksLikeUbl } from "../src/workplace/ubl.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("UBL prolog skip", () => {
  it("skips the XML declaration, whitespace and leading comments", () => {
    expect(afterProlog('<?xml version="1.0"?>\n<!-- a --> <!-- b -->\n<Invoice>')).toBe("<Invoice>");
    expect(looksLikeUbl(enc('﻿<?xml version="1.0"?><!-- x --><ubl:Invoice xmlns:ubl="x">'))).toBe(true);
    expect(looksLikeUbl(enc("<Order>"))).toBe(false);
  });
  it("returns at once on many '--><!--' repetitions (no backtracking)", () => {
    const hostile = "<!--" + "--><!--".repeat(50_000) + "x";
    const t = performance.now();
    expect(looksLikeUbl(enc(hostile))).toBe(false);
    afterProlog(hostile);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("an unterminated comment or declaration is not skipped past", () => {
    expect(afterProlog("<!-- open <Invoice>")).toBe("<!-- open <Invoice>");
    expect(afterProlog("<?xml no end <Invoice>")).toBe("<?xml no end <Invoice>");
  });
});
