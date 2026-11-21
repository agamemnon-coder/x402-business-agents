/**
 * Purser's visual skin. Styling only: no business logic, approval semantics, network
 * calls or financial figures. Dark-mode first while retaining the light theme.
 */
export const PREMIUM_CSS = String.raw`
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#080a12; --surface:#111522; --sunken:#191d30; --border:#2b2e44;
    --text:#f5f4ff; --muted:#b6bed0; --faint:#8e98af;
    --accent:#a398ff; --accent-soft:#28234b;
    --shadow:0 10px 38px -18px rgba(0,0,0,.75),0 0 0 1px rgba(163,152,255,.035);
    color-scheme:dark;
  }
}
:root[data-theme="dark"] {
  --bg:#080a12; --surface:#111522; --sunken:#191d30; --border:#2b2e44;
  --text:#f5f4ff; --muted:#b6bed0; --faint:#8e98af;
  --accent:#a398ff; --accent-soft:#28234b;
  --shadow:0 10px 38px -18px rgba(0,0,0,.75),0 0 0 1px rgba(163,152,255,.035);
  color-scheme:dark;
}
header.top { border-bottom-color:color-mix(in srgb,var(--accent) 12%,var(--border)); }
nav.tabs { border:1px solid color-mix(in srgb,var(--accent) 14%,var(--border)); }
nav.tabs > a, nav.tabs summary { transition:background .2s ease,color .2s ease; }
nav.tabs > a:hover, nav.tabs summary:hover { color:var(--text); }
.btn { transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease,background .2s ease; }
.btn:hover { transform:translateY(-2px); border-color:color-mix(in srgb,var(--accent) 50%,var(--border)); }
.btn.primary { background:linear-gradient(112deg,#c6baff 0%,#a297ff 60%,#8f85fc 100%); border:1px solid #b4a8ff; color:#100d25; box-shadow:0 8px 30px rgba(119,91,233,.19); }
.btn.primary:hover { box-shadow:0 11px 40px rgba(119,91,233,.29); background:linear-gradient(112deg,#d4caff 0%,#b1a7ff 65%,#9a91ff 100%); }
.card { transition:border-color .2s ease,box-shadow .2s ease; }
.card:hover { border-color:color-mix(in srgb,var(--accent) 24%,var(--border)); }
:where(.card,.pc,details.fold,a,button,input,textarea,select):focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { .btn,.card,nav.tabs > a,nav.tabs summary { transition:none!important; } .btn:hover {transform:none;} }
`;

const wavePath = (row: number): string => {
  const points: string[] = [];
  for (let x=0; x<=1320; x+=24) {
    const y=322+(row-20)*10+31*Math.sin(x/165+row*.105)+18*Math.sin(x/320+row*.045);
    points.push(`\${x},\${y.toFixed(2)}`);
  }
  return `<polyline points="\${points.join(" ")}" />`;
};
const WAVE_PATHS = Array.from({length:41},(_,i)=>wavePath(i)).join("");

/** True moving dots, not a video or screenshot. Decorative and ignored by assistive technology. */
export const waveMarkup = () => `<div class="pv-wave" aria-hidden="true"><svg viewBox="0 0 1320 680" preserveAspectRatio="xMidYMid slice" focusable="false"><g>\${WAVE_PATHS}</g></svg></div>`;

export const WAVE_CSS = String.raw`
.pv-wave { position:absolute;z-index:0;inset:0;overflow:hidden;pointer-events:none; }
.pv-wave svg { position:absolute;inset:-8% -12%;width:124%;height:118%;opacity:.74;mask-image:radial-gradient(ellipse 88% 62% at 63% 59%,#000 18%,transparent 94%); }
.pv-wave polyline { fill:none;stroke:#a78bfa;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:.15 11;opacity:.44;animation:pv-drift 32s linear infinite; }
.pv-wave polyline:nth-child(3n) { stroke:#7a70ff;opacity:.58;animation-duration:42s; }
.pv-wave polyline:nth-child(5n) { stroke:#d0c3ff;opacity:.58;animation-direction:reverse;animation-duration:38s; }
.pv-wave polyline:nth-child(7n) { opacity:.23; }
@keyframes pv-drift { from {stroke-dashoffset:0} to {stroke-dashoffset:-330} }
@media(max-width:760px) { .pv-wave svg {inset:0 -48%;width:190%;opacity:.30;} }
@media(prefers-reduced-motion:reduce) { .pv-wave polyline {animation:none;} }
@media print { .pv-wave {display:none;} }
`;

export const HOME_PREMIUM_CSS = String.raw`
main.ent .e-hero { position:relative;isolation:isolate;overflow:hidden;min-height:620px;background:
  radial-gradient(ellipse 63% 75% at 83% 41%,rgba(95,75,183,.23),transparent 72%),
  radial-gradient(ellipse 48% 45% at 9% 93%,rgba(67,49,150,.12),transparent 77%); }
main.ent .e-hero > .wrap {position:relative;z-index:1;}
main.ent .e-hero .copy {position:relative;z-index:2;}
main.ent .e-hero .h-hero { font-size:clamp(44px,4.9vw,70px);letter-spacing:-.055em;line-height:1.02; }
main.ent .e-hero .h-hero span:last-child {background:linear-gradient(100deg,#f0edff 0%,#b7a9ff 42%,#7eacf3 95%);background-clip:text;-webkit-background-clip:text;color:transparent;}
main.ent .e-hero .what {color:var(--muted);max-width:34rem;}
main.ent .e-hero .eyebrow {display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid rgba(154,134,241,.28);border-radius:999px;background:rgba(67,56,120,.23);color:#b5a7ff;font-size:12px;}
main.ent .e-hero .show > * {border-color:rgba(155,140,245,.28);box-shadow:0 24px 90px -28px rgba(30,24,87,.75),inset 0 1px 0 rgba(180,166,255,.09);}
main.ent .e-hero .trust {border-top-color:rgba(151,137,230,.22);}
main.ent .e-hero .ctas {gap:12px;}
main.ent .e-hero .btn.big {min-height:54px;}
main.ent section.e-start,main.ent section.e-path {background:linear-gradient(180deg,rgba(38,31,77,.10),transparent 65%);}
main.ent .e-start .card, main.ent .e-path .card {border-color:color-mix(in srgb,var(--accent) 18%,var(--border));}
@media (min-width:1040px) { main.ent .e-hero .wrap {grid-template-columns:minmax(0,1fr) minmax(0,490px);} }
@media(max-width:760px) { main.ent .e-hero {min-height:auto;}main.ent .e-hero .h-hero {font-size:clamp(38px,10vw,54px);}main.ent .e-hero .show > * {box-shadow:none;} }
`;

export const CONSOLE_PREMIUM_CSS = String.raw`
/* App-only override, placed after all existing console view styles. No change to data or permissions. */
@media (prefers-color-scheme:dark) {
 :root:not([data-theme="light"]) { --bg:#080a12; --surface:#111522; --sunken:#191d30; --border:#2b2e44; --text:#f5f4ff; --muted:#b6bed0; --faint:#8e98af; --accent:#a398ff; --accent-soft:#28234b; }
}
:root[data-theme="dark"] { --bg:#080a12; --surface:#111522; --sunken:#191d30; --border:#2b2e44; --text:#f5f4ff; --muted:#b6bed0; --faint:#8e98af; --accent:#a398ff; --accent-soft:#28234b; }
.signed-in main { position:relative; isolation:isolate; min-height:80vh; background:
  radial-gradient(ellipse 70% 37% at 82% 3%,rgba(106,79,205,.18),transparent 72%),
  linear-gradient(180deg,color-mix(in srgb,var(--bg) 90%,#291951),var(--bg) 430px); }
.signed-in main::before {content:"";position:absolute;z-index:0;pointer-events:none;inset:0 0 auto;height:420px;opacity:.32;
  background-image:radial-gradient(circle,rgba(171,151,255,.65) .8px,transparent 1.2px);
  background-size:18px 18px;
  mask-image:radial-gradient(ellipse 70% 75% at 75% 0%,#000 4%,transparent 90%);
  animation:console-particles 45s linear infinite;}
.signed-in main > .wrap {position:relative;z-index:1;}
@keyframes console-particles {from{background-position:0 0}to{background-position:180px 36px}}
.signed-in .appbar {background:var(--surface);border-right-color:color-mix(in srgb,var(--accent) 14%,var(--border));}
.signed-in .appbar nav.apptabs a[aria-current="page"] {background:linear-gradient(110deg,rgba(129,101,255,.30),rgba(91,77,180,.12));color:#bbb0ff;box-shadow:inset 2px 0 0 #9c87ff;}
.signed-in .appbar nav.apptabs a:hover {background:color-mix(in srgb,var(--accent) 10%,var(--sunken));}
.signed-in .card, .signed-in .kpi, .signed-in .auth {border-color:color-mix(in srgb,var(--accent) 13%,var(--border));box-shadow:0 14px 38px -28px rgba(0,0,0,.75);}
.signed-in .card.next.hero, .signed-in .card.nyou {background:linear-gradient(130deg,rgba(101,78,199,.19),var(--surface) 58%);border-color:rgba(160,145,255,.31);}
.signed-in .btn.primary,.auth .btn.primary {background:linear-gradient(115deg,#c5baff,#9589ff);border-color:#ad9fff;color:#100d25;box-shadow:0 7px 26px rgba(116,92,211,.19);}
.signed-in .btn.primary:hover,.auth .btn.primary:hover {background:linear-gradient(115deg,#d2c8ff,#a69aff);}
.signed-in #view h1 {font-size:clamp(28px,3vw,38px);letter-spacing:-.038em;}
.signed-in .ng {color:#a4a0c8;}
.signed-in .pflow-c {border-color:rgba(155,139,246,.22);}
.signed-out .auth {border-color:rgba(155,139,246,.28);box-shadow:0 35px 95px -45px rgba(113,82,231,.5);}
.signed-out main {background:radial-gradient(ellipse 50% 65% at 20% 44%,rgba(98,76,202,.14),transparent 80%),var(--bg);}
@media(prefers-reduced-motion:reduce) {.signed-in main::before{animation:none;}}
@media(max-width:760px) {.signed-in main::before{opacity:.12;} .signed-in .appbar nav.apptabs a[aria-current="page"]{box-shadow:none;}}
@media print {.signed-in main::before{display:none;}}
`;
