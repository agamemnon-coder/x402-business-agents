// "Judge it in 3 minutes" (Max's last round, item 5.1): /judge, five steps a juror ticks off, each a link to a page that
// already exists and one line of what they will see there. The ticks live in the browser only (localStorage, in
// try/catch); the page has no fetch and a CSP that allows no connection.
//
// The route check below is the one that sequences the merge: it fails, step by step, while a step links to a page the
// site does not serve yet (/trace, item 1.2) or to a part of /try/sign that is not built yet (step 0, PR #71, and the
// worst-case figure, item 1.1). No page is stubbed to make it pass.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageResponse } from "../worker/src/core.js";
import { buildPages } from "../src/relay/assets.js";
import { JUDGE_CSP, JUDGE_PAGE } from "../src/servers/dashboard.js";
import { JUDGE_CODE_HREF, JUDGE_LINK, JUDGE_STEPS, JUDGE_URL, judgePage } from "../src/redesign/judge.js";
import { FILM_URL } from "../src/config/brand.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { loadRecord } from "../src/redesign/run.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ON = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const OFF = buildPages({} as NodeJS.ProcessEnv);
const SITE = "https://kit11.max-31b.workers.dev";

/** The status the Worker's pages answer a GET with (following a redirect, as a browser does); 404 for no page. */
function served(path: string, pages = ON): number {
  let r = pageResponse(new Request(`${SITE}${path}`), pages);
  for (let hops = 0; r && r.status === 302 && hops < 3; hops++) r = pageResponse(new Request(new URL(r.headers.get("location")!, SITE)), pages);
  return r?.status ?? 404;
}
/** The HTML the Worker serves at a page path (the same strings pageResponse wraps). */
function bodyOf(path: string, pages = ON): string {
  const p = new URL(path, SITE).pathname;
  const by: Record<string, string | undefined> = {
    "/try/sign": pages.trySign, "/try/verify": pages.tryVerify, "/airwallex": pages.airwallex, "/metal": pages.metal,
    "/proof": pages.proof, "/watch": pages.watch, "/home": pages.home, "/judge": pages.judge,
  };
  return by[p] ?? "";
}
/** Each step's own links on this site (not the explorer), as paths. */
const ownLinks = (s: (typeof JUDGE_STEPS)[number]) => s.links.map((l) => l.href).filter((h) => h.startsWith("/"));

/**
 * What each step's line says the juror will see, as a mark on the page it links to: a step says nothing its page does
 * not show. Step 3's page (/trace) is not built yet, so only its route is checked.
 */
const SEES: Record<string, { path: string; marks: (string | RegExp)[] }[]> = {
  sign: [{ path: "/try/sign", marks: ["Try to tamper: change the amount by 0.01", 'id="go-tamper"'] }],
  policy: [{ path: "/try/sign", marks: ["Optional: set the policy first", /worst.case/i] }],
  trace: [],
  rails: [{ path: "/airwallex", marks: ['id="controls"', "LIMIT_EXCEEDED"] }, { path: "/metal", marks: [metalStory(loadRecord().record).refusal?.proof.href ?? "no refusal in the record"] }],
  verify: [{ path: "/try/verify", marks: ["Don't trust our server: check it yourself.", "connect-src 'none'"] }],
};

describe("/judge: the five steps", () => {
  it("are the five Max named, in his order, with his times, three minutes in all", () => {
    expect(JUDGE_STEPS.map((s) => [s.title, s.seconds])).toEqual([
      ["Sign one yourself, and tamper one cent", 60],
      ["Set a looser policy and see the worst case change", 30],
      ["Trace any payment from policy to bank", 30],
      ["See Airwallex and Metal enforce it themselves", 30],
      ["Check the receipt yourself, no server", 30],
    ]);
    expect(JUDGE_STEPS.reduce((t, s) => t + s.seconds, 0)).toBe(180);
    expect(JUDGE_STEPS.map((s) => s.links.map((l) => l.href))).toEqual([
      ["/try/sign"], ["/try/sign"], ["/trace"], ["/airwallex", "/metal", metalStory(loadRecord().record).refusal!.proof.href], ["/try/verify"],
    ]);
    // Each says in one line what the juror will see.
    for (const s of JUDGE_STEPS) expect({ step: s.id, oneLine: s.see.length > 0 && !s.see.includes("\n") && s.see.length <= 200 }).toEqual({ step: s.id, oneLine: true });
  });

  // One test per step, so a red run names the steps whose pages are not on the site yet.
  for (const s of JUDGE_STEPS) {
    it(`step ${JUDGE_STEPS.indexOf(s) + 1} (${s.id}) links only to routes the site serves, and its page shows what the step says`, () => {
      for (const path of ownLinks(s)) expect({ step: s.id, path, status: served(path) }).toEqual({ step: s.id, path, status: 200 });
      for (const { path, marks } of SEES[s.id] ?? []) {
        const html = path === "/try/verify" ? `${bodyOf(path)}\n${ON.csp.tryVerify}` : bodyOf(path);
        for (const m of marks) expect({ step: s.id, path, mark: String(m), shown: typeof m === "string" ? html.includes(m) : m.test(html) }).toEqual({ step: s.id, path, mark: String(m), shown: true });
      }
    });
  }

  it("has a checkbox and a time for each step, and every link on the page in the HTML", () => {
    const html = judgePage();
    expect(html).toBe(JUDGE_PAGE);
    for (const [i, s] of JUDGE_STEPS.entries()) {
      expect(html).toContain(`<input type="checkbox" id="step-${s.id}" data-step="${s.id}">`);
      expect(html).toContain(`<span class="secs">${s.seconds} s</span>`);
      expect(html).toContain(`<span class="n">${i + 1}</span>`);
      for (const l of s.links) expect(html).toContain(`href="${l.href}"`);
    }
  });

  it("ends with the code (the README's five files) and the film", () => {
    expect(JUDGE_CODE_HREF).toBe("https://github.com/agamemnon-coder/x402-business-agents#how-it-works-in-5-files");
    expect(read("README.md")).toMatch(/^## How it works in 5 files$/m);
    const html = judgePage();
    const tail = html.slice(html.indexOf('<section class="more"'));
    expect(tail).toContain("Want the code?");
    expect(tail).toContain(`href="${JUDGE_CODE_HREF}"`);
    expect(tail).toContain("How it works in 5 files");
    expect(tail).toContain(`href="${FILM_URL}"`);
    expect(FILM_URL).toBe("https://youtu.be/jaqO2M2V6NY");
  });
});

describe("/judge: in the browser only", () => {
  it("has one script, hashed in a CSP that allows no connection and no unsafe-inline, with no fetch in it", () => {
    const html = judgePage();
    const blocks = scriptBlocks(html);
    expect(blocks).toHaveLength(1);
    const script = blocks[0]!.slice("<script>".length, -"</script>".length);
    expect(JUDGE_CSP).toContain(`script-src 'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`);
    expect(JUDGE_CSP).toContain("connect-src 'none'");
    expect(JUDGE_CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(script).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource|\.submit\(/);
    expect(html).not.toMatch(/<form/);
  });

  it("keeps the ticks in localStorage, every access inside try/catch", () => {
    const script = scriptBlocks(judgePage())[0]!;
    const uses = [...script.matchAll(/localStorage/g)].length;
    expect(uses).toBe(2);
    // Each use sits in a try block of its own line.
    for (const line of script.split("\n").filter((l) => l.includes("localStorage"))) expect(line).toMatch(/try \{.*localStorage.*\} catch \(e\) \{/);
  });

  it("the Worker serves it at /judge, with its CSP, only in a bundle that has /try/sign (three of its steps go there)", () => {
    const r = pageResponse(new Request(`${SITE}/judge`), ON);
    expect(r?.status).toBe(200);
    expect(r?.headers.get("content-security-policy")).toBe(JUDGE_CSP);
    expect(ON.judge).toBe(JUDGE_PAGE);
    expect(pageResponse(new Request(`${SITE}/judge`), OFF)).toBeNull();
    expect(OFF.judge).toBeUndefined();
  });
});

describe("the way in: Home, the README and the form", () => {
  it("Home has one link to /judge, at the top, and only when the bundle has /judge", () => {
    const home = ON.home!;
    expect(home.match(/href="judge"/g)).toHaveLength(1);
    expect(home).toContain(`<a href="judge">${JUDGE_LINK}</a>`);
    expect(JUDGE_LINK).toBe("Judge it in 3 minutes →");
    // At the top: before the hero and its heading.
    expect(home.indexOf('href="judge"')).toBeLessThan(home.indexOf('<section class="hero">'));
    expect(home.indexOf('href="judge"')).toBeGreaterThan(home.indexOf("<main>"));
    expect(OFF.home).not.toContain('href="judge"');
  });

  it("the README has one line to /judge near the top", () => {
    const lines = read("README.md").split("\n");
    const at = lines.findIndex((l) => l.includes(JUDGE_URL));
    expect(JUDGE_URL).toBe(`${SITE}/judge`);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(20);
    expect(lines[at]).toBe(`**[${JUDGE_LINK}](${JUDGE_URL})**`);
    expect(lines.filter((l) => l.includes(JUDGE_URL))).toHaveLength(1);
  });

  it("the form's jury instructions start with /judge, and the form stays under 4,000 characters", () => {
    const form = read("docs/submission/README.md");
    const ins = form.split("<!-- instructions -->")[1]!.split("<!-- /instructions -->")[0]!.trim();
    expect(ins.startsWith(`1. ${JUDGE_LINK.replace(/ →$/, "")}: ${JUDGE_URL}`)).toBe(true);
    expect(ins.length).toBeLessThan(4000);
    const description = form.split("<!-- description -->")[1]!.split("<!-- /description -->")[0]!.trim();
    expect(description.length).toBeLessThan(4000);
  });
});
