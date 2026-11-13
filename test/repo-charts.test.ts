// The README's charts and the changelog are generated, never typed (scripts/repo-charts.ts, scripts/changelog.ts): the
// charts drawn from the committed records are redrawn here and must equal the committed SVGs; the git-history chart
// needs the full history, so here it only has to exist with its source said. The changelog's parser and grouping are
// checked on sample merge lines. Breaks when a record changes and `npm run charts` was not run, or a chart loses its
// source line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changelog, groupOf, parseMerges } from "../scripts/changelog.js";
import { CHART_DIR, mainRun, recordCharts, runsPerRail } from "../scripts/repo-charts.js";

const ROOT = join(import.meta.dirname, "..");

describe("the README's charts", () => {
  it("are the committed SVGs, redrawn from the records", () => {
    for (const [name, body] of Object.entries(recordCharts(ROOT))) expect({ name, same: readFileSync(join(CHART_DIR, name), "utf8") === body }).toEqual({ name, same: true });
  });

  it("count what the records say: the main run's 24 decisions by Claude and its refusals, and the runs per rail", () => {
    const m = mainRun(JSON.parse(readFileSync(join(ROOT, "docs/demo/main-run.json"), "utf8")));
    expect(m.total).toMatchObject({ decisions: 24, byClaude: 24 });
    expect(m.refusals.reduce((n, r) => n + r.value, 0)).toBe(16);
    const rails = runsPerRail(readFileSync(join(ROOT, "docs/runs/README.md"), "utf8"));
    expect(rails.map((r) => r.label)).toEqual(expect.arrayContaining(["Airwallex sandbox", "Metal testnet"]));
    expect(rails.every((r) => r.value > 0)).toBe(true);
  });

  it("has the git-history chart, saying its source, and every chart is linked from the README", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(existsSync(join(CHART_DIR, "tests-over-time.svg"))).toBe(true);
    expect(readFileSync(join(CHART_DIR, "tests-over-time.svg"), "utf8")).toContain("From git history");
    for (const name of [...Object.keys(recordCharts(ROOT)), "tests-over-time.svg"]) expect(readme).toContain(`docs/assets/charts/${name}`);
  });
});

describe("the changelog", () => {
  const log = [
    "2026-11-13\tMerge pull request #234 from agamemnon-coder/fix-c43-1113\tHand-in film: claim C43 follows the new /books page",
    "2026-11-12\tMerge pull request #158 from agamemnon-coder/tokenize-run-1112\tRun record: invoice token on Metal testnet, live (12 Nov)",
    "2026-11-09\tMerge pull request #113 from agamemnon-coder/platform: Purser platform into main\tPayables, bookkeeping core",
    "2026-11-09\tnot a merge line",
  ].join("\n");

  it("reads GitHub's merge commits, the branch without a suffix, and nothing else", () => {
    expect(parseMerges(log).map((m) => [m.pr, m.branch])).toEqual([[234, "fix-c43-1113"], [158, "tokenize-run-1112"], [113, "platform"]]);
  });

  it("groups by the first rule that matches, and links each pull request", () => {
    const [film, run] = parseMerges(log);
    expect(groupOf(run!)).toBe("Live runs and run records");
    expect(groupOf(film!)).toBe("Books: ledger, T:0, Moneybird and ERP");
    expect(changelog(parseMerges(log), "v1.0-submission", "https://github.com/o/r")).toContain("[#158](https://github.com/o/r/pull/158) Run record");
  });

  // Squash merges count too (13 Nov: #258, #262, #263, #268 and #273 were squashed and the changelog missed them).
  it("reads GitHub's squash merges as well as its merge commits, and puts the latest day first", () => {
    const log = "2026-11-13\tREADME follow-up: screenshots (#273)\t\n2026-11-12\tMerge pull request #250 from o/firefox-retry\tFirefox checks: retry\n2026-11-12\tA direct commit, no PR\t";
    expect(parseMerges(log)).toEqual([{ date: "2026-11-13", pr: 273, branch: "", title: "README follow-up: screenshots" }, { date: "2026-11-12", pr: 250, branch: "firefox-retry", title: "Firefox checks: retry" }]);
    const md = changelog(parseMerges(log), "v1.0-submission", "https://github.com/o/r");
    expect(md).toContain("### Merged on 13 November 2026, the latest day (1)\n\n- [#273](https://github.com/o/r/pull/273) README follow-up: screenshots");
  });

  it("gives the release notes the same counts, total and per group", () => {
    const md = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const notes = readFileSync(join(ROOT, "docs/releases/v1.1-final.md"), "utf8");
    expect(notes).toContain(`${/, (\d+) in all/.exec(md)![1]} pull requests merged into main`);
    for (const [, group, body] of md.matchAll(/^## (.+)\n\n([\s\S]*?)(?=\n## |$(?![\s\S]))/gm)) {
      const n = (body!.match(/^- /gm) ?? []).length;
      expect({ group, line: new RegExp(`^- ${group!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${n}\\b`, "m").test(notes) }).toEqual({ group, line: true });
    }
  });

  it("is committed, generated, and lists every pull request it counts", () => {
    const md = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const n = Number(/, (\d+) in all/.exec(md)![1]);
    expect(md).toContain("Generated by `npm run changelog`");
    expect((md.match(/^- \d{4}-\d{2}-\d{2} · \[#\d+\]/gm) ?? []).length).toBe(n);
  });
});

describe("the README's diagrams and media", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const blocks = (md: string) => [...md.matchAll(/```mermaid\n[\s\S]*?```/g)].map((m) => m[0]);

  // Since 13 Nov (the README upgrade): five diagrams in docs/diagrams.md; the README inlines four of them, word for word
  // and in the same order, and links the fifth (who holds which limit), which its one-line diagram now sums up.
  it("inlines three of docs/diagrams.md's five diagrams exactly, in order, and links the other two", () => {
    const docs = blocks(readFileSync(join(ROOT, "docs/diagrams.md"), "utf8"));
    expect(docs).toHaveLength(5);
    expect(blocks(readme)).toEqual([docs[0], docs[2], docs[4]]);
    expect(readme).toContain("(docs/diagrams.md)"); // who holds which limit: in docs/diagrams.md, linked from Links (13 Nov)
    // The mandate on Metal is linked from the Metal Award section since the award sections came in (13 Nov).
    expect(readme).toContain("(docs/diagrams.md#3-the-mandate-on-metal-bound-refused-raised-revoked)");
  });

  it("opens See it with the hands-on demo's GIF and the caption media.json gives it, the test passkey said", () => {
    const media = JSON.parse(readFileSync(join(ROOT, "docs/assets/media/media.json"), "utf8")) as { files: { file: string; caption: string }[] };
    const caption = media.files.find((f) => f.file === "try-flow.gif")!.caption;
    expect(caption).toMatch(/test passkey, no person or phone/);
    const see = readme.slice(readme.indexOf("## See it"), readme.indexOf("\n## ", readme.indexOf("## See it") + 5));
    expect(see.indexOf("docs/assets/media/try-flow.gif")).toBeGreaterThan(0);
    expect(see.indexOf("docs/assets/media/try-flow.gif")).toBeLessThan(see.indexOf("cloud-dashboard-poster.png"));
    expect(see).toContain(`*${caption}*`);
    // Since 13 Nov the books and cloud clips are posters (stills from their MP4s) that link to the MP4, not GIFs (-9 MB).
    for (const f of ["cloud-dashboard-poster.png", "cloud-dashboard.mp4", "books-poster.png", "books.mp4", "proof.gif"]) expect({ f, ok: existsSync(join(ROOT, "docs/assets/media", f)) && see.includes(f) }).toEqual({ f, ok: true });
    for (const f of ["cloud-dashboard.gif", "books.gif"]) expect({ f, gone: !existsSync(join(ROOT, "docs/assets/media", f)) && !see.includes(f) }).toEqual({ f, gone: true });
  });

  it("says Connect any AI can read and propose only, with the public demo token and the dated live check", () => {
    const sec = readme.slice(readme.indexOf("## Connect any AI"), readme.indexOf("\n## ", readme.indexOf("## Connect any AI") + 5));
    expect(sec).toContain("it can never approve or pay");
    expect(sec).toContain("`purser-demo-read-only`");
    expect(sec).toMatch(/Checked on 13 November 2026, 06:57 UTC: `tools\/list` .* answers 7 read tools/);
    // Only Claude was tried live; the other clients are said to come from their own documentation.
    expect(sec).toContain("have not been tried live against a deployed cloud");
  });
});

describe("the README against the site (jury findings, 13 Nov)", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  it("calls the guest console public, names purser-try and the connector, and has the 2-minute block", () => {
    // The public guest console on purser-try is said; the product's own console deployment stays private, and is said so.
    expect(readme).toMatch(/Try as guest\* opens a demo company read-only/);
    expect(readme).toMatch(/product's own console deployment is another matter: that hosted preview exists but is private/);
    expect(readme).toContain("https://purser-try.max-31b.workers.dev/");
    expect(readme).toContain("https://purser-try.max-31b.workers.dev/mcp");
    const block = readme.slice(readme.indexOf("## Try it in 2 minutes"), readme.indexOf("\n## ", readme.indexOf("## Try it in 2 minutes") + 5));
    for (const s of ["https://kit11.max-31b.workers.dev/try", "Try as guest", "purser-demo-read-only", "cannot approve or pay"]) expect({ s, has: block.includes(s) }).toEqual({ s, has: true });
  });

  it("quotes the same connected-account payout as /runs: the end-to-end run's PAID payout, amount and fee from its record", () => {
    const runs = readFileSync(join(ROOT, "src/redesign/runs.ts"), "utf8");
    const id = /label: "Payout PAID", value: "([0-9a-f-]{36})"/.exec(runs)![1]!;
    const record = readFileSync(join(ROOT, "docs/runs/2026-11-10-platform-e2e.md"), "utf8");
    const row = record.split("\n").find((l) => l.includes(id))!;
    const [amount, fee] = [/EUR ([\d.]+) \|/.exec(row)![1]!, /\| EUR ([\d.]+), SETTLED/.exec(row)![1]!];
    expect(readme).toContain(`EUR ${amount} PAID on a test company's behalf (\`${id}\``);
    expect(readme).toContain(`Purser's EUR ${fee} fee`);
  });
});
