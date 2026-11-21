/**
 * Purser's visual skin: the design system's one source (PR #469, built on in the design lane, 21 Nov: the owner's
 * concept "dark violet premium enterprise fintech"). Styling only: no business logic, approval semantics, network calls
 * or financial figures. Dark first; the light theme is the same system on white. Every text colour meets WCAG AA on the
 * surfaces it sits on.
 *
 * - PREMIUM_TOKENS: colours (obsidian, charcoal, violet), radii, spacing, type, motion; light and dark. src/redesign/ui.ts
 *   TOKENS carries them to every page, /try and Purser Cloud's console (src/ui/payablesKit.ts).
 * - PREMIUM_BASE_CSS: the components at the base of every page's style (ground, type, eyebrow, buttons, fields, cards,
 *   very wide screens), where the site's own base rules stood, so a page's own rules still refine them.
 * - PREMIUM_CSS: the last word on every page (hover, focus, motion), as #469 placed it.
 * - HOME_PREMIUM_CSS and CONSOLE_PREMIUM_CSS: Home's sections and the console, after their own styles.
 * The header's own style stays in src/redesign/ui.ts HEADER_CSS, the one Purser Cloud's pages share byte for byte.
 */

const DARK = String.raw`
  --bg:#080a12; --surface:#111522; --sunken:#191d30; --border:#2b2e44;
  --text:#f5f4ff; --muted:#b6bed0; --faint:#8e98af;
  --accent:#a398ff; --accent-soft:#28234b; --accent-ink:#7c6cf0;
  --ok:#3ccf82; --ok-soft:#12291e; --bad:#ff6b70; --bad-soft:#341a1c; --on-bad:#1a0607;
  --metal:#2dd4bf; --metal-soft:#0f2a28; --awx:#ff8a4c; --awx-soft:#33200f; --claude:#ef9a76; --claude-soft:#33221b;
  --a-sourcing:#60a5fa; --a-support:#d8b4fe; --a-treasury:#22d3ee;
  --shadow:0 10px 38px -18px rgba(0,0,0,.75),0 0 0 1px rgba(163,152,255,.035);
  --hi:inset 0 1px 0 rgba(255,255,255,.06); --glow:rgba(129,107,250,.42);
  --glass:rgba(17,21,34,.66); --glass-line:rgba(180,168,255,.14);
  --grad-text:linear-gradient(100deg,#f0edff 0%,#c3b8ff 40%,#a398ff 70%,#d8b4fe 100%);
  --btn-bg:linear-gradient(112deg,#c6baff 0%,#a297ff 60%,#8f85fc 100%); --btn-ink:#100d25; --btn-line:#b4a8ff;
  color-scheme:dark;`;

export const PREMIUM_TOKENS = String.raw`:root {
  --bg:#f7f6fb; --surface:#ffffff; --sunken:#f2f0f8; --border:#e4e1ef;
  --text:#0e0b1a; --muted:#57536b; --faint:#646078;
  --accent:#6d28d9; --accent-soft:#f1ebff; --accent-ink:#6d28d9;
  --ok:#0b7d43; --ok-soft:#e6f6ee; --bad:#c5363c; --bad-soft:#fdecec; --on-bad:#ffffff;
  --metal:#0b7a70; --metal-soft:#e3f5f2; --awx:#ad4a0c; --awx-soft:#fdf0e7; --claude:#a84d2b; --claude-soft:#fbefe9;
  --a-sourcing:#2563eb; --a-support:#9333ea; --a-treasury:#0e7490;
  --shadow:0 1px 2px rgba(20,16,40,.05),0 14px 36px -16px rgba(40,24,90,.16);
  --hi:inset 0 1px 0 rgba(255,255,255,.9); --glow:rgba(109,40,217,.28);
  --glass:rgba(255,255,255,.74); --glass-line:rgba(14,11,26,.09);
  --grad:linear-gradient(135deg,#7c3aed 0%,#6d28d9 55%,#5b21b6 100%);
  --grad-text:linear-gradient(100deg,#7c3aed,#a855f7 55%,#6d28d9);
  --btn-bg:var(--grad); --btn-ink:#ffffff; --btn-line:transparent;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  --r-sm:12px; --r:20px; --r-lg:28px; --gut:16px;
  --s1:8px; --s2:16px; --s3:24px; --s4:40px; --s5:64px; --s6:104px;
  --ease:cubic-bezier(.2,.7,.2,1); --dur:.2s;
  color-scheme:light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK}
} }
:root[data-theme="dark"] {${DARK}
}
`;

/** The components, at the base of the site's style (src/redesign/ui.ts CSS). */
export const PREMIUM_BASE_CSS = String.raw`
body { margin: 0; background: radial-gradient(1200px 520px at 70% -220px, color-mix(in srgb, var(--accent) 12%, transparent), transparent 72%) no-repeat, var(--bg); color: var(--text); font: 400 17px/1.55 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; overflow-x: hidden; }
h1, h2, h3 { margin: 0; letter-spacing: -.025em; line-height: 1.08; text-wrap: balance; }
.h-hero { font-size: clamp(38px, 5.4vw, 64px); font-weight: 780; letter-spacing: -.04em; }
.h-sec { font-size: clamp(28px, 3.4vw, 40px); font-weight: 750; letter-spacing: -.03em; }
.lead { font-size: clamp(18px, 1.6vw, 21px); color: var(--muted); line-height: 1.5; margin: 0; }
.eyebrow { font: 600 14px/1.4 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--faint); margin: 0 0 10px; }
/* Buttons: the violet primary, glass secondaries; one height, one radius. */
.btn { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 999px; font: 650 16px/1 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--glass-line); background: var(--glass); color: var(--text); cursor: pointer; white-space: nowrap; box-shadow: var(--hi); }
.btn.primary { background: var(--btn-bg); color: var(--btn-ink); border-color: var(--btn-line); box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 10px 32px -12px var(--glow); }
.btn.primary:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 14px 40px -12px var(--glow); }
/* Fields: one style, at low specificity so a page's own rules still win. */
:where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea) { font: inherit; color: var(--text); background: var(--sunken); border: 1px solid var(--border); border-radius: var(--r-sm); }
:where(input, select, textarea):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 3%, var(--surface)), var(--surface)); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--hi), var(--shadow); }
/* Very wide screens (the owner: "razor-sharp in 4K"): the whole page scales up as vectors, never a narrow column in a sea
   of black. Borders stay whole device pixels (browsers snap them); text and drawings are drawn afresh at the new size. */
@media (min-width: 2200px) { body { zoom: 1.25; } }
@media (min-width: 2800px) { body { zoom: 1.5; } }
@media (min-width: 3600px) { body { zoom: 2; } }
`;

/** The last word on every page of the site (after the page's own style), as #469 placed it. */
export const PREMIUM_CSS = String.raw`
nav.tabs > a, nav.tabs summary { transition:background .2s ease,color .2s ease; }
nav.tabs > a:hover, nav.tabs summary:hover { color:var(--text); }
.btn { transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease,background .2s ease; }
.btn:hover { transform:translateY(-2px); border-color:color-mix(in srgb,var(--accent) 50%,var(--border)); }
.card { transition:border-color .2s ease,box-shadow .2s ease; }
.card:hover { border-color:color-mix(in srgb,var(--accent) 24%,var(--border)); }
:where(.card,.pc,details.fold,a,button,input,textarea,select):focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { .btn,.card,nav.tabs > a,nav.tabs summary { transition:none!important; } .btn:hover {transform:none;} }
`;

/** Home's sections after its own style (src/redesign/home.ts): the start part's light, its cards' violet edge. */
export const HOME_PREMIUM_CSS = String.raw`
main.ent .e-hero .show > * {border-color:color-mix(in srgb,var(--accent) 26%,var(--border));}
main.ent .e-hero .btn.big {min-height:54px;}
main.ent section.e-start {background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,transparent),transparent 65%);}
main.ent .e-start .card {border-color:color-mix(in srgb,var(--accent) 18%,var(--border));}
`;

/**
 * Purser Cloud's console, after all its own view styles (cloud/src/console.ts). No change to data or permissions, and
 * no markup: cards on one surface with a lit edge, the KPI figures large, chart lines, bars and rings that glow in their
 * colour, the sidebar's current page lit, a faint field of points at the top (moved by transform; still under reduced
 * motion).
 */
export const CONSOLE_PREMIUM_CSS = String.raw`
.signed-in main { position:relative; isolation:isolate; min-height:80vh; overflow-x:clip; background:
  radial-gradient(ellipse 70% 37% at 82% 3%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 72%),
  linear-gradient(180deg,color-mix(in srgb,var(--accent) 5%,var(--bg)),var(--bg) 430px); }
.signed-in main::before {content:"";position:absolute;z-index:0;pointer-events:none;left:-180px;right:0;top:-36px;height:456px;opacity:.3;
  background-image:radial-gradient(circle,color-mix(in srgb,var(--accent) 70%,transparent) .8px,transparent 1.2px);
  background-size:18px 18px;
  -webkit-mask-image:radial-gradient(ellipse 70% 75% at 75% 0%,#000 4%,transparent 90%);mask-image:radial-gradient(ellipse 70% 75% at 75% 0%,#000 4%,transparent 90%);}
@media (prefers-reduced-motion:no-preference) { .signed-in main::before { animation:console-particles 45s linear infinite; will-change:transform; } }
.signed-in main > .wrap {position:relative;z-index:1;}
@keyframes console-particles {from{transform:translate3d(0,0,0)}to{transform:translate3d(180px,36px,0)}}
/* One surface for every card. */
.card, .auth { border-radius:16px; border-color:color-mix(in srgb,var(--accent) 13%,var(--border)); background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 3%,var(--surface)),var(--surface)); box-shadow:var(--hi),0 1px 2px rgba(16,24,40,.05),0 22px 44px -34px rgba(0,0,0,.55); }
.signed-in .card.next.hero, .signed-in .card.nyou {background:linear-gradient(130deg,color-mix(in srgb,var(--accent) 18%,var(--surface)),var(--surface) 58%);border-color:color-mix(in srgb,var(--accent) 38%,var(--border));}
.next.hero .nic { box-shadow:0 8px 24px -8px var(--glow); }
.signed-in .btn.primary,.auth .btn.primary {background:var(--btn-bg);border-color:var(--btn-line);color:var(--btn-ink);box-shadow:0 7px 26px var(--glow);}
/* The KPI cards: the figure large, its icon lit. */
.kpi { padding:18px 20px; gap:8px; }
.kpi b { font-size:clamp(24px,2.3vw,32px); font-weight:720; letter-spacing:-.035em; line-height:1.1; }
.kpi .kl .ic { border-radius:9px; box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 8%,transparent); }
.kpi.pos .kl .ic { box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ok) 30%,transparent),0 6px 18px -8px color-mix(in srgb,var(--ok) 70%,transparent); }
.kpi.wait .kl .ic { box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warn) 30%,transparent),0 6px 18px -8px color-mix(in srgb,var(--warn) 70%,transparent); }
@media (max-width:520px) { .kpi { padding:14px; } .kpi b { font-size:22px; } }
.signed-in #view h1 {font-size:clamp(28px,3vw,38px);letter-spacing:-.038em;}
.dcard .dh h2 { font-size:16.5px; letter-spacing:-.015em; }
/* Charts: lines, bars and rings glow in their colour; the grid steps back. */
svg.chart .grid { stroke:color-mix(in srgb,var(--border) 70%,transparent); }
svg.chart .line { stroke-width:2.5; filter:drop-shadow(0 0 3px color-mix(in srgb,var(--accent) 90%,transparent)) drop-shadow(0 0 14px color-mix(in srgb,var(--accent) 55%,transparent)); }
svg.chart .end { filter:drop-shadow(0 0 6px color-mix(in srgb,var(--accent) 80%,transparent)); }
svg.chart .b.cfo, svg.chart .b.fout { filter:drop-shadow(0 0 10px color-mix(in srgb,var(--accent) 60%,transparent)); }
svg.chart .b.fin { filter:drop-shadow(0 0 8px color-mix(in srgb,var(--fin,var(--ok)) 40%,transparent)); }
svg.ring .seg { filter:drop-shadow(0 0 6px color-mix(in srgb,currentColor 55%,transparent)); }
svg.ring .seg.c0 { color:var(--c0); } svg.ring .seg.c1 { color:var(--c1); } svg.ring .seg.c2 { color:var(--c2); } svg.ring .seg.c3 { color:var(--c3); } svg.ring .seg.c4 { color:var(--c4); }
.sbars .strk { height:8px; }
.sbars .sf { box-shadow:0 0 12px -2px color-mix(in srgb,var(--accent) 70%,transparent); }
/* The sidebar: the current page lit with a bar of the accent. */
.signed-in .appbar {background:var(--surface);border-right-color:color-mix(in srgb,var(--accent) 14%,var(--border));}
.signed-in .appbar nav.apptabs a:hover {background:color-mix(in srgb,var(--accent) 10%,var(--sunken));}
@media (min-width:1024px) {
  .signed-in .appbar nav.apptabs a[aria-current="page"] { position:relative; color:var(--text); background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 24%,transparent),color-mix(in srgb,var(--accent) 6%,transparent)); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 24%,transparent); }
  .signed-in .appbar nav.apptabs a[aria-current="page"]::before { content:""; position:absolute; left:-12px; top:8px; bottom:8px; width:3px; border-radius:0 3px 3px 0; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  .signed-in .apptabs .ng { font-family:var(--mono); font-weight:600; letter-spacing:.14em; }
}
.signed-out .auth {border-color:color-mix(in srgb,var(--accent) 28%,var(--border));box-shadow:0 35px 95px -45px var(--glow);}
.signed-out main {background:radial-gradient(ellipse 50% 65% at 20% 44%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 80%),var(--bg);}
@media (prefers-color-scheme:light) { :root:not([data-theme="dark"]) svg.chart .line { filter:drop-shadow(0 2px 4px color-mix(in srgb,var(--accent) 35%,transparent)); } }
:root[data-theme="light"] svg.chart .line { filter:drop-shadow(0 2px 4px color-mix(in srgb,var(--accent) 35%,transparent)); }
@media(max-width:760px) {.signed-in main::before{opacity:.12;}}
@media print {.signed-in main::before{display:none;} .card, .auth, svg.chart .line, svg.chart .b, svg.ring .seg { box-shadow:none; filter:none; }}
`;
