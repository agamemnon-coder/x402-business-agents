// "Judge it in 3 minutes" (Max's last round, item 5.1): /judge, five steps a juror ticks off in the menu's order (Home,
// Try, Proof; the replay at /watch left the tour on 12 Nov), each a link to a page that already exists and one line of
// what they will see there.
// The ticks live in the browser only (localStorage, in try/catch); the page has no fetch and a CSP that allows no
// connection.
//
// The route check below is the one that sequences the merge: it fails, step by step, while a step links to a page the
// site does not serve yet (/trace, item 1.2) or to a part of /try/sign that is not built yet (step 0, PR #71, and the
// worst-case figure, item 1.1). No page is stubbed to make it pass.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageResponse } from "../worker/src/core.js";
import { buildPages, flowLinks } from "../src/relay/assets.js";
import { JUDGE_CSP, JUDGE_PAGE } from "../src/servers/dashboard.js";
import { JUDGE_CODE_HREF, JUDGE_LINK, JUDGE_STEPS, JUDGE_URL, judgePage } from "../src/redesign/judge.js";
import { FILM_URL } from "../src/config/brand.js";
import { FLOW_STEPS } from "../src/redesign/heroFlow.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { loadRecord } from "../src/redesign/run.js";
import { scriptBlocks } from "./support/scriptBlocks.js";
import { DEMO_CONNECTOR_TOKEN, PURSER_CLOUD_MCP, PURSER_CLOUD_URL } from "../src/ui/more.js";
import { DEMO_CONNECTOR_TOKEN as CLOUD_DEMO_TOKEN } from "../cloud/src/auth.js";

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
    "/proof": pages.proof, "/docs": pages.docs, "/watch": pages.watch, "/replay": pages.replay, "/home": pages.home, "/judge": pages.judge,
  };
  return by[p] ?? "";
}
/** Each step's own links on this site (not the explorer), as paths. */
const ownLinks = (s: (typeof JUDGE_STEPS)[number]) => s.links.map((l) => l.href).filter((h) => h.startsWith("/"));

/**
 * What each step's line says the juror will see, as a mark on the page it links to: a step says nothing its page does
 * not show. The marks on /try/sign hold before and after screen 1's live Treasury agent ("Purser's code checks it" is in
 * both of the trick screen's lines).
 */
const SEES: Record<string, { path: string; marks: (string | RegExp)[] }[]> = {
  // Home's own moment (enterprise pass, 12 Nov): the product card, its steps by name, the reader, the check, the signature.
  home: [{ path: "/home", marks: ['<figure class="hf"', ...FLOW_STEPS.map((s, i) => `<li class="hf-s${i}">${s}</li>`), "Claude reader", "Checker: ready to pay", "<b>Signed</b>", "<b>Paid</b>"] }],
  sign: [{ path: "/try/sign", marks: ["Your Treasury agent wants to pay an invoice above its limit.", "Now try to cheat: change one cent", 'id="go-cheat"', "Sign with Face ID"] }],
  trick: [{ path: "/try/sign", marks: ["Try to trick the agent.", "Send your agent a fake invoice", "Sonnet", "Purser's code checks it"] }],
  policy: [{ path: "/try/sign", marks: ["Change the rule.", 'id="rule-chips"', /worst.case/i, "The agent pays it alone.", "That's Purser."] }],
  // Purser Cloud is another site; its steps are on /docs, with the cloud's /mcp address and the demo token the cloud
  // itself names (cloud/src/auth.ts).
  cloud: [{ path: "/docs", marks: ['id="connect-ai"', "Try as guest", PURSER_CLOUD_MCP, DEMO_CONNECTOR_TOKEN, "Use the demo company"] }],
  proof: [
    { path: "/proof", marks: ['id="awx-1"', /\d of \d checks pass/] },
    { path: "/airwallex", marks: ['id="awx-1"', "LIMIT_EXCEEDED"] },
    { path: "/metal", marks: [metalStory(loadRecord().record).refusal?.proof.href ?? "no refusal in the record"] },
  ],
};

describe("/judge: the six steps", () => {
  it("go in the menu's order (Home, Try, Proof; no replay since 12 Nov), with their times, three minutes in all", () => {
    expect(JUDGE_STEPS.map((s) => [s.title, s.seconds])).toEqual([
      ["One payment on Home", 35],
      ["Sign, then try to cheat", 35],
      ["Try to trick the agent", 25],
      ["Paid, booked, filed", 25],
      // Jury, 13 Nov: Purser Cloud as a guest, with Claude on the demo company's public token.
      ["Open Purser Cloud as guest, connect Claude (demo token)", 30],
      ["See the proof", 30],
    ]);
    expect(JUDGE_STEPS.reduce((t, s) => t + s.seconds, 0)).toBe(180);
    // The guest step's token is the one the cloud takes (the site keeps its own copy, so no cloud code ships in its bundle).
    expect(DEMO_CONNECTOR_TOKEN).toBe(CLOUD_DEMO_TOKEN);
    expect(PURSER_CLOUD_MCP).toBe("https://purser-try.max-31b.workers.dev/mcp");
    expect(JUDGE_STEPS.map((s) => s.links.map((l) => l.href))).toEqual([
      // Since 12 Nov (one Try everywhere): steps 2 to 4 in the hands-on demo (TRY_URL); /try/sign once, as "the 60-second story".
      ["/home"], ["/try", "/try/sign"], ["/try"], ["/try"], [PURSER_CLOUD_URL, "/docs#connect-ai"], // The Visa run among the proof's links since 12 Nov (jury panel): the Airi run, Visa Intelligent Commerce via Airi.
      ["/proof", "/airwallex#awx-1", "/metal", "/visa", metalStory(loadRecord().record).refusal!.proof.href],
    ]);
    // The tour starts on Home and ends on the proof; no step is the replay, by its link, its title or its line.
    expect(JUDGE_STEPS[0]!.links[0]!.href).toBe("/home");
    expect(JUDGE_STEPS.at(-1)!.links[0]!.href).toBe("/proof");
    expect(JSON.stringify(JUDGE_STEPS)).not.toMatch(/watch|replay/i);
    // The first step's line names the card's own steps.
    expect(JUDGE_STEPS[0]!.see).toContain(FLOW_STEPS.join(", "));
    // Each says in one line what the juror will see.
    for (const s of JUDGE_STEPS) expect({ step: s.id, oneLine: s.see.length > 0 && !s.see.includes("\n") && s.see.length <= 200 }).toEqual({ step: s.id, oneLine: true });
  });

  // One test per step, so a red run names the steps whose pages are not on the site yet.
  for (const s of JUDGE_STEPS) {
    it(`step ${JUDGE_STEPS.indexOf(s) + 1} (${s.id}) links only to routes the site serves, and its page shows what the step says`, () => {
      for (const path of ownLinks(s)) expect({ step: s.id, path, status: served(path) }).toEqual({ step: s.id, path, status: 200 });
      expect({ step: s.id, checked: (SEES[s.id] ?? []).length > 0 }).toEqual({ step: s.id, checked: true });
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

  it("ends with /trace and the receipt check for more time, then the code (the README's five files) and the film", () => {
    expect(JUDGE_CODE_HREF).toBe("https://github.com/agamemnon-coder/x402-business-agents#how-it-works-in-5-files");
    expect(read("README.md")).toMatch(/^## How it works in 5 files$/m);
    const html = judgePage();
    const tail = html.slice(html.indexOf('<section class="more"'));
    for (const path of ["/trace", "/try/verify"]) {
      expect(tail).toContain(`href="${path}"`);
      expect({ path, status: served(path) }).toEqual({ path, status: 200 });
    }
    expect(tail).toContain("Want the code?");
    expect(tail).toContain(`href="${JUDGE_CODE_HREF}"`);
    expect(tail).toContain("How it works in 5 files");
    expect(tail).toContain(`href="${FILM_URL}"`);
    expect(FILM_URL).toBe("https://youtu.be/kCUsFHrxE-o");
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

  // Since 13 Nov in either bundle ("Judge" is in the top menu, jury): its one link to /try/sign leads to /try without it.
  it("the Worker serves it at /judge, with its CSP, in either bundle (step 2 links /try/sign's story only where it is served)", () => {
    expect(JUDGE_STEPS.filter((s) => s.links.some((l) => l.href === "/try/sign"))).toHaveLength(1);
    const r = pageResponse(new Request(`${SITE}/judge`), ON);
    expect(r?.status).toBe(200);
    expect(r?.headers.get("content-security-policy")).toBe(JUDGE_CSP);
    // As served (src/relay/assets.ts flowLinks); the header's "Try" tab is the hands-on demo at /try in either bundle.
    expect(ON.judge).toBe(flowLinks(JUDGE_PAGE, true));
    expect(pageResponse(new Request(`${SITE}/judge`), OFF)?.status).toBe(200);
    expect(OFF.judge).toBe(flowLinks(JUDGE_PAGE, false).replace(/<span class="sep"> · <\/span><a href="\/try\/verify">[^<]*<\/a>/, ""));
    expect(OFF.judge).not.toMatch(/href="\/try\/(sign|verify)"/);
  });
});

describe("the way in: Home, the README and the form", () => {
  it("Home is one story with two buttons (home-story, 12 Nov: try it, see the proof), with the tour as one quiet footer link where /judge exists", () => {
    expect(JUDGE_LINK).toBe("Judge it in 3 minutes →");
    // The tab in the menu (jury, 13 Nov) and the quiet footer link.
    expect(ON.home!.match(/href="judge"/g)).toHaveLength(2);
    expect(ON.home).toContain('<a href="judge">Judge</a>');
    expect(ON.home).toContain('<a class="flink" href="judge">Judging? Take the 3-minute tour</a>');
    expect(/<main[\s\S]*<\/main>/.exec(ON.home!)![0]).not.toContain('href="judge"');
    // Without /try/sign: the tab only, no footer line.
    expect(OFF.home!.match(/href="judge"/g)).toHaveLength(1);
    expect(OFF.home).toContain('<a href="judge">Judge</a>');
    // Home's two buttons are two of /judge's steps: /try/sign, then the proof. Home sends no one to the replay (/replay, at /watch until 12 Nov).
    expect(ON.home).toContain('<a class="btn primary big start" href="/try">'); expect(ON.home).toContain('<a class="btn big ghost" href="proof">');
    expect(/<main[\s\S]*<\/main>/.exec(ON.home!)![0]).not.toMatch(/href="(?:watch|replay)"/);
  });

  it("the README has one line to /judge near the top", () => {
    const lines = read("README.md").split("\n");
    const at = lines.findIndex((l) => l.includes(JUDGE_URL));
    expect(JUDGE_URL).toBe(`${SITE}/judge`);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(20);
    // In the README's one line of links under the pitch (jury panel, 12 Nov).
    expect(lines[at]).toContain(`**[${JUDGE_LINK}](${JUDGE_URL})**`);
    expect(lines.filter((l) => l.includes(JUDGE_URL))).toHaveLength(1);
  });

  it("the form's jury instructions start with /judge, and the form stays under 4,000 characters", () => {
    const form = read("docs/submission/README.md");
    const ins = form.split("<!-- instructions -->")[1]!.split("<!-- /instructions -->")[0]!.trim();
    // The link in <…>, no full stop glued to it (jury review, 7 Nov, #18).
    expect(ins.startsWith(`1. ${JUDGE_LINK.replace(/ →$/, "")}: <${JUDGE_URL}>`)).toBe(true);
    expect(ins).not.toMatch(/https:\/\/[^\s<>]*[.,](?=\s|$)/);
    expect(ins.length).toBeLessThan(4000);
    const description = form.split("<!-- description -->")[1]!.split("<!-- /description -->")[0]!.trim();
    expect(description.length).toBeLessThan(4000);
  });
});
