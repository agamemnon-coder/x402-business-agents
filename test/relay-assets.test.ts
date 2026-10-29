// What the deploy step bundles into the Worker: the pages, their CSPs, and the phone script with its types stripped.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { jcs } from "@metalntwx/metal-pay/mandates";
import { buildPages, pagesModule } from "../src/relay/assets.js";
import { CSP as LOCAL_DASHBOARD_CSP } from "../src/servers/dashboard.js";

describe("relay assets", () => {
  const pages = buildPages();

  it("ships the phone script as plain JavaScript that still canonicalises like the runner", async () => {
    expect(pages.client).not.toMatch(/^\s*import /m);
    const file = join(mkdtempSync(join(tmpdir(), "kit11-client-")), "approve.mjs");
    writeFileSync(file, pages.client);
    const mod = (await import(pathToFileURL(file).href)) as { canonicalize: (v: unknown) => string };
    const sample = { b: "Müller \"x\"", a: [null, true, { d: "1.00", c: "" }] };
    expect(mod.canonicalize(sample)).toBe(jcs(sample));
  });

  it("serves the dashboard under the same CSP as the local server, and the phone pages with no inline code", () => {
    expect(pages.csp.dashboard).toBe(LOCAL_DASHBOARD_CSP);
    for (const csp of [pages.csp.approve, pages.csp.enrol]) {
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe");
    }
    for (const html of [pages.approve, pages.enrol]) {
      expect(html).not.toMatch(/<script>|<style>|\son\w+=/i);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).toContain('src="/assets/approve.js"');
    }
  });

  it("writes a module the Worker imports", () => {
    const mod = pagesModule(pages);
    expect(mod).toContain('import type { Pages } from "./core.js";');
    const json = mod.slice(mod.indexOf("= ") + 2, mod.lastIndexOf(";"));
    expect(JSON.parse(json)).toEqual(pages);
  });
});
