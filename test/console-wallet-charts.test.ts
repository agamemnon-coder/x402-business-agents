// Purser Cloud's Agents as passes (cloud/src/agentWallet.ts) and the Overview's and Books' charts
// (cloud/src/consoleCharts.ts), 21 Nov: what the page script promises in its text. The browser check
// (test/browser/console.check.ts, the guest pass) turns a pass over, opens an agent's record and reads the charts.
import { describe, expect, it } from "vitest";
import { WALLET_CSS, WALLET_JS } from "../cloud/src/agentWallet.js";
import { CHARTS_CSS, CHARTS_JS } from "../cloud/src/consoleCharts.js";
import { consolePage } from "../cloud/src/console.js";

const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });

describe("the agents' passes", () => {
  it("are in the console, its script and its one stylesheet", () => {
    expect(html).toContain(WALLET_JS.trim());
    expect(html).toContain(WALLET_CSS.trim());
  });
  it("show the card's last four only, never a card number, a CVV or a way to act", () => {
    expect(WALLET_JS).toContain("'•••• '+last4");
    expect(WALLET_JS).not.toMatch(/card_number|cvv|\bpan\b/i);
    // Visual only: no API call and no signed action from the pass (the live card's actions stay in its own panel).
    expect(WALLET_JS).not.toMatch(/\bapi\(|cardAct\(|navigator\.credentials/);
  });
  it("turn over as a button a screen reader hears, and swap without motion when motion is reduced", () => {
    expect(WALLET_JS).toContain("pass.setAttribute('aria-pressed'");
    expect(WALLET_JS).toContain("more.setAttribute('aria-expanded'");
    expect(WALLET_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^]*button\.wpass\.flipped \.wp-inner \{ transform: none; \}/);
  });
  it("leave room for more rows and blocks (PASS_ROWS, AGENT_BLOCKS), and a row that throws leaves the pass drawn", () => {
    expect(WALLET_JS).toContain("const PASS_ROWS=[];");
    expect(WALLET_JS).toContain("const AGENT_BLOCKS=[];");
    expect(WALLET_JS).toContain("const safely=(f,a,ctx)=>{try{return f(a,ctx)}catch(e){return null}};");
  });
});

describe("the charts", () => {
  it("are in the console, with a palette for light and dark", () => {
    expect(html).toContain(CHARTS_JS.trim());
    expect(CHARTS_CSS).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])');
    expect(CHARTS_CSS).toContain(':root[data-theme="dark"]');
  });
  it("give each SVG chart a title and a description, and a table of the same numbers", () => {
    expect(CHARTS_JS).toContain("g.prepend(sv('title',{id:k+'t'}");
    expect(CHARTS_JS).toContain("sv('desc',{id:k+'d'}");
    for (const f of ["flowChart", "donut", "agentSpend", "cashWithTable"]) {
      const body = CHARTS_JS.slice(CHARTS_JS.indexOf(`function ${f}(`), CHARTS_JS.indexOf("\nfunction", CHARTS_JS.indexOf(`function ${f}(`) + 1));
      expect({ f, table: body.includes("chartTable(") }).toEqual({ f, table: true });
    }
  });
  it("say so instead of drawing when nothing has moved", () => {
    expect(CHARTS_JS).toContain("if(!ws.length)return chartEmpty(t('cs.ch.none'));");
    expect(CHARTS_JS).toContain("if(!parts.length)return chartEmpty(t('cs.ch.none'));");
    expect(CHARTS_JS).toContain("if(!D||!D.cash||!D.cash.length)return el('section','card dcard chempty-card'");
  });
});
