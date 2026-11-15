import { describe, expect, it } from "vitest";
import { mdCell, pageText } from "../src/cli/verifyAllFormat.js";

describe("verify-all's text helpers", () => {
  it("decode an entity once: &amp; last, so &amp;quot; stays &quot;", () => {
    expect(pageText("a &amp;quot; b")).toBe("a &quot; b");
    expect(pageText("<p>x &quot;y&quot; &#39;z&#39; &amp; w</p>")).toBe(" x \"y\" 'z' & w ");
  });
  it("escape a table cell's backslash before its pipe", () => {
    expect(mdCell("a \\| b")).toBe("a \\\\\\| b");
    expect(mdCell("a | b\nc")).toBe("a \\| b c");
  });
});
