// Payables: the text layer of a PDF (library unpdf, pinned). A scan has none: it is read from its pages (src/ap/scan.ts).
//
// A PDF is untrusted input, so it is never read on the main thread (red team round 2: a 612 KB PDF kept pdf.js busy and
// stopped the whole process, and a timer cannot interrupt a busy thread). First its compressed streams are inflated
// against a budget, so a deflate bomb is refused before the PDF library sees it; then a worker thread with a memory
// limit reads it, and is terminated when it takes longer than the time allowed. The next PDF gets a fresh worker.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { constants, inflateSync } from "node:zlib";

export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

/** The most pages read from one PDF; an invoice has a few. */
export const PDF_MAX_PAGES = 200;
/** The longest a PDF may take to read; the worker reading it is then terminated. */
export const PDF_MAX_MS = 10_000;
/** The most bytes a PDF's compressed streams may decode to, all together (a few pages of a scan fit). */
export const PDF_MAX_DECODED_BYTES = 64 * 1024 * 1024;
/** The reading worker's heap limit. Decoded streams live outside the heap: PDF_MAX_DECODED_BYTES bounds those. */
export const PDF_WORKER_HEAP_MB = 256;

export interface PdfTextOptions { timeoutMs?: number; maxDecodedBytes?: number }

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/** Every stream's raw bytes ("stream" EOL ... "endstream"), with the filters its dictionary names (in order). */
function streams(buf: Buffer): { data: Buffer; filters: string[] }[] {
  const out: { data: Buffer; filters: string[] }[] = [];
  let i = 0;
  while ((i = buf.indexOf("stream", i, "latin1")) !== -1) {
    if (i >= 3 && buf.toString("latin1", i - 3, i) === "end") { i += 6; continue; }
    let s = i + 6;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;
    else if (buf[s - 1] !== 0x0d) { i = s; continue; }
    const e = buf.indexOf("endstream", s, "latin1");
    if (e === -1) break;
    // The stream's dictionary: from its object's start ("obj") to the stream keyword.
    const from = Math.max(0, buf.lastIndexOf("obj", i, "latin1"));
    const dict = buf.toString("latin1", from, i);
    const f = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict)?.[1] ?? "";
    out.push({ data: buf.subarray(s, e), filters: [...f.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]!) });
    i = e + 9;
  }
  return out;
}

/** A zlib header (what pdf.js's FlateDecode reads). */
const looksZlib = (b: Buffer) => b.length >= 2 && (b[0]! & 0x0f) === 8 && ((b[0]! << 8) | b[1]!) % 31 === 0;

const FLATE = new Set(["FlateDecode", "Fl"]);
const HEX = new Set(["ASCIIHexDecode", "AHx"]);
const A85 = new Set(["ASCII85Decode", "A85"]);
/** Filters that expand data a lot and that an invoice never needs: refused, so their output cannot be counted wrong. */
const EXPANDING = new Set(["LZWDecode", "LZW", "RunLengthDecode", "RL"]);

const fromHex = (b: Buffer): Buffer => {
  const t = b.toString("latin1").replace(/>.*$/s, "").replace(/[^0-9A-Fa-f]/g, "");
  return Buffer.from(t.length % 2 ? `${t}0` : t, "hex");
};
const fromA85 = (b: Buffer): Buffer => {
  const t = b.toString("latin1").replace(/^\s*<~/, "").replace(/~>.*$/s, "").replace(/\s+/g, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => { let v = 0; for (const c of group) v = v * 85 + c; for (let k = group.length; k < 5; k++) v = v * 85 + 84; for (let k = 3; k >= 4 - n; k--) out.push((v >>> (8 * k)) & 0xff); };
  for (const ch of t) {
    if (ch === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) { flush(4); group = []; }
  }
  if (group.length) flush(group.length - 1);
  return Buffer.from(out);
};

/**
 * Throws when the PDF's compressed streams (and deflate inside deflate) decode to more than `max` bytes together. A
 * stream's whole filter chain is followed (red team round 4: Flate behind ASCIIHex counted as nothing, and decoded to
 * gigabytes in the reader): ASCIIHex and ASCII85 are decoded here, LZW and RunLength are refused. A stream that is
 * not deflate, or is damaged, is left for the reader; a stream cut short counts what it gives.
 */
export function checkDecodedSize(bytes: Uint8Array, max: number = PDF_MAX_DECODED_BYTES): void {
  let left = max;
  const tooBig = () => new Error(`the PDF's compressed streams decoded would be more than ${mb(max)} (a compression bomb?); it was not read`);
  for (const st of streams(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) {
    if (st.filters.some((f) => EXPANDING.has(f))) throw new Error(`the PDF uses the ${st.filters.find((f) => EXPANDING.has(f))} filter, which an invoice never needs; it was not read`);
    let data = st.data;
    // The text encodings before the deflate: decoded here, counted, and their output checked like any stream.
    for (const f of st.filters) {
      if (FLATE.has(f)) break;
      if (HEX.has(f)) data = fromHex(data);
      else if (A85.has(f)) data = fromA85(data);
      else break;
      left -= data.length;
      if (left < 0) throw tooBig();
    }
    for (let depth = 0; depth < 4 && looksZlib(data); depth++) {
      let out: Buffer;
      try {
        out = inflateSync(data, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: Math.max(1, left + 1) });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) throw tooBig();
        break;
      }
      left -= out.length;
      if (left < 0) throw tooBig();
      data = out;
    }
  }
}

// The worker's code, as plain JavaScript (it runs outside any TypeScript loader): it imports unpdf by its file URL.
const WORKER = `(async () => {
  const { parentPort, workerData } = await import("node:worker_threads");
  const lib = await import(workerData.unpdf);
  parentPort.on("message", async (m) => {
    try {
      const pdf = await lib.getDocumentProxy(new Uint8Array(m.bytes));
      try {
        if (pdf.numPages > m.maxPages) throw new Error("the PDF has " + pdf.numPages + " pages, more than the " + m.maxPages + " read");
        const { text, totalPages } = await lib.extractText(pdf, { mergePages: true });
        parentPort.postMessage({ id: m.id, ok: true, text: String(text).split("\\u0000").join("").trim(), pages: totalPages });
      } finally {
        await pdf.cleanup?.();
        await pdf.destroy?.();
      }
    } catch (e) {
      parentPort.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 300) });
    }
  });
})();`;

const UNPDF = pathToFileURL(createRequire(import.meta.url).resolve("unpdf").replace(/index\.cjs$/, "index.mjs")).href;

type Reply = { id: number; ok: true; text: string; pages: number } | { id: number; ok: false; error: string };
let worker: Worker | null = null;
let pending: { id: number; owner: Worker; resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
let nextId = 1;
/** One PDF at a time: a later one waits for the earlier one (or its timeout). */
let queue: Promise<unknown> = Promise.resolve();

function spawn(): Worker {
  const w = new Worker(WORKER, { eval: true, workerData: { unpdf: UNPDF }, resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 } });
  w.on("message", (r: Reply) => {
    if (pending?.owner === w && pending.id === r.id) { const p = pending; pending = null; p.resolve(r); }
  });
  const gone = (why: string) => {
    if (worker === w) worker = null;
    if (pending?.owner === w) { const p = pending; pending = null; p.reject(new Error(why)); }
  };
  w.on("error", (e) => gone(/memory/i.test(String((e as Error).message) + String((e as NodeJS.ErrnoException).code)) ? `reading the PDF needed more than ${PDF_WORKER_HEAP_MB} MB of memory` : `the PDF reader stopped: ${String((e as Error).message).slice(0, 120)}`));
  w.on("exit", () => gone("the PDF reader stopped"));
  // Unref'd last: adding a "message" listener refs the worker's port again, so an earlier unref kept a one-shot
  // command (npm run cloud -- mail) alive forever after its work was done (backend demo, 9 November).
  w.unref();
  return w;
}

async function readInWorker(bytes: Uint8Array, timeoutMs: number): Promise<{ text: string; pages: number }> {
  const w = (worker ??= spawn());
  const id = nextId++;
  let timer: NodeJS.Timeout | undefined;
  try {
    const reply = await new Promise<Reply>((resolve, reject) => {
      pending = { id, owner: w, resolve, reject };
      // A ref'd timer: the process waits for this PDF even though the worker itself does not keep it alive.
      timer = setTimeout(() => {
        if (pending?.id === id) { pending = null; reject(new Error(`reading the PDF took longer than ${timeoutMs / 1000} s; it was stopped`)); }
        if (worker === w) worker = null;
        void w.terminate();
      }, timeoutMs);
      const copy = new Uint8Array(bytes); // the worker takes over this copy
      w.postMessage({ id, bytes: copy, maxPages: PDF_MAX_PAGES }, [copy.buffer]);
    });
    if (!reply.ok) throw new Error(reply.error);
    return { text: reply.text, pages: reply.pages };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The PDF's text, pages joined. Throws, with the reason, when the file is not a PDF it can open, decodes to more than
 * the budget, has too many pages, needs too much memory or takes too long; the process itself is never stopped.
 */
export function pdfText(bytes: Uint8Array, opts: PdfTextOptions = {}): Promise<{ text: string; pages: number }> {
  const run = queue.then(() => {
    checkDecodedSize(bytes, opts.maxDecodedBytes ?? PDF_MAX_DECODED_BYTES);
    return readInWorker(bytes, opts.timeoutMs ?? PDF_MAX_MS);
  });
  queue = run.catch(() => undefined);
  return run;
}
