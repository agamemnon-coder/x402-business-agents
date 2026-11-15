// The README's animated pictures beside the flow (15 Nov, Max: "make the README look exceptional with what GitHub
// renders"). One SVG per theme each, CSS animation only (no script, no external link, no web font: GitHub shows an SVG
// in an <img>), each stopped by prefers-reduced-motion:
//   terminal-verify-*  types `npm run -s verify-approval` and its real output, then a copy with the amount one cent
//                      higher and `npm run -s verify-receipt -- tampered.json`, which says NOT VALID. The output below was
//                      captured from those commands on 15 Nov 2026 (commit 29ccca1d); test/readme-animations.test.ts
//                      runs the verifier again and compares, line for line.
//   stats-*            four figures that roll up once, each read from its record here.
//   system-map-*       everything Purser is, in six zones, with dots on the path of one payment and a red one refused.
// Written by `npx tsx scripts/readme-wow-svg.ts`; test/readme-animations.test.ts redraws each and compares.
import { readFileSync, writeFileSync } from "node:fs";
import { loadRecord, payments, split } from "../src/redesign/run.js";

export const WOW_DIR = "docs/assets/readme";
export const WOW_FILES = ["terminal-verify", "stats", "system-map"].flatMap((n) => (["dark", "light"] as const).map((t) => `${WOW_DIR}/${n}-${t}.svg`));
type Theme = "light" | "dark";

const SANS = `ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------------
// The terminal. RECEIPT is the real approval of 7 November; TAMPERED is the same file with "240.00" made "240.01".
export const RECEIPT = "docs/runs/2026-11-07-awx-1/receipt-P-0002.json";
export const TAMPER_CMD = `sed 's/"amount": "240.00"/"amount": "240.01"/' ${RECEIPT} > tampered.json`;
export const APPROVAL_CMD = "npm run -s verify-approval";
export const TAMPERED_CMD = "npm run -s verify-receipt -- tampered.json";
export const APPROVAL_OUT = `ok    format             purser.try-sign-receipt/v1
ok    algorithm          ES256 (ECDSA on P-256 with SHA-256)
ok    terms hash         SHA-256 of the canonical terms is b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb
ok    ceremony           a passkey assertion (webauthn.get)
ok    challenge          the passkey signed a challenge equal to the terms hash
ok    origin             made on https://kit11.max-31b.workers.dev
ok    authenticator data 37 bytes
ok    RP id              for kit11.max-31b.workers.dev
ok    user present       the authenticator reports a person present
ok    user verified      the authenticator reports user verification (Face ID, a fingerprint or a PIN; which one is not in the signature)
ok    signature          the ES256 signature verifies with the receipt's public key

VALID: docs/runs/2026-11-07-awx-1/receipt-P-0002.json
Proves: the holder of this public key signed exactly these terms, with the authenticator reporting user verification, on this site.
Does not prove: who holds the key, or that it was Face ID (no attestation is checked).
Airwallex sandbox approval of 7 Nov, test money.`;
export const TAMPERED_OUT = `ok    format             purser.try-sign-receipt/v1
ok    algorithm          ES256 (ECDSA on P-256 with SHA-256)
FAIL  terms hash         the terms hash to c9b9404bdfbbf700dcf9962249e0b15529ec1ce775cc18f87cd1c931a09098db, not to the receipt's b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb: the terms were changed
ok    ceremony           a passkey assertion (webauthn.get)
ok    challenge          the passkey signed a challenge equal to the terms hash
ok    origin             made on https://kit11.max-31b.workers.dev
ok    authenticator data 37 bytes
ok    RP id              for kit11.max-31b.workers.dev
ok    user present       the authenticator reports a person present
ok    user verified      the authenticator reports user verification (Face ID, a fingerprint or a PIN; which one is not in the signature)
ok    signature          the ES256 signature verifies with the receipt's public key

NOT VALID: tampered.json (terms hash)`;

const TERM = {
  dark: { page: "#0b1222", win: "#0d1117", bar: "#161b22", border: "#30363d", text: "#e6edf3", muted: "#8b949e", prompt: "#a9a4ff", ok: "#3fb950", bad: "#ff7b72", caret: "#e6edf3" },
  light: { page: "#ffffff", win: "#ffffff", bar: "#f3f4f6", border: "#d0d7de", text: "#1f2328", muted: "#57606a", prompt: "#4f46e5", ok: "#1a7f37", bad: "#cf222e", caret: "#1f2328" },
} as const;

const COLS = 138, CW = 7.8, LH = 19, TX = 26, FS = 13, LOOP = 11;
const wrap = (s: string) => { const out: string[] = []; for (let i = 0; i < s.length || i === 0; i += COLS) out.push(s.slice(i, i + COLS)); return out; };
const pct = (t: number) => `${r1((t / LOOP) * 100)}%`;

export function terminalSvg(theme: Theme): string {
  const c = TERM[theme];
  const W = 1200;
  const scene1 = APPROVAL_OUT.split("\n"), scene2 = TAMPERED_OUT.split("\n");
  const rows2 = 2 + scene2.reduce((n, l) => n + wrap(l).length, 0);
  const rows1 = 1 + scene1.reduce((n, l) => n + wrap(l).length, 0);
  const rows = Math.max(rows1, rows2);
  const top = 46, H = top + 18 + rows * LH + 34;
  const css: string[] = [];
  let k = 0;
  // A line of output: its own visible window inside the loop.
  const line = (y: number, s: string, from: number, until: number, first: boolean) => {
    const id = `o${k++}`;
    css.push(`.${id}{animation-name:${id}}@keyframes ${id}{0%,${pct(from - 0.01)}{opacity:0}${pct(from)},${pct(until)}{opacity:1}${pct(until + 0.08)},100%{opacity:0}}`);
    let body = esc(s);
    if (first) {
      body = body.replace(/^ok(?= )/, `<tspan fill="${c.ok}">ok</tspan>`).replace(/^FAIL/, `<tspan fill="${c.bad}" font-weight="700">FAIL</tspan>`)
        .replace(/^NOT VALID:/, `<tspan fill="${c.bad}" font-weight="700">NOT VALID:</tspan>`).replace(/^VALID:/, `<tspan fill="${c.ok}" font-weight="700">VALID:</tspan>`);
    }
    return s ? `<text class="ln ${id}" x="${TX}" y="${y}" textLength="${r1(s.length * CW)}" lengthAdjust="spacingAndGlyphs">${body}</text>` : "";
  };
  // A command typed in: the text under a cover that steps right one character at a time, a caret at its edge.
  const typed = (y: number, cmd: string, start: number, end: number, sceneEnd: number) => {
    const id = `c${k++}`, x0 = TX + 2 * CW, w = cmd.length * CW;
    css.push(`.${id}{animation-name:${id}}@keyframes ${id}{0%,${pct(start)}{transform:translateX(0);opacity:1;animation-timing-function:steps(${cmd.length},end)}${pct(end)}{transform:translateX(${r1(w)}px);opacity:1}${pct(sceneEnd)},100%{transform:translateX(${r1(w)}px);opacity:0}}`);
    return `<text x="${TX}" y="${y}"><tspan fill="${c.prompt}" font-weight="700">$</tspan></text><text x="${r1(x0)}" y="${y}" textLength="${r1(w)}" lengthAdjust="spacingAndGlyphs">${esc(cmd)}</text>`
      + `<g class="cv ${id}"><rect x="${r1(x0)}" y="${y - 14}" width="${r1(w + 2 * CW)}" height="${LH}" fill="${c.win}"/><rect class="caret" x="${r1(x0)}" y="${y - 13}" width="${CW}" height="16" fill="${c.caret}"/></g>`;
  };
  const y0 = top + 30;
  // Scene 1: 0.3 s to 5.3 s. Scene 2: 5.5 s to 10.9 s.
  const s1: string[] = [typed(y0, APPROVAL_CMD, 0.4, 1.3, 1.6)];
  let row = 1, t = 1.7;
  for (const l of scene1) { for (const [i, seg] of wrap(l).entries()) { s1.push(line(y0 + row * LH, seg, t, 5.3, i === 0)); row++; } t += 0.13; }
  const s2: string[] = [typed(y0, TAMPER_CMD, 5.7, 6.7, 6.9), typed(y0 + LH, TAMPERED_CMD, 7.0, 7.6, 7.85)];
  row = 2; t = 7.9;
  for (const l of scene2) { for (const [i, seg] of wrap(l).entries()) { s2.push(line(y0 + row * LH, seg, t, 10.85, i === 0)); row++; } t += 0.12; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Verify it yourself: the real output</title>
<desc id="d">A terminal types npm run -s verify-approval and its real output: every check ok, VALID, on the owner's passkey approval of 7 November (Airwallex sandbox, test money). Then the same receipt with the amount changed from 240.00 to 240.01 is checked with npm run -s verify-receipt -- tampered.json: FAIL terms hash, the terms were changed; NOT VALID. Output captured on 15 November 2026.</desc>
<style>
text{font-family:${MONO};font-size:${FS}px;fill:${c.text};white-space:pre}
.ln{opacity:0}.ln,.cv,.s1,.s2{animation-duration:${LOOP}s;animation-iteration-count:infinite;animation-timing-function:linear}
.s1{animation-name:s1}.s2{animation-name:s2;opacity:0}
@keyframes s1{0%,${pct(5.35)}{opacity:1}${pct(5.45)},100%{opacity:0}}
@keyframes s2{0%,${pct(5.45)}{opacity:0}${pct(5.5)},${pct(10.9)}{opacity:1}100%{opacity:0}}
.caret{animation:blink 1s steps(2,start) infinite}@keyframes blink{to{visibility:hidden}}
${css.join("\n")}
@media (prefers-reduced-motion:reduce){.ln,.cv,.s1,.s2,.caret{animation:none}.s1 .ln{opacity:1}.cv{opacity:0}.s2{opacity:0}}
</style>
<rect width="${W}" height="${H}" fill="${c.page}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${c.win}" stroke="${c.border}"/>
<path d="M0.5 36 V12.5 a12 12 0 0 1 12 -12 H${W - 12.5} a12 12 0 0 1 12 12 V36 Z" fill="${c.bar}" stroke="${c.border}"/>
<circle cx="22" cy="18.5" r="6" fill="#ff5f57"/><circle cx="42" cy="18.5" r="6" fill="#febc2e"/><circle cx="62" cy="18.5" r="6" fill="#28c840"/>
<text x="${W / 2}" y="23" text-anchor="middle" style="font-family:${SANS};font-size:13px;font-weight:600;fill:${c.muted}">x402-business-agents: npm run verify-approval, then one cent changed</text>
<g class="s1">${s1.join("")}</g>
<g class="s2">${s2.join("")}</g>
<text x="${W - TX}" y="${H - 14}" text-anchor="end" style="font-family:${SANS};font-size:12px;fill:${c.muted}">Real output, captured 15 Nov 2026 · offline, Node's crypto · test money</text>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The stat strip: four figures, each from its record.
export function statFigures(): { tests: number; decisions: number; alta: number; wrong: number } {
  const summary = JSON.parse(readFileSync("docs/assets/test-summary.json", "utf8")) as { passed: number };
  const { record } = loadRecord();
  const sp = split(record);
  const worst = JSON.parse(readFileSync("docs/evals/worst-case-summary.json", "utf8")) as { purser_script: Record<string, { wrong_payments: number }> };
  return { tests: summary.passed, decisions: sp.byClaude, alta: payments(record).onChain, wrong: Math.max(...Object.values(worst.purser_script).map((r) => r.wrong_payments)) };
}

const STAT = {
  dark: { bg: "#0b1222", card: "#111a2e", border: "#24304a", text: "#eef1f6", muted: "#a4adbd", tones: ["#3ccf82", "#ef9a76", "#2dd4bf", "#8b85ff"] },
  light: { bg: "#ffffff", card: "#f7f8fa", border: "#e3e6ec", text: "#0b1220", muted: "#586174", tones: ["#0b7d43", "#b4532a", "#0b7a70", "#4f46e5"] },
} as const;

export function statsSvg(theme: Theme, f = statFigures()): string {
  const c = STAT[theme];
  const W = 1200, H = 196, cw = 270, gap = 24, x0 = (W - 4 * cw - 3 * gap) / 2;
  const cells = [
    { n: f.tests, label: "tests passing", sub: ["the last full run of the suite", "docs/assets/test-summary.json"] },
    { n: f.decisions, label: "Claude decisions", sub: ["in the main run of 3 November,", "0 fallbacks"] },
    { n: f.alta, label: "Alta payments", sub: ["in the main run, each its own", "testnet transaction"] },
    { n: f.wrong, label: "wrong payments", sub: ["an AI that always says pay,", "50 invoices: the worst-case test"] },
  ];
  const DH = 62, FSZ = 54, DW = 33;
  const body = cells.map((cell, i) => {
    const x = x0 + i * (cw + gap), tone = c.tones[i]!;
    const s = cell.n.toLocaleString("en-GB");
    const glyphs = [...s];
    const total = glyphs.reduce((w, g) => w + (g === "," ? 14 : DW), 0);
    let gx = x + 24;
    let col = 0;
    const digits = glyphs.map((g) => {
      if (g === ",") { const t = `<text x="${r1(gx + 4)}" y="${r1(30 + DH - 14)}" style="font-size:${FSZ}px;font-weight:760;fill:${tone}">,</text>`; gx += 14; return t; }
      const d = Number(g), cx = gx + DW / 2, delay = r1(0.15 * col++);
      const strip = Array.from({ length: 20 }, (_, j) => `<text x="${r1(cx)}" y="${r1(j * DH + DH - 14)}" text-anchor="middle" style="font-size:${FSZ}px;font-weight:760;fill:${tone}">${j % 10}</text>`).join("");
      const out = `<g clip-path="url(#k${i})"><g transform="translate(0 30)"><g class="roll" style="transform:translateY(${-(10 + d) * DH}px);animation-delay:${delay}s">${strip}</g></g></g>`;
      gx += DW;
      return out;
    }).join("");
    return `<rect x="${x}" y="12" width="${cw}" height="${H - 24}" rx="14" fill="${c.card}" stroke="${c.border}"/>
<rect x="${x + 1}" y="30" width="4" height="${H - 60}" rx="2" fill="${tone}"/>
<clipPath id="k${i}"><rect x="${x + 20}" y="30" width="${r1(total + 8)}" height="${DH}"/></clipPath>
${digits}
<text x="${x + 24}" y="${30 + DH + 24}" style="font-size:18px;font-weight:700;fill:${c.text}">${cell.label}</text>
<text x="${x + 24}" y="${30 + DH + 48}" style="font-size:13px;fill:${c.muted}">${esc(cell.sub[0]!)}</text>
<text x="${x + 24}" y="${30 + DH + 66}" style="font-size:13px;fill:${c.muted}">${esc(cell.sub[1]!)}</text>`;
  }).join("\n");
  // Each strip sits in a translate(0 30) to the clip's top; the CSS transform on the inner group rolls it (an attribute
  // and a CSS transform on the same element would not both apply).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Purser in four figures</title>
<desc id="d">${f.tests.toLocaleString("en-GB")} tests passing in the last full run; ${f.decisions} Claude decisions and ${f.alta} Alta payments in the main run of 3 November; ${f.wrong} wrong payments in the worst-case AI test. Each figure is read from its record.</desc>
<style>
text{font-family:${SANS};font-variant-numeric:tabular-nums}
.roll{animation:roll 1.8s cubic-bezier(.16,.84,.3,1) 1 backwards}
@keyframes roll{from{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.roll{animation:none}}
</style>
<rect width="${W}" height="${H}" fill="${c.bg}"/>
${body}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The system map: everything Purser is, in six zones, left to right.
const MAP = {
  dark: { bg: "#0b1222", zone: "#0f182c", zoneLine: "#24304a", card: "#141e34", text: "#eef1f6", muted: "#a4adbd", path: "#a9a4ff", dot: "#c9c6ff", bad: "#ff6b70", badSoft: "#3a1a1f",
    tones: { who: "#93a4c3", surf: "#8b85ff", agent: "#ef9a76", code: "#22d3ee", awx: "#ff8a4c", alta: "#2dd4bf", visa: "#7aa2ff", proof: "#3ccf82" } },
  light: { bg: "#ffffff", zone: "#f6f7fa", zoneLine: "#dde1e8", card: "#ffffff", text: "#0b1220", muted: "#4f586b", path: "#4f46e5", dot: "#4f46e5", bad: "#c5363c", badSoft: "#fdecec",
    tones: { who: "#55637d", surf: "#4f46e5", agent: "#b4532a", code: "#0e7490", awx: "#ad4a0c", alta: "#0b7a70", visa: "#1d4ed8", proof: "#0b7d43" } },
} as const;
type Tone = keyof (typeof MAP)["dark"]["tones"];
interface Box { id: string; title: string; sub: string[]; tone: Tone | "bad"; h?: number }
interface Zone { n: number; name: string; note: string; tone: Tone; boxes: Box[]; banner?: string }

export const ZONES: Zone[] = [
  { n: 1, name: "Who", note: "people and outside AI", tone: "who", boxes: [
    { id: "cfo", title: "The CFO", sub: ["a passkey: Face ID or a key;", "signs the exact terms"], tone: "who" },
    { id: "visitor", title: "A visitor or judge", sub: ["/try, /verify;", "a test company of their own"], tone: "who" },
    { id: "ai", title: "An outside AI", sub: ["any MCP client;", "reads and proposes only"], tone: "who" },
  ] },
  { n: 2, name: "Surfaces", note: "two Cloudflare Workers", tone: "surf", boxes: [
    { id: "home", title: "Home", sub: ["the story and the proof"], tone: "surf" },
    { id: "try", title: "/try", sub: ["pay an invoice with your", "passkey; then the negotiation"], tone: "surf" },
    { id: "neg", title: "/try/negotiate", sub: ["two Claude agents agree", "a deal; code holds limits"], tone: "surf" },
    { id: "verify", title: "/verify", sub: ["checks a proof file", "in your browser"], tone: "surf" },
    { id: "proofp", title: "/proof", sub: ["every id, per rail"], tone: "surf" },
    { id: "awxp", title: "/airwallex", sub: ["and /airwallex/calls:", "every sandbox call"], tone: "surf" },
    { id: "altap", title: "/alta  ·  /visa", sub: ["the mandates; the Visa", "Intelligent Commerce runs"], tone: "surf" },
    { id: "console", title: "Purser Cloud console", sub: ["Agents (their cards),", "Invoices, Books"], tone: "surf" },
    { id: "mcp", title: "/mcp", sub: ["the MCP server:", "read, propose only"], tone: "surf" },
  ] },
  { n: 3, name: "Agents", note: "Claude, by Anthropic", tone: "agent", banner: "agents propose · code decides", boxes: [
    { id: "reader", title: "Reader · Sonnet", sub: ["reads an invoice into", "checked fields"], tone: "agent" },
    { id: "checker", title: "Checker · Haiku", sub: ["pay, ask the CFO,", "hold or reject"], tone: "agent" },
    { id: "sourcing", title: "Sourcing · Haiku", sub: ["buys data by x402;", "negotiates with suppliers"], tone: "agent" },
    { id: "support", title: "Support · Sonnet", sub: ["disputes and refunds"], tone: "agent" },
    { id: "treasury", title: "Treasury · Opus", sub: ["cash, FX and when to pay"], tone: "agent" },
  ] },
  { n: 4, name: "Rails in code", note: "Purser's code decides", tone: "code", boxes: [
    { id: "policy", title: "CFO policy", sub: ["limits per agent", "and per rail"], tone: "code" },
    { id: "hash", title: "Terms SHA-256", sub: ["the hash of the exact", "terms, checked at payment"], tone: "code" },
    { id: "passkey", title: "Passkey approvals", sub: ["WebAuthn: the passkey", "signs the terms hash"], tone: "code" },
    { id: "refused", title: "Refused", sub: ["one cent changed: the", "signature no longer matches"], tone: "bad" },
    { id: "foureyes", title: "Four eyes", sub: ["a second passkey above", "a set amount"], tone: "code" },
    { id: "audit", title: "Audit log", sub: ["hash-chained,", "every decision"], tone: "code" },
    { id: "worst", title: "Worst-case test", sub: ["an AI that always says", "pay: 0 wrong payments"], tone: "code" },
  ] },
  { n: 5, name: "Money rails", note: "test money only", tone: "awx", boxes: [
    { id: "awx", title: "Airwallex sandbox", sub: ["cards with the CFO's limits;", "transfers carry the hash;", "FX; its own approvals"], tone: "awx", h: 108 },
    { id: "alta", title: "Alta testnet", sub: ["a mandate per agent; x402", "payments; over the cap:", "refused on chain"], tone: "alta", h: 108 },
    { id: "visa", title: "Visa VIC via Airi", sub: ["Intelligent Commerce through", "Airwallex Airi, sandbox;", "a credential per purchase"], tone: "visa", h: 108 },
  ] },
  { n: 6, name: "Proof and books", note: "check it without us", tone: "proof", boxes: [
    { id: "files", title: "Proof files", sub: ["terms, signature, key:", "verify-bundle, offline"], tone: "proof" },
    { id: "verify2", title: "/verify", sub: ["the same checks,", "in the browser"], tone: "proof" },
    { id: "all", title: "verify-all", sub: ["every verifier,", "one report"], tone: "proof" },
    { id: "anchor", title: "On-chain anchor", sub: ["the log's head on Alta;", "verify-anchor: MATCH"], tone: "proof" },
    { id: "t0", title: "T:0 ledger", sub: ["the books read back,", "to the cent"], tone: "proof" },
    { id: "ci", title: "CI", sub: ["tests, CodeQL and", "gitleaks on every push"], tone: "proof" },
  ] },
];

export const MAP_W = 1400, MAP_H = 900;
interface Placed { x: number; y: number; w: number; h: number }
export function mapLayout(): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  const colW = 206, gap = 22, x0 = (MAP_W - 6 * colW - 5 * gap) / 2, top = 118, bottom = 872;
  ZONES.forEach((z, i) => {
    const zx = x0 + i * (colW + gap);
    out[`zone${z.n}`] = { x: zx, y: 96, w: colW, h: bottom - 96 };
    const startY = top + 38 + (z.banner ? 42 : 0);
    const hs = z.boxes.map((b) => b.h ?? (b.sub.length > 1 ? 68 : 50));
    const avail = bottom - 14 - startY, used = hs.reduce((a, b) => a + b, 0);
    const g = Math.min(26, (avail - used) / Math.max(1, z.boxes.length - 1));
    const block = used + g * (z.boxes.length - 1);
    let y = startY + Math.max(0, (avail - block) / 2);
    z.boxes.forEach((b, j) => { out[b.id] = { x: zx + 10, y: r1(y), w: colW - 20, h: hs[j]! }; y += hs[j]! + g; });
  });
  return out;
}

// The main path of one payment, box by box, and where the red one turns off.
export const MAIN_PATH = ["visitor", "try", "reader", "checker", "policy", "passkey", "awx", "files"] as const;
export const RED_PATH = ["hash", "refused"] as const;

export function systemMapSvg(theme: Theme): string {
  const c = MAP[theme], L = mapLayout();
  const toneOf = (t: Tone | "bad") => (t === "bad" ? c.bad : c.tones[t]);
  const zones = ZONES.map((z) => {
    const p = L[`zone${z.n}`]!, t = c.tones[z.tone];
    const banner = z.banner ? `<rect x="${p.x + 6}" y="${p.y + 60}" width="${p.w - 12}" height="30" rx="15" fill="none" stroke="${t}" stroke-width="1.4" stroke-dasharray="4 3"/><text x="${p.x + p.w / 2}" y="${p.y + 80}" text-anchor="middle" style="font-size:12px;font-weight:700;fill:${t}">${z.banner}</text>` : "";
    return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="16" fill="${c.zone}" stroke="${c.zoneLine}"/>
<circle cx="${p.x + 22}" cy="${p.y + 22}" r="11" fill="${t}"/><text x="${p.x + 22}" y="${p.y + 26.5}" text-anchor="middle" style="font-size:12.5px;font-weight:800;fill:${c.bg}">${z.n}</text>
<text x="${p.x + 40}" y="${p.y + 27}" style="font-size:16px;font-weight:750;fill:${c.text}">${esc(z.name)}</text>
<text x="${p.x + 12}" y="${p.y + 46}" style="font-size:12px;fill:${c.muted}">${esc(z.note)}</text>${banner}`;
  }).join("\n");
  const boxes = ZONES.flatMap((z) => z.boxes).map((b) => {
    const p = L[b.id]!, t = toneOf(b.tone), bad = b.tone === "bad";
    const subs = b.sub.map((s, i) => `<text x="${p.x + 14}" y="${r1(p.y + 41 + i * 16)}" style="font-size:12px;fill:${c.muted}">${esc(s)}</text>`).join("");
    return `<g class="bx${bad ? " refused" : ""}" id="${b.id}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" fill="${bad ? c.badSoft : c.card}" stroke="${t}" stroke-opacity="${bad ? 1 : 0.55}" stroke-width="${bad ? 1.6 : 1.2}"/><rect x="${p.x}" y="${p.y + 10}" width="4" height="${p.h - 20}" rx="2" fill="${t}"/><text x="${p.x + 14}" y="${p.y + 22}" style="font-size:14px;font-weight:700;fill:${bad ? t : c.text}">${esc(b.title)}</text>${subs}</g>`;
  }).join("\n");
  // Path points: leave a box on its right edge, enter the next on its left (or top/bottom inside one zone).
  const pts = (ids: readonly string[], side: "right" | "left" = "right") => {
    const out: [number, number][] = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = L[ids[i]!]!, b = L[ids[i + 1]!]!;
      if (Math.abs(a.x - b.x) < 1) { // same column: down the right edge, inside the gutter
        const ex = side === "right" ? a.x + a.w : a.x, gx = side === "right" ? ex + 5 : ex - 5;
        if (out.length === 0) out.push([ex, a.y + a.h / 2]);
        else { const last = out[out.length - 1]!; if (last[0] !== ex) out.push([ex, last[1]]); }
        out.push([gx, a.y + a.h / 2], [gx, b.y + b.h / 2], [ex, b.y + b.h / 2]);
        continue;
      }
      const ay = a.y + a.h / 2, by = b.y + b.h / 2, mx = (a.x + a.w + b.x) / 2;
      if (out.length === 0) out.push([a.x + a.w, ay]);
      else { const last = out[out.length - 1]!; if (last[0] < a.x + a.w) out.push([a.x + a.w, last[1]]); }
      out.push([mx, ay], [mx, by], [b.x, by]);
    }
    return out.map(([x, y]) => [r1(x), r1(y)] as [number, number]);
  };
  const main = pts(MAIN_PATH), red = pts(RED_PATH, "left");
  const d = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const frames = (p: [number, number][], from: number, to: number, hold = 0) => {
    const segs = p.slice(1).map(([x, y], i) => Math.hypot(x - p[i]![0], y - p[i]![1]));
    const total = segs.reduce((a, b) => a + b, 0);
    let acc = 0;
    const span = to - from;
    const out = [`0%{transform:translate(${p[0]![0]}px,${p[0]![1]}px);opacity:0}`, `${r1(from)}%{transform:translate(${p[0]![0]}px,${p[0]![1]}px);opacity:1}`];
    p.slice(1).forEach(([x, y], i) => { acc += segs[i]!; out.push(`${r1(from + (acc / total) * span)}%{transform:translate(${x}px,${y}px);opacity:1}`); });
    const [lx, ly] = p[p.length - 1]!;
    out.push(`${r1(to + hold)}%{transform:translate(${lx}px,${ly}px);opacity:1}`, `${r1(Math.min(100, to + hold + 2))}%,100%{transform:translate(${lx}px,${ly}px);opacity:0}`);
    return out.join("");
  };
  // The dots run under the boxes: a payment goes into a box and comes out of it.
  const ref = L.refused!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}" role="img" aria-labelledby="t d">
<title id="t">Purser: the whole system</title>
<desc id="d">Six zones, left to right. 1 Who: the CFO with a passkey, a visitor or judge, an outside AI over MCP (read and propose only). 2 Surfaces: Home, /try, /try/negotiate, /verify, /proof, /airwallex and /airwallex/calls, /alta and /visa, the Purser Cloud console (Agents with their cards, Invoices, Books), /mcp. 3 Agents, Claude: Reader on Sonnet, Checker on Haiku, Sourcing on Haiku, Support on Sonnet, Treasury on Opus; agents propose, code decides. 4 Rails in code: the CFO policy, the terms SHA-256, passkey approvals (WebAuthn), refused when one cent changes, four eyes, the hash-chained audit log, the worst-case test. 5 Money rails, test money only: Airwallex sandbox, Alta testnet, Visa Intelligent Commerce via Airwallex Airi. 6 Proof and books: proof files, /verify, verify-all, the on-chain anchor, the T:0 ledger, CI. Dots travel the path of one payment: visitor, /try, Reader, Checker, CFO policy, passkey approval, Airwallex, proof files; a red dot takes a changed cent from the terms hash to Refused.</desc>
<style>
text{font-family:${SANS}}
.flow{stroke-dasharray:6 6;animation:flow 1s linear infinite}@keyframes flow{to{stroke-dashoffset:-12}}
.dot{animation:m 10s linear infinite}.d2{animation-delay:-3.33s}.d3{animation-delay:-6.66s}
@keyframes m{${frames(main, 2, 88, 4)}}
.rd{animation:r 10s linear infinite}@keyframes r{${frames(red, 50, 66, 10)}}
.flash{opacity:0;animation:fl 10s linear infinite}@keyframes fl{0%,65%{opacity:0}67%{opacity:1}74%{opacity:.25}78%{opacity:1}86%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.flow,.dot,.rd,.flash{animation:none}.dot,.rd{opacity:0}}
</style>
<rect width="${MAP_W}" height="${MAP_H}" fill="${c.bg}"/>
<text x="${L.zone1!.x}" y="44" style="font-size:24px;font-weight:780;fill:${c.text};letter-spacing:-0.01em">Purser: the whole system</text>
<text x="${L.zone1!.x}" y="72" style="font-size:14px;fill:${c.muted}">Agents propose, code decides, the CFO signs the exact terms. Test money only: sandboxes and testnets.</text>
<g transform="translate(${L.zone6!.x + L.zone6!.w} 0)"><text x="0" y="40" text-anchor="end" style="font-size:12.5px;fill:${c.muted}">one payment</text><line x1="-150" y1="36" x2="-110" y2="36" stroke="${c.path}" stroke-width="2.2" stroke-dasharray="6 6"/><circle cx="-130" cy="36" r="4.5" fill="${c.dot}"/>
<text x="0" y="64" text-anchor="end" style="font-size:12.5px;fill:${c.muted}">one cent changed: refused</text><line x1="-210" y1="60" x2="-170" y2="60" stroke="${c.bad}" stroke-width="2.2" stroke-dasharray="6 6"/><circle cx="-190" cy="60" r="4.5" fill="${c.bad}"/></g>
${zones}
<path class="flow" d="${d(main)}" fill="none" stroke="${c.path}" stroke-width="2" stroke-opacity="0.75" stroke-linejoin="round"/>
<path class="flow" d="${d(red)}" fill="none" stroke="${c.bad}" stroke-width="2" stroke-opacity="0.85" stroke-linejoin="round"/>
<circle class="dot" r="5.5" fill="${c.dot}" stroke="${c.bg}" stroke-width="1.5"/><circle class="dot d2" r="5.5" fill="${c.dot}" stroke="${c.bg}" stroke-width="1.5"/><circle class="dot d3" r="5.5" fill="${c.dot}" stroke="${c.bg}" stroke-width="1.5"/>
<circle class="rd" r="5.5" fill="${c.bad}" stroke="${c.bg}" stroke-width="1.5"/>
${boxes}
<rect class="flash" x="${ref.x - 4}" y="${ref.y - 4}" width="${ref.w + 8}" height="${ref.h + 8}" rx="13" fill="none" stroke="${c.bad}" stroke-width="3"/>
</svg>
`;
}

export function wowSvgs(): Record<string, string> {
  const f = statFigures();
  const out: Record<string, string> = {};
  for (const t of ["dark", "light"] as const) {
    out[`${WOW_DIR}/terminal-verify-${t}.svg`] = terminalSvg(t);
    out[`${WOW_DIR}/stats-${t}.svg`] = statsSvg(t, f);
    out[`${WOW_DIR}/system-map-${t}.svg`] = systemMapSvg(t);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [f, svg] of Object.entries(wowSvgs())) { writeFileSync(f, svg); console.log(`wrote ${f} (${Buffer.byteLength(svg)} bytes)`); }
}
