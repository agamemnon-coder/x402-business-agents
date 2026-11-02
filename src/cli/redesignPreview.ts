// npx tsx src/cli/redesignPreview.ts: the redesigned Home and Watch (design pass, 2 Nov) on a local port the system
// picks (port 0), under the same hash-based CSP as the served pages. Read-only: it serves the pages and their assets
// from the repo and calls nothing. Try and Proof are not part of this pass and answer with a short note.

import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FONT, LOGOS } from "../servers/dashboard.js";
import { homePage } from "../redesign/home.js";
import { watchPage } from "../redesign/watch.js";
import { page } from "../redesign/ui.js";

const hash = (body: string, tag: "script" | "style") => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  if (!m) throw new Error(`no inline ${tag}`);
  return `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
};
const csp = (body: string) => ["default-src 'none'", `script-src ${hash(body, "script")}`, `style-src ${hash(body, "style")}`, "connect-src 'self'", "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");

const note = (title: string, tab: "try" | "proof") => page({
  title, description: "Not part of this design pass.", tab, css: ".note { padding: 80px 0; } .note p { color: var(--muted); }", js: "",
  body: `<main class="note"><div class="wrap"><h1 class="h-sec">${title}</h1><p>Not part of this design pass: Home and Watch first.</p></div></main>`, data: null, source: "Design pass, 2 November.",
});

export async function startPreview(port = 0): Promise<{ server: Server; url: string }> {
  const pages: Record<string, string> = { "/": homePage(), "/watch": watchPage(), "/try": note("Try", "try"), "/proof": note("Proof", "proof") };
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const body = pages[path];
    if (body) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp(body), "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (path === "/assets/inter.woff2") { res.writeHead(200, { "content-type": "font/woff2" }); res.end(FONT); return; }
    const logo = LOGOS[path.replace("/assets/", "")];
    if (logo) { res.writeHead(200, { "content-type": logo.type }); res.end(logo.body); return; }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startPreview(0);
  console.log(`redesign preview: ${url}/ and ${url}/watch (Ctrl-C to stop)`);
}
