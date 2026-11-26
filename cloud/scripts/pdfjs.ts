// npm run cloud:pdfjs: copies pdf.js (unpdf's build, the same file the local payables page serves) and the console's font
// (Inter, src/ui/inter.woff2) into cloud/public, the Worker's static assets, before a deploy. The copy is not in git (cloud/public/assets is ignored); the version is
// the one package.json pins.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const to = new URL("../public/assets/pdfjs.mjs", import.meta.url);
mkdirSync(new URL("../public/assets/", import.meta.url), { recursive: true });
copyFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")), fileURLToPath(to));
console.log(`pdf.js copied to ${fileURLToPath(to)}`);
const font = new URL("../public/assets/inter.woff2", import.meta.url);
copyFileSync(fileURLToPath(new URL("../../src/ui/inter.woff2", import.meta.url)), fileURLToPath(font));
console.log(`Inter copied to ${fileURLToPath(font)}`);
