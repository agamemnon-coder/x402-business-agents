// The QR code to /try/sign (pitch round, 5 Nov): the same code on the deck's QR slide (SVG) and in
// docs/media/try-sign-qr.png (for print and the cheat sheet). test/pitch.test.ts decodes the PNG back to the URL.

import QRCode from "qrcode";
import { QR_URL } from "./deck.js";

/** Where the PNG lives in the repo. */
export const QR_PNG = "docs/media/try-sign-qr.png";
// Error correction M and a quiet zone of 4 modules: scannable from a projector and from paper.
const OPTIONS = { errorCorrectionLevel: "M", margin: 4 } as const;

/** The QR code as SVG, black on white, for the deck. */
export const qrSvg = (url = QR_URL) => QRCode.toString(url, { ...OPTIONS, type: "svg", color: { dark: "#000000", light: "#ffffff" } });
/** The QR code as a PNG, 1024 px wide, black on white. */
export const qrPng = (url = QR_URL) => QRCode.toBuffer(url, { ...OPTIONS, type: "png", width: 1024, color: { dark: "#000000", light: "#ffffff" } });
