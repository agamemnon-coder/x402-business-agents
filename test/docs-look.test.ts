// The repository's Markdown pages in the README's house style (26 Nov 2026, Max: "just like our normal readme it should
// be more visuals, architecture, badges, everything! apply this to all our MD files"): a centred header with the Purser
// mark, the title, one bold line and a row of badges; Mermaid diagrams; tables and callouts. Every badge must be true:
// a static badge that states a figure says its record's figure (docs/badges/*.json, docs/assets/test-summary.json), a
// workflow badge names a workflow that exists, and no badge asks shields.io to fetch a file from the repository at view
// time (24 Nov: it could no longer reach raw.githubusercontent.com). Every relative link, image and anchor resolves, the
// root pages included (test/data-consistency.test.ts covers README.md and docs/ only for Markdown links, not HTML).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");
const exists = (p: string) => existsSync(`${ROOT}${p}`);

/** The pages redesigned in the house style, each with the centred header. */
export const STYLED = ["ROADMAP.md", "SECURITY.md", "GOVERNANCE.md", "CONTRIBUTING.md", "JUDGES.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "docs/architecture.md", "docs/how-it-works.md", "docs/security.md", "docs/cloud.md", "docs/agents.md", "docs/airwallex.md",
  "docs/README.md", "docs/proof/README.md", "docs/evidence/README.md", "docs/security/README.md", "docs/audit/README.md", "docs/submission/README.md", "docs/business/README.md", "docs/video/README.md", "examples/metal-dispute-desk/README.md", "docs/assets/brand/README.md", "docs/agent-api.md", "docs/mcp.md", "docs/ledger.md", "docs/cfo-policy.md", "docs/controls.md", "docs/controls-matrix.md", "docs/fraud-and-injection.md", "docs/hardening.md", "docs/enterprise.md", "docs/go-live.md", "docs/install.md", "docs/connections.md", "docs/connect-claude.md", "docs/ask-purser.md", "docs/autopilot.md", "docs/cards-and-clearing.md", "docs/agentos.md", "docs/kit11.md", "docs/decisions.md", "docs/in-depth.md", "docs/idea-vs-build.md", "docs/assurance.md", "docs/engine-events.md", "docs/erp.md", "docs/moneybird.md", "docs/accessibility.md", "docs/gallery.md", "docs/learning.md", "docs/finance-value.md", "docs/security/openssf-gold.md", "docs/security/SECURITY-MAPPING.md"];
/** Pages that carry the house-style badges (the judge-facing READMEs' header is test/readme-headers.test.ts's). */
const BADGED = [...new Set([...STYLED, "docs/README.md"])];

const withoutFences = (md: string) => md.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
const withoutCode = (md: string) => withoutFences(md).replace(/`[^`\n]*`/g, "``");

/** GitHub's heading anchors in a Markdown file (as test/data-consistency.test.ts computes them). */
function anchors(md: string): Set<string> {
  const out = new Set<string>(), seen = new Map<string, number>();
  for (const line of withoutFences(md).split("\n")) {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const plain = h[1]!.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[*`]/g, "");
      const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
      const k = seen.get(base) ?? 0;
      seen.set(base, k + 1);
      out.add(k ? `${base}-${k}` : base);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]!);
  }
  return out;
}

/** Every link target in a page: Markdown links (badges' outer links included) and HTML href, src and srcset. */
function targets(md: string): string[] {
  const body = withoutCode(md);
  return [
    ...[...body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!),
    ...[...body.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)].map((m) => m[1]!),
  ];
}

/** A shields.io static badge's label and message, decoded from its path ("label-message-colour"). */
function shields(url: string): { label: string; message: string } {
  const path = /img\.shields\.io\/badge\/([^?)]+)/.exec(url)![1]!;
  // Shields reads "--" as "-", "__" as "_" and "_" as a space: split on the single hyphens, then undo each.
  const parts = path.split(/(?<!-)-(?!-)/).map((p) => decodeURIComponent(p.replace(/--/g, "-").split("__").map((w) => w.replace(/_/g, " ")).join("_")));
  return parts.length >= 3 ? { label: parts[0]!, message: parts[1]! } : { label: "", message: parts[0]! };
}

/** The figures the records give: each docs/badges/*.json's label and message, and the full suite's test count. */
function recordFigures(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(`${ROOT}docs/badges`).filter((n) => n.endsWith(".json"))) {
    const b = JSON.parse(read(`docs/badges/${f}`)) as { label: string; message: string };
    out.set(b.label, b.message);
  }
  const t = JSON.parse(read("docs/assets/test-summary.json")) as { passed: number };
  out.set("tests, last full run", `${t.passed} passing`);
  return out;
}

const DIAGRAMS = /^(flowchart (LR|TB|TD|RL|BT)|sequenceDiagram|stateDiagram-v2|timeline|gantt|graph (LR|TB|TD)|xychart-beta( horizontal)?|pie( showData)?( title .+)?|quadrantChart)\s*$/;
/** The Mermaid charts that plot figures (26 Nov 2026, the owner: "graphs", from committed records only). */
const CHARTS = /^(xychart-beta|pie)\b/;

describe("the Markdown pages in the README's house style", () => {
  for (const f of STYLED) it(`${f}: opens with the centred header: the mark, one title, one bold line, badges`, () => {
    const md = read(f);
    const head = md.slice(0, md.indexOf("</div>"));
    expect(md.startsWith('<div align="center">\n\n')).toBe(true);
    const rel = posix.relative(posix.dirname(f), "docs/assets/brand"), up = rel ? `${rel}/` : "";
    expect(head).toContain(`<picture><source media="(prefers-color-scheme: dark)" srcset="${up}purser-mark-dark.svg"><img src="${up}purser-mark.svg" alt="Purser"`);
    expect(head.match(/^# \S.*$/gm) ?? []).toHaveLength(1);
    expect(md.match(/^# /gm) ?? []).toHaveLength(1);
    expect(head).toMatch(/^\*\*[^*\n]+\*\*$/m);
    expect(head).toMatch(/\[!\[[^\]]+\]\(https:\/\/[^)]+\)\]\([^)]+\)/);
  });

  for (const f of BADGED) it(`${f}: every badge is true: figures from their records, workflows that exist, nothing fetched from the repository`, () => {
    const md = read(f), figures = recordFigures();
    expect(md).not.toMatch(/img\.shields\.io\/(endpoint|badge\/dynamic)/);
    for (const u of md.matchAll(/https:\/\/img\.shields\.io\/badge\/[^)\s"]+/g)) {
      expect({ f, u: u[0], flat: u[0].includes("style=flat-square") }).toEqual({ f, u: u[0], flat: true });
      const { label, message } = shields(u[0]);
      if (figures.has(label)) expect({ f, label, message }).toEqual({ f, label, message: figures.get(label) });
    }
    for (const w of md.matchAll(/actions\/workflows\/([^/]+(?:\/codeql)?)\/badge\.svg/g))
      expect({ f, workflow: w[1], there: w[1] === "github-code-scanning/codeql" || exists(`.github/workflows/${w[1]}`) }).toEqual({ f, workflow: w[1], there: true });
  });

  it("the badge check is not empty: it reads the record figures on CONTRIBUTING.md's badges", () => {
    const figures = recordFigures();
    const read_ = [...read("CONTRIBUTING.md").matchAll(/https:\/\/img\.shields\.io\/badge\/[^)\s"]+/g)].map((u) => shields(u[0])).filter((b) => figures.has(b.label));
    expect(read_.map((b) => b.label).sort()).toEqual([[...figures.keys()].find((k) => k.startsWith("coverage, run on"))!, "tests, last full run"]);
  });

  for (const f of BADGED) it(`${f}: every relative link, image and #anchor resolves`, () => {
    const md = read(f), broken: string[] = [];
    for (const t of targets(md)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//") || t.startsWith("/")) continue;
      const [raw, anchor] = t.split("#", 2) as [string, string | undefined];
      const dest = raw ? posix.join(posix.dirname(f), decodeURIComponent(raw)) : f;
      if (!exists(dest)) { broken.push(`${t} (no file ${dest})`); continue; }
      if (anchor && dest.endsWith(".md") && !anchors(dest === f ? md : read(dest)).has(decodeURIComponent(anchor).toLowerCase())) broken.push(`${t} (no heading #${anchor} in ${dest})`);
    }
    expect({ f, broken }).toEqual({ f, broken: [] });
  });

  for (const f of BADGED) it(`${f}: each Mermaid block names a diagram type GitHub draws, with balanced brackets and quotes`, () => {
    for (const m of read(f).matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)) {
      // A leading "%%{init: …}%%" line sets the chart's colours; the diagram's type comes after it.
      const lines = m[1]!.split("\n").filter((l) => l.trim() && !/^\s*%%/.test(l));
      expect({ f, first: lines[0]!.trim(), known: DIAGRAMS.test(lines[0]!.trim()) }).toEqual({ f, first: lines[0]!.trim(), known: true });
      for (const l of lines) {
        const plain = l.replace(/"[^"]*"/g, '""');
        expect({ f, l, quotes: (l.match(/"/g) ?? []).length % 2 }).toEqual({ f, l, quotes: 0 });
        for (const [o, c] of [["[", "]"], ["(", ")"], ["{", "}"]] as const)
          expect({ f, l, [o]: plain.split(o).length - plain.split(c).length }).toEqual({ f, l, [o]: 0 });
      }
    }
  });

  // A chart plots figures, so the line under it names the committed record they come from (26 Nov 2026, the owner:
  // "graphs", real data only): "<sub>Record: [file](path) …</sub>", and the file exists.
  for (const f of BADGED) it(`${f}: each Mermaid chart cites the record its figures come from`, () => {
    const md = read(f);
    for (const m of md.matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)) {
      if (!CHARTS.test(m[1]!.replace(/^\s*%%.*$/gm, "").trim())) continue;
      const after = md.slice(m.index! + m[0].length).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      const cite = /^<sub>Record: .*?\]\(([^)#\s]+)[^)]*\)/.exec(after);
      expect({ f, chart: m[1]!.split("\n")[0], cite: after.slice(0, 60), cited: !!cite }).toEqual({ f, chart: m[1]!.split("\n")[0], cite: after.slice(0, 60), cited: true });
      expect({ f, record: cite![1], there: exists(posix.join(posix.dirname(f), cite![1]!)) }).toEqual({ f, record: cite![1], there: true });
    }
  });

  // GitHub shows an SVG as an image: it strips scripts, so an animation is CSS inside the file; each one small.
  for (const f of BADGED) it(`${f}: every SVG it shows exists, is under 30 KB and has no script`, () => {
    for (const t of targets(read(f)).filter((x) => /\.svg(#.*)?$/.test(x) && !/^[a-z][a-z0-9+.-]*:/i.test(x))) {
      const p = posix.join(posix.dirname(f), decodeURIComponent(t.split("#")[0]!));
      expect({ f, p, there: exists(p) }).toEqual({ f, p, there: true });
      const svg = read(p);
      expect({ p, small: statSync(`${ROOT}${p}`).size < 30 * 1024 }).toEqual({ p, small: true });
      expect({ p, script: /<script|\son[a-z]+=|javascript:/i.test(svg) }).toEqual({ p, script: false });
    }
  });
});
