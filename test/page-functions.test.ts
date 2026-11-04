// The dashboard page is one inline script: a second function with the same name silently replaces the first. The trace
// (4.1) added a usd() that turned "USD 418.64" into "$0.0004" on the recorded dashboard (CI's page check caught it).
// Breaks if any page script declares the same function name twice.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("page scripts", () => {
  for (const page of ["src/dashboard/page.html", "src/dashboard/month.html", "src/dashboard/lab.html"]) {
    it(`${page} declares each function once`, () => {
      const names = [...readFileSync(page, "utf8").matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
      const twice = names.filter((n, i) => names.indexOf(n) !== i);
      expect(twice).toEqual([]);
    });
  }
});
