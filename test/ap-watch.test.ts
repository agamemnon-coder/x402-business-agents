// Payables: a watched folder. Every PDF or saved e-mail in it is filed once (a file seen before is recognised by its
// hash); nothing in the folder is moved or deleted.
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Asker } from "../src/ap/read.js";
import { apInvoices } from "../src/ap/store.js";
import { scanFolder } from "../src/ap/watch.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
let root: string;
let db: DB;
beforeEach(() => { root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-watch-")); db = openDb(":memory:"); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a watched folder", () => {
  it("files each PDF and e-mail once, skips other files, and leaves the folder as it was", async () => {
    const drop = join(root, "drop");
    mkdirSync(drop);
    writeFileSync(join(drop, "en.pdf"), await pdfOf(EN));
    writeFileSync(join(drop, "mail.eml"), emlWith(await pdfOf(NL)));
    writeFileSync(join(drop, "notes.txt"), "not an invoice");
    const deps = { dir: join(root, "ap"), reader: parserOnly };
    const first = await scanFolder(db, deps, drop);
    expect(first.filed).toBe(2);
    expect(first.skipped).toEqual(["notes.txt"]);
    expect(apInvoices(db)).toHaveLength(2);
    const again = await scanFolder(db, deps, drop);
    expect(again.filed).toBe(0);
    expect(again.already).toBe(2);
    expect(readdirSync(drop).sort()).toEqual(["en.pdf", "mail.eml", "notes.txt"]);
  });
});
