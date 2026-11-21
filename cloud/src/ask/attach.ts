// A file the visitor attaches to one question (21 Nov): a PDF, a CSV or text file, or a picture of an invoice, at most
// ATTACH_MAX_BYTES. Checked in code before anything reads it: the type must be on the list AND the bytes must be that
// type (a PDF starts %PDF-, a PNG with its signature, a text decodes as UTF-8 with no NUL), and the name is tidied. It
// goes to Claude in the same request as the question and nowhere else: never stored, logged or counted beyond "a file
// was attached". The browser keeps it only until the question is sent.

import type { FileBlock } from "./core.js";

export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
/** Characters of a text or CSV file at most (a longer one: "attach a shorter excerpt"). */
export const ATTACH_TEXT_MAX = 120_000;
export const ATTACH_TYPES = ["application/pdf", "text/csv", "text/plain", "image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AttachType = (typeof ATTACH_TYPES)[number];
/** The body's base64 at most: ATTACH_MAX_BYTES as base64, rounded up. */
export const ATTACH_B64_MAX = Math.ceil(ATTACH_MAX_BYTES / 3) * 4;

export interface Attachment { name: string; type: AttachType; data: string }
export type Checked = { ok: true; block: FileBlock; kind: "pdf" | "text" | "image"; name: string; bytes: number; text: string | null } | { ok: false; why: string };

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function decode(b64: string): Uint8Array | null {
  if (!B64.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** The bytes are what the type says they are. */
function looksLike(type: AttachType, b: Uint8Array): boolean {
  switch (type) {
    case "application/pdf": return starts(b, ascii("%PDF-"));
    case "image/png": return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg": return starts(b, [0xff, 0xd8, 0xff]);
    case "image/gif": return starts(b, ascii("GIF87a")) || starts(b, ascii("GIF89a"));
    case "image/webp": return starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8);
    default: return true;
  }
}

/** A file name as text: no path, no control or markup characters, at most 80 characters. */
export const tidyName = (name: string) => (name.split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80) || "file";

export function checkAttachment(a: Attachment): Checked {
  if (!ATTACH_TYPES.includes(a.type)) return { ok: false, why: "That kind of file can't be attached: a PDF, a CSV or text file, or a PNG, JPEG, WebP or GIF picture." };
  if (a.data.length > ATTACH_B64_MAX) return { ok: false, why: "That file is larger than 5 MB." };
  const bytes = decode(a.data);
  if (!bytes || !bytes.length) return { ok: false, why: "That file could not be read." };
  if (bytes.length > ATTACH_MAX_BYTES) return { ok: false, why: "That file is larger than 5 MB." };
  if (!looksLike(a.type, bytes)) return { ok: false, why: "That file is not what its type says it is." };
  const name = tidyName(a.name);
  if (a.type === "text/csv" || a.type === "text/plain") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return { ok: false, why: "That text file is not UTF-8 text." }; }
    if (text.includes("\u0000")) return { ok: false, why: "That text file is not plain text." };
    if (text.length > ATTACH_TEXT_MAX) return { ok: false, why: "That file is too long for one question. Attach a shorter excerpt (a few pages) and ask again." };
    return { ok: true, kind: "text", name, bytes: bytes.length, text, block: { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: name } };
  }
  if (a.type === "application/pdf") return { ok: true, kind: "pdf", name, bytes: bytes.length, text: null, block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: name } };
  return { ok: true, kind: "image", name, bytes: bytes.length, text: null, block: { type: "image", source: { type: "base64", media_type: a.type, data: a.data } } };
}
