// The integrations band on Home and /docs (Max, 21 Nov: "Logos of the companies you can integrate with, as a moving
// band, on the homepage (and on /docs), showing that you can work with them"). Held here: every name in the band is a
// connection Purser Cloud's hub lists (cloud/src/connections.ts), and the line under it sends the reader to the hub's
// labels; every mark is a file the site serves, the same drawing as the Connections page's, on a white tile, never
// filtered or recoloured; Visa and T:0 are text; the band moves only with script and without a wish for less motion.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BAND, BAND_HUB, BAND_NOTE, LOGO_BAND_CSS, LOGO_BAND_JS, bandLogoFiles, logoBandHtml } from "../src/redesign/integrations.js";
import { BRAND_LOGOS } from "../cloud/src/brandLogos.gen.js";
import { connectionsCatalogue } from "../cloud/src/connections.js";
import { homePage } from "../src/redesign/home.js";
import { docsPage } from "../src/redesign/docs.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Each name in the band, and the hub's connection that carries it (by its name, and the word in its name or its text). */
const HUB: Record<string, [connection: string, word: string]> = {
  Airwallex: ["Airwallex", "Airwallex"], "Alta (formerly Metal)": ["Alta (formerly Metal)", "Alta"], Visa: ["Visa via Airwallex Airi", "Visa"],
  Claude: ["MCP server (Connect any AI)", "Claude"], "T:0": ["T:0 (outside ledger)", "T:0"], ChatGPT: ["MCP server (Connect any AI)", "ChatGPT"],
  Cursor: ["MCP server (Connect any AI)", "Cursor"], "VS Code": ["MCP server (Connect any AI)", "VS Code"], Gemini: ["MCP server (Connect any AI)", "Gemini"],
  MCP: ["MCP server (Connect any AI)", "MCP"], Xero: ["Xero", "Xero"], QuickBooks: ["QuickBooks Online", "QuickBooks"], Exact: ["Exact Online (CSV)", "Exact"],
  Moneybird: ["Moneybird (API)", "Moneybird"], Odoo: ["Business Central and Odoo (API)", "Odoo"], Slack: ["Slack and Microsoft Teams messages", "Slack"],
  "Microsoft Teams": ["Slack and Microsoft Teams messages", "Microsoft Teams"], WhatsApp: ["Approval alerts (e-mail, WhatsApp, Slack, Teams)", "WhatsApp"],
  Gmail: ["Invoices by e-mail (forwarded from Gmail or Outlook)", "Gmail"], Zapier: ["Zapier and Make (HTTP modules)", "Zapier"], Make: ["Zapier and Make (HTTP modules)", "Make"],
  Python: ["TypeScript and Python SDKs", "Python"], TypeScript: ["TypeScript and Python SDKs", "TypeScript"],
};

describe("The integrations band", () => {
  it("names only connections the hub lists, and sends the reader to the hub for each one's label", () => {
    const cat = connectionsCatalogue("https://cloud.example");
    const all = [...cat.connections, ...cat.money] as { name: string; what: string }[];
    expect(BAND.map((b) => b.name).sort()).toEqual(Object.keys(HUB).sort());
    for (const b of BAND) {
      const [name, word] = HUB[b.name]!;
      const c = all.find((x) => x.name === name);
      expect({ band: b.name, hub: c ? `${c.name} ${c.what}`.includes(word) : "missing" }).toEqual({ band: b.name, hub: true });
    }
    // n8n's node is not built yet (its hub entry says so): it is not in the band.
    expect(BAND.map((b) => b.name)).not.toContain("n8n");
    expect(BAND_NOTE).toBe("Each connection carries its label: live, sandbox, testnet, export or built.");
    expect(logoBandHtml()).toContain(`${BAND_HUB}" target="_blank" rel="noopener">`);
    expect(read(BAND_HUB)).toMatch(/label/i);
  });

  it("serves every mark from the site, the Connections page's own drawing, on a white tile, never filtered; Visa and T:0 as text", () => {
    const pages = buildPages({} as NodeJS.ProcessEnv);
    const files = bandLogoFiles();
    for (const b of BAND.filter((x) => x.file)) expect({ file: b.file, served: !!pages.images[b.file!] }).toEqual({ file: b.file, served: true });
    for (const [name, f] of Object.entries(files)) {
      const key = name.replace(/^brand-|\.svg$/g, "");
      expect(`data:image/svg+xml,${encodeURIComponent(f.body.toString("utf8"))}`.length).toBeGreaterThan(0);
      expect(decodeURIComponent(BRAND_LOGOS[key]!.uri.slice("data:image/svg+xml,".length))).toBe(f.body.toString("utf8"));
    }
    expect(BAND.filter((b) => !b.file).map((b) => b.name)).toEqual(["Visa", "T:0"]);
    expect(logoBandHtml()).not.toMatch(/logo-visa|brand-visa/);
    expect(LOGO_BAND_CSS).toMatch(/\.lb-i \{[^}]*background: #ffffff/);
    expect(LOGO_BAND_CSS).not.toMatch(/filter:|mix-blend-mode|opacity/);
    // Every mark has its name: in the alt of a wordmark, beside the drawing otherwise.
    for (const b of BAND.filter((x) => x.file)) expect(logoBandHtml()).toContain(b.wordmark ? `alt="${b.name}"` : `alt="${b.name}" width="24" height="24" decoding="async"><span>${b.name}</span>`);
  });

  it("moves only with its script's copy and without a wish for less motion; the copy is hidden from screen readers", () => {
    const [still, ...moving] = LOGO_BAND_CSS.split("@media (prefers-reduced-motion: no-preference)");
    expect(moving).toHaveLength(1);
    expect(still).not.toMatch(/animation:/);
    expect(moving[0]).toContain(".lband.loop .lb-track { animation: lb-drift");
    expect(LOGO_BAND_JS).toContain('matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
    expect(LOGO_BAND_JS).toContain('dup.setAttribute("aria-hidden", "true")');
    expect(logoBandHtml().match(/<ul class="lb-row">/g)).toHaveLength(1);
  });

  it("is on Home, under the hero, and on /docs, each page with its script", () => {
    for (const html of [homePage(), docsPage()]) {
      expect(html).toContain('<div class="lband" role="group"');
      expect(html).toContain("lb-drift");
      expect(html).toContain('dup.classList.add("lb-dup")');
    }
    const home = homePage();
    expect(home.indexOf('<section class="e-band"')).toBeGreaterThan(home.indexOf('<section class="e-hero"'));
    expect(home.indexOf('<section class="e-band"')).toBeLessThan(home.indexOf('<section class="e-agents"'));
  });
});
