// The vic-1 conductor's wait for purchase B (src/airi/deps.ts awaitWithTap), against a STAND-IN runner: a separate
// process that writes the one-time link the way the real runner does (fileLinkSink), then, later, an outcome. Checks:
// the console gets a labelled "AIRI TAP B" line with the link at once, the file is gone, the run log names no link,
// and the wait ends only on an outcome or when the tap window has run out. (On 7 November, vic-1b, B's link went
// unseen: printed unlabelled, without a time, and never in the run log.) The link is a made-up stand-in.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoSecrets } from "../src/airi/vic1.js";
import { TAP_LINK_FILE, awaitWithTap, consoleLinkSink, takeTapLink } from "../src/airi/deps.js";

const LINK = "https://app.airi.com/approve/standin-not-a-real-link";
const repo = resolve(import.meta.dirname, "..");

/** The stand-in runner: fileLinkSink.showPasskeyUrl after `linkAfter` ms, then clearPasskeyUrl and an outcome. */
function standInRunner(dir: string, linkAfter: number, outcomeAfter: number | null) {
  const script = join(dir, "runner.ts");
  writeFileSync(script, `
    import { writeFileSync } from "node:fs";
    import { fileLinkSink } from ${JSON.stringify(join(repo, "src/airi/deps.ts"))};
    const [file, statusFile, linkAfter, outcomeAfter] = process.argv.slice(2);
    const sink = fileLinkSink(() => {}, () => file);
    setTimeout(() => { writeFileSync(statusFile + ".linkAt", String(Date.now())); sink.showPasskeyUrl(${JSON.stringify(LINK)}, { actionId: "P-0001", amount: "45.00", currency: "EUR", merchant: "Northwind Outdoor test shop" }); }, Number(linkAfter));
    if (outcomeAfter !== "none") setTimeout(() => { sink.clearPasskeyUrl?.("P-0001"); writeFileSync(statusFile, "FAILED"); }, Number(outcomeAfter));
    else setTimeout(() => {}, 5000);
  `);
  const file = join(dir, TAP_LINK_FILE);
  const statusFile = join(dir, "status");
  const child = spawn(join(repo, "node_modules/.bin/tsx"), [script, file, statusFile, String(linkAfter), outcomeAfter === null ? "none" : String(outcomeAfter)], { stdio: "ignore" });
  return { file, statusFile, child };
}

describe("the conductor's wait for B (stand-in runner)", { timeout: 30_000 }, () => {
  it("prints the runner's link on the console at once as AIRI TAP B, deletes the file, and waits for B's outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vic1-tap-"));
    const r = standInRunner(dir, 800, 3500);
    const console: { line: string; at: number }[] = [];
    const log: string[] = [];
    const t0 = Date.now();
    const end = await awaitWithTap({
      id: "P-0001", which: "B", takeLink: () => takeTapLink("P-0001", r.file),
      tap: (line) => console.push({ line, at: Date.now() }), log: (l) => { assertNoSecrets(l); log.push(l); },
      status: () => (existsSync(r.statusFile) ? readFileSync(r.statusFile, "utf8") : "EXECUTING"),
    });
    const linkAt = Number(readFileSync(`${r.statusFile}.linkAt`, "utf8"));
    expect(end).toBe("FAILED");
    expect(console).toHaveLength(1);
    expect(console[0]!.line).toMatch(/^AIRI TAP B {2}\d\d:\d\d:\d\d UTC {2}P-0001: 45\.00 EUR at Northwind Outdoor test shop\. Open this one-time link/);
    expect(console[0]!.line).toContain(`\n           ${LINK}`);
    expect(console[0]!.at - linkAt).toBeLessThan(1500);
    expect(existsSync(r.file)).toBe(false);
    expect(log.some((l) => /^AIRI TAP B {2}P-0001: the one-time Airi link is on the console now \(not in this log\)/.test(l))).toBe(true);
    expect(log.join("\n")).not.toContain("airi.com");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3400);
    r.child.kill();
  });

  it("with no outcome, it does not finish before the tap window has run out (then grace), and never prints the link twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vic1-tap-"));
    const r = standInRunner(dir, 300, null);
    const lines: string[] = [];
    const t0 = Date.now();
    const end = await awaitWithTap({
      id: "P-0001", which: "B", takeLink: () => takeTapLink("P-0001", r.file), tap: (l) => lines.push(l), log: () => {},
      status: () => "EXECUTING", tapWindowMs: 2000, graceMs: 500, pollMs: 100,
    });
    expect(end).toBe("still EXECUTING after the 2 s tap window");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2700);
    expect(lines.filter((l) => l.startsWith("AIRI TAP B"))).toHaveLength(1);
    r.child.kill();
  });
});

describe("awaitWithTap on a clock", () => {
  it("a 5-minute tap window: waits it out, notes the time left each minute in the log (no link), returns after the grace", async () => {
    let t = 0;
    const log: string[] = [];
    const tap: string[] = [];
    let given = false;
    const end = await awaitWithTap({
      id: "P-0002", which: "B", status: () => "EXECUTING", tap: (l) => tap.push(l), log: (l) => log.push(l),
      takeLink: () => (t >= 10_000 && !given ? ((given = true), { url: LINK, amount: "45.00", currency: "EUR", merchant: "Shop" }) : null),
      now: () => t, sleep: async (ms) => { t += ms; },
    });
    expect(end).toBe("still EXECUTING after the 5 min tap window");
    expect(t).toBeGreaterThan(10_000 + 5 * 60_000 + 60_000);
    expect(t).toBeLessThan(10_000 + 5 * 60_000 + 62_000);
    expect(tap).toHaveLength(1);
    expect(log.filter((l) => /still waiting for Max's tap/.test(l)).length).toBeGreaterThanOrEqual(4);
    expect(log.join("\n")).not.toContain("airi.com");
  });

  it("before any link, an approval that never comes ends after the approval wait", async () => {
    let t = 0;
    const end = await awaitWithTap({ id: "P-0003", which: "B", status: () => "PENDING_APPROVAL", tap: () => {}, log: () => {}, takeLink: () => null, now: () => t, sleep: async (ms) => { t += ms; }, approvalWaitMs: 60_000 });
    expect(end).toBe("still PENDING_APPROVAL after 1 min");
  });

  it("A's console line has the same shape, labelled A", () => {
    const lines: string[] = [];
    consoleLinkSink((l) => lines.push(l), "A").showPasskeyUrl(LINK, { actionId: "airi-x", amount: "12.00", currency: "EUR", merchant: "Shop" });
    expect(lines[0]).toMatch(/^AIRI TAP A {2}\d\d:\d\d:\d\d UTC {2}airi-x: 12\.00 EUR at Shop\. Open this one-time link/);
  });
});
