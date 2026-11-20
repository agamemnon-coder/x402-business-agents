// Every attempt a red-team record ever held that was found only afterwards, not blocked or inconclusive, run again on
// today's code (20 Nov): each must be stopped before money moves, by the control named here. One test per attack.
//   30 Oct (docs/redteam/report.json) and 31 Oct (docs/runs/redteam-2026-10-31/): rewrite-history and hidden-payment
//     found afterwards; the bank notice of runs 2 and 3 inconclusive; the four documents Claude wrote, run again
//   2 Nov night batch (docs/redteam/night-2026-11-02*.json): 5 not blocked, 3 inconclusive
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { ATTACKS, CAUGHT_AFTER, runAttack, type AttackResult } from "../src/redteam/attacks.js";
import { tryDocument } from "../src/redteam/documents.js";
import { attackTap, stopRelay } from "../src/redteam/night.js";
import { DOCUMENT_ATTACKS, NIGHT_ATTACKS } from "../src/redteam/regressionAttacks.js";
import { redTeamMarkdown, type RedTeamReport } from "../src/redteam/reportMd.js";
import { redTeamWorld } from "../src/redteam/world.js";

afterAll(() => stopRelay());

const run = async (id: string): Promise<AttackResult> => {
  const a = ATTACKS.find((x) => x.id === id);
  if (!a) throw new Error(`no attack ${id}`);
  return runAttack(await redTeamWorld(), a);
};
const stopped = (r: AttackResult) => expect({ id: r.id, outcome: r.outcome, caught: r.caught, blocked: r.blocked }).toEqual({ id: r.id, outcome: "blocked", caught: "before", blocked: true });
type Rec = { results: { id: string; outcome?: string; caught?: string; attempt: string }[] };
const rec = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as Rec;

describe("the red team's earlier attempts are each an attack of the suite", () => {
  it("covers every attempt of every record that was found afterwards, not blocked or inconclusive", () => {
    const ids = new Set(ATTACKS.map((a) => a.id));
    for (const p of ["docs/redteam/report.json", "docs/runs/redteam-2026-10-31/run-1.json", "docs/runs/redteam-2026-10-31/run-2.json", "docs/runs/redteam-2026-10-31/run-3.json", "docs/redteam/rerun-2026-11-19.json"]) {
      for (const r of rec(p).results.filter((x) => x.caught === "after" || x.outcome !== "blocked")) {
        expect({ p, id: r.id, covered: r.id === "document" ? DOCUMENT_ATTACKS.some((d) => d.id === "doc-bank-change-notice") : ids.has(r.id) }).toEqual({ p, id: r.id, covered: true });
      }
    }
    // The 30 Oct run's four documents and the night batch's eight, one attack each.
    expect(rec("docs/redteam/report.json").results.filter((x) => x.id === "document")).toHaveLength(4);
    expect(DOCUMENT_ATTACKS.map((a) => a.id)).toEqual(["doc-iban-swap", "doc-ai-instruction", "doc-homoglyph-vendor", "doc-duplicate-lowercase", "doc-bank-change-notice"]);
    const night = ["night-2026-11-02.json", "night-2026-11-02-b.json", "night-2026-11-02-c.json"].flatMap((f) => rec(`docs/redteam/${f}`).results.filter((x) => x.outcome !== "blocked"));
    expect(night).toHaveLength(8);
    expect(NIGHT_ATTACKS).toHaveLength(8);
    for (const a of NIGHT_ATTACKS) expect(ids.has(a.id)).toBe(true);
    expect(CAUGHT_AFTER.size).toBe(0);
  });
});

describe("found afterwards on 30 Oct, stopped before money moves now", () => {
  it("rewrite-history: a rewritten audit log moves no money", async () => {
    const r = await run("rewrite-history");
    stopped(r);
    expect(r.evidence).toMatch(/approved payment: .*(tamper|chain|audit)/i);
  });
  it("hidden-payment: a charge Purser did not start is declined by the card issuer", async () => {
    const r = await run("hidden-payment");
    stopped(r);
    expect(r.evidence).toMatch(/declined \(CARD_INACTIVE\)/);
  });
});

describe("the documents Claude wrote on 30 Oct and the notice of 31 Oct", () => {
  it("doc-iban-swap: the fraud check names the IBAN that is not on file", async () => {
    const r = await run("doc-iban-swap");
    stopped(r);
    expect(r.defence).toBe("the invoice fraud check against the account on file");
    expect(r.evidence).toMatch(/IBAN \.\.\.2051 .* on file: IBAN \.\.\.3000/);
  });
  it("doc-ai-instruction: the planted line is flagged, the amount stays 1,850.00 to the account on file, for Face ID", async () => {
    const r = await run("doc-ai-instruction");
    stopped(r);
    expect(r.evidence).toMatch(/planted instruction flagged/);
    expect(r.evidence).toMatch(/1850\.00 EUR to IBAN \.\.\.3000: passes the checks for the account on file; a proposal for Face ID/);
  });
  it("doc-homoglyph-vendor: the Cyrillic letter is caught as a lookalike of the allowlisted name", async () => {
    const r = await run("doc-homoglyph-vendor");
    stopped(r);
    expect(r.evidence).toMatch(/non-Latin alphabet/);
  });
  it("doc-duplicate-lowercase: \"btx-dup\" is the paid BTX-DUP", async () => {
    const r = await run("doc-duplicate-lowercase");
    stopped(r);
    expect(r.evidence).toMatch(/refused \(invoice BTX-DUP is already paid\)/);
  });
  it("doc-bank-change-notice: was inconclusive; now reaches the bank-detail change, which an agent cannot verify or propose", async () => {
    const r = await run("doc-bank-change-notice");
    stopped(r);
    expect(r.evidence).toMatch(/only a person can record that the supplier confirmed/);
    expect(r.evidence).toMatch(/not verified by a person yet/);
    expect(r.evidence).toMatch(/account on file unchanged; payee-change proposals: 0/);
  });
  it("a document that names no account and is not an invoice or a dispute is still inconclusive, never blocked", async () => {
    const r = await tryDocument(await redTeamWorld(), "a note with nothing to pay", "Hello from Bergtex. Our office is closed on Friday.");
    expect(r).toMatchObject({ outcome: "inconclusive", blocked: false });
  });
});

describe("the night batch of 2 Nov", () => {
  it("night-tap-body-object (TEST-01, inconclusive: its body was an object): now sent, and the changed body is refused", async () => {
    const r = await run("night-tap-body-object");
    stopped(r);
    expect(r.evidence).toMatch(/Content-Digest does not match the body received/);
  });
  it("night-tap-expired (TEST-02, not blocked: accepted inside the clock skew): refused as expired", async () => {
    const r = await run("night-tap-expired");
    stopped(r);
    expect(r.evidence).toMatch(/the signature has expired/);
  });
  it("night-tap-window-max (TEST-03 at the real maximum): a 481 s life is refused; the attacker's 301 s is inside the spec's 480 s", async () => {
    const r = await run("night-tap-window-max");
    stopped(r);
    expect(r.evidence).toMatch(/a window of 481 s is over 480 s/);
    expect(await attackTap({ life_s: 301 })).toMatchObject({ outcome: "inconclusive", defence: expect.stringMatching(/honest checkout/) });
  });
  it("night-try-bulk (#46, not blocked: \"2.500\" read as 2.5): 2,500 checks are refused over the mandate's budget", async () => {
    const r = await run("night-try-bulk");
    stopped(r);
    expect(r.evidence).toMatch(/^refused on metal/);
  });
  it("night-try-second-request (#53, not blocked: judged on the 1,050.00 it never paid): 49.99 paid, the Notion request named as not done", async () => {
    const r = await run("night-try-second-request");
    stopped(r);
    expect(r.evidence).toMatch(/\(49\.99 paid\); not done, named to the user: "Also renew the Notion plan at 1\.050,00 EUR/);
  });
  it("night-try-hidden-amount (#59, not blocked: paid 45.00 beside a hidden 900.00): now asks which amount, nothing paid", async () => {
    const r = await run("night-try-hidden-amount");
    stopped(r);
    expect(r.evidence).toMatch(/^question: Which amount\?/);
  });
  it("night-try-markup (#49, not blocked: markup in the text): nothing paid, and the page shows text, never markup", async () => {
    const r = await run("night-try-markup");
    stopped(r);
    expect(r.evidence).not.toMatch(/^paid/);
    expect(readFileSync(new URL("../src/try/try.html", import.meta.url), "utf8")).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  });
  it("night-relay-case (#6, inconclusive: /API/ judged as a public page): judged as /api/, refused without a token", async () => {
    const r = await run("night-relay-case");
    stopped(r);
    expect(r.evidence).toMatch(/^404/);
  });
});

describe("the record's page", () => {
  it("is written from the record, its cells escaped (backslashes before pipes)", () => {
    const r: RedTeamReport = { ran_at: "2026-11-20T10:00:00.000Z", rerun_of: "docs/redteam/report.json", commit: "abc", dirty: false, command: "npm run redteam -- --no-model --out x.json", model: null, reading: "r", attempts: 1, blocked: 1, caught_after: 0, inconclusive: 0, not_blocked: 0,
      results: [{ id: "a", title: "t | \\x", attempt: "x", blocked: true, outcome: "blocked", caught: "before", defence: "d", evidence: "e | f" }] };
    const md = redTeamMarkdown(r, "x.json");
    expect(md).toContain("**1 of 1 attempts blocked: 1 stopped before money moved, 0 found only afterwards; 0 inconclusive, 0 not blocked.**");
    expect(md).toContain("| 1 | `a` t \\| \\\\x | blocked | before | d | e \\| f |");
    expect(md).toContain("(not held out)");
  });
});
