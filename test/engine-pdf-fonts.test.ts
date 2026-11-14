// The engine's PDFs in the cloud's Worker (14 Nov, a live QA run: the records PDF answered 500 there): pdfkit's browser
// build carries no font, so the Worker registers each standard font the engine's PDFs name (cloud/src/engine/hostWorker.ts).
// Every font a PDF of the engine uses must be among them, or that PDF fails only in the Worker, never in Node's tests.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync("cloud/src/engine/hostWorker.ts", "utf8");
const registered = new Set([...worker.matchAll(/import (\w+) from "pdfkit\/standard-fonts\/(\w+)";/g)].map((m) => m[2]!));
const named = (src: string) => new Set([...src.matchAll(/\.font\("([A-Za-z-]+)"\)/g)].map((m) => m[1]!.replace(/-/g, "")));

describe("the fonts of the engine's PDFs, in the Worker", () => {
  const files = readdirSync("src/engine").filter((f) => /Pdf\.ts$/.test(f));
  it("finds the engine's PDFs", () => {
    expect(files).toEqual(expect.arrayContaining(["invoicePdf.ts", "recordsPdf.ts"]));
  });
  for (const f of files) {
    it(`${f}: every font it uses is registered in the Worker`, () => {
      const used = named(readFileSync(`src/engine/${f}`, "utf8"));
      expect(used.size).toBeGreaterThan(0);
      for (const font of used) expect(registered.has(font), font).toBe(true);
      expect(worker).toContain("registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique, Courier, CourierBold)");
    });
  }
});
