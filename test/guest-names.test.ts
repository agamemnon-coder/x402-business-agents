// Once the recordings come from a Northwind run, nothing a guest can open shows the earlier example company or the
// old agent names: the demo story, the recorded dashboard and landing figures, and the Metal award dossier.
// Until then (a recording without a company) this is skipped, and the pages say which company they show.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oldNamesIn } from "../src/demo/oldNames.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const northwind = (JSON.parse(read("docs/demo/story.json")) as { company?: string }).company === "Northwind Outdoor";

describe("guests see only Northwind", () => {
  it.skipIf(!northwind)("no old names in the recordings or the Metal dossier", () => {
    for (const f of ["docs/demo/story.json", "docs/demo/snapshot.json", "docs/metal-award.md"]) expect({ f, old: oldNamesIn(read(f)) }).toEqual({ f, old: [] });
  });

  it("finds the old names it guards against", () => {
    expect(oldNamesIn("the agent paid Feedstock via Contoso")).toEqual(["Feedstock", "Contoso"]);
    expect(oldNamesIn("the Sourcing agent paid Stockline")).toEqual([]);
  });
});
