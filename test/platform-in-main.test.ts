// The product for small companies (the payables inbox, the books, the vault, the accounting links, Purser Cloud) came
// into this repository on the owner's decision of 12 November (docs/decisions.md, D29). Every sentence about where it
// lives and who can use it must say what is true since then: the code is here, it is tested against stand-ins, it ran
// once end to end in the Airwallex sandbox on 10 November, a hosted preview exists but is private, no customer uses
// it, and it is not ready for real money. Breaks when a text goes back to "on a branch" or "never deployed", names a
// directory that does not exist, states a count its run record does not hold, or announces a public demo (none exists).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEXT_NEXT } from "../src/redesign/home.js";

const root = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(root(p), "utf8");
/** A Markdown section: from its "## " heading to the next one (or the end). */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const from = lines.findIndex((l) => heading.test(l));
  if (from < 0) throw new Error(`no section ${String(heading)}`);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => /^## /.test(l));
  return [lines[from]!, ...(to < 0 ? rest : rest.slice(0, to))].join("\n");
}
/** One paragraph, as read: line breaks and Markdown bold gone. */
const flat = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ");

const README_SECTION = section(read("README.md"), /^## Built after the kit/);
const LLMS_LINE = read("llms.txt").split("\n").find((l) => l.startsWith("- After the kit:")) ?? "";
const AFTER_KIT = read("docs/after-the-kit.md");
const CLAIMS_SECTION = section(read("docs/claims.md"), /^## Built after the kit/);
const RUNBOOK_CLOUD = section(read("docs/runbook.md"), /^## Purser Cloud/);
const FORM = read("docs/submission/README.md").split("<!-- description -->")[1]!.split("<!-- /description -->")[0]!;
const DECISION = (() => {
  const all = read("docs/decisions.md");
  const from = all.indexOf("\n### D29.");
  if (from < 0) return "";
  const next = all.indexOf("\n### D", from + 1);
  return all.slice(from, next < 0 ? undefined : next);
})();

/** Every text that says where the product lives or who can use it: [name, text]. */
const STATUS_TEXTS: [string, string][] = [
  ["README.md, Built after the kit", README_SECTION],
  ["README.md, Links", section(read("README.md"), /^## Links/)],
  ["llms.txt, After the kit", LLMS_LINE],
  ["docs/after-the-kit.md", AFTER_KIT],
  ["docs/README.md", read("docs/README.md")],
  ["docs/claims.md, Built after the kit", CLAIMS_SECTION],
  ["docs/submission/README.md, the Description", FORM],
  ["docs/payables.md", read("docs/payables.md")],
  ["docs/cloud.md", read("docs/cloud.md")],
  ["docs/go-live.md", read("docs/go-live.md")],
  ["docs/vault.md", read("docs/vault.md")],
  ["docs/runbook.md, Purser Cloud", RUNBOOK_CLOUD],
  ["src/redesign/home.ts", read("src/redesign/home.ts")],
  ["src/erp/source.ts", read("src/erp/source.ts")],
  ["cloud/wrangler.jsonc", read("cloud/wrangler.jsonc")],
];

/** What was true while the product sat on its integration branch, and is not any more. */
const STALE = [
  /on a (separate )?branch/i, /(its|their) own branch/i, /other branches/i, /backend branch/i, /`platform` branch/i, /this branch/i, /draft PR #113/i,
  /not deployed/i, /never deployed/i, /nothing (here )?is deployed/i, /deployed yet/i, /after 15 November, on Max's word/i,
  /\bnot public\b/i, /private preview only/i,
];

/** The directories and files of this repository a text names (`src/ap`, cloud/, docs/payables.md …), not the ones inside a URL. */
const namedPaths = (t: string) => [...new Set([...t.matchAll(/(?<![\w/.-])((?:src|docs|test)\/[\w./-]*[\w-]|cloud\/(?:[\w./-]*[\w-])?)/g)].map((m) => m[1]!.replace(/\/$/, "")))];

describe("the product for small companies, in this repository (decision D29, 12 November)", () => {
  it("no text still says it is on a branch, not in this repository, never deployed, or not public", () => {
    for (const [name, text] of STATUS_TEXTS) {
      for (const re of STALE) expect({ name, stale: re.exec(flat(text))?.[0] ?? null }).toEqual({ name, stale: null });
    }
  });

  it("the README, llms.txt and after-the-kit.md say where the code is, and every directory they name exists", () => {
    const DIRS = ["src/ap", "src/ledger", "src/vault", "src/erp", "src/payouts", "cloud"];
    for (const [name, text] of [["README.md", README_SECTION], ["llms.txt", LLMS_LINE], ["docs/after-the-kit.md", AFTER_KIT]] as const) {
      expect({ name, says: /in this repository/.test(flat(text)) }).toEqual({ name, says: true });
      const named = namedPaths(text);
      for (const dir of DIRS) expect({ name, dir, named: named.includes(dir) }).toEqual({ name, dir, named: true });
      for (const p of named) expect({ name, path: p, exists: existsSync(root(p)) }).toEqual({ name, path: p, exists: true });
    }
    // What each named directory holds is what the text says it holds.
    for (const [dir, file] of [["src/ap", "inbox.ts"], ["src/ledger", "core.ts"], ["src/vault", "build.ts"], ["src/erp", "connector.ts"], ["src/payouts", "plan.ts"], ["cloud", "src/console.ts"]] as const) {
      expect({ dir, file, exists: existsSync(root(`${dir}/${file}`)) }).toEqual({ dir, file, exists: true });
    }
  });

  it("says the same four things everywhere: tested against stand-ins, one sandbox run on 10 November, a private hosted preview with no customer, not ready for real money", () => {
    // llms.txt is served by the site (/llms.txt), whose pages never say "stand-in" (test/site-v4.test.ts): it says "fakes".
    for (const [name, text, tested] of [["README.md", README_SECTION, /tested against stand-ins/], ["llms.txt", LLMS_LINE, /tested offline on fakes of Airwallex and Claude/],
      ["docs/after-the-kit.md", AFTER_KIT, /tested against stand-ins/]] as const) {
      const t = flat(text);
      const has = (re: RegExp) => expect({ name, says: String(re), found: re.test(t) }).toEqual({ name, says: String(re), found: true });
      has(tested);
      has(/10 Nov/);
      has(/docs\/runs\/2026-11-10-platform-e2e\.md|runs\/2026-11-10-platform-e2e\.md/);
      has(/hosted preview exists but is private \(behind an access key\)/);
      has(/no customer uses it/);
      has(/not ready for real money/);
    }
    // The cloud's own pages say it too, where they said "not deployed".
    for (const p of ["docs/cloud.md", "docs/go-live.md"]) {
      const t = flat(read(p));
      expect({ p, preview: /hosted preview exists but is private \(behind an access key\)/.test(t), customer: /no customer uses it/.test(t) }).toEqual({ p, preview: true, customer: true });
    }
    expect(flat(RUNBOOK_CLOUD)).toMatch(/hosted preview exists but is private \(behind an access key\)/);
    expect(flat(read("docs/cloud.md"))).toMatch(/Not ready for real money/);
    expect(flat(read("docs/go-live.md"))).toMatch(/before real money/);
  });

  it("keeps the sandbox run's counts as its record has them", () => {
    type Company = { key: string; account: string; transfers: { status: string; transfer_id: string | null }[] };
    const facts = JSON.parse(read("docs/runs/2026-11-10-platform-e2e/facts.json")) as Company[];
    const transfers = facts.flatMap((c) => c.transfers);
    const paid = transfers.filter((t) => t.status === "PAID");
    const refused = transfers.filter((t) => t.status !== "PAID");
    expect([facts.length, paid.length, refused.length]).toEqual([3, 1, 3]);
    const words = `${paid.length} payout PAID, ${refused.length} refused by Airwallex`;
    for (const [name, text] of [["README.md", README_SECTION], ["llms.txt", LLMS_LINE], ["docs/after-the-kit.md", AFTER_KIT]] as const) {
      expect({ name, has: flat(text).includes(words) }).toEqual({ name, has: true });
      expect({ name, companies: new RegExp(`${["zero", "one", "two", "three"][facts.length]} test companies`).test(flat(text)) }).toEqual({ name, companies: true });
    }
    // The paid payout's id, on the page that tells the run.
    expect(AFTER_KIT).toContain(paid[0]!.transfer_id!);
    // The connected-account payout of the same day, as its own record has it.
    const connected = read("docs/runs/2026-11-10-connected-accounts-sandbox.md");
    for (const id of ["a9460dba-f31b-4111-be58-6d9a9e71adb1", "acct_SC-QD89fOneAeqaRFgOymw"]) {
      expect(connected).toContain(id);
      expect(AFTER_KIT).toContain(id);
    }
    expect(README_SECTION).toContain("a9460dba-f31b-4111-be58-6d9a9e71adb1");
    expect(LLMS_LINE).toContain("a9460dba-f31b-4111-be58-6d9a9e71adb1");
  });

  it("announces no public demo of it: none exists, and the site still calls it next, not live", () => {
    const announce = /public(ly)? (jury )?(demo|preview|console)|demo (world|environment) (is|are) (open|public|live)|open to (the public|everyone|anyone)|anyone can (try|sign in)|try the console/i;
    for (const [name, text] of STATUS_TEXTS) expect({ name, announces: announce.exec(flat(text))?.[0] ?? null }).toEqual({ name, announces: null });
    expect(NEXT_NEXT).toMatch(/^Next, not live yet:/);
  });

  it("the design notes of 8 November are marked as that day's, with today's status beside them", () => {
    const dir = "docs/superpowers/specs";
    const specs = readdirSync(root(dir)).filter((f) => /^2026-11-08-.*-design\.md$/.test(f));
    expect(specs.length).toBe(6);
    for (const f of specs) {
      const t = flat(read(`${dir}/${f}`));
      expect({ f, marked: /Status, 12 November 2026: .*design note of 8 November.*in this repository.*after-the-kit\.md/.test(t) }).toEqual({ f, marked: true });
    }
  });

  it("the decision is on record: who, when, why, and what stays true", () => {
    const t = flat(DECISION);
    expect(DECISION).toMatch(/^\n### D29\. .*\(the owner, 12 November\)/);
    for (const re of [/merged into `main` now/, /instead of after 15 November/, /jury/, /read the code/, /sandbox/i, /not ready for real money/,
      /independent review of the integrated tree .*(pending|not been done)/, /pull request #113/, /public demo .*does not exist yet/]) {
      expect({ says: String(re), found: re.test(t) }).toEqual({ says: String(re), found: true });
    }
  });
});
