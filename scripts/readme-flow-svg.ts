// The README's animated flow (Max, 15 Nov: "an animated hero at the top of the README"). One SVG per theme, CSS
// animation only (no script, so GitHub shows it in an <img>), a 6-second loop:
//   an agent asks to pay an invoice of EUR 240.00 → three locks light up in turn (Airwallex's card controls, Alta's
//   mandate, the CFO's passkey) → the passkey signs the SHA-256 of the exact terms → the amount becomes 240.01 and the
//   signature no longer matches: refused → it starts again.
// An illustration of the flow, said so on the drawing; the amount is the Airwallex two-locks run's (airwallexHold).
// Written by `npx tsx scripts/readme-flow-svg.ts`; test/readme-flow.test.ts redraws both and compares.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { airwallexHold } from "../src/visuals/facts.js";

export const FLOW_DIR = "docs/assets/hero";
export const FLOW_FILES = { light: `${FLOW_DIR}/flow-light.svg`, dark: `${FLOW_DIR}/flow-dark.svg` } as const;

interface Palette { bg: string; surface: string; border: string; text: string; muted: string; faint: string; accent: string; accentSoft: string; ok: string; okSoft: string; bad: string; badSoft: string; awx: string; awxSoft: string; metal: string; metalSoft: string }
// src/redesign/ui.ts's tokens, light and dark.
const LIGHT: Palette = { bg: "#f7f8fa", surface: "#ffffff", border: "#e3e6ec", text: "#0b1220", muted: "#586174", faint: "#646d7e", accent: "#4f46e5", accentSoft: "#eef0ff", ok: "#0b7d43", okSoft: "#e6f6ee", bad: "#c5363c", badSoft: "#fdecec", awx: "#ad4a0c", awxSoft: "#fdf0e7", metal: "#0b7a70", metalSoft: "#e3f5f2" };
const DARK: Palette = { bg: "#0a0c11", surface: "#12151d", border: "#262b37", text: "#eef1f6", muted: "#a4adbd", faint: "#858fa1", accent: "#8b85ff", accentSoft: "#23224a", ok: "#3ccf82", okSoft: "#12291e", bad: "#ff6b70", badSoft: "#341a1c", awx: "#ff8a4c", awxSoft: "#33200f", metal: "#2dd4bf", metalSoft: "#0f2a28" };

/** The amount the drawing pays, from the Airwallex two-locks run's record, and the one a cent above it. */
export function flowAmounts(): { paid: string; changed: string } {
  const hold = airwallexHold();
  const m = hold ? /\(EUR ([\d,]+)\.(\d\d)\)/.exec(hold.short) : null;
  if (!m) throw new Error("the two-locks run's record names no EUR amount");
  const cents = Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2]);
  const fmt = (c: number) => `EUR ${Math.floor(c / 100).toLocaleString("en-GB")}.${String(c % 100).padStart(2, "0")}`;
  return { paid: fmt(cents), changed: fmt(cents + 1) };
}

const LOCKS = [
  { label: "Airwallex card controls", sub: "the card's own limit", key: "awx" },
  { label: "Alta mandate", sub: "the agent's on-chain budget", key: "metal" },
  { label: "CFO passkey", sub: "Face ID on the exact terms", key: "accent" },
] as const;

export function flowSvg(theme: "light" | "dark", a = flowAmounts()): string {
  const p = theme === "light" ? LIGHT : DARK;
  const tone = (k: string) => (k === "awx" ? [p.awx, p.awxSoft] : k === "metal" ? [p.metal, p.metalSoft] : [p.accent, p.accentSoft]);
  const lock = (i: number) => {
    const l = LOCKS[i]!, [c, soft] = tone(l.key), y = 64 + i * 78;
    return `<g transform="translate(440 ${y})">
  <rect width="330" height="62" rx="14" fill="${p.surface}" stroke="${p.border}"/>
  <rect class="lit l${i}" width="330" height="62" rx="14" fill="${soft}" stroke="${c}" stroke-width="2"/>
  <g transform="translate(18 15)"><rect width="32" height="32" rx="9" fill="${p.bg}" stroke="${p.border}"/><g class="lit l${i}"><rect width="32" height="32" rx="9" fill="${c}"/><path d="M10 16.5l4 4 8-9" fill="none" stroke="${p.surface}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g></g>
  <text x="64" y="28" class="t" font-size="16" font-weight="650">${l.label}</text>
  <text x="64" y="47" class="m" font-size="13">${l.sub}</text>
</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 340" width="1200" height="340" role="img" aria-labelledby="t d">
<title id="t">Purser's flow, in six seconds</title>
<desc id="d">An agent asks to pay an invoice of ${a.paid}. Three locks hold in turn: Airwallex's card controls, Alta's mandate and the CFO's passkey, which signs the SHA-256 of the exact terms. The amount changes to ${a.changed}: the signature no longer matches, and the payment is refused. An illustration; test money.</desc>
<style>
text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.t{fill:${p.text}}.m{fill:${p.muted}}.f{fill:${p.faint}}
.lit,.sig,.bad,.amt2,.arr{opacity:0;animation:6s linear infinite}
.amt1{animation:amt1 6s linear infinite}
.l0{animation-name:l0}.l1{animation-name:l1}.l2{animation-name:l2}.sig{animation-name:sig}.bad{animation-name:bad}.amt2{animation-name:amt2}.arr{animation-name:arr}
@keyframes l0{0%,14%{opacity:0}18%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes l1{0%,24%{opacity:0}28%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes l2{0%,34%{opacity:0}38%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes arr{0%,8%{opacity:0}12%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sig{0%,42%{opacity:0}46%,60%{opacity:1}63%,100%{opacity:0}}
@keyframes amt1{0%,60%{opacity:1}63%,94%{opacity:0}97%,100%{opacity:1}}
@keyframes amt2{0%,60%{opacity:0}63%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes bad{0%,63%{opacity:0}67%,92%{opacity:1}97%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.lit,.sig,.arr,.amt1{animation:none;opacity:1}.amt2,.bad{animation:none;opacity:0}}
</style>
<rect width="1200" height="340" rx="20" fill="${p.bg}"/>
<g transform="translate(40 64)">
  <rect width="330" height="218" rx="16" fill="${p.surface}" stroke="${p.border}"/>
  <text x="24" y="38" class="m" font-size="13" font-weight="600" letter-spacing=".06em">AGENT · SOURCING</text>
  <text x="24" y="70" class="t" font-size="18" font-weight="650">Pay the supplier's invoice</text>
  <text x="24" y="132" class="t amt1" font-size="40" font-weight="760" letter-spacing="-.02em">${a.paid}</text>
  <text x="24" y="132" class="amt2" fill="${p.bad}" font-size="40" font-weight="760" letter-spacing="-.02em">${a.changed}</text>
  <text x="24" y="168" class="m" font-size="14">payee, account, amount, due date</text>
  <text x="24" y="192" class="f" font-size="13">the exact terms, hashed with SHA-256</text>
</g>
<g class="arr" fill="none" stroke="${p.faint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M384 173h40M416 165l8 8-8 8"/><path d="M784 173h40M816 165l8 8-8 8"/></g>
${[0, 1, 2].map(lock).join("\n")}
<g transform="translate(840 64)">
  <rect width="320" height="218" rx="16" fill="${p.surface}" stroke="${p.border}"/>
  <text x="24" y="38" class="m" font-size="13" font-weight="600" letter-spacing=".06em">THE CFO'S SIGNATURE</text>
  <g class="sig"><rect x="20" y="62" width="280" height="132" rx="14" fill="${p.okSoft}" stroke="${p.ok}" stroke-width="2"/>
    <text x="40" y="104" fill="${p.ok}" font-size="20" font-weight="720">✓ Signed</text>
    <text x="40" y="134" class="t" font-size="15">SHA-256 of the exact terms,</text>
    <text x="40" y="156" class="t" font-size="15">with the CFO's passkey</text>
    <text x="40" y="180" class="m" font-size="13">Face ID on iPhone</text></g>
  <g class="bad"><rect x="20" y="62" width="280" height="132" rx="14" fill="${p.badSoft}" stroke="${p.bad}" stroke-width="2"/>
    <text x="40" y="104" fill="${p.bad}" font-size="20" font-weight="720">✕ Refused</text>
    <text x="40" y="134" class="t" font-size="15">One cent changed: the</text>
    <text x="40" y="156" class="t" font-size="15">signature no longer matches</text>
    <text x="40" y="180" class="m" font-size="13">nothing is paid</text></g>
</g>
<text x="40" y="34" class="t" font-size="15" font-weight="700">Purser</text>
<text x="98" y="34" class="m" font-size="14">· how a payment is held, signed, and refused when one cent changes</text>
<text x="1160" y="320" class="f" font-size="12" text-anchor="end">An illustration of the flow · test money</text>
</svg>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync(FLOW_DIR, { recursive: true });
  for (const t of ["light", "dark"] as const) writeFileSync(FLOW_FILES[t], flowSvg(t));
  console.log(`wrote ${FLOW_FILES.light} and ${FLOW_FILES.dark}`);
}
