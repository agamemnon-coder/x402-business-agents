// qrcode's core module (the package's own types cover only its main entry, which also loads its PNG and file renderers).
declare module "qrcode/lib/core/qrcode.js" {
  export function create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): { modules: { size: number; data: Uint8Array } };
}
