// A one-shot command that reads a PDF (npm run cloud -- mail, npm run payables -- once) must end by itself: the PDF
// reader's worker may not keep the process alive once the work is done (backend demo of 9 November: it hung).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

describe("a one-shot command that read a PDF", () => {
  it("exits by itself once the PDF is read", async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pdf-exit-"));
    try {
      const pdf = join(dir, "a.pdf");
      writeFileSync(pdf, await pdfOf(EN));
      const script = join(dir, "read.mts");
      writeFileSync(script, `import { readFileSync } from "node:fs";\nimport { pdfText } from ${JSON.stringify(join(process.cwd(), "src/ap/pdfText.ts"))};\nconst r = await pdfText(new Uint8Array(readFileSync(${JSON.stringify(pdf)})));\nconsole.log("pages", r.pages);\n`);
      const started = Date.now();
      const r = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", timeout: 20_000 });
      expect(r.stdout).toContain("pages 1");
      expect(r.signal, "the process had to be killed: something kept it alive").toBeNull();
      expect(r.status).toBe(0);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
