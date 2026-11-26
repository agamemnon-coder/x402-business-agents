// The Markdown pages' animations (26 Nov 2026, Max: "more visuals and architecture, animations, graphs, badges"): small
// animated SVGs in the Purser colours, one file for GitHub's light theme and one for its dark theme, shown with <picture>.
// CSS keyframes only (GitHub strips scripts), and every animation stops for a reader who asks for reduced motion: the
// still picture is then the whole story. Every value drawn comes from a committed record or a document, named below.
//   npm run docs:anim        writes docs/assets/anim/*.svg
// test/docs-anim.test.ts draws them again and compares them with the committed files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
export const ANIM_DIR = join(ROOT, "docs/assets/anim");

/** The Purser colours: violet is Purser and approval, emerald paid, amber waits and test money, rose refused, sky the rails. */
export const PALETTE = { violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", indigo: "#6366f1", teal: "#14b8a6", blue: "#3b82f6" };
type Theme = "light" | "dark";
const INK: Record<Theme, { bg: string; card: string; ink: string; muted: string; line: string }> = {
  light: { bg: "#ffffff", card: "#f6f8fa", ink: "#1f2328", muted: "#59636e", line: "#d1d9e0" },
  dark: { bg: "#0d1117", card: "#161b22", ink: "#e6edf3", muted: "#9198a1", line: "#3d444d" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

function frame(theme: Theme, w: number, h: number, label: string, css: string, body: string): string {
  const c = INK[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<style>
text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.bg{fill:${c.bg}}.card{fill:${c.card};stroke:${c.line}}.ink{fill:${c.ink}}.muted{fill:${c.muted}}.line{stroke:${c.line};fill:none}.rose{fill:${theme === "light" ? "#be123c" : "#fb7185"}}
.t{font-size:15px;font-weight:600}.l{font-size:13px;font-weight:600}.s{font-size:11.5px}.m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
${css}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect class="bg" width="${w}" height="${h}" rx="10"/>
${body}
</svg>
`;
}

/** One payment's path: the agent proposes, Purser's code checks, the CFO's passkey signs above the limit, the rail's own
 * control, then the books; a packet travels the path and each step lights as it passes. */
export function moneyPath(theme: Theme): string {
  const steps = [
    { t: "AI agent", s: "proposes a payment", c: PALETTE.indigo },
    { t: "Purser's checks", s: "in code: limits, payee", c: PALETTE.violet },
    { t: "CFO's passkey", s: "Face ID, above the limit", c: PALETTE.violet },
    { t: "The rail's control", s: "Airwallex · Alta", c: PALETTE.sky },
    { t: "The books", s: "double entry", c: PALETTE.emerald },
  ];
  const w = 800, h = 172, bw = 136, gap = 22, y = 52, cycle = 6;
  const x = (i: number) => 18 + i * (bw + gap);
  const travel = x(4) - x(0);
  const css = `.glow{opacity:.18;animation:glow ${cycle}s linear infinite}
@keyframes glow{0%{opacity:.18}4%{opacity:.95}18%{opacity:.18}100%{opacity:.18}}
.pk{opacity:0;animation:pk ${cycle}s linear infinite}
@keyframes pk{0%{opacity:1;transform:translateX(0)}80%{opacity:1;transform:translateX(${travel}px)}90%{opacity:0;transform:translateX(${travel}px)}100%{opacity:0}}`;
  const boxes = steps.map((s, i) => {
    const bx = x(i), d = ((cycle * 0.8 * i) / 4).toFixed(2);
    return `<rect class="glow" style="animation-delay:${d}s" x="${bx - 4}" y="${y - 4}" width="${bw + 8}" height="72" rx="12" fill="${s.c}"/>
<rect class="card" x="${bx}" y="${y}" width="${bw}" height="64" rx="9" stroke-width="1.5"/>
<rect x="${bx}" y="${y}" width="6" height="64" rx="3" fill="${s.c}"/>
<text class="ink l" x="${bx + 16}" y="${y + 27}">${esc(s.t)}</text>
<text class="muted s" x="${bx + 16}" y="${y + 46}">${esc(s.s)}</text>`;
  }).join("\n");
  const arrows = steps.slice(1).map((_, i) => {
    const ax = x(i) + bw + 3;
    return `<path class="line" d="M${ax} ${y + 32}h${gap - 8}" stroke-width="2"/><path d="M${ax + gap - 8} ${y + 27}l6 5-6 5z" fill="${INK[theme].line}"/>`;
  }).join("\n");
  const body = `<text class="ink t" x="18" y="32">One payment's path</text>
${arrows}
${boxes}
<circle class="pk" cx="${x(0) + bw / 2}" cy="${y + 78}" r="5" fill="${PALETTE.violet}"/>
<text class="muted s" x="18" y="${h - 14}">Each step can stop the payment. Test money only: the Airwallex sandbox and the Alta (formerly Metal) testnet.</text>`;
  return frame(theme, w, h, "One payment's path: an AI agent proposes; Purser's checks in code; above the limit the CFO's passkey (Face ID) signs the exact terms; the rail's own control; then the books. Test money only.", css, body);
}

/** One changed cent: the signed terms of the /try sample and their SHA-256, then the same signature sent with EUR 1,850.01,
 * whose terms hash differently: refused. The amounts and hashes are docs/proof/try-paid.json's and try-refused.json's. */
export function oneCent(theme: Theme): string {
  const paid = JSON.parse(readFileSync(join(ROOT, "docs/proof/try-paid.json"), "utf8")) as { terms: { amount: string; currency: string }; terms_sha256: string };
  const refused = JSON.parse(readFileSync(join(ROOT, "docs/proof/try-refused.json"), "utf8")) as { asked: { terms: { amount: string }; sha256: string } };
  const money = (a: string) => `${paid.terms.currency} ${Number(a).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const w = 760, h = 196, cycle = 8;
  const css = `.b{animation:b ${cycle}s ease-in-out infinite}
@keyframes b{0%,38%{opacity:0;transform:translateY(6px)}48%,90%{opacity:1;transform:translateY(0)}100%{opacity:0}}
.cent{animation:cent 1s steps(2) infinite}@keyframes cent{50%{fill:${PALETTE.amber}}}`;
  const row = (y: number, amount: string, hash: string, verdict: string, colour: string, extra = "") => `<rect class="card" x="18" y="${y}" width="724" height="50" rx="9" stroke-width="1.5"/>
<rect x="18" y="${y}" width="6" height="50" rx="3" fill="${colour}"/>
<text class="ink l" x="36" y="${y + 21}">${amount}</text><text class="muted s" x="36" y="${y + 39}">to Bergtex Textil GmbH</text>
<text class="muted s" x="196" y="${y + 21}">SHA-256 of the exact terms</text><text class="ink m" x="196" y="${y + 39}">${esc(short(hash))}</text>
<path class="line" d="M352 ${y + 25}h26" stroke-width="2"/>
<rect x="390" y="${y + 11}" width="352" height="28" rx="14" fill="${colour}" opacity=".16"/>
<text class="ink l" x="404" y="${y + 30}">${esc(verdict)}</text>${extra}`;
  const a = money(paid.terms.amount), b = money(refused.asked.terms.amount);
  const body = `<text class="ink t" x="18" y="30">One changed cent breaks the signature</text>
${row(46, a, paid.terms_sha256, "the CFO's passkey signed this hash: paid", PALETTE.emerald)}
<g class="b">${row(108, `${esc(b.slice(0, -1))}<tspan class="cent rose">${b.slice(-1)}</tspan>`, refused.asked.sha256, `a different hash, not the signed one: refused`, PALETTE.rose)}</g>
<text class="muted s" x="18" y="${h - 14}">The /try samples of 15 Nov 2026 (docs/proof/try-paid.json, try-refused.json). Test money only.</text>`;
  return frame(theme, w, h, `One changed cent breaks the signature: ${a} to Bergtex Textil GmbH hashes to ${short(paid.terms_sha256)}, which the CFO's passkey signed, so it is paid; the same signature sent with ${b} hashes to ${short(refused.asked.sha256)}, so it is refused. Test money only.`, css, body);
}

/** The ledger as a hash chain: the four entries of the /try payment (docs/proof/try-paid.json, entries 3 to 6), each
 * hash over the previous one; they appear in turn, then an edited entry breaks every hash after it. */
export function hashChain(theme: Theme): string {
  const paid = JSON.parse(readFileSync(join(ROOT, "docs/proof/try-paid.json"), "utf8")) as { ledger: { entries: { entry_id: number; description: string; prev_hash: string; entry_hash: string }[] } };
  const es = paid.ledger.entries.slice(0, 4);
  for (let i = 1; i < es.length; i++) if (es[i]!.prev_hash !== es[i - 1]!.entry_hash) throw new Error("the chain does not link");
  const w = 760, h = 226, bw = 164, gap = 20, y = 50, cycle = 9;
  const x = (i: number) => 18 + i * (bw + gap);
  const css = `.e{animation:e ${cycle}s ease-out infinite}
@keyframes e{0%{opacity:0;transform:translateY(8px)}8%,100%{opacity:1;transform:translateY(0)}}
.x{opacity:0;animation:x ${cycle}s linear infinite}
@keyframes x{0%,62%{opacity:0}68%,94%{opacity:1}100%{opacity:0}}`;
  const label = (d: string) => (d.length > 24 ? `${d.slice(0, 23)}…` : d);
  const blocks = es.map((e, i) => {
    const bx = x(i), d = (i * 1.2).toFixed(1);
    return `<g class="e" style="animation-delay:${d}s"><rect class="card" x="${bx}" y="${y}" width="${bw}" height="86" rx="9" stroke-width="1.5"/>
<rect x="${bx}" y="${y}" width="${bw}" height="6" rx="3" fill="${PALETTE.violet}"/>
<text class="ink l" x="${bx + 12}" y="${y + 26}">Entry ${e.entry_id}</text>
<text class="muted s" x="${bx + 12}" y="${y + 43}">${esc(label(e.description))}</text>
<text class="muted m" x="${bx + 12}" y="${y + 61}">prev ${esc(short(e.prev_hash))}</text>
<text class="ink m" x="${bx + 12}" y="${y + 77}">hash ${esc(short(e.entry_hash))}</text></g>`;
  }).join("\n");
  const links = es.slice(1).map((_, i) => `<path class="line" d="M${x(i) + bw} ${y + 72}h${gap}" stroke-width="2"/>`).join("\n");
  const broken = es.slice(1).map((_, i) => {
    const bx = x(i + 1);
    return i === 0
      ? `<rect x="${bx}" y="${y}" width="${bw}" height="86" rx="9" fill="none" stroke="${PALETTE.rose}" stroke-width="2.5"/><text x="${bx + bw / 2}" y="${y + 106}" text-anchor="middle" class="l rose">edited</text>`
      : `<rect x="${bx}" y="${y}" width="${bw}" height="86" rx="9" fill="none" stroke="${PALETTE.rose}" stroke-width="2.5" stroke-dasharray="5 4"/><text x="${bx + bw / 2}" y="${y + 106}" text-anchor="middle" class="s rose">hash no longer matches</text>`;
  }).join("\n");
  const body = `<text class="ink t" x="18" y="30">The books as a hash chain</text>
${links}
${blocks}
<g class="x">${broken}<text class="l rose" x="18" y="${y + 134}">Change one entry and every hash after it breaks.</text></g>
<text class="muted s" x="18" y="${h - 14}">The /try payment's ledger entries, 15 Nov 2026 (docs/proof/try-paid.json); each hash covers the previous one. Test money only.</text>`;
  return frame(theme, w, h, `The books as a hash chain: entries ${es.map((e) => e.entry_id).join(", ")} of the /try payment, each hash over the previous one; change one entry and every hash after it breaks. Test money only.`, css, body);
}

/** The emergency stop, as docs/runbook.md says it works: one Face ID sets freeze; every agent payment is refused and
 * every agent card is set INACTIVE at Airwallex. Tested against stand-ins; the full stop not pulled live end to end. */
export function emergencyStop(theme: Theme): string {
  const w = 760, h = 214, y = 52, cycle = 7;
  const css = `.on{animation:on ${cycle}s linear infinite}.off{animation:off ${cycle}s linear infinite}
@keyframes on{0%,40%{opacity:1}48%,100%{opacity:0}}@keyframes off{0%,40%{opacity:0}48%,100%{opacity:1}}
.press{transform-box:fill-box;transform-origin:center;animation:press ${cycle}s ease-in-out infinite}
@keyframes press{0%,22%{transform:scale(1)}28%{transform:scale(.9)}34%,100%{transform:scale(1)}}`;
  const cards = [0, 1, 2].map((i) => {
    const cx = 300 + i * 150;
    return `<rect class="card" x="${cx}" y="${y}" width="136" height="80" rx="10" stroke-width="1.5"/>
<text class="ink l" x="${cx + 14}" y="${y + 26}">Agent card</text>
<text class="muted m" x="${cx + 14}" y="${y + 44}">•••• •••• ••••</text>
<g class="on"><rect x="${cx + 14}" y="${y + 54}" width="64" height="18" rx="9" fill="${PALETTE.emerald}" opacity=".2"/><text class="ink s" x="${cx + 24}" y="${y + 67}">ACTIVE</text></g>
<g class="off"><rect x="${cx + 14}" y="${y + 54}" width="76" height="18" rx="9" fill="${PALETTE.rose}" opacity=".22"/><text class="s rose" x="${cx + 22}" y="${y + 67}">INACTIVE</text></g>`;
  }).join("\n");
  const body = `<text class="ink t" x="18" y="30">The emergency stop</text>
<g class="press"><circle cx="70" cy="${y + 40}" r="34" fill="${PALETTE.rose}"/><text x="70" y="${y + 37}" text-anchor="middle" class="l" fill="#111827">STOP</text><text x="70" y="${y + 52}" text-anchor="middle" class="s" fill="#111827">all agents</text></g>
<text class="ink l" x="118" y="${y + 30}">freeze set</text><text class="muted s" x="118" y="${y + 48}">one Face ID approves</text>
<path class="line" d="M240 ${y + 40}h48" stroke-width="2"/>
${cards}
<g class="off"><text class="l rose" x="300" y="${y + 106}">Agent payments refused · card charges decline CARD_INACTIVE</text></g>
<text class="muted s" x="18" y="${h - 30}">Tested against stand-ins (test/freeze.test.ts); CARD_INACTIVE checked live on a single card.</text>
<text class="muted s" x="18" y="${h - 13}">The full stop has not been pulled live end to end (docs/runbook.md). Test money only.</text>`;
  return frame(theme, w, h, "The emergency stop: one Face ID sets freeze; every agent payment is refused and every agent card is set INACTIVE at Airwallex, so a charge declines CARD_INACTIVE. Tested against stand-ins; CARD_INACTIVE checked live on a single card; the full stop has not been pulled live end to end.", css, body);
}

/** Every animation, by file name. */
export function animations(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, draw] of Object.entries({ "money-path": moneyPath, "one-cent": oneCent, "hash-chain": hashChain, "emergency-stop": emergencyStop }))
    for (const theme of ["light", "dark"] as const) out[`${name}-${theme}.svg`] = draw(theme);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mkdirSync(ANIM_DIR, { recursive: true });
  for (const [name, svg] of Object.entries(animations())) {
    writeFileSync(join(ANIM_DIR, name), svg);
    console.log(`docs/assets/anim/${name}: ${svg.length} bytes`);
  }
}
