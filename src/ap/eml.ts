// Payables: an e-mail as raw RFC 822 bytes (a saved .eml, or later a mailbox poller) into its sender, subject and PDF
// attachments. Small on purpose: multipart (nested), base64 and quoted-printable, header folding. Nothing in a mail
// is trusted: its attachments are filed and read like any other document.

export interface EmlAttachment { filename: string; mime: string; bytes: Buffer }
export interface ParsedEml { from: string; to: string; subject: string; date: string; message_id: string; attachments: EmlAttachment[] }

interface Part { headers: Map<string, string>; body: Buffer }

function splitPart(raw: Buffer): Part {
  const s = raw.toString("latin1");
  const m = /\r?\n\r?\n/.exec(s);
  const head = m ? s.slice(0, m.index) : s;
  const bodyStart = m ? m.index + m[0].length : s.length;
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body: raw.subarray(Buffer.byteLength(s.slice(0, bodyStart), "latin1")) };
}

function param(header: string | undefined, name: string): string {
  if (!header) return "";
  const m = new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(header);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function decode(body: Buffer, encoding: string): Buffer {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (enc === "quoted-printable") {
    const s = body.toString("latin1").replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(s, "latin1");
  }
  return body;
}

function walk(part: Part, out: EmlAttachment[], depth = 0): void {
  if (depth > 8) return;
  const type = part.headers.get("content-type") ?? "text/plain";
  const mime = type.split(";")[0]!.trim().toLowerCase();
  if (mime.startsWith("multipart/")) {
    const boundary = param(type, "boundary");
    if (!boundary) return;
    const text = part.body.toString("latin1");
    const pieces = text.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const piece of pieces.slice(1)) {
      if (!piece.trim()) continue;
      walk(splitPart(Buffer.from(piece, "latin1")), out, depth + 1);
    }
    return;
  }
  const filename = param(part.headers.get("content-disposition"), "filename") || param(type, "name");
  if (mime === "application/pdf" || /\.pdf$/i.test(filename) || (mime === "application/octet-stream" && /\.pdf$/i.test(filename))) {
    out.push({ filename: filename || "attachment.pdf", mime: "application/pdf", bytes: decode(part.body, part.headers.get("content-transfer-encoding") ?? "7bit") });
  }
}

/** Sender, subject and the PDFs attached to a raw e-mail. Never throws on a malformed mail: it finds what it can. */
export function parseEml(raw: Buffer): ParsedEml {
  const top = splitPart(raw);
  const attachments: EmlAttachment[] = [];
  walk(top, attachments);
  const h = (k: string) => top.headers.get(k) ?? "";
  return { from: h("from"), to: h("to"), subject: h("subject"), date: h("date"), message_id: h("message-id"), attachments };
}
