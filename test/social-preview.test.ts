import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trySignExample } from "../src/film/premiere.js";
import { SOCIAL_HTML, SOCIAL_PNG, SOCIAL_SIZE, loadRecord, metalPaymentCount, socialPreviewHtml } from "../src/submission/socialPreview.js";

// The GitHub social preview: its figures come from the record and the /try/sign code, not typed into the template.
const root = new URL("../", import.meta.url);
const template = readFileSync(new URL(SOCIAL_HTML, root), "utf8");
const record = loadRecord(root);
const filled = socialPreviewHtml(template, record, "data:font/woff2;base64,");
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("social preview", () => {
  it("counts 86 payments on Metal testnet in the main run, each with its own tx", () => {
    expect(metalPaymentCount(record)).toBe(86);
  });

  it("shows that count on its chip, and the template types no count of its own", () => {
    expect(text(filled)).toContain(`${metalPaymentCount(record)} payments, each its own tx on Metal testnet`);
    expect(text(template)).toContain("{{metal.payments}} payments");
    expect(text(template)).not.toMatch(/\b86\b/);
  });

  it("refuses to render when a figure is missing", () => {
    expect(() => socialPreviewHtml(template, { snapshot: { flows: [] } }, "x")).toThrow(/metal\.payments/);
  });

  it("carries the hook, the one cent and the /try/sign example terms (amounts and hashes from the page's code)", () => {
    const t = text(filled);
    const ex = trySignExample();
    const eur = (v: string | number) => `EUR ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    expect(t).toContain("AI agents spend. You sign off.");
    expect(t).toContain("One cent. Worthless.");
    expect(t).toContain(eur(ex.p.amount));
    expect(filled.replace(/<[^>]+>/g, "")).toContain(eur(ex.tamperedAmount));
    expect(t).toContain(`${ex.hash.slice(0, 8)}…${ex.hash.slice(-4)}`);
    expect(t).toContain(`${ex.tamperedHash.slice(0, 8)}…${ex.tamperedHash.slice(-4)}`);
    expect(template).toMatch(/example from a \/try\/sign test world/);
  });

  it("uses text only: no images or logos", () => {
    expect(template.replace(/<!--[\s\S]*?-->/g, "")).not.toMatch(/<img|<svg|logo|url\(https?:/i);
  });

  it("is rendered at 1280×640", () => {
    const png = readFileSync(new URL(SOCIAL_PNG, root));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([SOCIAL_SIZE.width, SOCIAL_SIZE.height]);
  });
});
