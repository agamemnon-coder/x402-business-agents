// npm run social:github: docs/media/social-preview-github.html rendered to docs/assets/social-preview-github.png
// (1280x640, the size GitHub asks for). The repository's owner uploads it under Settings > Social preview.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const page = new URL("../docs/media/social-preview-github.html", import.meta.url);
const out = fileURLToPath(new URL("../docs/assets/social-preview-github.png", import.meta.url));
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await p.goto(page.href);
await p.waitForFunction(() => (window as unknown as { done?: boolean }).done === true);
await p.waitForTimeout(400);
await p.screenshot({ path: out });
await b.close();
console.log(`wrote ${out}`);
