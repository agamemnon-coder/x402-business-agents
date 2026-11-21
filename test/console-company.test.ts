// Purser Cloud's company switcher, Company page, session block, connected tabs and Settings cards
// (cloud/src/consoleCompany.ts, 21 Nov): what the page script promises in its text. The browser checks
// (test/browser/console.check.ts, test/browser/awx-live.check.ts) walk the pages.
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { CO_WORDS, COMPANY_CSS, COMPANY_JS } from "../cloud/src/consoleCompany.js";
import { NAV_GROUPS } from "../cloud/src/consoleShell.js";

const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
const fn = (name: string) => { const at = COMPANY_JS.indexOf(`function ${name}(`); return COMPANY_JS.slice(at, COMPANY_JS.indexOf("\nfunction", at + 1)); };

describe("the company and the session", () => {
  it("are in the console's one script and one stylesheet, with every word in English and Dutch", () => {
    expect(html).toContain(COMPANY_JS.trim());
    expect(html).toContain(COMPANY_CSS.trim());
    expect(Object.keys(CO_WORDS.nl).sort()).toEqual(Object.keys(CO_WORDS.en).sort());
    for (const [k, v] of Object.entries(CO_WORDS.en)) expect({ k, placeholders: v.match(/\{[a-z]+\}/g) ?? [] }).toEqual({ k, placeholders: CO_WORDS.nl[k as keyof typeof CO_WORDS.nl].match(/\{[a-z]+\}/g) ?? [] });
  });
  it("say the session's time in words that read well, and update it with the page's clock", () => {
    expect(fn("leftWords")).toContain("if(m<1)return cw('left_lt1');if(m<60)return cw('left_min',{n:m});return cw('left_h',{h:Math.floor(m/60),m:m%60})");
    expect(CO_WORDS.en.left_min).toBe("Ends in {n} min");
    // The page's 30-second tick redraws the frame, the session block with it.
    expect(html).toContain("else shell()},30000);");
    expect(html).toContain("if(S){sessionBlock();companyBlock();");
  });
  it("make the company block a switcher: its name opens the Company page, the chevron a menu a keyboard can work", () => {
    expect(html).toContain('<a class="co" id="co" href="#/company"></a><button type="button" class="co-more" id="co-more" aria-haspopup="menu" aria-expanded="false" aria-controls="co-menu"');
    expect(html).toContain('<span class="co-menu" id="co-menu" role="menu"');
    for (const k of ["'Escape'", "'ArrowDown'", "'ArrowUp'", "'Tab'"]) expect(COMPANY_JS).toContain(k);
    // Real places only: the sign-in with another company's address, the demo, the existing first run. A session is one
    // company's, so switching signs out first, and the menu says so.
    expect(fn("drawCoMenu")).toContain("switchTo('#/sign-in',o.slug)");
    expect(fn("drawCoMenu")).toContain("switchTo('#/start')");
    expect(fn("switchTo")).toContain("api('/v1/auth/logout',{method:'POST'})");
    expect(CO_WORDS.en.signs_out).toContain("signs you out");
  });
  it("remember only the address and name of companies this browser signed in to, never a token, and never the demo", () => {
    const r = fn("rememberCompany").split("\n")[0]!;
    expect(r).toContain("if(!m||m.demo||!m.tenant||!m.tenant.slug)return;");
    expect(r).toContain("[{slug:m.tenant.slug,name:String(m.tenant.name||'').slice(0,120)}]");
    expect(r).not.toMatch(/S\.token|api_key|session/i);
  });
  it("put test money once, in the header strip on a laptop and the top bar on a phone", () => {
    expect(html.match(/class="test"/g)).toHaveLength(1);
    expect(fn("placeTest")).toContain("$('header.top .awx-h')");
    expect(COMPANY_CSS).toContain("body.demo.signed-in .appbar #testchip { display: none; }");
  });
});

describe("the connected tabs", () => {
  it("show Claude only once the company has it: the demo's read-only token, or a live connector token an owner made", () => {
    expect(NAV_GROUPS.find((g) => g[0] === "rails")![1]).toEqual(["airwallex", "claude", "connections"]);
    expect(html).toContain('<a href="#/claude" data-tab="claude" hidden>Claude</a>');
    const s = fn("connState");
    expect(s).toContain("if(ME.demo)CONN.claude={demo:true,live:1,last:null};");
    expect(s).toContain("api('/v1/claude/connectors')");
    expect(s).toContain("!x.revoked_at&&x.expires_at>new Date().toISOString()");
    expect(fn("connTabs")).toContain("a.hidden=!CONN.claude");
    // Making or revoking a token on Connections redraws the menu at once.
    expect(html.match(/await draw\(\);connState\(true\)/g)).toHaveLength(2);
    // A tab the company does not have is left out of the phone's group pages too.
    expect(html).toContain("return a&&!a.hidden});");
  });
  it("send Claude's page back to Connections when nothing is connected, and say what the AI can never do", () => {
    expect(fn("claudeView")).toContain("if(!c)return go('#/connections?at=claude');");
    expect(CO_WORDS.en.cl_cannot_1).toBe("Approve or pay");
  });
});

describe("the Company page", () => {
  it("reads the company's own answers only, each figure a link to its page", () => {
    const v = fn("companyView");
    for (const p of ["'/v1/insights'", "'/v1/dashboard'", "'/v1/agents'", "'/v1/invoices?limit=200'", "'/v1/transactions?limit=6'"]) expect(v).toContain(p);
    for (const h of ["'#/transactions'", "'#/invoices?f=open'", "'#/invoices?f=waiting_cfo'", "'#/agents'", "'#/connections'"]) expect(v).toContain(h);
    expect(v).not.toMatch(/innerHTML|insertAdjacentHTML/);
    expect(html).toContain("const pages={'/company':companyView,'/claude':claudeView,");
  });
});

describe("Settings", () => {
  it("has you, the policy, notifications, access and a danger zone, and no longer repeats Connections", () => {
    const settings = html.slice(html.indexOf("async function settingsView(q){"), html.indexOf("// --- Connections (21 Nov)"));
    for (const c of ["youCard(m)", "policyCard()", "notifyCard(m)", "accessCard(m)", "dangerCard(m)"]) expect(settings).toContain(c);
    expect(settings).not.toContain("cx-pointer");
    // Notifications are an owner's (the alerts API needs one); the access card shows addresses, never a key.
    expect(fn("notifyCard")).toContain("if(!m.scopes.includes('admin')||m.demo||m.kind!=='session')return null;");
    expect(fn("accessCard")).not.toMatch(/api_key|token/);
  });
});
