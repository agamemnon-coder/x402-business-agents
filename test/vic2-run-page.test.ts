// The second Airi run (vic-2, 7 Nov) on the site: on /visa under the VIC flow (in full, nothing folded) and on /airwallex
// and /proof (short, linking to /visa), every figure from its record (docs/demo/vic-2-run.json), nothing private, no person's
// name, and nothing at all when the record is not a clean live run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { VIC2_BADGES, VIC2_RUN_FILE, VIC2_RUN_LOG, vic2Lines, vic2Run, vic2RunHtml, type Vic2Record } from "../src/redesign/vic2Run.js";

const rec = JSON.parse(readFileSync(VIC2_RUN_FILE, "utf8")) as Vic2Record;
const pages = buildPages() as unknown as Record<string, string>;
const block = (html: string) => /<div class="card airi" id="airi-run-2">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the second Airi run on the site", () => {
  it("reads the committed live record: seven checks passed, 0 Airi and 0 Airwallex calls", () => {
    expect(vic2Run()).not.toBeNull();
    expect(rec).toMatchObject({ run: "vic-2", mode: "live", outside_calls: { airi: 0, airwallex: 0 } });
    expect(Object.keys(rec.checks)).toHaveLength(7);
    expect(Object.values(rec.checks).every((c) => c.ok)).toBe(true);
  });

  it("shows on /visa with the three outcomes from the record, and on /airwallex and /proof as its heading and checks", () => {
    for (const p of ["airwallex", "proof"]) {
      expect(text(block(pages[p]!)), p).toContain("What Purser adds around Airi: a second live run (7 Nov)");
      expect(text(block(pages[p]!)), p).toContain("7 of 7 checks pass");
      expect(block(pages[p]!), p).toContain('href="visa#airi-run-2"');
    }
    expect(block(pages.visa!)).not.toContain("<details");
    for (const p of ["visa"]) {
      const t = text(block(pages[p]!));
      expect(t, p).toContain("What Purser adds around Airi: a second live run (7 Nov)");
      for (const b of Object.values(VIC2_BADGES)) expect(t, p).toContain(b);
      expect(t, p).toContain("EUR 30.00");
      expect(t, p).toContain("EUR 190.00");
      expect(t, p).toContain("EUR 12.00");
      expect(t, p).toContain("refused before Airi was asked");
      expect(t, p).toContain("7 of 7 checks pass");
      expect(t, p).toContain("0 Airi and 0 Airwallex calls");
    }
    expect(block(pages.visa!)).toContain(VIC2_RUN_LOG);
  });

  it("comes after the first Airi run on each page", () => {
    for (const p of ["airwallex", "visa", "proof"]) expect(pages[p]!.indexOf('id="airi-run"'), p).toBeLessThan(pages[p]!.indexOf('id="airi-run-2"'));
  });

  it("holds nothing private and no person's name", () => {
    const raw = readFileSync(VIC2_RUN_FILE, "utf8");
    expect(raw).not.toMatch(/credential_id|assertion_sha256|"passkey":\s*\{/);
    expect(raw).not.toMatch(/\bmax \(|"Max"/i);
    for (const p of ["airwallex", "visa", "proof"]) expect(block(pages[p]!), p).not.toMatch(/#view=|runner=|\(passkey [A-Za-z0-9_-]+\)|\bMax\b/);
  });

  it("shows nothing when the record is not a clean live run", () => {
    expect(vic2RunHtml(null)).toBe("");
    const failed = structuredClone(rec);
    failed.checks.no_outside_calls!.ok = false;
    expect(vic2Lines(failed)).toHaveLength(3);
  });
});
