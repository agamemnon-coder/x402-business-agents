// The visual layer of /try (cloud/src/try/visuals.ts): its own style and module script under the page's nonce, small,
// GET-only, text-only, honest about the bank, and off under reduced motion.
import { describe, expect, it } from "vitest";
import { VIS, VIS_CSS, visScript } from "../cloud/src/try/visuals.js";
import { tryPage } from "../cloud/src/tryPage.js";

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const js = visScript(json);

describe("the /try visual layer", () => {
  it("is on the page: its style in the page's one style tag, its code a block at the end of the page's one script", () => {
    const html = tryPage("N0NCE", { origin: "https://x.test", rpId: "x.test" });
    expect(html).toContain(VIS_CSS);
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="module" nonce="N0NCE">']);
    expect(html).toContain(`\n${js}</script>`);
    expect(js.startsWith("{\n") && js.endsWith("}\n")).toBe(true);
  });

  it("adds under 15 KB, parses, and draws text only (no innerHTML, no inline handlers)", () => {
    expect(VIS_CSS.length + js.length).toBeLessThan(15 * 1024);
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bon[a-z]+=|setAttribute\('style'|eval\(/);
  });

  it("only reads: every request is a GET with the page's own session", () => {
    expect([...js.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["path,{headers:{authorization:'Bearer '+t}}"]);
    expect(js).not.toMatch(/method\s*:/);
    for (const p of js.match(/'\/v1\/[^']*'/g) ?? []) expect(["'/v1/engine'", "'/v1/ledger/entries'", "'/v1/engine/invoices'"]).toContain(p);
  });

  it("names the bank as it is: Airwallex (sandbox) only when the sandbox rail is on or the page holds an Airwallex transfer", () => {
    expect(VIS.flow.bankAwx).toBe("Airwallex (sandbox)");
    expect(js).toContain("awx=m.rail_awx==='on'||!!o.awx");
    expect(js).toContain("m.claude==='live'?V.flow.readClaude:V.flow.readCode");
  });

  it("animates with CSS only, all of it off under prefers-reduced-motion; no timer in the page's script", () => {
    expect(VIS_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*animation: none !important/);
    expect(js).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(js).not.toMatch(/stand-in/i);
  });
});
