import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trySignExample } from "../src/film/premiere.js";
import { SOCIAL_HTML, SOCIAL_MARK, SOCIAL_PNG, SOCIAL_SIZE, loadRecord, metalPaymentCount, socialPreviewHtml } from "../src/submission/socialPreview.js";

// The GitHub social preview: its figures come from the record and the /try/sign code, not typed into the template.
const root = new URL("../", import.meta.url);
const template = readFileSync(new URL(SOCIAL_HTML, root), "utf8");
const record = loadRecord(root);
const filled = socialPreviewHtml(template, record, "data:font/woff2;base64,", "data:image/svg+xml;base64,");
// The page after its header comment (the comment explains the placeholders and may name them).
const body = (html: string) => html.slice(html.indexOf("-->") + 3);

describe("social preview", () => {
  it("counts 86 payments on Metal testnet in the main run, each with its own tx", () => {
    expect(metalPaymentCount(record)).toBe(86);
  });

  it("shows that count on its chip, and the template types no count of its own", () => {
    expect(filled).toContain(`<b>${metalPaymentCount(record)}</b> payments, each its own tx on Metal testnet`);
    expect(body(template)).toContain("<b>{{metal.payments}}</b> payments");
    expect(body(template)).not.toMatch(/\b86\b/);
  });

  it("refuses to render when a figure is missing", () => {
    expect(() => socialPreviewHtml(template, { snapshot: { flows: [] } }, "x", "y")).toThrow(/metal\.payments/);
  });

  it("carries the hook, the one cent and the /try/sign example terms (amounts and hashes from the page's code)", () => {
    const t = body(filled);
    const ex = trySignExample();
    const eur = (v: string | number) => `EUR ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    expect(t).toContain("AI agents spend.<br><em>You sign off.</em>");
    expect(t).toContain("One cent. Worthless.");
    expect(t).toContain(eur(ex.p.amount));
    const tampered = eur(ex.tamperedAmount);
    expect(t).toContain(`${tampered.slice(0, -1)}<span class="cent">${tampered.slice(-1)}</span>`);
    expect(t).toContain(`${ex.hash.slice(0, 8)}…${ex.hash.slice(-4)}`);
    expect(t).toContain(`${ex.tamperedHash.slice(0, 8)}…${ex.tamperedHash.slice(-4)}`);
    expect(template).toMatch(/example from a \/try\/sign test world/);
  });

  it("uses text only, with Purser's own mark as its one image: no logos of others", () => {
    const imgs = body(template).match(/<img[^>]*>/g) ?? [];
    expect(imgs).toEqual(['<img src="{{mark}}" alt="">']);
    expect(readFileSync(new URL(SOCIAL_MARK, root), "utf8")).toMatch(/^<svg/);
    expect(body(template)).not.toMatch(/<svg|url\(https?:|airwallex\.com|metal\.[a-z]+\/|visa/i);
  });

  it("invites the viewer to /try/sign and keeps Airwallex and Metal named", () => {
    expect(body(template)).toContain("Try it: /try/sign");
    expect(body(template)).toContain("Live on the Airwallex sandbox");
    expect(body(template)).toContain("on Metal testnet");
    expect(body(template)).toContain("Signature verified for the original terms");
  });

  it("is rendered at 1280×640", () => {
    const png = readFileSync(new URL(SOCIAL_PNG, root));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([SOCIAL_SIZE.width, SOCIAL_SIZE.height]);
  });
});
