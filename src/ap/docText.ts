// The words of a filed document, whatever its kind: a PDF's text layer (src/ap/pdfText.ts), or, for a Peppol UBL
// invoice (src/ap/peppol.ts), its plain-text rendering with the result of its business rules. Every place that reads a
// filed document again (the recheck, the payment's terms, the invoice's detail) asks here, so a Peppol invoice is read
// the same way each time.

import { looksLikeXml, receivePeppol, type PeppolResult } from "./peppol.js";
import { pdfText } from "./pdfText.js";

export async function documentText(bytes: Uint8Array): Promise<{ text: string; peppol: PeppolResult | null }> {
  if (looksLikeXml(bytes)) {
    const peppol = receivePeppol(bytes);
    return { text: peppol.text, peppol };
  }
  return { text: (await pdfText(bytes)).text, peppol: null };
}
