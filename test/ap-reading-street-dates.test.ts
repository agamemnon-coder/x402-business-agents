// The payables reader without a model (src/ap/reading.ts parseApFallback) took a street for a date line (17 Nov): the
// Stockline invoice's address "Datenallee 12, 10115 Berlin" starts with "Date", so "nallee 12, 10115 Berlin" was read
// as its issue date and the real "Date: 1 November 2026" below it was never reached. A date label is now a whole word
// followed by a colon or a space, and the first labelled line whose value is a real date wins.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseApFallback } from "../src/ap/reading.js";

const stockline = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11B.txt", import.meta.url), "utf8");

describe("a street name is not a date", () => {
  it("reads the Stockline invoice's issue and due dates, not its street (Datenallee)", () => {
    const r = parseApFallback(stockline);
    expect([r.issue_date, r.due_date]).toEqual(["2026-11-01", "2026-11-15"]);
  });

  it("skips streets that start with a date word, in English, Dutch and German", () => {
    const text = (street: string) => `Acme Supplies BV\n${street}\nINVOICE A-1\nInvoice date: 3 November 2026\nDue date: 17 November 2026\nTotal EUR 100.00\n`;
    for (const street of ["Datenallee 12, 10115 Berlin", "Datumstraat 4, 1012 AB Amsterdam", "Dueweg 7, 3011 Rotterdam", "Fälligkeitsweg 2, 80331 München", "Date Street 4, London"]) {
      const r = parseApFallback(text(street));
      expect({ street, issue: r.issue_date, due: r.due_date }).toEqual({ street, issue: "2026-11-03", due: "2026-11-17" });
    }
  });

  it("still reads a bare label with a colon or a space, and the label's first real date", () => {
    expect(parseApFallback("Acme\nINVOICE A-2\nDate: 05/11/2026\nDue 20.11.2026\nTotal EUR 1.00\n")).toMatchObject({ issue_date: "2026-11-05", due_date: "2026-11-20" });
    expect(parseApFallback("Acme\nDatum 2026-11-06\nFällig am: 21. November 2026\nTotal EUR 1.00\n")).toMatchObject({ issue_date: "2026-11-06", due_date: "2026-11-21" });
    // A labelled line that holds no date is passed over, not taken as an empty date.
    expect(parseApFallback("Acme\nDate Street 4\nDate: 7 November 2026\nTotal EUR 1.00\n").issue_date).toBe("2026-11-07");
  });
});
