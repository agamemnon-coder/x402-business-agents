// What the deploy step bundles into the Worker: the pages, their CSPs, and the phone script with its types stripped.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { jcs } from "@metalntwx/metal-pay/mandates";
import { buildPages, pagesModule } from "../src/relay/assets.js";
import { CSP as LOCAL_DASHBOARD_CSP, FONT, PAGE as LOCAL_DASHBOARD } from "../src/servers/dashboard.js";
import { withAppHead } from "../src/pwa/manifest.js";

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

  it("serves the dashboard under the same CSP as the local server, and each phone page as one document under a CSP of hashes", () => {
    expect(pages.csp.dashboard).toBe(LOCAL_DASHBOARD_CSP);
    // The same page, with the installed app's tags in its head on the relay (src/pwa/manifest.ts); tags only, so the
    // same CSP. The runner's local page links no manifest (it serves none).
    expect(pages.dashboard).toBe(withAppHead(LOCAL_DASHBOARD, "site"));
    expect(LOCAL_DASHBOARD).not.toContain('<link rel="manifest"');
    expect(Buffer.from(pages.font, "base64").equals(FONT)).toBe(true);
    // Since the outside audit (finding 1.5) the script and stylesheet are inline, each allowed by its SHA-256, so the page's
    // bytes are all that runs and their hash is published (test/approval-page-integrity.test.ts holds the rest).
    for (const csp of [pages.csp.approve, pages.csp.enrol, pages.csp.policy]) {
      expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/]+=*';/);
      expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/]+=*';/);
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe");
    }
    for (const html of [pages.approve, pages.enrol, pages.policy]) {
      const markup = html.replace(/<script type="module">[\s\S]*?<\/script>/, "").replace(/<style>[\s\S]*?<\/style>/, "");
      expect(markup).not.toMatch(/<script|<style|\son\w+=/i);
      expect(markup).not.toMatch(/https?:\/\//);
      expect(html).toContain(`<script type="module">${pages.client}</script>`);
      expect(html).toContain(`<style>${pages.css}</style>`);
    }
  });

  it("writes a module the Worker imports", () => {
    const mod = pagesModule(pages);
    expect(mod).toContain('import type { Pages } from "./core.js";');
    const json = mod.slice(mod.indexOf("= ") + 2, mod.lastIndexOf(";"));
    expect(JSON.parse(json)).toEqual(pages);
  });
});
