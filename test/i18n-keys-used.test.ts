// Every word key a page uses is in both languages and travels to the page that uses it. The console showed raw keys
// (nav.invoices, ov.tile.open, test.label) because its script asked for keys its catalogue filter left out; this
// collects the keys each page's script and HTML refer to and checks both.
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { detailPage, overviewPage } from "../src/servers/payablesPage.js";
import { transactionsPage } from "../src/servers/transactionsPage.js";
import { MESSAGES } from "../src/ui/i18n.js";

const KEY = "[a-z][a-z0-9_]*(?:\\.[a-z0-9_]+)+";
/** The literal keys a page refers to: t('k'), tn('k') (its _one/_other forms), tk('k', …) and data-t="k" in the HTML. */
function usedKeys(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(new RegExp(`\\b(t|tk)\\('(${KEY})'`, "g"))) out.add(m[2]!);
  for (const m of html.matchAll(new RegExp(`\\btn\\('(${KEY})'`, "g"))) { out.add(`${m[1]}_one`); out.add(`${m[1]}_other`); }
  for (const m of html.matchAll(new RegExp(`data-t="(${KEY})"`, "g"))) out.add(m[1]!);
  return [...out].sort();
}
const PAGES: [string, string][] = [
  ["console", consolePage("n0nce", { origin: "https://cloud.example", rpId: "cloud.example", mailDomain: "in.example" })],
  ["payables overview", overviewPage("c", "n", null, "nl")],
  ["invoice detail", detailPage("c", "n", "AP-0001", "nl")],
  ["transactions", transactionsPage("c", "n", "nl")],
];

describe("word keys in use", () => {
  for (const [name, html] of PAGES) {
    it(`${name}: every key it uses is in Dutch and English, and in the catalogue the page carries`, () => {
      const used = usedKeys(html);
      expect(used.length).toBeGreaterThan(5);
      const missingCatalogue = used.filter((k) => !(k in MESSAGES.nl) || !(k in MESSAGES.en));
      expect(missingCatalogue).toEqual([]);
      const notCarried = used.filter((k) => !html.includes(`"${k}":`));
      expect(notCarried).toEqual([]);
    });
  }
});
