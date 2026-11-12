// npm run cloud:pdfjs: copies pdf.js (unpdf's build, the same file the local payables page serves) into cloud/public,
// the Worker's static assets, before a deploy. The copy is not in git (cloud/public/assets is ignored); the version is
// the one package.json pins.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const to = new URL("../public/assets/pdfjs.mjs", import.meta.url);
mkdirSync(new URL("../public/assets/", import.meta.url), { recursive: true });
copyFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")), fileURLToPath(to));
console.log(`pdf.js copied to ${fileURLToPath(to)}`);
