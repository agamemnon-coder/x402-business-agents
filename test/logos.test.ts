// Partner logo files (src/ui/logos/): each kept byte for byte as downloaded, its SHA-256 on record in the folder's
// README with its source; Visa and Cloudflare only with the owner's stated permission on record
// (docs/evidence/logo-permissions.md); served as /assets/logo-*; never worded as an endorsement.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOGOS } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url));
const readme = read("src/ui/logos/README.md").toString("utf8");
const evidence = read("docs/evidence/logo-permissions.md").toString("utf8");

describe("partner logos", () => {
  it("Visa and Cloudflare: unmodified, hash and source on record, served", () => {
    for (const [file, asset, source] of [["visa.png", "logo-visa.png", "corporate.visa.com"], ["cloudflare.png", "logo-cloudflare.png", "cloudflare.com/press-kit"]] as const) {
      const body = read(`src/ui/logos/${file}`);
      expect(readme).toContain(createHash("sha256").update(body).digest("hex"));
      expect(readme).toContain(source);
      expect(LOGOS[asset]?.body.equals(body)).toBe(true);
    }
  });
  it("the owner's stated permission and each brand's own words are on record", () => {
    expect(evidence).toMatch(/12 November 2026/);
    expect(evidence).toMatch(/As\s+stated by the owner/);
    expect(evidence).toMatch(/No document is\s+attached/);
    expect(evidence).toContain("media usage only");
    expect(evidence).toContain("requires our written permission");
  });
  it("never claims an endorsement", () => {
    const strip = (s: string) => s.replace(/never "certified", "endorsed", "approved by" or "partner of"/g, "").replace(/Neither is "certified", "endorsed", "approved by" or "partner of" anything/g, "");
    for (const s of [readme, evidence]) expect(strip(s.replace(/\s+/g, " "))).not.toMatch(/certified|endorsed by|approved by|partner of/i);
  });
});
