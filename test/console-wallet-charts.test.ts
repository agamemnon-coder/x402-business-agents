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
  // 21 Nov, the owner: "if I go over something with my cursor I want it to show me the numbers… no dead zones".
  it("answer the pointer, the keyboard and touch on every chart, with no dead zone", () => {
    expect(CHARTS_JS).toContain("function chartPoint(o){");
    for (const ev of ["'pointermove'", "'pointerleave'", "'click'", "'focus'", "'blur'", "'keydown'"]) expect({ ev, there: CHARTS_JS.includes(`root.addEventListener(${ev}`) }).toEqual({ ev, there: true });
    for (const k of ["ArrowRight", "ArrowLeft", "Home", "End", "Enter", "Escape"]) expect(CHARTS_JS).toContain(`'${k}'`);
    // One tab stop, a live region a screen reader hears, the tooltip hidden from it (its words are said once).
    expect(CHARTS_JS).toContain("root.tabIndex=0");
    expect(CHARTS_JS).toContain("say.setAttribute('aria-live','polite')");
    expect(CHARTS_JS).toContain("tip.setAttribute('aria-hidden','true')");
    // Every chart binds it: the cash line (a crosshair), both column charts, both rings, the spend bars, the due bar.
    const all = html.slice(html.indexOf("<script"));
    for (const f of ["function cashChart(", "function weekChart(", "function invoiceRing(", "function spendBars(", "function segbar(", "function flowChart(", "function donut("]) {
      const at = all.indexOf(f);
      const body = all.slice(at, all.indexOf("\nfunction", at + 1));
      expect({ f, binds: body.includes("chartPoint({root:") }).toEqual({ f, binds: true });
    }
    // A line answers anywhere on its plot (the nearest day), a column over its full height, a ring at every angle.
    expect(all).toContain("class:'xh'");
    expect(CHARTS_JS).toContain("function ringPick(g,fr,cx,cy)");
    expect(all).toContain("sv('rect',{x:l+step*k,y:tp,width:step,height:H-tp-b,class:'hit'})");
    // No native title tooltip left on a column or a ring part to show a second, different box.
    expect(all).not.toContain("const col=sv('g',{class:'col'},[sv('title'");
    // A datum opens its list: a week or a day in Transactions (which reads its filters from the address), a state in Invoices.
    expect(CHARTS_JS).toContain("const txWeek=(w)=>'#/transactions?from='+w+'&to='+plusDays(w,6);");
    expect(all).toContain("async function transactionsView(q0){");
    expect(all).toContain("href:(i)=>'#/invoices?f='+F[parts[i][0]]");
    expect(CHARTS_CSS).toContain(".chi:focus-visible");
  });
});
