// A UBL 2.1 invoice (OASIS UBL, the format Peppol BIS Billing 3.0 and the Dutch SI-UBL 2.0 use) as it reaches Purser
// from a mailbox or a watched folder. Purser's pipeline reads PDFs, so a UBL file is taken in through the PDF it carries
// (cac:AdditionalDocumentReference / cac:Attachment / cbc:EmbeddedDocumentBinaryObject, mimeCode application/pdf):
// that PDF goes through the inbox unchanged, read and checked like any other. The UBL's own figures are kept only as
// labelled metadata beside it; they never decide an amount. A UBL file without a PDF in it is refused with the reason.
//
// Strict and small on purpose, with no XML library: a DOCTYPE or an entity declaration is refused outright (no external
// entities, no entity expansion), the file is capped, the text must be UTF-8, and the root element must be a UBL
// Invoice or CreditNote in its OASIS namespace.

import { isPdf } from "../ap/pdfText.js";
import { MAX_DOCUMENT_BYTES } from "../ap/inbox.js";
import { clean, decodeBase64, WorkplaceError } from "./http.js";

/** A UBL file with a PDF embedded as base64 is about 4/3 of the PDF, plus the XML around it. */
export const MAX_UBL_BYTES = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 2 * 1024 * 1024;

const NS = { Invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2", CreditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" } as const;

export interface UblInvoice {
  kind: "Invoice" | "CreditNote";
  /** As the UBL states them: labelled metadata, never used for an amount. */
  id: string;
  issueDate: string;
  currency: string;
  supplier: string;
  payable: string;
  /** The first embedded PDF, or null. */
  pdf: { filename: string; bytes: Uint8Array } | null;
}

const head = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, "");

/** Whether the bytes look like a UBL invoice or credit note (cheap: the first element only). */
export function looksLikeUbl(bytes: Uint8Array): boolean {
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w.-]*:)?(Invoice|CreditNote)[\s>]/.test(head(bytes));
}

/** The text of the first element with this local name (any prefix), unescaped, cleaned; "" when absent. */
function first(xml: string, local: string): string {
  const m = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${local}(?:\\s[^>]*)?>([^<]{0,500})</(?:[A-Za-z_][\\w.-]*:)?${local}>`).exec(xml);
  return m ? clean(unescape(m[1]!), 200) : "";
}
function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d{1,6});/g, (_, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff))).replace(/&amp;/g, "&");
}
const attr = (attrs: string, name: string) => clean(unescape(new RegExp(`\\b${name}\\s*=\\s*"([^"]{0,300})"`).exec(attrs)?.[1] ?? new RegExp(`\\b${name}\\s*=\\s*'([^']{0,300})'`).exec(attrs)?.[1] ?? ""), 200);

/** Reads a UBL invoice strictly; throws a WorkplaceError("invalid") with the reason when it is not one Purser takes. */
export function readUbl(bytes: Uint8Array): UblInvoice {
  if (bytes.length > MAX_UBL_BYTES) throw new WorkplaceError("too_large", `the UBL file is above ${MAX_UBL_BYTES} bytes; it was not read`);
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); } catch { throw new WorkplaceError("invalid", "the UBL file is not UTF-8 text"); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new WorkplaceError("invalid", "the UBL file declares a DOCTYPE or an entity; such files are refused unread");
  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:([A-Za-z_][\w.-]*):)?(Invoice|CreditNote)(\s[^>]*)?>/.exec(xml);
  if (!root) throw new WorkplaceError("invalid", "the file is not a UBL Invoice or CreditNote");
  const kind = root[2] as "Invoice" | "CreditNote";
  const nsAttr = root[1] ? `xmlns:${root[1]}` : "xmlns";
  const ns = new RegExp(`${nsAttr.replace(/[.]/g, "\\.")}\\s*=\\s*"([^"]*)"`).exec(root[3] ?? "")?.[1];
  if (ns !== NS[kind]) throw new WorkplaceError("invalid", `the root ${kind} is not in the UBL namespace ${NS[kind]}`);

  let pdf: UblInvoice["pdf"] = null;
  const objects = /<(?:[A-Za-z_][\w.-]*:)?EmbeddedDocumentBinaryObject(\s[^>]*)?>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?EmbeddedDocumentBinaryObject>/g;
  for (let m = objects.exec(xml), n = 0; m && n < 20; m = objects.exec(xml), n++) {
    const attrs = m[1] ?? "";
    if (attr(attrs, "mimeCode").toLowerCase() !== "application/pdf") continue;
    const decoded = decodeBase64(m[2]!, MAX_DOCUMENT_BYTES, false);
    if (!isPdf(decoded)) throw new WorkplaceError("invalid", "the UBL file's embedded document says application/pdf but is not a PDF");
    const name = attr(attrs, "filename").replace(/[/\\]/g, "_") || "invoice.pdf";
    pdf = { filename: /\.pdf$/i.test(name) ? name : `${name}.pdf`, bytes: decoded };
    break;
  }
  return {
    kind, id: first(xml, "ID"), issueDate: first(xml, "IssueDate"), currency: first(xml, "DocumentCurrencyCode"),
    supplier: (() => { const party = /<(?:[\w.-]+:)?AccountingSupplierParty[\s>][\s\S]*?<\/(?:[\w.-]+:)?AccountingSupplierParty>/.exec(xml)?.[0] ?? ""; return first(party, "RegistrationName") || first(party, "Name"); })(),
    payable: first(xml, "PayableAmount"), pdf,
  };
}
