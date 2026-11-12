// A QR code of an invite link, as SVG, made where the link is made (the Worker, at the moment it issues the secret), so
// the secret never travels back to a server to be drawn. Only qrcode's core (pure JavaScript, no file or canvas access);
// the drawing is ours: one path of unit squares, nothing but numbers in it.
import { create } from "qrcode/lib/core/qrcode.js";

export function qrSvg(text: string, opts: { margin?: number } = {}): string {
  const m = create(text, { errorCorrectionLevel: "M" }).modules;
  const margin = opts.margin ?? 4;
  const size = m.size + margin * 2;
  let d = "";
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) if (m.data[y * m.size + x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
