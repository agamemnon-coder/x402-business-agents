// Watch is out of the menu (home-story, 12 Nov; the owner: "the Watch page is really outdated, it has to go"). The menu
// is Home, Try, Proof (at most five items); no served page's navigation, Home, or the judge tour leads to the replay.
// The page is not deleted: it stays at /watch (/live and /demo still lead there), under the Proof tab, and its heading
// says what it is: a replay of the main run of 3 November, the day read from the record. In sight it shows no proposal
// number and no tool name; every step, with its tools and ids, is in a fold. And no served page links to a path the
// site does not serve.
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { NAV_MAIN, navHtml } from "../src/ui/nav.js";
import { header, STAGE_JS } from "../src/redesign/ui.js";
import { JUDGE_STEPS, judgePage } from "../src/redesign/judge.js";
import { agentRun, loadRecord } from "../src/redesign/run.js";
import { inSight, replayHead, watchPage } from "../src/redesign/watch.js";
import { scriptBlocks, scriptBody, textOutsideTags, withoutBlocks } from "./support/scriptBlocks.js";

const SITE = "https://x.test";
const ON = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const OFF = buildPages({} as NodeJS.ProcessEnv);
const run = agentRun();
const { record } = loadRecord();

/** Every HTML page of a bundle, by name: the entries that are HTML documents (the phone's script, stylesheet and font,
 * llms.txt and the JSON files are not pages). */
function htmlPages(pages: Pages): [string, string][] {
  const flat = Object.entries(pages as unknown as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && /^\s*<!doctype html/i.test(e[1]));
  return [...flat, ...Object.entries(pages.agents ?? {}).map(([id, a]): [string, string] => [`agents/${id}`, a.page])];
}
const navs = (html: string) => [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map((m) => m[0]);
const noScript = (html: string) => withoutBlocks(html, ["script", "style"], " ");
/** What a visitor sees before opening anything: no script, no style, no fold's inside (its header stays). */
const inSightHtml = (html: string) => noScript(html).replace(/<details\b[^>]*>\s*(<summary[^>]*>[\s\S]*?<\/summary>)[\s\S]*?<\/details>/g, " $1 ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** A link in a navigation to the replay (/replay; /watch until 12 Nov), or an item named Watch; the film on YouTube is neither. */
const toReplayIn = (nav: string) => [...nav.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!).find((h) => !/^https?:/.test(h) && /(^|\/)(watch|replay)([?#]|$)/.test(h)) ?? items(nav).find((t) => /^watch$/i.test(t)) ?? null;
/** The items of a menu as a visitor reads them: its links, and a fold's header for a fold. */
const items = (nav: string) => [...nav.replace(/<details\b[\s\S]*?<\/details>/g, (d) => /<summary[^>]*>[\s\S]*?<\/summary>/.exec(d)?.[0] ?? "").matchAll(/<(a|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => textOutsideTags(m[2]!).replace(/\s+/g, " ").trim());

describe("the menu: Home, Try, Proof, and no Watch", () => {
  it("in both definitions: the redesign's header and the older pages' navigation", () => {
    for (const [name, nav] of [["src/redesign/ui.ts", navs(header(null))[0]!], ["src/ui/nav.ts", navHtml(null)]] as const) {
      expect({ name, first: items(nav).slice(0, 3) }).toEqual({ name, first: ["Home", "Try", "Proof"] });
      expect({ name, max: items(nav).length <= 5 }).toEqual({ name, max: true });
      expect({ name, watch: /watch/i.test(nav) }).toEqual({ name, watch: false });
    }
    expect(NAV_MAIN.map(([key]) => key).slice(0, 3)).toEqual(["home", "try", "proof"]);
    expect(JSON.stringify(NAV_MAIN)).not.toMatch(/watch/i);
    // A page under the replay's old tab marks Proof now: the replay itself, and the two old addresses that lead to it.
    for (const key of ["watch", "live", "demo"] as const) expect(navHtml(key)).toContain('<a href="proof" data-nav="proof" class="on" aria-current="page">Proof</a>');
  });

  it("in the navigation of every page the site serves, with and without /try/sign", () => {
    for (const [build, pages] of [["with /try/sign", ON], ["without", OFF]] as const) {
      const all = htmlPages(pages);
      expect(all.length).toBeGreaterThan(20);
      for (const [name, html] of all) {
        for (const nav of navs(html)) expect({ build, name, watch: toReplayIn(nav) }).toEqual({ build, name, watch: null });
        const main = navs(html).find((n) => /aria-label="Main"/.test(n));
        if (!main) continue;
        expect({ build, name, first: items(main).slice(0, 3) }).toEqual({ build, name, first: ["Home", "Try", "Proof"] });
        expect({ build, name, max: items(main).length <= 5 }).toEqual({ build, name, max: true });
      }
      // The pages a juror opens all carry the menu.
      for (const name of ["home", "try", "proof", "watch", "metal", "airwallex", "visa", "claude", "notFound"]) expect({ build, name, menu: navs((pages as unknown as Record<string, string>)[name]!).some((n) => /aria-label="Main"/.test(n)) }).toEqual({ build, name, menu: true });
    }
  });

  it("Home does not name or link the replay, in either build", () => {
    for (const [build, html] of [["with /try/sign", ON.home!], ["without", OFF.home!]] as const) {
      expect({ build, link: /href="\/?(watch|replay|live|demo)\b[^"]*"/.exec(html)?.[0] ?? null }).toEqual({ build, link: null });
      expect({ build, word: /\bWatch\b|\breplay/i.exec(text(noScript(html)))?.[0] ?? null }).toEqual({ build, word: null });
    }
  });

  it("the judge tour has no replay step and no link to /watch; it starts on Home and still adds up to three minutes", () => {
    expect(JSON.stringify(JUDGE_STEPS)).not.toMatch(/watch|replay/i);
    expect(JUDGE_STEPS[0]!.links.map((l) => l.href)).toEqual(["/home"]);
    expect(JUDGE_STEPS.reduce((t, s) => t + s.seconds, 0)).toBe(180);
    for (const html of [judgePage(), ON.judge!]) {
      expect(html).not.toMatch(/href="\/?(watch|live|demo)\b/);
      expect(html).toContain("<h1 class=\"h-hero\">Judge it in 3 minutes</h1>");
      // The one "Watch" left on /judge is the film's link, not a tab or a step.
      expect(text(/<ol class="steps">[\s\S]*?<\/ol>/.exec(html)![0])).not.toMatch(/\bwatch|replay/i);
    }
  });

  it("the CFO dashboard's landing for a guest offers Home, Try and Proof", () => {
    const landing = /<div id="landing" hidden>[\s\S]*?<\/section>/.exec(ON.dashboard)![0];
    expect([...landing.matchAll(/<a class="btn[^"]*" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])).toEqual([["home", "Home"], ["try", "Try"], ["proof", "Proof"]]);
  });
});

describe("/replay answers, as a replay under Proof (it was /watch until the film's page took that address, 12 Nov)", () => {
  const html = ON.replay!;

  it("is served at /replay, and /live and /demo lead to it", () => {
    for (const pages of [ON, OFF]) {
      const r = pageResponse(new Request(`${SITE}/replay`), pages);
      expect(r?.status).toBe(200);
      expect(r?.headers.get("content-security-policy")).toBe(pages.csp.replay);
      for (const old of ["/live", "/demo"]) {
        const moved = pageResponse(new Request(`${SITE}${old}`), pages);
        expect({ old, status: moved?.status, to: moved?.headers.get("location") }).toEqual({ old, status: 302, to: "/replay" });
      }
    }
    expect(OFF.replay).toContain('href="try" data-next="try"');
    expect(html).toContain('href="try/sign" data-next="try"');
  });

  it("says in its heading that it is a replay of the main run of 3 November, the day read from the record", () => {
    // The day of the run's first row, written out, as the run's label counts it (src/redesign/run.ts runSpan).
    const first = record.snapshot.agent_chat.map((c) => c.ts).concat(record.snapshot.flows.map((f) => f.at)).sort()[0]!;
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(first));
    expect(day).toBe("3 November");
    expect(replayHead(run)).toEqual({ heading: `Replay of the main run, ${day}`, rest: run.label.replace(/^Replay of the main run, 3 Nov /, "") });
    expect(run.label.startsWith("Replay of the main run, 3 Nov ")).toBe(true);
    expect([...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1])).toEqual([`Replay of the main run, ${day}`]);
    expect(html).toContain(`<title>Replay of the main run, ${day}</title>`);
    // A record of another day gives another heading: nothing here is typed by hand.
    const later = { ...run, label: "Replay of the main run and its follow-up, 9 Dec 08:00–08:10 UTC · test money · real Claude decisions" };
    expect(replayHead(later).heading).toBe(`Replay of the main run and its follow-up, ${day}`);
    expect(replayHead(later).rest).toBe("08:00–08:10 UTC · test money · real Claude decisions");
    expect(watchPage(run)).toBe(buildPages({} as NodeJS.ProcessEnv).replay);
  });

  it("marks the Proof tab, and nothing on it calls the replay live", () => {
    const main = navs(html).find((n) => /aria-label="Main"/.test(n))!;
    expect([...main.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(["Proof"]);
    // The one "live" on the page is the world's own: Northwind sells live stock data. Nothing says the replay is live.
    const words = text(noScript(html)).replace(/live stock data/g, " ");
    expect(/\blive\b/i.exec(words)?.[0] ?? null).toBeNull();
    expect(words).not.toMatch(/Watch the agents/);
    // The numbered "step 2" of the old way through (watch, then try) is gone: the way on is a plain card.
    expect(html).not.toContain('<span class="fn">');
    expect(html).toContain('<a class="nextstep card" href="try/sign" data-next="try"><span class="ft"><b>Now try it yourself</b>');
  });

  // The run's own tool names, from the record: every tool any decision used.
  const TOOLS = [...new Set(run.events.flatMap((e) => (e.k === "say" ? e.tools ?? [] : [])))];
  const PROPOSAL = /\bP-\d{3,}/;

  it("shows no proposal number and no tool name outside a fold, in the page as it opens", () => {
    expect(TOOLS.length).toBeGreaterThan(5);
    const sight = inSightHtml(html);
    expect(PROPOSAL.exec(sight)?.[0] ?? null).toBeNull();
    expect(sight).not.toMatch(/class="tool"/);
    // A tool's name as the record writes it (set_buy_policy, plan_invoice…); "market" and "position" are also plain words.
    for (const t of TOOLS.filter((x) => x.includes("_"))) expect({ tool: t, shown: text(sight).includes(t) }).toEqual({ tool: t, shown: false });
    // Every step, with its tools and ids, is one fold, closed until asked for.
    expect(html).toMatch(/<details class="card logp" id="steps"><summary><h2 id="h-log">Every step, with its tools and ids<\/h2><svg[\s\S]*?<\/svg><\/summary><ol class="log" id="log" aria-labelledby="h-log"><\/ol><\/details>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("plays every step on the stage without proposal numbers or tool names: the words in sight are built with the page", () => {
    const data = JSON.parse(/<script type="application\/json" id="run-data">([\s\S]*?)<\/script>/.exec(html)![1]!) as { events: Record<string, unknown>[]; highlights: Record<string, unknown>[] };
    expect(data.events).toHaveLength(run.events.length);
    let reworded = 0;
    for (const e of [...data.events, ...data.highlights]) {
      // What the stage, its caption and its tooltips read of a step (src/redesign/ui.ts STAGE_JS, watch.ts caption()).
      const proof = e.proof as { label?: string } | undefined, refused = e.refused as { reason?: string } | null | undefined;
      const shown = [e.see ?? e.text, e.seeWhat ?? e.what, e.title, e.label, e.via, e.run, e.cap, e.budget, proof?.label, refused?.reason, ...((e.signers as string[] | undefined) ?? [])].filter((v): v is string => typeof v === "string");
      for (const v of shown) {
        expect({ at: e.at, v, id: PROPOSAL.exec(v)?.[0] ?? null }).toEqual({ at: e.at, v, id: null });
        for (const t of TOOLS.filter((x) => x.includes("_"))) expect({ at: e.at, tool: t, shown: v.includes(t) }).toEqual({ at: e.at, tool: t, shown: false });
      }
      if (e.see !== undefined || e.seeWhat !== undefined) reworded++;
      // The record's own words stay whole in the data, for the fold.
      if (e.see !== undefined) expect(PROPOSAL.test(String(e.text))).toBe(true);
      if (e.seeWhat !== undefined) expect(PROPOSAL.test(String(e.what))).toBe(true);
    }
    expect(reworded).toBeGreaterThan(0);
    // The stage never draws a tool chip or a proposal's id, and the page's script shows it only steps passed through sight().
    expect(STAGE_JS).not.toMatch(/\.tools|"tool"|ev\.id\b/);
    const script = scriptBody(scriptBlocks(html).find((b) => b.toLowerCase().startsWith("<script>"))!);
    expect(script.match(/st\.show\(/g)!.length).toBe(script.match(/st\.show\(sight\(/g)!.length);
    expect(script.match(/\bcaption\(sight\(/g)).toHaveLength(1);
    // The chips and ids are drawn in one place: a row of the fold's list.
    const entry = script.slice(script.indexOf("function entry(e)"), script.indexOf("function sceneOf"));
    expect(script.match(/"tool"/g)).toHaveLength(1);
    expect(entry).toContain('el("span", "tool", t)');
    expect(script.replace(entry, "")).not.toMatch(/\be\.id\b/);
  });

  it("cuts a proposal number out of a step's words without rewording them", () => {
    // A line of Purser's own: only the reference goes.
    expect(inSight("EUR 110.00 bought for USD 124.29, only the shortfall, for P-0005")).toBe("EUR 110.00 bought for USD 124.29, only the shortfall");
    expect(inSight("The CFO set the sourcing agent's card to 46.00 EUR a purchase (P-0006, Face ID)")).toBe("The CFO set the sourcing agent's card to 46.00 EUR a purchase (Face ID)");
    expect(inSight("A rebalance (P-0002/P-0003) was sent")).toBe("A rebalance was sent");
    // An agent's several sentences: the ones that name a proposal are left out, the gap is marked, the rest is word for word.
    expect(inSight("I planned the payment. It's now P-0005, waiting for your Face ID. I recommend paying now.")).toBe("I planned the payment. … I recommend paying now.");
    expect(inSight("So I sent the CFO a rebalance as P-0002/P-0003. I recommended A.")).toBe("… I recommended A.");
    // One sentence that cannot lose its reference cleanly: the number becomes "…".
    expect(inSight("It is P-0005 now")).toBe("It is … now");
    // No proposal number: nothing changes, not even the spacing.
    expect(inSight("No change.  Budget stays at 9.54.")).toBe("No change.  Budget stays at 9.54.");
    for (const e of run.events) if ("text" in e && typeof e.text === "string") expect(PROPOSAL.test(inSight(e.text))).toBe(false);
  });
});

describe("no served page links to a path the site does not serve", () => {
  /** Where a bundle's pages are served. */
  const PATHS: Record<string, string> = {
    dashboard: "/?recorded", home: "/home", watch: "/watch", replay: "/replay", try: "/try", proof: "/proof", trace: "/trace", runs: "/runs", month: "/month", film: "/film", lab: "/lab",
    metal: "/metal", metalReport: "/metal/report", visa: "/visa", airwallex: "/airwallex", claude: "/claude", t0: "/t0", pricing: "/pricing", security: "/security", docs: "/docs", status: "/status", trySign: "/try/sign", tryVerify: "/try/verify", judge: "/judge",
    enrol: "/enrol", policy: "/policy", approve: "/approve/P-0001", notFound: "/no/such/page",
  };
  /** The status a GET ends in, following redirects as a browser does; 404 for no page. */
  function served(url: string, pages: Pages): number {
    let r = pageResponse(new Request(url), pages);
    for (let hops = 0; r && r.status === 302 && hops < 3; hops++) r = pageResponse(new Request(new URL(r.headers.get("location")!, url)), pages);
    return r?.status ?? 404;
  }

  /**
   * Known and not this stream's to fix (src/redesign/runs.ts, being rebuilt by its own stream): /runs links four run logs
   * by a repository path ("../../docs/runs/….md"), which the site does not serve. Left out here by that exact shape.
   */
  const RUN_LOG = /^\.\.\/\.\.\/docs\/runs\/[\w.-]+\.md$/;

  for (const [build, pages] of [["with /try/sign", ON], ["without", OFF]] as const) {
    it(`${build}: every internal link in the markup of every page answers, after a redirect at most; only Proof (and the 404's old button) leads to the replay`, () => {
      let links = 0;
      const toReplay = new Set<string>();
      for (const [name, html] of htmlPages(pages)) {
        // /demo and /live are built but answered by a redirect to /watch: no visitor reads their markup.
        if (name === "demo" || name === "live") continue;
        const at = name.startsWith("agents/") ? `/${name}` : PATHS[name];
        expect({ name, at: at ?? "no path for this page in the test" }).toEqual({ name, at });
        if (name !== "notFound") expect({ name, at, status: served(`${SITE}${at}`, pages) }).toEqual({ name, at, status: 200 });
        for (const m of noScript(html).matchAll(/<a\b[^>]*\bhref="([^"#]*)(?:#[^"]*)?"/g)) {
          const href = m[1]!.replace(/&amp;/g, "&");
          // /health (linked from /status since 12 Nov) is the service's JSON endpoint, answered before the page router.
          if (!href || /^(https?:|mailto:)/.test(href) || (name === "runs" && RUN_LOG.test(href)) || (name === "status" && /^health(\/live)?$/.test(href))) continue;
          links++;
          const url = new URL(href, `${SITE}${at}`);
          expect({ build, name, href, status: served(url.toString(), pages) }).toEqual({ build, name, href, status: 200 });
          if (/^\/(replay|live|demo)$/.test(url.pathname)) toReplay.add(name);
        }
      }
      expect(links).toBeGreaterThan(100);
      // The replay is reached from Proof. The 404 page still has a "Watch" button among its four (src/redesign/partners.ts,
      // another stream's file): the one other way in until that stream takes it out. No other page links to it.
      expect([...toReplay].filter((name) => name !== "proof" && name !== "notFound")).toEqual([]);
    });
  }
});
