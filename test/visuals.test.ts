// The visual system (src/visuals/): the committed files under docs/assets/ are what the code draws now; colours come
// from the site's tokens; every figure in "refused by the rail itself" is read from its record; no images, no outside
// references, no logos; motion only where the viewer allows it, and the first frame is the whole picture.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visualFiles } from "../src/visuals/files.js";
import { airiHold, airwallexHold, metalRefusal, railRefusals, TWO_LOCKS_LOG } from "../src/visuals/facts.js";
import { LIFE_STEPS, VISUAL_CSS, architectureSvg, lifecycleSvg, refusalsSvg, wrap } from "../src/visuals/svg.js";
import { palette } from "../src/visuals/tokens.js";
import { TOKENS } from "../src/redesign/ui.js";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const files = visualFiles();

describe("visual files", () => {
  it("every committed file is what the code draws now (npm run visuals)", () => {
    for (const [path, body] of Object.entries(files)) expect(read(path), path).toBe(body);
  });
  it("hold no images, scripts, outside references or brand marks", () => {
    for (const [path, body] of Object.entries(files)) {
      expect(body, path).not.toMatch(/<image|<script|<foreignObject|xlink:href|url\((?!#)|@import|data:/i);
      const links = [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      for (const l of links) expect(l, path).toMatch(/^https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/blob\/main\/docs\/runs\//);
      expect(body, path).not.toMatch(/certified|endorsed|partnered with/i);
    }
  });
  it("carry no style attributes, so they fit the site's hash-based CSP", () => {
    for (const s of [architectureSvg("wide"), lifecycleSvg("tall"), refusalsSvg(railRefusals(), (p) => p)]) {
      expect(s).not.toMatch(/ style="/);
      expect(s).not.toMatch(/<style>/);
    }
  });
  it("take their colours from the site's tokens, light and dark", () => {
    const light = palette("light"), dark = palette("dark");
    expect(TOKENS).toContain(`--accent: ${light.accent};`);
    expect(TOKENS).toContain(`--accent: ${dark.accent};`);
    expect(files["docs/assets/architecture-wide-dark.svg"]).toContain(`--bg:${dark.bg}`);
    expect(files["docs/assets/architecture-wide-light.svg"]).toContain(`--bg:${light.bg}`);
  });
});

describe("motion", () => {
  it("animates only under prefers-reduced-motion: no-preference", () => {
    const outside = VISUAL_CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/animation:/);
    expect(VISUAL_CSS).toMatch(/prefers-reduced-motion: no-preference/);
  });
  it("draws every step in the first frame; the animation only adds a highlight", () => {
    const s = lifecycleSvg("wide");
    for (const step of LIFE_STEPS) expect(s).toContain(`>${step.h}<`);
    expect(LIFE_STEPS).toHaveLength(8);
    expect(VISUAL_CSS).toMatch(/\.pv \.pv-ring \{[^}]*opacity: 0;/);
    for (let i = 0; i < LIFE_STEPS.length; i++) expect(VISUAL_CSS).toContain(`.pv .pv-d${i} {`);
  });
});

describe("refused by the rail itself: from the records", () => {
  it("Airwallex: the two-locks run log", () => {
    const a = airwallexHold()!, log = read(TWO_LOCKS_LOG);
    expect(a.code).toBe("IN_APPROVAL");
    expect(log).toContain(a.what.match(/transfer ([0-9a-f]{8})…/)![1]!);
    expect(log).toContain(a.what.match(/EUR \d+\.\d\d/)![0]);
    expect(log).toMatch(/\*\*Not completed\.\*\*/);
  });
  it("Airwallex: a log that no longer says it was never approved drops the card", () => {
    expect(airwallexHold(read(TWO_LOCKS_LOG).replace("**Not completed.**", "Completed."))).toBeNull();
  });
  it("Metal: the main run's refusal on chain", () => {
    const m = metalRefusal()!, rec = read("docs/demo/main-run.json");
    expect(m.code).toBe("mandate_cap_exceeded");
    expect(m.proof!.href).toMatch(/^https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/);
    expect(rec).toContain(m.proof!.href.split("/tx/")[1]);
  });
  it("Airi: says what held, and that Airi has not refused outright", () => {
    const a = airiHold()!;
    expect(a.note).toMatch(/has not refused a purchase outright/);
    expect(a.label).toMatch(/test card, test money/);
    expect(airiHold({ mode: "dry", test_money: true, test_card: true, attempts: [] })).toBeNull();
  });
  it("each card names its date and its sandbox or testnet label", () => {
    const s = files["docs/assets/rail-refusals-wide-light.svg"]!;
    for (const r of railRefusals()) { expect(s).toContain(r.label); expect(s).toContain(r.record); }
  });
});

it("wrap keeps words whole", () => {
  expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
});

describe("partner logos", async () => {
  const { createHash } = await import("node:crypto");
  const { BUILT_WITH, LEFT_OUT } = await import("../src/visuals/logos.js");
  const sources = read("docs/assets/logos/SOURCES.md");
  it("every logo shown is an official file whose hash is on record, unmodified", () => {
    for (const l of BUILT_WITH) {
      const hash = createHash("sha256").update(readFileSync(new URL(l.file, root))).digest("hex");
      expect(sources, l.file).toContain(hash);
    }
  });
  it("every logo left out is named with its reason", () => {
    for (const l of LEFT_OUT) expect(sources).toContain(`| ${l.name} |`);
  });
  it("never claims more than 'built with'", () => {
    const draft = read("docs/readme-v2-draft.md");
    expect(draft).toMatch(/Built with/);
    expect(`${draft}\n${sources.replace(/never with "certified", "endorsed",\n"approved by" or "partner of"/, "")}`).not.toMatch(/certified|endorsed by|approved by|partner of/i);
  });
});
