import { describe, expect, it } from "vitest";
import { mdCell, pageText, wallFigures } from "../src/cli/verifyAllFormat.js";
import { NEVER_ON_PROOF } from "../src/redesign/proofQuestions.js";

describe("verify-all's text helpers", () => {
  it("decode an entity once: &amp; last, so &amp;quot; stays &quot;", () => {
    expect(pageText("a &amp;quot; b")).toBe("a &quot; b");
    expect(pageText("<p>x &quot;y&quot; &#39;z&#39; &amp; w</p>")).toBe(" x \"y\" 'z' & w ");
  });
  it("escape a table cell's backslash before its pipe", () => {
    expect(mdCell("a \\| b")).toBe("a \\\\\\| b");
    expect(mdCell("a | b\nc")).toBe("a \\| b c");
  });
});

// Outside audit, 22 November: verify-all read the wall's figures with a regex that wanted <b class="ew-f"> right after the
// tile's link; /proof's tiles have put a visual (<span class="ew-v …">) in between since 19bddc1d8, so all 58 read as
// missing. wallFigures reads each tile's figure inside its own <li>, run here on the pages as they are built now.
describe("verify-all reads every evidence-wall tile on the pages as built", () => {
  it("/proof: every tile on /proof, with the figure docs/evidence/evidence-wall.json holds", async () => {
    const { proofPage } = await import("../src/redesign/proof.js");
    const { committedWall, onProof } = await import("../src/redesign/evidenceWall.js");
    const html = proofPage();
    expect(html).toContain('<span class="ew-v'); // the shape that broke the old regex is there
    const seen = wallFigures(html);
    const tiles = onProof(committedWall()!).groups.flatMap((g) => g.tiles).filter((t) => !NEVER_ON_PROOF.has(t.key));
    expect(tiles.length).toBeGreaterThan(40);
    for (const t of tiles) expect({ key: t.key, fig: seen.get(t.key) }).toEqual({ key: t.key, fig: t.fig });
  });

  it("a partner page's strip, and a tile with no figure, and &amp;", async () => {
    const { airwallexPage } = await import("../src/redesign/partners.js");
    const { PARTNER_STRIPS, committedWall } = await import("../src/redesign/evidenceWall.js");
    const seen = wallFigures(airwallexPage());
    const wall = committedWall()!.groups.flatMap((g) => g.tiles);
    for (const key of PARTNER_STRIPS.airwallex.keys) {
      const t = wall.find((x) => x.key === key);
      if (t) expect({ key, fig: seen.get(key) }).toEqual({ key, fig: t.fig });
    }
    expect(wallFigures('<li data-wall="a"><a href="x"><span class="ew-v"><svg></svg></span><b class="ew-f">1 &amp; 2</b></a></li><li data-wall="b">no figure</li><li data-wall="c"><a><b class="ew-f">3</b></a></li>'))
      .toEqual(new Map([["a", "1 & 2"], ["c", "3"]]));
  });
});
