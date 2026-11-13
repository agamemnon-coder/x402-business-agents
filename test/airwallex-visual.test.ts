// /airwallex as pictures first (owner, 13 Nov): the path of stops, the runs on one time axis, one payment as a bar and
// two meters. Every figure is the run records', read by the code that draws it; nothing is typed in. Shape and words
// carry identity (filled vs ring, a legend, a table), never colour alone; the site's tokens only; no inline style (the
// page's CSP hashes its one stylesheet).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { flaggedTiles, productTiles } from "../src/redesign/airwallexProducts.js";
import { PATH_STOPS, VISUAL_CSS, metersHtml, onePayment, pathHtml, paymentChart, timelineSvg, visualsHtml } from "../src/redesign/airwallexVisual.js";
import { agentRun } from "../src/redesign/run.js";

const inUse = productTiles(agentRun()), flagged = flaggedTiles();
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const record = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as { invoices: Record<string, unknown>[] };

describe("the path of a payment through Airwallex", () => {
  const html = pathHtml(inUse, flagged);
  it("has the stops in a payment's order, each linked to its card, each with the day it ran live", () => {
    const labels = [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
    expect(labels).toEqual(PATH_STOPS.map((s) => s.label));
    for (const s of PATH_STOPS) {
      const t = [...inUse, ...flagged].find((x) => s.keys.includes(x.key))!;
      expect(html).toContain(`href="#p-${t.key}"`);
    }
    expect(text(html)).toMatch(/Agent card Live 7 Nov/);
  });
  it("says which stops are built but not yet switched on (a ring, and the words)", () => {
    for (const label of ["Payee check", "Ledger reconciliation"]) expect(text(html)).toMatch(new RegExp(`${label} Live 12 Nov not yet switched on`));
    expect((html.match(/<li class="off">/g) ?? []).length).toBe(2);
  });
});

describe("the runs on one time axis", () => {
  it("one row per product, a dot on the day of its own record, filled in use and a ring when not switched on", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const svg = timelineSvg(inUse, flagged, layout);
      const titles = [...svg.matchAll(/<g><title>([^<]+)<\/title>/g)].map((m) => m[1]);
      expect(titles).toHaveLength(inUse.length + flagged.length);
      for (const t of inUse) expect(titles).toContain(`${t.name}: ran live ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(t.iso))}, in use`);
      expect((svg.match(/<circle class="on"/g) ?? []).length).toBe(inUse.length);
      expect((svg.match(/<circle class="off"/g) ?? []).length).toBe(flagged.length);
    }
  });
  it("keeps every dot clear of the edges, on its day's gridline, all the same size (owner, 13 Nov: \"make sure the dots are clean\")", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const svg = timelineSvg(inUse, flagged, layout);
      const W = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
      const grid = new Set([...svg.matchAll(/<line class="g" x1="(\d+)"/g)].map((m) => Number(m[1])));
      const dots = [...svg.matchAll(/<circle class="(on|off)" cx="(\d+)" cy="[\d.]+" r="([\d.]+)"(?: stroke-width="([\d.]+)")?/g)]
        .map((m) => ({ cx: Number(m[2]), outer: Number(m[3]) + (m[4] ? Number(m[4]) / 2 : 0) }));
      expect(dots).toHaveLength(inUse.length + flagged.length);
      expect(new Set(dots.map((d) => d.outer)).size).toBe(1);
      for (const d of dots) { expect(grid.has(d.cx)).toBe(true); expect(d.cx - d.outer).toBeGreaterThan(8); expect(W - d.cx - d.outer).toBeGreaterThan(8); }
    }
  });
});

describe("when a flagged product is switched on (another run flips it in the page data)", () => {
  it("moves to filled dots and keeps its meter, with no 'not yet switched on' left", () => {
    const all = [...inUse, ...flagged];
    expect(timelineSvg(all, [])).not.toContain('class="off"');
    expect(pathHtml(all, [])).not.toContain("not yet switched on");
    expect(metersHtml(all)).toBe(metersHtml(flagged));
    expect(visualsHtml(all, [])).toContain("payee name checks stopped before the CFO is asked");
  });
});

describe("one payment as a bar", () => {
  const p = onePayment()!;
  it("is the FX payment of the Airwallex-only run, and its parts add up as the record says", () => {
    const i = record.invoices.find((x) => x.invoice_no === p.invoice)!;
    expect(i.plan).toBe("convert_shortfall");
    expect(p.need).toBe(p.amount + p.feeMax);
    expect(p.need).toBe(p.free + p.fx);
    expect((i.quote as { buy_eur: string }).buy_eur).toBe((p.fx / 100).toFixed(2));
    expect(i.free_eur).toBe((p.free / 100).toFixed(2));
    expect(i.fee).toBe(`EUR ${(p.fee / 100).toFixed(2)}`);
  });
  it("says its figures in words and in a table, never by colour alone", () => {
    const html = paymentChart(p);
    expect(text(html)).toContain("Already free in EUR: EUR 1,246.50");
    expect(text(html)).toContain("Bought by FX: EUR 623.50 for USD 704.45");
    expect(html).toMatch(/<details class="fold awtab"><summary>As a table<\/summary><table>/);
    expect(text(html)).toContain("Fee Airwallex charged EUR 13.50");
    expect(text(html)).toContain("Status PAID, 7 Nov");
  });
});

describe("the two meters", () => {
  it("read their counts from the flagged tiles' records", () => {
    const html = metersHtml(flagged);
    const ledger = flagged.find((t) => t.key === "ledger")!, payee = flagged.find((t) => t.key === "payee-check")!;
    expect(text(html)).toContain(`${ledger.value} movements agree`);
    expect(text(html)).toContain(`${payee.value} payee name checks stopped before the CFO is asked`);
  });
});

describe("on the page", () => {
  const awx = buildPages().airwallex!;
  it("opens with the path, then the charts, then the cards in two groups", () => {
    const at = ['<ol class="awpath"', 'class="awviz"', 'id="awg-on"', 'id="awg-off"'].map((m) => awx.indexOf(m));
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(awx).toContain("Built, not yet switched on; each ran live on 12 Nov.");
    expect(awx).toContain(visualsHtml(inUse, flagged));
  });
  it("has no inline style and uses the site's tokens only", () => {
    expect(visualsHtml(inUse, flagged)).not.toMatch(/\sstyle=/);
    expect(VISUAL_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });
});
