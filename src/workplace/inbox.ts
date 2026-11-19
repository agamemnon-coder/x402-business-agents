// Where every workplace inbox delivers: Purser's one way in (src/ap/inbox.ts, ingestDocument). A mailbox or a watched
// folder only fetches files; this hands each one to the inbox as it would an upload, with where it came from as
// metadata. A PDF goes through the existing pipeline unchanged (read, checked, filed with a status); a UBL invoice goes
// in through the PDF it carries (./ubl.ts); a photo of an invoice (JPEG or PNG) is left to the inbox, which takes those
// too. Anything else is refused here with the reason and recorded in the audit log. Nothing here proposes or pays: the
// inbox files invoices, and every payment still needs the CFO's passkey.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ingestDocument, MAX_DOCUMENT_BYTES, type InboxDeps, type IngestResult } from "../ap/inbox.js";
import { isPdf } from "../ap/pdfText.js";
import { clean } from "./http.js";
import { looksLikeUbl, MAX_UBL_BYTES, readUbl } from "./ubl.js";

export type WorkplaceSource = "gmail" | "gdrive" | "outlook" | "onedrive";

/** A file a workplace integration fetched, not yet taken in. */
export interface FetchedFile {
  provider: WorkplaceSource;
  /** The provider's id of the message or file it came from. */
  ref: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** Sender, subject, folder: kept with the document as the inbox keeps an e-mail's. */
  meta: Record<string, string>;
}

/** A file an integration saw and did not fetch (too large, not an invoice type), with the reason. */
export interface SkippedFile { provider: WorkplaceSource; ref: string; filename: string; reason: string }

export interface PollResult { files: FetchedFile[]; skipped: SkippedFile[] }

export type Delivery =
  | { ref: string; filename: string; outcome: "filed"; result: IngestResult }
  | { ref: string; filename: string; outcome: "refused"; reason: string };

/** The file types a workplace inbox fetches (by name or declared type); the inbox decides on the bytes. */
export function invoiceLike(filename: string, mime: string): boolean {
  return /\.(pdf|xml|jpe?g|png)$/i.test(filename) || /^(application\/pdf|application\/xml|text\/xml|image\/jpeg|image\/png)$/i.test(mime.split(";")[0]!.trim());
}

/** The largest file a workplace inbox fetches: a UBL file may be larger than the PDF inside it. */
export const MAX_FETCH_BYTES = MAX_UBL_BYTES;

const sourceOf = (p: WorkplaceSource) => (p === "gmail" || p === "outlook" ? "email" : "folder");
const isImage = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);

/** Each file into the inbox, one at a time; one refusal never stops the others. */
export async function deliverToInbox(db: DB, deps: InboxDeps, files: FetchedFile[]): Promise<Delivery[]> {
  const out: Delivery[] = [];
  for (const f of files) {
    const filename = clean(f.filename, 200) || "document";
    const meta: Record<string, string> = { ...Object.fromEntries(Object.entries(f.meta).map(([k, v]) => [k, clean(v, 200)])), via: f.provider, ref: clean(f.ref, 200) };
    const refuse = (reason: string) => {
      audit(db, "system", "workplace.file_refused", null, { via: f.provider, ref: meta.ref!, filename, reason: reason.slice(0, 300) });
      out.push({ ref: f.ref, filename, outcome: "refused", reason });
    };
    try {
      if (isPdf(f.bytes) || isImage(f.bytes)) {
        if (f.bytes.length > MAX_DOCUMENT_BYTES) { refuse(`${filename} is larger than ${MAX_DOCUMENT_BYTES} bytes; nothing was filed`); continue; }
        // Never named as an e-mail: the inbox opens a name ending .eml as one, and this is a PDF or a photo.
        const name = filename.replace(/\.eml$/i, ".bin");
        const result = await ingestDocument(db, deps, { bytes: Buffer.from(f.bytes), filename: name, mime: isPdf(f.bytes) ? "application/pdf" : isImage(f.bytes) && f.bytes[0] === 0xff ? "image/jpeg" : "image/png", source: sourceOf(f.provider), meta });
        out.push({ ref: f.ref, filename, outcome: "filed", result });
      } else if (looksLikeUbl(f.bytes)) {
        const ubl = readUbl(f.bytes);
        if (!ubl.pdf) { refuse(`${filename} is a UBL ${ubl.kind} with no PDF embedded; Purser reads invoices from their PDF, so a person files it`); continue; }
        const ublMeta = { ...meta, ubl_file: filename, ubl_kind: ubl.kind, ubl_id: ubl.id, ubl_supplier: ubl.supplier, ubl_payable: `${ubl.currency} ${ubl.payable}`.trim(), ubl_note: "as the UBL states it; the PDF is what is read and checked" };
        const result = await ingestDocument(db, deps, { bytes: Buffer.from(ubl.pdf.bytes), filename: ubl.pdf.filename, mime: "application/pdf", source: sourceOf(f.provider), meta: ublMeta });
        out.push({ ref: f.ref, filename, outcome: "filed", result });
      } else {
        refuse(`${filename} is not a PDF, a UBL invoice or a photo of an invoice; nothing was filed`);
      }
    } catch (e) {
      refuse((e as Error).message);
    }
  }
  return out;
}
