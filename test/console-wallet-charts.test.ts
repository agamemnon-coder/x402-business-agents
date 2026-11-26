// Purser Cloud's Agents as cards (cloud/src/agentWallet.ts, 23 Nov; passes before) and the Overview's and Books' charts
// (cloud/src/consoleCharts.ts), 21 Nov: what the page script promises in its text. The browser check
// (test/browser/console.check.ts, the guest pass) turns a pass over, opens an agent's record and reads the charts.
import { describe, expect, it } from "vitest";
import { WALLET_CSS, WALLET_JS } from "../cloud/src/agentWallet.js";
import { CARD_ART_CSS, CARD_PRESETS, DEFAULT_STYLE } from "../cloud/src/agentCardArt.js";
import { ROSTER } from "../cloud/src/agentRoster.js";
import { CHARTS_CSS, CHARTS_JS } from "../cloud/src/consoleCharts.js";
import { consolePage } from "../cloud/src/console.js";

const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });

describe("the agents' cards (23 Nov)", () => {
  it("are in the console, its script and its one stylesheet, with the card art the phone's view shares", () => {
    expect(html).toContain(WALLET_JS.trim());
    expect(html).toContain(WALLET_CSS.trim());
    expect(WALLET_CSS).toContain(CARD_ART_CSS.trim());
  });
  it("show the card's last four only, never a card number, a CVV or a way to move money", () => {
    expect(WALLET_JS).toContain("'•••• '+x.last4"); // 26 Nov (the owner): "•••• 4002", the last four only
    expect(WALLET_JS).not.toMatch(/card_number|cvv|\bpan\b/i);
    // Its only calls: the design (read, and saved by an owner), the phone link, the Wallet pass link, the recorded
    // negotiation, and the authority map under each card (read, cloud/src/authorityView.ts).
    const calls = [...WALLET_JS.matchAll(/api\('([^']+)'/g)].map((m) => m[1]).sort();
    expect(calls).toEqual(["/v1/agents/", "/v1/agents/", "/v1/authority-map", "/v1/card-design", "/v1/card-design", "/v1/negotiation/recorded"]);
    expect(WALLET_JS).not.toMatch(/cardAct\(|navigator\.credentials|\/v1\/cards\/actions/);
  });
  it("draw from data as text, never as markup", () => {
    expect(WALLET_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
  it("give each agent its own design, the company's mark, and real marks for Claude, Alta and Airwallex, Visa in text only", () => {
    expect(new Set(Object.values(DEFAULT_STYLE)).size).toBe(ROSTER.length);
    for (const r of ROSTER) expect(DEFAULT_STYLE[r.id], r.id).toBeDefined();
    for (const k of ["'claude'", "'alta'", "'airwallex'"]) expect(WALLET_JS).toContain(`dkLogo(${k})`);
    expect(WALLET_JS).not.toContain("dkLogo('visa");
    expect(WALLET_JS).toContain("pcEl('text',{class:'ac-net txt'");
    expect(WALLET_JS).toContain("fill:'url(#pc-vs)'},'VISA')");
    // 27 Nov (Obsidian): the card is drawn as SVG nodes (its words as text, never markup), each agent's relief by its id.
    expect(WALLET_JS).toContain("const rel=RELIEF[x.id]||'lines';");
    // 26 Nov (the owner: "remove SIMULATED, far too busy"): no badge on the card; the honesty label is under it, as words.
    expect(WALLET_JS).not.toContain("el('span','ac-tag'");
    expect(WALLET_JS).toContain("sim_card:'Simulated card · test money',sbx_card:'Sandbox card · test money'");
    expect(WALLET_JS).toContain("x.last4?el('span','dk-hon',honestOf(x)):null");
    for (const p of CARD_PRESETS) expect(CARD_ART_CSS).toContain(`.acard.p-${p} {`);
  });
  it("say plainly when Apple Wallet waits for its certificate, and offer the phone's QR either way", () => {
    expect(WALLET_JS).toContain("wal_wait:'Apple Wallet: waiting for the pass certificate'");
    expect(WALLET_JS).toContain("wal.disabled=true");
    expect(WALLET_JS).toContain("/phone-card/link");
    expect(WALLET_JS).toContain("ctx.P.wallet_pass.available");
  });
  it("keep a guest's design in the browser and say so; the company's is saved only by those who may", () => {
    expect(WALLET_JS).toContain("DESIGN_MODE=r&&r.can_save?'company':ME&&ME.demo?'guest':'reader'");
    expect(WALLET_JS).toContain("d_guest:'Kept in this browser only");
    expect(WALLET_JS).toContain("Design only: no limit, card or payment changes.");
  });
  it("move only when motion is allowed: tilt, meters, ticker, dialogs", () => {
    expect(WALLET_JS).toContain("if(RM()||e.pointerType!=='mouse')return;");
    expect(WALLET_JS).toContain("let k=0,paused=RM();");
    expect(WALLET_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.dk-item, \.dk-tl\.in/);
    expect(CARD_ART_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.acard, \.acard \.ac-bar > span \{ transition: none; \} \.acard \{ transform: none; \} \}/);
  });
  it("let a link to one agent open its drawer (#/agents?a=id clicks its button.wmore)", () => {
    expect(WALLET_JS).toContain("it.id='roster-'+x.r.id");
    expect(WALLET_JS).toContain("el('button','dk-line wmore'");
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
    // 26 Nov: the older Overview's approvals-by-week chart and invoices ring went with it (the console redesign).
    for (const f of ["function cashChart(", "function spendBars(", "function segbar(", "function flowChart(", "function donut("]) {
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
    // (26 Nov: a state in Invoices from the Overview's flow, its stages each a link; the invoices ring went.)
    expect(all).toContain("stage('pd','circle-check',sw('fl_paid'),paid,'#/invoices?f=paid'");
    expect(CHARTS_CSS).toContain(".chi:focus-visible");
  });
});
