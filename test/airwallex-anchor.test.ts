// /proof's "Policy and card side by side" goes to /airwallex#controls, the fold of the cards beside the CFO policy, which
// is closed on the page. The link's anchor is that <details>'s id, each card inside it has its own (#card-<agent>), and
// the page's one script (OPEN_TARGET_JS) opens the fold around whatever the #hash points at, under a hashed CSP.
// test/browser/pages.check.ts opens /airwallex#controls at 390 and 1440 px and sees the cards open.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AWX_CONTROLS_ID, awxCardId } from "../src/redesign/airwallexProof.js";
import { OPEN_TARGET_JS } from "../src/redesign/ui.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const pages = buildPages();
const awx = pages.airwallex!, proof = pages.proof!;
/** Every id on a page, and the tag that carries it. */
const ids = (html: string) => [...html.matchAll(/<([a-z0-9]+)\b[^>]*\sid="([^"]+)"/g)].map((m) => ({ tag: m[1]!, id: m[2]! }));

describe("/proof → /airwallex#controls: the link and the ids match", () => {
  it("the link on /proof points at /airwallex's cards' fold, a <details>, closed on the page", () => {
    const links = [...proof.matchAll(/<a class="open" href="([^"]+)">Policy and card side by side/g)].map((m) => m[1]);
    expect(links).toEqual([`airwallex#${AWX_CONTROLS_ID}`]);
    expect(AWX_CONTROLS_ID).toBe("controls");
    expect(ids(awx).filter((x) => x.id === AWX_CONTROLS_ID)).toEqual([{ tag: "details", id: "controls" }]);
    expect(awx).toMatch(/<details class="fold" id="controls"><summary>Show each card: the CFO policy beside the Airwallex card control<\/summary>/);
    expect(awx).not.toMatch(/<details[^>]*\sopen/);
  });

  it("each card has its own id, #card-<agent>, inside that fold; no id twice on the page", () => {
    const fold = /<details class="fold" id="controls">[\s\S]*?<\/details>/.exec(awx)![0];
    const cards = [...fold.matchAll(/<div class="awcard" id="([^"]+)">/g)].map((m) => m[1]);
    expect(cards).toHaveLength(3);
    expect(cards).toEqual(expect.arrayContaining(["card-sourcing"]));
    for (const c of cards) expect(c).toMatch(/^card-[a-z0-9-]+$/);
    const all = ids(awx).map((x) => x.id);
    expect(new Set(all).size).toBe(all.length);
    expect(awxCardId("Sourcing")).toBe("card-sourcing");
    expect(awxCardId(" Data / buyer ")).toBe("card-data-buyer");
  });

  it("the page's one script opens the fold around the target and scrolls to it, hashed into a CSP that connects nowhere", () => {
    const scripts = scriptBlocks(awx);
    expect(scripts).toEqual([`<script>\n${OPEN_TARGET_JS}</script>`]);
    expect(OPEN_TARGET_JS).toContain('t.closest("details")');
    expect(OPEN_TARGET_JS).toContain('window.addEventListener("hashchange", openTarget)');
    expect(OPEN_TARGET_JS).toContain('t.scrollIntoView({ block: "start" })');
    const hash = createHash("sha256").update(`\n${OPEN_TARGET_JS}`, "utf8").digest("base64");
    expect(pages.csp.airwallex).toContain(`script-src 'sha256-${hash}'`);
    expect(pages.csp.airwallex).not.toMatch(/unsafe-inline|connect-src/);
  });

  it("run as written: opening #controls or #card-sourcing opens the fold; another hash, or none, leaves it closed", () => {
    // A tiny DOM: the fold, a card inside it, and something outside it.
    type El = { id: string; open?: boolean; parent: El | null; tag: string; scrolled?: number; closest(sel: string): El | null; parentElement: El | null; scrollIntoView(o: unknown): void };
    const mk = (tag: string, id: string, parent: El | null): El => {
      const e: El = { tag, id, parent, parentElement: parent, closest(sel) { for (let x: El | null = e; x; x = x.parent) if (x.tag === sel) return x; return null; }, scrollIntoView() { e.scrolled = (e.scrolled ?? 0) + 1; } };
      if (tag === "details") e.open = false;
      return e;
    };
    const run = (hash: string) => {
      const body = mk("main", "top", null), fold = mk("details", "controls", body), card = mk("div", "card-sourcing", fold), other = mk("p", "elsewhere", body);
      const byId: Record<string, El> = { top: body, controls: fold, "card-sourcing": card, elsewhere: other };
      const listeners: string[] = [];
      new Function("location", "document", "window", OPEN_TARGET_JS)({ hash }, { getElementById: (id: string) => byId[id] ?? null }, { addEventListener: (k: string) => listeners.push(k) });
      return { open: fold.open, scrolled: (fold.scrolled ?? 0) + (card.scrolled ?? 0), listeners };
    };
    expect(run("#controls")).toEqual({ open: true, scrolled: 1, listeners: ["hashchange"] });
    expect(run("#card-sourcing")).toEqual({ open: true, scrolled: 1, listeners: ["hashchange"] });
    expect(run("#elsewhere")).toMatchObject({ open: false, scrolled: 0 });
    expect(run("")).toMatchObject({ open: false, scrolled: 0 });
    expect(run("#%E0%A4%A")).toMatchObject({ open: false, scrolled: 0 });
  });
});

describe("scriptBlocks (test support): finds script blocks by position, in any case", () => {
  it("finds lower- and upper-case blocks, with attributes or a spaced end tag, and nothing else", () => {
    expect(scriptBlocks('<p>x</p><script>a()</script><SCRIPT type="module">b()</SCRIPT ><script>c()</script\n>')).toEqual(["<script>a()</script>", '<SCRIPT type="module">b()</SCRIPT >', "<script>c()</script\n>"]);
    expect(scriptBlocks("<p>no script here</p>")).toEqual([]);
    expect(scriptBlocks("<script>never closed")).toEqual(["<script>never closed"]);
  });
});
