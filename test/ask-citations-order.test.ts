// Ask Purser's citations as the reader sees them (outside audit, 22 November: the live /ask answered "Which invoices wait
// for the CFO?" citing its one source as "6", the place of a demo-company read after five passages). The page numbers the
// chips and the sources list 1, 2, 3 in the order the answer first uses them, each still linked to its own passage, and
// keeps the renumbered text in the conversation. The page's own functions are run here, taken from the page as served.
import { describe, expect, it } from "vitest";
import { askPage } from "../cloud/src/ask/page.js";

const html = askPage("nonce", { embed: false });
const fn = (name: string) => {
  const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(html);
  if (!m) throw new Error(`no ${name} in the page`);
  return m[0];
};
const page = new Function(`${fn("citeOrder")}\n${fn("renumbered")}\nreturn { citeOrder, renumbered };`)() as {
  citeOrder: (text: string, sources: unknown[]) => Map<number, number>;
  renumbered: (text: string, sources: unknown[]) => string;
};
const src = (n: number) => ({ n, title: `source ${n}`, url: `https://example.org/${n}`, kind: n > 5 ? "data" : "doc" });
const sources = [1, 2, 3, 4, 5, 6, 7].map(src);

describe("Ask Purser numbers its citations in the order of use", () => {
  it("a single source read sixth is cited as 1", () => {
    expect([...page.citeOrder("Two invoices wait for the CFO [6].", sources)]).toEqual([[6, 1]]);
    expect(page.renumbered("Two invoices wait for the CFO [6].", sources)).toBe("Two invoices wait for the CFO [1].");
  });

  it("several, in the order the answer first uses them, each once; a number with no source is left as written", () => {
    const text = "Limits [3]. The CFO signs [6], over a limit [3]. Read [7] and [1]. Not sent [12].";
    expect([...page.citeOrder(text, sources)]).toEqual([[3, 1], [6, 2], [7, 3], [1, 4]]);
    expect(page.renumbered(text, sources)).toBe("Limits [1]. The CFO signs [2], over a limit [1]. Read [3] and [4]. Not sent [12].");
  });

  it("the chips and the sources list use the same numbers, and keep each source's own link", () => {
    expect(html).toContain("const shown = String((order && order.get(n)) || n);");
    expect(html).toContain("a.append(el('b', null, String(i + 1))");
    expect(html).toContain("text: renumbered(text, sources).slice(0, 1200)");
    expect(html).toMatch(/a\.href = s\.url;[^\n]*'Source ' \+ shown/);
  });
});
