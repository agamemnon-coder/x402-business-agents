import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFilm } from "../src/film/film.js";
import { FILM_SCENES, filmTimeline } from "../src/film/script.js";
import { FILM_CSP, filmPage } from "../src/servers/dashboard.js";
import type { Story } from "../src/demo/story.js";
import type { Recorded } from "../src/demo/recorded.js";

const story = JSON.parse(readFileSync("docs/demo/story.json", "utf8")) as Story;
const recorded = JSON.parse(readFileSync("docs/demo/snapshot.json", "utf8")) as Recorded;
const reports = { redteam: { attempts: 34, blocked: 34 }, lab: { total: 18, passed: 18 } };

describe("the film", () => {
  it("takes its numbers from the recordings", () => {
    const f = buildFilm(story, recorded, reports);
    expect(f.card).toMatchObject({ small: "19.99", big: "45.00", from: "30.00", to: "50.00", last4: "8120" });
    expect(f.bill).toMatchObject({ invoice: "1,850.00", usd: "418.40", eur: "370.00", fee: "13.41", ceiling: "20.00" });
    expect(f.metal).toMatchObject({ cap: "0.03", newPrice: "0.04" });
    expect(f.dispute.rows).toHaveLength(12);
    expect(f.mandates[0]).toMatchObject({ name: "Operations agent", cap: "0.03" });
    expect(f.trust).toMatchObject({ blocked: 34, passed: 18, per1000: "$0.09" });
  });

  it("stops the build when a recorded fact is missing, rather than invent one", () => {
    const broken = { ...story, steps: story.steps.filter((s) => s.id !== "swift") };
    expect(() => buildFilm(broken, recorded, reports)).toThrow(/swift/);
  });

  it("times ten scenes back to back, under three minutes", () => {
    const t = filmTimeline();
    expect(t.map((s) => s.id)).toEqual(FILM_SCENES.map((s) => s.id));
    expect(t.at(-1)!.start + t.at(-1)!.seconds).toBe(173);
  });

  it("serves a page whose every scene has an animation, under its own CSP", () => {
    const html = filmPage();
    expect(html).not.toContain("__FILM_JSON__");
    for (const s of FILM_SCENES) expect(html).toContain(`    ${s.id}: function (L)`);
    expect(FILM_CSP).toContain("script-src 'sha256-");
  });
});
