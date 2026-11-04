// The story is no longer "code decides; the models only read and advise": Claude agents handle the exceptions (they
// decide inside their mandates, as agent run 1 recorded); Metal and Airwallex enforce the limits;
// the CFO approves anything beyond them. Breaks if the old line comes back anywhere a juror reads.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILM_SCENES as SCENES } from "../src/film/script.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const dir = (p: string, re: RegExp) => readdirSync(new URL(`../${p}`, import.meta.url)).filter((f) => re.test(f)).map((f) => `${p}/${f}`);
const OLD = /code decides|(models?|claude) only reads? and advises?/i;
const DOCS = [
  "README.md", "docs/claims.md", "docs/claude.md", "docs/metal-award.md", "docs/airwallex.md", "docs/controls-matrix.md",
  "docs/internal/uitleg-voor-max.md", "docs/fraud-and-injection.md", "docs/model-benchmark.md", "docs/demo/story.json", "docs/demo/metal.json",
  ...dir("docs/submission", /\.md$/), ...dir("docs/video", /\.(md|srt)$/),
];

describe("the core line", () => {
  it("is gone from every page the relay serves", () => {
    for (const [name, body] of Object.entries(buildPages())) {
      if (typeof body !== "string") continue;
      expect({ page: name, old: OLD.exec(body)?.[0] ?? null }).toEqual({ page: name, old: null });
    }
  });

  it("is gone from the film and the documents a juror reads", () => {
    for (const s of SCENES) expect({ scene: s.id, old: OLD.exec(s.voice)?.[0] ?? null }).toEqual({ scene: s.id, old: null });
    for (const d of DOCS) expect({ doc: d, old: OLD.exec(read(d))?.[0] ?? null }).toEqual({ doc: d, old: null });
  });

  it("says who enforces the limits on the trust beat", () => {
    expect(SCENES.find((s) => s.id === "trust")!.voice).toMatch(/^Claude agents handle the exceptions; Metal and Airwallex enforce the limits\./);
  });
});
