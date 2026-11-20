// The figure trace's own HTML reader and record checks (src/proof/figureTrace.ts), on small pages: comments, doctype and
// processing instructions skipped, script and style bodies never read as text, attributes quoted, unquoted, unterminated
// or bare, a stray closing tag ignored; a link that is a record only on an allowed https host or to a file this
// repository holds; and where in a record a figure is found.
import { describe, expect, it } from "vitest";
import { fieldOf, figures, foundIn, gap, hrefIsRecord, recordText, recordsOf, textNodes, valueGap } from "../src/proof/figureTrace.js";

const REPO = "https://github.com/agamemnon-coder/x402-business-agents/";

describe("the figure trace's HTML reader", () => {
  it("skips comments, the doctype, processing instructions and script or style bodies", () => {
    const html = `<!doctype html><?xml version="1.0"?><!-- 123 --><p>one 1</p><script>var x = "<p>2</p>";</script><style>p{width:3px}</style><p>four 4</p>`;
    expect(textNodes(html).map((n) => n.text)).toEqual(["one 1", "four 4"]);
    expect(textNodes("<p>a</p><!-- never closed 5").map((n) => n.text)).toEqual(["a"]);
    expect(textNodes("<p>b</p><script>never closed 6").map((n) => n.text)).toEqual(["b"]);
  });

  it("reads quoted, unquoted, unterminated and bare attributes, and decodes entities", () => {
    const [n] = textNodes(`<div id=main-1 data-rec='docs/a.json' hidden title="a &amp; b &#65;&nbsp;&quot;&#39;&lt;&gt;"><span class="x">7</span></div>`);
    expect(n!.stack.map((e) => e.tag)).toEqual(["div", "span"]);
    expect(n!.stack[0]!.attrs).toEqual({ id: "main-1", "data-rec": "docs/a.json", hidden: "", title: "a & b A \"'<>" });
    const [u] = textNodes(`<a href="docs/x.json>8`);
    expect(u).toBeUndefined();
    expect(textNodes(`<b title='unterminated>9</b>`)).toEqual([]);
  });

  it("ignores a closing tag that closes nothing, self-closing and void elements, and a tag with no name", () => {
    const nodes = textNodes(`<main></span><br><img src=x /><svg><path d="M0"/></svg><p>10</p></main>< 11>12`);
    expect(nodes.map((n) => [n.text, n.stack.map((e) => e.tag).join(">")])).toEqual([["10", "main>p"], ["12", ""]]);
  });

  it("finds figures inside <main> only, with the records and links around them", () => {
    const html = `<header><p>outside 12</p></header><main id="m"><section id="s" data-rec="docs/a.json docs/b.json"><a href="${REPO}blob/main/README.md">13 tests</a></section></main>`;
    const f = figures(html);
    expect(f).toEqual([{ token: "13", text: "13 tests", recs: ["docs/a.json", "docs/b.json"], hrefs: [`${REPO}blob/main/README.md`], where: "m>s" }]);
    // No <main>: the whole fragment; names that only look like figures are skipped.
    expect(figures("<p>SHA-256 over 1,850.00 and x402</p>").map((x) => x.token)).toEqual(["1,850.00"]);
  });
});

describe("records a figure names", () => {
  it("a link is a record on an allowed https host, or a file this repository holds", () => {
    expect(hrefIsRecord("https://www.airwallex.com/docs")).toBe(true);
    expect(hrefIsRecord("http://airwallex.com/docs")).toBe(false);
    expect(hrefIsRecord("https://example.com/")).toBe(false);
    expect(hrefIsRecord("not a url")).toBe(false);
    expect(hrefIsRecord(`${REPO}blob/main/README.md`)).toBe(true);
    expect(hrefIsRecord(`${REPO}blob/main/no/such/file.json`)).toBe(false);
    expect(hrefIsRecord(`${REPO}pulls`)).toBe(true);
  });

  it("names why a figure is not traced", () => {
    const f = { token: "14", text: "14", where: "" };
    expect(gap({ ...f, recs: ["docs/nope.json"], hrefs: [] })).toBe("data-rec names a file that is not in the repository: docs/nope.json");
    expect(gap({ ...f, recs: ["README.md"], hrefs: [] })).toBeNull();
    expect(gap({ ...f, recs: [], hrefs: ["https://example.com/"] })).toBe("links only to https://example.com/, not a record");
    expect(gap({ ...f, recs: [], hrefs: [] })).toBe("no record (no data-rec, no link to one)");
    expect(recordsOf({ ...f, recs: ["README.md#x"], hrefs: [`${REPO}tree/main/docs/runs`, "https://airwallex.com/"] })).toEqual(["README.md", "docs/runs"]);
  });

  it("a folder or a missing file reads as empty text; a figure in none of its records is a value gap", () => {
    expect(recordText("docs/runs")).toBe("");
    expect(recordText("docs/no-such-file.json")).toBe("");
    expect(valueGap({ token: "123456789", text: "", recs: ["docs/no-such-file.json"], hrefs: [], where: "" })).toBe("number 123456789 is in none of its records (docs/no-such-file.json)");
    expect(valueGap({ token: "tests", text: "", recs: [], hrefs: [], where: "" })).toBeNull();
  });

  it("where in a record a figure is: a line of a text record, a path in a JSON one, nothing in a file that is not JSON", () => {
    const d = { kind: "number" as const, parts: ["2147483647"] };
    expect(fieldOf(d, "docs/no-such-file.json")).toBeNull();
    expect(fieldOf({ kind: "number", parts: ["999999999999"] }, "README.md")).toBeNull();
    expect(fieldOf({ kind: "id", parts: ["agamemnon-coder"] }, "README.md")).toMatch(/^line \d+$/);
    expect(foundIn({ kind: "amount", parts: ["1850.00"] }, "EUR 1,850.00")).toBe(true);
    expect(foundIn({ kind: "amount", parts: ["1850.00"] }, "185000 cents")).toBe(true);
    expect(foundIn({ kind: "hash", parts: ["797d4483", "cdab"] }, `797d4483${"0".repeat(90)}cdab`)).toBe(false);
  });
});
