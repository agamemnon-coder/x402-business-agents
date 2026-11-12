// The hands-on page at /try (cloud/src/tryPage.ts): one page, one script under the console's nonce policy, values put
// on the page only as text, timers only for the three things that need one, the token read from the fragment and then
// removed from the address bar, and every word in cloud/src/tryCopy.ts inside each screen's budget.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleCsp } from "../cloud/src/console.js";
import * as COPY from "../cloud/src/tryCopy.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { scriptBlocks, scriptBody, textOutsideTags, withoutBlocks } from "./support/scriptBlocks.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const html = tryPage("n0nce", { origin: ORIGIN, rpId: RP });
const script = (() => {
  const blocks = scriptBlocks(html);
  expect(blocks).toHaveLength(1);
  return scriptBody(blocks[0]!);
})();
/** A word is a run of non-space characters with a letter or a digit in it ("·" and "…" are not words). */
const words = (...s: string[]) => s.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

let c: TestCloud;
beforeEach(() => { c = testCloud({ engine: true }); });
afterEach(() => c.close());

describe("GET /try", () => {
  it("is served with a fresh nonce on its one script and its one stylesheet, under the console's own policy and headers", async () => {
    const a = await c.fetch(`${ORIGIN}/try`);
    const b = await c.fetch(`${ORIGIN}/try`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toMatch(/text\/html/);
    const csp = a.headers.get("content-security-policy")!;
    const n = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(n).not.toBe(/'nonce-([^']+)'/.exec(b.headers.get("content-security-policy")!)![1]);
    expect(csp).toBe(consoleCsp(n));
    const page = await a.text();
    expect(scriptBlocks(page)).toHaveLength(1);
    expect(page).toContain(`<script type="module" nonce="${n}">`);
    expect(page).toContain(`<style nonce="${n}">`);
    // The same headers as the console's page, the policy's nonce aside.
    const cons = await c.fetch(`${ORIGIN}/`);
    const rest = (r: Response) => Object.fromEntries([...r.headers].filter(([k]) => k !== "content-security-policy"));
    expect(rest(a)).toEqual(rest(cons));
  });

  it("loads from a cloud with an engine, and the session the page holds reads that engine", async () => {
    const t = await c.tenant("visitor");
    expect((await c.fetch(`${ORIGIN}/try`)).status).toBe(200);
    expect((await c.fetch(`${ORIGIN}/try`, { method: "HEAD" })).status).toBe(200);
    const inv = await c.req("GET", "/v1/engine/invoices", { key: t.session });
    expect(inv.status).toBe(200);
    expect(inv.json.items).toEqual([]);
    const ev = await c.req("GET", "/v1/engine/events?after=0&limit=200", { key: t.session });
    expect(ev.status).toBe(200);
  });

  it("leaves the console where it was", async () => {
    expect((await c.fetch(`${ORIGIN}/`)).status).toBe(200);
    expect(await (await c.fetch(`${ORIGIN}/`)).text()).toContain("<title>Purser Cloud</title>");
    expect((await c.fetch(`${ORIGIN}/try/other`)).status).toBe(404);
  });
});

describe("the page", () => {
  it("has no inline handlers, no javascript: links and no style attributes, and its script parses", () => {
    const markup = withoutBlocks(html, ["script", "style"]);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(() => new Script(`(async()=>{${script}})`)).not.toThrow();
  });

  it("puts values on the page only as text: no innerHTML or any other HTML sink, no eval", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });

  it("never says stand-in", () => {
    expect(html).not.toMatch(/stand-in/i);
    for (const group of Object.values(COPY)) expect(JSON.stringify(group)).not.toMatch(/stand-in/i);
  });

  it("uses a timer only for polling, the session's renewal and the running time of an open Claude call", () => {
    const uses = [...script.matchAll(/(\w*)\s*=\s*(setTimeout|setInterval|requestAnimationFrame)\s*\(|(setTimeout|setInterval|requestAnimationFrame)\s*\(/g)];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u[1], u[0]).toMatch(/^(pollTimer|renewTimer|askTimer)$/);
    expect(script).toMatch(/pollTimer=setTimeout\(/);
    expect(script).toMatch(/renewTimer=setTimeout\(/);
    expect(script).toMatch(/askTimer=setInterval\(/);
    expect(script).not.toMatch(/requestAnimationFrame/);
  });

  it("reads the token from the fragment, takes it out of the address bar, and sends it only in the start request's body", () => {
    const read = script.indexOf("location.hash");
    const drop = script.indexOf("history.replaceState(");
    expect(read).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(read);
    expect(script).toMatch(/#\(\[ej\]\)=/);
    expect(script).toMatch(/'\/v1\/try\/start',TOKEN\?\{token:TOKEN\}:\{\}/);
    // The token goes nowhere else: no URL is built from it.
    expect(script.replace("const TOKEN=", "").replace("TOKEN?{token:TOKEN}:{}", "")).not.toContain("TOKEN");
  });

  it("has no words outside the copy: the markup's own text is the brand", () => {
    expect(textOutsideTags(withoutBlocks(html, ["script", "style", "title"])).trim().split(/\s+/)).toEqual(["P", "Purser"]);
    expect(readFileSync(new URL("../cloud/src/tryPage.ts", import.meta.url), "utf8")).not.toMatch(/ui\/i18n/);
  });
});

describe("the copy", () => {
  it("keeps every screen at 45 visible words or fewer outside the live panel and the invoice, in each of its states", () => {
    for (const [screen, states] of Object.entries(COPY.VISIBLE)) {
      for (const [i, state] of states.entries()) {
        const band = screen === "start" ? [] : [COPY.BAND.line, COPY.BAND.claudeCode];
        expect(words(COPY.CHROME.brand, ...band, ...state), `${screen} state ${i}`).toBeLessThanOrEqual(45);
      }
    }
  });

  it("counts every string of a screen in at least one of its states", () => {
    const groups: Record<string, Record<string, string>> = { start: COPY.START, invoice: COPY.INVOICE, work: COPY.WORK, gone: COPY.GONE, ended: COPY.ENDED };
    expect(Object.keys(COPY.VISIBLE).sort()).toEqual(Object.keys(groups).sort());
    for (const [screen, group] of Object.entries(groups)) {
      const seen = new Set(COPY.VISIBLE[screen as keyof typeof COPY.VISIBLE].flat());
      for (const [k, v] of Object.entries(group)) expect(seen.has(v), `${screen}.${k}`).toBe(true);
    }
  });

  it("says what the visitor uses in the band, and what reads the invoice from the start answer's mode", () => {
    expect(COPY.BAND.line).toBe("Your test company · test money · simulated bank");
    expect(COPY.BAND.claudeLive).toBe("Claude reads live");
    expect(COPY.BAND.claudeCode).toBe("Purser's code reads today");
    expect(COPY.START.heading).toBe("Run a company's payables with Purser.");
    expect(COPY.START.button).toBe("Start with a test company");
    expect(COPY.GONE.heading).toBe("Your test company was deleted after 24 hours.");
    expect(COPY.GONE.button).toBe("Start again");
    expect(COPY.INVOICE.ibanHint).toBe("Change the IBAN and see what Purser does");
    expect(script).toContain("mode.claude==='live'");
  });
});
