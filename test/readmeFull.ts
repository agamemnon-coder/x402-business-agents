// 15 Nov (jury panel: "the README is 6,255 words"): long README sections moved to docs/ files, each heading kept in the
// README with one line that links its file. readmeFull() puts each moved body back under its heading, with its links
// as from the repository's root again, so a test of what the README tells a reader (with the docs it links in place of
// a section) still reads the same words. Tests of the README's own length and first screen read README.md itself.
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** The docs files that hold a README section since 15 Nov, in the README's order. */
export const README_DOCS = ["docs/kit11.md", "docs/airwallex-centre.md", "docs/gallery.md", "docs/visa-award.md", "docs/enterprise.md", "docs/see-it.md", "docs/how-it-works.md", "docs/charts.md", "docs/connect-any-ai.md", "docs/built-after-the-kit.md", "docs/who-does-what.md"] as const;

const MOVED = "Moved from the [README](../README.md) on 15 November, to keep it short.\n\n";

/** A moved file's links, from docs/ back to the repository's root (the inverse of how they were moved). */
export function rootLinks(text: string): string {
  const fix = (u: string) => (u.startsWith("../README.md#") ? u.slice("../README.md".length) : /^(?:https?:|mailto:|#|\/)/.test(u) ? u : u.startsWith("../") ? u.slice(3) : `docs/${u}`);
  return text.replace(/\]\(([^)\s]+)\)/g, (_, u: string) => `](${fix(u)})`).replace(/(src|srcset|href)="([^"]+)"/g, (_, a: string, u: string) => `${a}="${fix(u)}"`);
}

/** The body a moved file holds: everything under its title and the "Moved from the README" line, links from the root. */
export function movedBody(file: string): string {
  const t = read(file);
  const i = t.indexOf(MOVED);
  if (i < 0) throw new Error(`${file} does not say it was moved from the README`);
  return rootLinks(t.slice(i + MOVED.length).replace(/\n+$/, ""));
}

/** The README with every moved section's body in place of its one-line link. */
export function readmeFull(readme = read("README.md")): string {
  let out = readme;
  for (const f of README_DOCS) {
    const line = new RegExp(`\\n[^\\n]*\\]\\(${f.replace(/[.]/g, "\\.")}\\)\\.\\n`);
    if (!line.test(out)) throw new Error(`the README has no line linking ${f}`);
    out = out.replace(line, () => `\n${movedBody(f)}\n`);
  }
  return out;
}
