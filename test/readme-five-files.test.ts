// The README's "How it works in 5 files" (Max's last round, item 3): each of the five places that enforce the limits and
// the approval is linked to the exact line that defines it. This test reads every such link and checks that the file
// exists and that the linked line still defines the symbol the link names, so a later edit that moves a function
// breaks this test instead of the README's anchors. It also checks the diagram (hand-written SVG: no script, no
// external font or link, readable in light and dark) and the commands the section asks a judge to run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const README = read("README.md");

const HEADING = "## How it works in 5 files";
const start = README.indexOf(HEADING);
const end = README.indexOf("\n## ", start + HEADING.length);
const SECTION = start < 0 ? "" : README.slice(start, end < 0 ? undefined : end);

/** Each [`symbol`](path#Lnn) link in a piece of markdown. */
function lineLinks(md: string): { symbol: string; path: string; line: number }[] {
  return [...md.matchAll(/\[`([A-Za-z_$][\w$]*)`\]\(([^)#\s]+)#L(\d+)\)/g)].map((m) => ({ symbol: m[1]!, path: m[2]!, line: Number(m[3]) }));
}

/** Whether a source line defines `symbol` (a function, const, class or type of that exact name). */
function defines(sourceLine: string, symbol: string): boolean {
  const forms = [`function ${symbol}(`, `function ${symbol}<`, `const ${symbol} =`, `const ${symbol}:`, `class ${symbol} `, `type ${symbol} =`, `interface ${symbol} `];
  return forms.some((f) => sourceLine.indexOf(f) >= 0);
}

/** Why a link does not hold, or null when the file exists and its line defines the symbol. */
function brokenAnchor(l: { symbol: string; path: string; line: number }, exists: (p: string) => boolean, lines: (p: string) => string[]): string | null {
  if (!exists(l.path)) return `${l.path} does not exist`;
  const src = lines(l.path)[l.line - 1];
  if (src === undefined) return `${l.path} has no line ${l.line}`;
  if (!defines(src, l.symbol)) return `${l.path}#L${l.line} does not define ${l.symbol}: ${src.trim().slice(0, 80)}`;
  return null;
}

const exists = (p: string) => existsSync(join(ROOT, p));
const sourceLines = (p: string) => read(p).split("\n");

describe("README: How it works in 5 files", () => {
  it("sits after the first screen and why this is a company, and before the deep docs links", () => {
    expect(start).toBeGreaterThan(README.indexOf("## The business hypothesis"));
    expect(README.indexOf("## The business hypothesis")).toBeGreaterThan(0);
    expect(start).toBeLessThan(README.indexOf("## Links"));
  });

  it("names five numbered places, linked to the symbols that enforce the limits and the approval", () => {
    expect(SECTION.match(/^\d\. \*\*/gm)?.length).toBe(5);
    expect(lineLinks(SECTION).map((l) => `${l.path} ${l.symbol}`)).toEqual([
      "src/policy/holds.ts reserveSpend",
      "src/lib/terms.ts termsHash",
      "src/passkey/webauthn.ts verifyApprovalSignature",
      "src/policy/approvals.ts beginExecution",
      "src/metal/pay.ts payUnderMandate",
      "src/audit/log.ts audit",
    ]);
  });

  it("every line link points at a file that exists and a line that still defines the named symbol", () => {
    const links = lineLinks(SECTION);
    expect(links.length).toBeGreaterThanOrEqual(5);
    expect(links.map((l) => brokenAnchor(l, exists, sourceLines)).filter(Boolean)).toEqual([]);
  });

  it("the check itself catches a moved line, a renamed symbol and a missing file", () => {
    const files: Record<string, string[]> = { "a.ts": ["// x", "export function reserveSpend(db) {", "export const audit = 1;"] };
    const has = (p: string) => p in files;
    const get = (p: string) => files[p]!;
    expect(brokenAnchor({ symbol: "reserveSpend", path: "a.ts", line: 2 }, has, get)).toBeNull();
    expect(brokenAnchor({ symbol: "audit", path: "a.ts", line: 3 }, has, get)).toBeNull();
    expect(brokenAnchor({ symbol: "reserveSpend", path: "a.ts", line: 1 }, has, get)).toMatch(/does not define reserveSpend/);
    expect(brokenAnchor({ symbol: "reserve", path: "a.ts", line: 2 }, has, get)).toMatch(/does not define reserve:/);
    expect(brokenAnchor({ symbol: "reserveSpend", path: "a.ts", line: 9 }, has, get)).toMatch(/has no line 9/);
    expect(brokenAnchor({ symbol: "x", path: "b.ts", line: 1 }, has, get)).toMatch(/does not exist/);
    expect(lineLinks("[`a`](x.ts#L3) [`b c`](y.ts#L1) [a](z.ts#L2)")).toEqual([{ symbol: "a", path: "x.ts", line: 3 }]);
  });

  it("every other relative link in the section exists", () => {
    const targets = [...SECTION.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((t) => !/^[a-z]+:/i.test(t)).map((t) => t.split("#")[0]!);
    expect(targets.length).toBeGreaterThanOrEqual(8);
    expect(targets.filter((t) => !exists(t))).toEqual([]);
  });
});

describe("the architecture diagram", () => {
  const SVG_PATH = "docs/assets/how-it-works.svg";
  const svg = read(SVG_PATH);

  it("is shown in the section", () => {
    expect(SECTION).toContain(`](${SVG_PATH})`);
  });

  it("is hand-written SVG with no script, no external font, image or link", () => {
    expect(svg.startsWith("<svg ")).toBe(true);
    for (const banned of ["<script", "<image", "<foreignObject", "@import", "@font-face", "href=", "url(http", "javascript:"]) {
      expect({ banned, found: svg.indexOf(banned) >= 0 }).toEqual({ banned, found: false });
    }
  });

  it("carries its own background and a dark scheme, so it reads in GitHub's light and dark themes", () => {
    expect(svg).toContain('<rect class="bg"');
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
  });

  it("draws the chain as the code runs it: policy, the passkey over the terms hash, the executor's re-hash, the rails, the audit chain", () => {
    for (const label of ["Agent", "Policy", "reserveSpend", "Approval", "SHA-256 of the", "Executor", "beginExecution", "Airwallex / Metal", "within the limits", "Audit log, hash-chained"]) {
      expect({ label, found: svg.indexOf(label) >= 0 }).toEqual({ label, found: true });
    }
  });
});

describe("Verify it yourself in 3 commands", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  // Since 13 Nov (the README upgrade) the three commands are the quick start, under 2 minutes: npm ci, the offline
  // judge check and the real approval's receipt; the full suite (npm test, 4 to 7 min) is its own line below.
  it("lists npm ci, npm run judge -- --check and npm run verify-approval in that order, then npm test and verify-receipt", () => {
    const block = SECTION.slice(SECTION.indexOf("```sh"), SECTION.indexOf("```", SECTION.indexOf("```sh") + 5));
    expect(block.split("\n").slice(1).filter(Boolean).map((l) => l.replace(/\s+#.*$/, ""))).toEqual(["npm ci", "npm run judge -- --check", "npm run verify-approval"]);
    expect(SECTION).toContain("The full suite, `npm test` (about 8 to 9 min on a laptop)");
    expect(SECTION).toContain("ExperimentalWarning: SQLite is an experimental feature");
    expect(SECTION).toContain("`npm run verify-receipt -- receipt.json`");
  });

  it("runs scripts that exist, and judge knows --check", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.judge).toBeDefined();
    expect(pkg.scripts["verify-receipt"]).toBeDefined();
    expect(read("src/cli/judge.ts")).toContain('"--check"');
  });

  it("says honestly what needs the network", () => {
    expect(SECTION).toContain("`npm ci` downloads packages from npm; after that, no network and no keys.");
    expect(SECTION).toContain("(that one needs the live site and your own\npasskey)");
  });

  it("the tests badge links to this section", () => {
    expect(README).toContain("](#verify-it-yourself-in-3-commands)");
    expect(SECTION).toContain("### Verify it yourself in 3 commands");
  });
});

// Docs hygiene (the jury of 12 November): one name, one traction sentence, one way into the docs. Each is read from
// the README, so a later edit there breaks this test instead of leaving two versions.
describe("the README's own words elsewhere: the package, the business pages, the docs index", () => {
  const flat = (s: string) => s.replace(/\s+/g, " ");

  it("package.json's description is the README's first sentence", () => {
    // The first sentence under the title, as written in the owner's centred top (13 Nov): bold, so the marks go.
    const lines = README.split("\n");
    const first = lines.slice(lines.findIndex((l) => l.startsWith("# Purser")) + 1).find((l) => l.trim() !== "")!.trim().replace(/^\*\*|\*\*$/g, "");
    expect(first.length).toBeGreaterThan(40);
    expect(first).toMatch(/^[A-Z][^\n]*\.$/);
    expect((JSON.parse(read("package.json")) as { description?: string }).description).toBe(first);
  });

  it("the business pages carry the README's traction sentence word for word", () => {
    const heading = "## The business hypothesis";
    const traction = /^[^\n]*?no pilots, no revenue\./m.exec(README.slice(README.indexOf(heading) + heading.length).trimStart())![0];
    expect(traction.startsWith("Not validated with customers yet")).toBe(true);
    for (const p of ["docs/business/README.md", "docs/business/model.md", "docs/business/problem.md", "docs/business/roadmap.md"]) {
      const t = flat(read(p));
      expect({ p, carries: t.includes(traction) }).toEqual({ p, carries: true });
      // No second, older version beside it.
      expect({ p, old: /no customer interviews|no discovery|have not validated demand/i.exec(t)?.[0] ?? null }).toEqual({ p, old: null });
    }
  });

  it("docs/README.md opens with five files in reading order, and each exists", () => {
    const index = read("docs/README.md");
    const firstList = /^(?:\d+\. [^\n]*\n)+/m.exec(index)![0];
    // Nothing but the title and one line of introduction comes before the list.
    expect(index.slice(0, index.indexOf(firstList)).trim().split("\n").filter(Boolean).length).toBeLessThanOrEqual(2);
    const links = [...firstList.matchAll(/^\d+\. \[[^\]]+\]\(([^)]+)\): \S/gm)].map((m) => m[1]!);
    expect(links).toEqual(["runs/README.md", "runs/2026-11-03-main-run.md", "claims.md", "controls-matrix.md", "business/README.md"]);
    for (const l of links) expect({ l, exists: exists(`docs/${l}`) }).toEqual({ l, exists: true });
    // The superseded documents have one line; the working notes are not what a reader is sent to.
    expect(index).toContain("[archive/](archive/)");
    expect(index).not.toMatch(/\]\(internal\//);
  });
});

describe("the archive is history, not evidence (review of 12 Nov)", () => {
  it("cites no archived document as the open status of a row of the requirements matrix (a dated finding may cite it)", () => {
    const rows = read("docs/requirements-matrix.md").split("\n").filter((l) => /^\| [A-Z]\d/.test(l));
    expect(rows.length).toBeGreaterThan(80);
    for (const row of rows) expect({ row: row.slice(0, 12), open: /docs\/archive\/[^|]*\(open\)/.test(row) }).toEqual({ row: row.slice(0, 12), open: false });
  });

  it("the archived quality plan names no other product for agent payments (this repository names no competitors)", () => {
    expect(read("docs/archive/quality-plan.md")).not.toMatch(/\b(Ramp|Brex|Payman|Skyfire|Crossmint|AgentKit|Agent Pay)\b/);
  });

  it("the pitch's spoken lines take their sources from current documents, or say that an archived one is kept for history", () => {
    for (const l of read("docs/submission/pitch.md").split("\n").filter((x) => x.includes("docs/archive/"))) expect(l).toMatch(/kept for history/);
  });
});
