// The Dafny record's counts come from the proofs themselves (outside audit, 22 November: the record said 59 lemmas while
// formal/dafny held 61). scripts/formal-dafny.sh --write counts them with the same pattern and refuses a record that
// differs; this test holds the committed record to the files without needing Dafny, so it runs everywhere.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "formal/dafny";
const LEMMA = /^\s*(ghost\s+)?lemma\s/;

describe("docs/evidence/formal-proofs.json counts what formal/dafny holds", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".dfy")).sort();
  const lemmas = files.reduce((n, f) => n + readFileSync(`${DIR}/${f}`, "utf8").split("\n").filter((l) => LEMMA.test(l)).length, 0);
  const record = JSON.parse(readFileSync("docs/evidence/formal-proofs.json", "utf8")) as { totals: { lemmas: number; files: number } };

  it("the lemmas and the files", () => {
    expect(record.totals).toMatchObject({ lemmas, files: files.length });
  });

  it("the write-up states the same lemma count", () => {
    expect(readFileSync("docs/evidence/formal-proofs.md", "utf8")).toContain(`every lemma (${lemmas})`);
  });

  it("the script counts with the same pattern", () => {
    expect(readFileSync("scripts/formal-dafny.sh", "utf8")).toContain("grep -cE '^\\s*(ghost\\s+)?lemma\\s'");
  });
});
