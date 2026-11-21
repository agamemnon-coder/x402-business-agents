// The README's small demo (21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture
// animation can go; far fewer headings"). One payment as a judge would see it on /try, drawn from one recorded walk:
// the invoice in, Claude reads it, Purser's checks, the CFO signs the exact terms with a passkey, paid on the Airwallex
// sandbox; then the same approval with one cent changed, refused, nothing paid. Every word and figure is read here from
// that walk's record (DEMO_RECORD) and from the evidence wall (docs/evidence/evidence-wall.json) for the totals over
// all the walks; nothing is typed by hand.
//
// Like the proof strip (scripts/readme-proof-strip.ts): CSS animation only, played once, stopped by
// prefers-reduced-motion (the still frame is the last frame); no script, no external link, no web font, under 16 KB, so
// GitHub shows it in an <img>. Two layouts, each light and dark: wide (the README's column on a desktop) and narrow
// (a phone, under 600 px: the README picks it with a media query on <picture>).
//
// The two step cards beside the demo's thumbnail (step 2, /try; step 3, /proof) come from the same walk: the button the
// page showed and the verdict /verify gave the proof file. Dark in both themes, like the thumbnail they sit beside.
//
// Written by `npm run readme:demo`; test/readme-demo.test.ts redraws each file and compares.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

/** The recorded walk the demo shows: a phone walk through the public /try, 21 Nov (WebKit, a software passkey). */
export const DEMO_RECORD = "docs/runs/2026-11-21-phone-try/run-1.json";
export const WALL_RECORD = "docs/evidence/evidence-wall.json";
const DIR = "docs/assets/readme";
export const DEMO_FILES = {
  "wide-light": `${DIR}/demo-light.svg`,
  "wide-dark": `${DIR}/demo-dark.svg`,
  "narrow-light": `${DIR}/demo-narrow-light.svg`,
  "narrow-dark": `${DIR}/demo-narrow-dark.svg`,
} as const;
export const STEP_FILES = { try: `${DIR}/step-try.svg`, proof: `${DIR}/step-proof.svg` } as const;
type Theme = "light" | "dark";
type Layout = "wide" | "narrow";

const read = (p: string) => readFileSync(p, "utf8");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 100) / 100;
/** "1850.00" → "1,850.00". */
const money = (s: string) => { const [i, d] = s.split("."); return `${Number(i).toLocaleString("en-US")}.${d ?? "00"}`; };
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-5)}`;

// An answer's body is read loosely: demoFigures checks every field it uses and throws when one is missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Answer { method: string; path: string; status: number; body: Record<string, any> }
interface Walk { started_at: string; ok: boolean; passkey: string; page_says: { sign_clicks: string }; answers: Answer[]; bundle: { paid: { verify_page_pasted: { verdict: string } } } }

export interface DemoFigures {
  day: string;
  passkey: string;
  invoice: { no: string; vendor: string; amount: string; currency: string };
  claude: { model: string; live: boolean; line: string };
  checks: string[];
  finding: { times: string; usual: string } | null;
  limit: string;
  signed: string;
  signButton: string;
  paid: { status: string; source: string; amount: string };
  refused: { amount: string; sent: string; reason: string; transfersBefore: number; transfersAfter: number };
  verdict: string;
  wall: { cent: string; centLabel: string; signToPaid: string };
}

const CHECK_WORDS: Record<string, string> = { not_paid_before: "not paid before", bank_on_file: "bank on file", known_supplier: "known supplier" };

/** Every figure the demo shows, from the walk's record and the evidence wall. Throws when one is missing, never guesses. */
export function demoFigures(): DemoFigures {
  const w = JSON.parse(read(DEMO_RECORD)) as Walk;
  if (!w.ok) throw new Error(`${DEMO_RECORD}: the walk did not pass`);
  // The first test company of the walk (a second /try/start begins the next scenario).
  const starts = w.answers.map((a, i) => (a.path === "/v1/try/start" ? i : -1)).filter((i) => i >= 0);
  const first = w.answers.slice(starts[0], starts[1] ?? w.answers.length);
  const start = first[0]!.body;
  const sample = first.find((a) => /\/v1\/engine\/samples\//.test(a.path) && a.body.invoice?.alone_limit?.within === false);
  if (!sample) throw new Error(`${DEMO_RECORD}: no invoice above the agent's limit`);
  const inv = sample.body.invoice;
  const proposal = first.find((a) => a.path === `/v1/engine/invoices/${inv.id}/pay`)?.body.proposal;
  if (proposal?.status !== "PENDING_APPROVAL") throw new Error(`${DEMO_RECORD}: the invoice above the limit did not wait for the CFO`);
  const at = (p: string) => first.filter((a) => a.path === `/v1/engine/proposals/${proposal.id}/${p}`);
  const approved = at("approve")[0]?.body;
  const paid = at("pay").find((a) => a.body.outcome === "paid")?.body;
  const refused = at("pay").find((a) => a.body.outcome === "refused")?.body;
  const payout = at("payout/simulate").find((a) => a.body.note?.status)?.body.note;
  if (approved?.status !== "approved" || !paid || !refused || !payout) throw new Error(`${DEMO_RECORD}: the approval, the payment, the payout or the refusal is missing`);
  if (paid.signed_sha256 !== proposal.terms_sha256 || paid.layers?.signature?.verified !== true) throw new Error(`${DEMO_RECORD}: the payment was not over the signed hash`);
  if (refused.signed_sha256 !== proposal.terms_sha256 || refused.sent_sha256 === refused.signed_sha256 || refused.transfers_after !== refused.transfers_before) throw new Error(`${DEMO_RECORD}: the refusal is not a changed term refused before any transfer`);
  const asked = refused.proof?.asked?.terms?.amount as string | undefined;
  if (!asked || Math.round((Number(asked) - Number(inv.total)) * 100) !== 1) throw new Error(`${DEMO_RECORD}: the refused amount is not one cent more`);
  const line = (proposal.facts as [string, string][]).find(([k]) => k === "On the invoice")?.[1];
  if (!line) throw new Error(`${DEMO_RECORD}: no total line read from the invoice`);
  const usual = /more than (\d+) times this supplier's usual (\w+) ([\d.]+)/.exec(inv.findings?.[0]?.message ?? "");
  const tiles = new Map((JSON.parse(read(WALL_RECORD)) as { groups: { tiles: { key: string; fig: string; label: string }[] }[] }).groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const cent = tiles.get("try-cent"), s2p = tiles.get("try-sign-paid");
  if (!cent || !s2p) throw new Error(`${WALL_RECORD}: no try-cent or try-sign-paid tile`);
  const button = w.page_says.sign_clicks.split(" | ").find((s) => s.startsWith("Approve & sign"));
  if (!button) throw new Error(`${DEMO_RECORD}: no sign button recorded`);
  return {
    day: dayOf(w.started_at),
    passkey: w.passkey,
    invoice: { no: inv.invoice_no, vendor: inv.vendor, amount: money(inv.total), currency: inv.currency },
    claude: { model: String(inv.read_by).replace(/^claude:/, ""), live: start.mode?.claude === "live", line: line.replace(/[“”]/g, "") },
    checks: (inv.checks_passed as string[]).map((c) => CHECK_WORDS[c] ?? c.replace(/_/g, " ")),
    finding: usual ? { times: `over ${usual[1]}×`, usual: `${usual[2]} ${money(usual[3]!)}` } : null,
    limit: `${inv.alone_limit.currency} ${money(inv.alone_limit.amount)}`,
    signed: proposal.terms_sha256,
    signButton: button,
    paid: { status: payout.status, source: payout.source, amount: money(payout.amount) },
    refused: { amount: money(asked), sent: refused.sent_sha256, reason: refused.layers.signature.reason, transfersBefore: refused.transfers_before, transfersAfter: refused.transfers_after },
    verdict: w.bundle.paid.verify_page_pasted.verdict,
    wall: { cent: cent.fig, centLabel: cent.label, signToPaid: s2p.fig },
  };
}

/** The demo's alt text in the README: what the picture shows, in words. */
export function demoAlt(f = demoFigures()): string {
  return `Animated, one recorded walk through /try (${f.day}, test money): invoice ${f.invoice.no} from ${f.invoice.vendor}, ${f.invoice.currency} ${f.invoice.amount}, comes in; Claude (${f.claude.model}) reads “${f.claude.line}”; Purser's checks pass (${f.checks.join(", ")})${f.finding ? ` and flag the amount as ${f.finding.times} the usual ${f.finding.usual}` : ""}; above the agent's ${f.limit} limit the CFO signs the SHA-256 of the exact terms with a passkey; paid, the Airwallex sandbox transfer ${f.paid.status} (settlement simulated). Then the same approval with one cent changed (${f.invoice.currency} ${f.refused.amount}): refused, nothing paid. Over all the /try walks of 19 to 21 Nov: ${f.wall.cent} one-cent changes refused.`;
}

const SANS = `ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// GitHub's neutrals; Purser's violet as the one accent (the mark, the thumbnail); green for paid, red for refused.
const PAL = {
  light: { bg: "#ffffff", card: "#f6f8fa", line: "#d1d9e0", ink: "#1f2328", ink2: "#59636e", muted: "#656d76", accent: "#8250df", accentBg: "#fbefff", good: "#1a7f37", goodBg: "#dafbe1", bad: "#cf222e", badBg: "#ffebe9", warn: "#9a6700", track: "#e6eaef", markBg: "#0b1220", markInk: "#ffffff" },
  dark: { bg: "#0d1117", card: "#151b23", line: "#3d444d", ink: "#e6edf3", ink2: "#9198a1", muted: "#8b949e", accent: "#a371f7", accentBg: "#271b3d", good: "#3fb950", goodBg: "#12261b", bad: "#f85149", badBg: "#2c1216", warn: "#d29922", track: "#262c36", markBg: "#f0f3f6", markInk: "#0b1220" },
} as const;

// Width of a line of text, estimated (the layout throws rather than let a line spill out of its card).
export const tw = (s: string, size: number, bold = false) => [...s].reduce((w, ch) => w + (/[ il.,:;()'|!’“”…·✓]/.test(ch) ? 0.3 : /[mwMW×]/.test(ch) ? 0.85 : /[A-Z€]/.test(ch) ? 0.64 : /[0-9]/.test(ch) ? 0.56 : 0.54), 0) * size * (bold ? 1.06 : 1);
const fit = (s: string, size: number, room: number, bold = false) => {
  if (tw(s, size, bold) > room) throw new Error(`"${s}" does not fit in ${Math.round(room)} px`);
  return esc(s);
};

/** The feather of the site header's mark (src/ui/nav.ts), on its rounded square. */
const markSvg = (x: number, y: number, size: number, bg: string, ink: string) => `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r1(size * 0.3)}" fill="${bg}"/><g transform="translate(${r1(x + size * 0.2333)} ${r1(y + size * 0.2333)}) scale(${r1(size / 45)})" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></g>`;

interface Step { title: string; lines: { t: string; cls?: "big" | "mono" | "ok" | "warn" | "good" }[]; tone?: "good" }

function steps(f: DemoFigures, layout: Layout): Step[] {
  const cur = f.invoice.currency;
  if (layout === "wide") return [
    { title: "Invoice in", lines: [{ t: f.invoice.no }, { t: f.invoice.vendor }, { t: `${cur} ${f.invoice.amount}`, cls: "big" }] },
    { title: "Claude reads", lines: [{ t: `${f.claude.model}${f.claude.live ? ", live" : ""}` }, { t: `“${f.claude.line.slice(0, f.claude.line.lastIndexOf(` ${cur} `))}` }, { t: `${f.claude.line.slice(f.claude.line.lastIndexOf(` ${cur} `) + 1)}”`, cls: "big" }] },
    { title: "Purser’s checks", lines: [...f.checks.map((c) => ({ t: `✓ ${c}`, cls: "ok" as const })), ...(f.finding ? [{ t: `! ${f.finding.times} the usual`, cls: "warn" as const }, { t: `   ${f.finding.usual}, flagged`, cls: "warn" as const }] : [])] },
    { title: "CFO signs", lines: [{ t: "above the agent’s" }, { t: `${f.limit} limit:` }, { t: "a passkey signs the" }, { t: "SHA-256 of the terms" }, { t: short(f.signed), cls: "mono" }] },
    { title: "Paid", tone: "good", lines: [{ t: "Airwallex sandbox" }, { t: `transfer ${f.paid.status}`, cls: "good" }, { t: "settlement simulated" }] },
  ];
  return [
    { title: "Invoice in", lines: [{ t: `${f.invoice.no} · ${f.invoice.vendor}` }, { t: `${cur} ${f.invoice.amount}`, cls: "big" }] },
    { title: "Claude reads", lines: [{ t: `${f.claude.model}${f.claude.live ? ", live" : ""}, reads the total:` }, { t: `“${f.claude.line}”`, cls: "big" }] },
    { title: "Purser’s checks", lines: [{ t: f.checks.slice(0, 2).map((c) => `✓ ${c}`).join("   "), cls: "ok" }, ...f.checks.slice(2).map((c) => ({ t: `✓ ${c}`, cls: "ok" as const })), ...(f.finding ? [{ t: `! ${f.finding.times} the usual ${f.finding.usual}: flagged`, cls: "warn" as const }] : [])] },
    { title: "CFO signs with a passkey", lines: [{ t: `above the agent’s ${f.limit} limit, the passkey` }, { t: "signs the SHA-256 of the exact terms:" }, { t: short(f.signed), cls: "mono" }] },
    { title: "Paid", tone: "good", lines: [{ t: `Airwallex sandbox: transfer ${f.paid.status}`, cls: "good" }, { t: "settlement simulated by the sandbox" }] },
  ];
}

/** The demo, one theme and one layout. */
export function demoSvg(theme: Theme, layout: Layout, f = demoFigures()): string {
  const c = PAL[theme];
  const cur = f.invoice.currency;
  const st = steps(f, layout);
  const D = (i: number) => r1(0.3 + 0.75 * i); // each step's entrance
  const END = D(st.length); // when the refusal comes in
  const lineFill = (cls?: string) => cls === "ok" || cls === "good" ? c.good : cls === "warn" ? c.warn : cls === "big" ? c.ink : c.ink2;
  const lineAttrs = (cls?: string) => cls === "big" ? ` font-size="17" font-weight="650"` : cls === "mono" ? ` font-family="${MONO}" font-size="12"` : cls === "good" ? ` font-size="13" font-weight="600"` : ` font-size="13"`;
  let body = "", W: number, H: number;

  if (layout === "wide") {
    W = 960; const M = 14, G = 10, CW = (W - 2 * M - 4 * G) / 5, CY = 60, CH = 158, ROOM = CW - 24;
    st.forEach((s, i) => {
      const x = M + i * (CW + G), good = s.tone === "good";
      const lines = s.lines.map((l, j) => `<text x="${r1(x + 13)}" y="${CY + 58 + j * 21}"${lineAttrs(l.cls)} fill="${lineFill(l.cls)}"${l.cls === "ok" ? ` class="tick" style="animation-delay:${r1(D(i) + 0.35 + 0.18 * j)}s"` : ""}>${fit(l.t, l.cls === "big" ? 17 : 13, ROOM, l.cls === "big")}</text>`).join("");
      body += `<g class="in" style="animation-delay:${D(i)}s"><rect x="${r1(x) + 0.5}" y="${CY + 0.5}" width="${r1(CW - 1)}" height="${CH - 1}" rx="10" fill="${good ? c.goodBg : c.card}" stroke="${good ? c.good : c.line}"/>
<circle cx="${r1(x + 23)}" cy="${CY + 25}" r="11" fill="${good ? c.good : c.accent}"/><text x="${r1(x + 23)}" y="${CY + 29.5}" font-size="12.5" font-weight="700" fill="${c.bg}" text-anchor="middle">${i + 1}</text>
<text x="${r1(x + 41)}" y="${CY + 30}" font-size="15" font-weight="650" fill="${c.ink}">${fit(s.title, 15, CW - 50, true)}</text>${lines}</g>\n`;
      if (i < st.length - 1) body += `<path class="in" style="animation-delay:${r1(D(i) + 0.4)}s" d="M${r1(x + CW + G / 2 - 2)} ${CY + 70}l4 5-4 5" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    });
    // The rail under the steps: the payment's progress, filled once from the invoice to paid.
    const RY = CY + CH + 14;
    body += `<rect x="${M}" y="${RY}" width="${W - 2 * M}" height="4" rx="2" fill="${c.track}"/><rect class="fill" x="${M}" y="${RY}" width="${W - 2 * M}" height="4" rx="2" fill="${c.accent}" style="animation-duration:${r1(D(st.length - 1) + 0.3)}s"/>\n`;
    // The refusal: the same approval, one cent more.
    const LY = RY + 18, LH = 58, x4 = M + 3 * (CW + G) + CW / 2;
    body += `<g class="in" style="animation-delay:${END}s"><path d="M${r1(x4)} ${CY + CH}V${LY}" stroke="${c.bad}" stroke-width="1.5" stroke-dasharray="3 3"/>
<rect x="${M + 0.5}" y="${LY + 0.5}" width="${W - 2 * M - 1}" height="${LH - 1}" rx="10" fill="${c.badBg}" stroke="${c.bad}"/>
<circle cx="${M + 26}" cy="${LY + LH / 2}" r="11" fill="${c.bad}"/><path d="M${M + 21.5} ${LY + LH / 2 - 4.5}l9 9m0-9l-9 9" stroke="${c.bg}" stroke-width="2.2" stroke-linecap="round"/>
<text x="${M + 46}" y="${LY + 24}" font-size="14" font-weight="650" fill="${c.ink}">One cent changed after signing: ${cur} ${esc(f.refused.amount.slice(0, -1))}<tspan class="cent" fill="${c.bad}">${esc(f.refused.amount.slice(-1))}</tspan></text>
<text x="${M + 46}" y="${LY + 43}" font-size="12.5" fill="${c.ink2}">its terms hash to <tspan font-family="${MONO}" font-size="12">${short(f.refused.sent)}</tspan>, not to the signed <tspan font-family="${MONO}" font-size="12">${short(f.signed)}</tspan></text>
<text x="${W - M - 18}" y="${LY + 35}" font-size="16" font-weight="700" fill="${c.bad}" text-anchor="end">Refused · nothing paid</text></g>\n`;
    H = LY + LH + 30;
    body += `<text class="in" style="animation-delay:${r1(END + 0.3)}s" x="${M}" y="${H - 11}" font-size="11.5" fill="${c.muted}">${fit(`One recorded walk, ${f.day}: ${DEMO_RECORD} · over all the /try walks of 19 to 21 Nov: ${f.wall.cent} one-cent changes refused · test money only`, 11.5, W - 2 * M)}</text>\n`;
    body = header(c, W, M) + body;
  } else {
    W = 420; const M = 14, TX = M + 44, ROOM = W - TX - M - 12;
    let y = 66;
    const tops: number[] = [];
    st.forEach((s, i) => {
      const h = 38 + s.lines.length * 19, good = s.tone === "good";
      tops.push(y);
      const lines = s.lines.map((l, j) => `<text x="${TX}" y="${y + 48 + j * 19}"${lineAttrs(l.cls === "big" ? "good" : l.cls)} fill="${lineFill(l.cls)}"${l.cls === "ok" ? ` class="tick" style="animation-delay:${r1(D(i) + 0.35 + 0.18 * j)}s"` : ""}>${fit(l.t, 13, ROOM)}</text>`).join("");
      body += `<g class="in" style="animation-delay:${D(i)}s"><rect x="${TX - 12.5}" y="${y + 0.5}" width="${W - TX - M + 12 - 1}" height="${h - 1}" rx="10" fill="${good ? c.goodBg : c.card}" stroke="${good ? c.good : c.line}"/>
<circle cx="${M + 14}" cy="${y + 24}" r="12" fill="${good ? c.good : c.accent}"/><text x="${M + 14}" y="${y + 28.5}" font-size="13" font-weight="700" fill="${c.bg}" text-anchor="middle">${i + 1}</text>
<text x="${TX}" y="${y + 28}" font-size="15.5" font-weight="650" fill="${c.ink}">${fit(s.title, 15.5, ROOM, true)}</text>${lines}</g>\n`;
      y += h + 8;
    });
    // The rail down the numbers, filled once from the invoice to paid.
    const top = tops[0]! + 24, bottom = tops[tops.length - 1]! + 24;
    body = `<rect x="${M + 12.5}" y="${top}" width="3" height="${bottom - top}" fill="${c.track}"/><rect class="fill v" x="${M + 12.5}" y="${top}" width="3" height="${bottom - top}" fill="${c.accent}" style="animation-duration:${r1(D(st.length - 1) + 0.3)}s"/>\n` + body;
    const LY = y + 4, LH = 92;
    body += `<g class="in" style="animation-delay:${END}s"><rect x="${M + 0.5}" y="${LY + 0.5}" width="${W - 2 * M - 1}" height="${LH - 1}" rx="10" fill="${c.badBg}" stroke="${c.bad}"/>
<circle cx="${M + 14}" cy="${LY + 24}" r="12" fill="${c.bad}"/><path d="M${M + 9.5} ${LY + 19.5}l9 9m0-9l-9 9" stroke="${c.bg}" stroke-width="2.2" stroke-linecap="round"/>
<text x="${TX}" y="${LY + 28}" font-size="15.5" font-weight="700" fill="${c.bad}">Refused · nothing paid</text>
<text x="${TX}" y="${LY + 50}" font-size="13" fill="${c.ink}">One cent changed after signing: ${cur} ${esc(f.refused.amount.slice(0, -1))}<tspan class="cent" fill="${c.bad}" font-weight="700">${esc(f.refused.amount.slice(-1))}</tspan></text>
<text x="${TX}" y="${LY + 70}" font-size="12.5" fill="${c.ink2}">hash <tspan font-family="${MONO}" font-size="12">${short(f.refused.sent)}</tspan>, not the signed one</text></g>\n`;
    H = LY + LH + 44;
    body += `<g class="in" style="animation-delay:${r1(END + 0.3)}s"><text x="${M}" y="${H - 28}" font-size="11.5" fill="${c.muted}">${fit(`One recorded walk on /try, ${f.day} · test money only`, 11.5, W - 2 * M)}</text>
<text x="${M}" y="${H - 12}" font-size="11.5" fill="${c.muted}">${fit(`All /try walks, 19 to 21 Nov: ${f.wall.cent} one-cent changes refused`, 11.5, W - 2 * M)}</text></g>\n`;
    body = header(c, W, M) + body;
  }

  const desc = `${demoAlt(f)} Drawn from ${DEMO_RECORD} and ${WALL_RECORD} by scripts/readme-demo-svg.ts.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Purser: one payment on /try, signed and paid; one cent changed, refused</title>
<desc id="d">${esc(desc)}</desc>
<style>
text{font-family:${SANS}}
.in{animation:in .5s cubic-bezier(.2,.7,.3,1) both}@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.tick{animation:in .35s ease-out both}
.fill{transform-box:fill-box;transform-origin:left center;animation:grow 3.6s linear .3s both}.fill.v{transform-origin:center top;animation-name:growv}
@keyframes grow{from{transform:scaleX(0)}to{transform:none}}@keyframes growv{from{transform:scaleY(0)}to{transform:none}}
.cent{animation:blink .45s ease-in-out ${r1(END + 0.5)}s 3 both}@keyframes blink{50%{opacity:.15}}
@media (prefers-reduced-motion:reduce){.in,.tick,.fill,.fill.v,.cent{animation:none}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${c.bg}" stroke="${c.line}"/>
${body}</svg>
`;
}

/** The header line: the mark, what this is, and the test-money label. */
function header(c: (typeof PAL)[Theme], W: number, M: number): string {
  const label = "Test money · sandbox";
  const lw = tw(label, 11.5, true) + 22;
  return `<g class="in" style="animation-delay:0s">${markSvg(M, 16, 28, c.markBg, c.markInk)}
<text x="${M + 38}" y="${35}" font-size="15" font-weight="700" fill="${c.ink}">Purser<tspan dx="8" font-weight="400" fill="${c.ink2}">${W > 600 ? "one payment on /try, as recorded" : "one payment on /try"}</tspan></text>
<rect x="${r1(W - M - lw) + 0.5}" y="18.5" width="${r1(lw - 1)}" height="23" rx="11.5" fill="none" stroke="${c.warn}"/><text x="${r1(W - M - lw / 2)}" y="34" font-size="11.5" font-weight="600" fill="${c.warn}" text-anchor="middle">${label}</text></g>\n`;
}

/** A step card's words: its number, title, what the page is, and one real line from the walk. */
function stepCard(which: "try" | "proof", f: DemoFigures) {
  return which === "try"
    ? { n: 2, title: "Try it live", sub: "/try · your own test company · 2 min", chip: f.signButton, note: `the button on /try, recorded ${f.day}` }
    : { n: 3, title: "See the proof", sub: "/proof · every id, every record", chip: f.verdict.replace(/^VALID /, "VALID · "), note: `/verify on the walk’s proof file, ${f.day}` };
}
/** A step card's alt text in the README. */
export function stepAlt(which: "try" | "proof", f = demoFigures()): string {
  const k = stepCard(which, f);
  return `${k.n} · ${k.title}: ${k.sub}. “${k.chip}” (${k.note}; test money)`;
}

const SITE = "https://kit11.max-31b.workers.dev";
/** The demo on YouTube (3:15), the video in the submission. */
export const DEMO_VIDEO = "https://youtu.be/gEUm8RlhZac";

/** The README's demo: the four pictures, the phone's under 600 px, each theme's by prefers-color-scheme; linked to /try. */
export function readmeDemoLine(f = demoFigures()): string {
  return `<a href="${SITE}/try"><picture><source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="${DEMO_FILES["narrow-dark"]}"><source media="(max-width: 600px)" srcset="${DEMO_FILES["narrow-light"]}"><source media="(prefers-color-scheme: dark)" srcset="${DEMO_FILES["wide-dark"]}"><img src="${DEMO_FILES["wide-light"]}" alt="${demoAlt(f)}" width="100%"></picture></a>`;
}

/** The README's three steps: the demo's thumbnail and the two step cards, each linked, then the same three as links. */
export function readmeStepLines(f = demoFigures()): [string, string] {
  return [
    `<a href="${DEMO_VIDEO}"><img src="docs/assets/readme/demo-thumb.jpg" alt="1 · Watch the demo: Purser on YouTube (3:15)" width="32%"></a>&nbsp;<a href="${SITE}/try"><img src="${STEP_FILES.try}" alt="${stepAlt("try", f)}" width="32%"></a>&nbsp;<a href="${SITE}/proof"><img src="${STEP_FILES.proof}" alt="${stepAlt("proof", f)}" width="32%"></a>`,
    `**1 · [Watch the demo (3:15)](${DEMO_VIDEO})** &nbsp;·&nbsp; **2 · [Try it live on /try](${SITE}/try)** (2 min, test money) &nbsp;·&nbsp; **3 · [See the proof on /proof](${SITE}/proof)**`,
  ];
}

/** A step card beside the demo's thumbnail (dark, 16:9, as the thumbnail): its number, its title, and one real line from the walk. */
export function stepSvg(which: "try" | "proof", f = demoFigures()): string {
  const c = PAL.dark, W = 640, H = 360;
  const card = { ...stepCard(which, f), ...(which === "try" ? { chipFill: c.accent, chipInk: "#ffffff" } : { chipFill: c.goodBg, chipInk: c.good }) };
  const cw = tw(card.chip, 22, true) + 48;
  if (cw > W - 64) throw new Error(`step card ${which}: the chip does not fit`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${card.n} · ${esc(card.title)}: ${esc(card.sub)}. ${esc(card.chip)} (${esc(card.note)}; test money)</title>
<style>text{font-family:${SANS}}</style>
<rect width="${W}" height="${H}" rx="18" fill="#0b0f1a"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#2a2f45"/>
${markSvg(36, 34, 44, "#f0f3f6", "#0b1220")}<text x="94" y="66" font-size="26" font-weight="700" fill="#f0f3f6">Purser</text>
<circle cx="58" cy="152" r="24" fill="${c.accent}"/><text x="58" y="161" font-size="26" font-weight="800" fill="#0b0f1a" text-anchor="middle">${card.n}</text>
<text x="96" y="166" font-size="46" font-weight="800" letter-spacing="-0.8" fill="#ffffff">${fit(card.title, 46, W - 130, true)}</text>
<text x="36" y="216" font-size="23" fill="#c4c8d4">${fit(card.sub, 23, W - 72)}</text>
<rect x="36" y="248" width="${r1(cw)}" height="50" rx="25" fill="${card.chipFill}"/><text x="${r1(36 + cw / 2)}" y="280" font-size="22" font-weight="650" fill="${card.chipInk}" text-anchor="middle">${esc(card.chip)}</text>
<text x="36" y="332" font-size="17" fill="#8b90a3">${esc(card.note)} · test money</text>
</svg>
`;
}

/** Every file this script writes, with its content. */
export function demoSvgs(f = demoFigures()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, file] of Object.entries(DEMO_FILES)) {
    const [layout, theme] = key.split("-") as [Layout, Theme];
    out[file] = demoSvg(theme, layout, f);
  }
  out[STEP_FILES.try] = stepSvg("try", f);
  out[STEP_FILES.proof] = stepSvg("proof", f);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = demoSvgs();
  for (const [file, svg] of Object.entries(files)) writeFileSync(file, svg);
  console.log(`wrote ${Object.keys(files).join(", ")}`);
}
