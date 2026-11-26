// Purser Cloud's console in colour (26 Nov, Max: "add a bit more colours to the purser cloud and more details"): one
// colour per meaning, the same on every page, after every other style so it has the last word. Violet is Purser and
// the CFO's approval (--accent), green paid and healthy (--ok), amber what waits and test money (--warn), rose what was
// refused or stopped (--bad), sky the cash and money moving (--sky), indigo the agents (--ind). Each agent keeps its own
// colour (--g0 to --g5, by passHue in cloud/src/agentWallet.ts: Sourcing, Support, Treasury, then by name), the colour
// of its avatar, on its meters and bars everywhere. A supplier's monogram takes one of eight hues from its name (--m0 to
// --m7, hue() in cloud/src/console.ts). Ledger accounts by kind (k1 assets, k2 liabilities, k3 equity, k4 revenue, k5
// to k9 costs). Coloured text on its own tint is the hue mixed 82% with the text colour: at least 5.2:1 in both themes
// (light: 700 to 800 shades; dark: 300 to 400). Motion only without prefers-reduced-motion; nothing here moves.

const DARK = "--sky:#38bdf8;--ind:#818cf8;--g0:#818cf8;--g1:#2dd4bf;--g2:#60a5fa;--g3:#fbbf24;--g4:#f472b6;--g5:#94a3b8;"
  + "--m0:#b4aaff;--m1:#7dd3fc;--m2:#6ee7b7;--m3:#fcd34d;--m4:#fda4af;--m5:#a5b4fc;--m6:#5eead4;--m7:#f0abfc";

const hues = (p: string, v: string, n: number) => Array.from({ length: n }, (_, i) => `.${p}${i}{--${v}:var(--${p === "m" ? "m" : "g"}${i})}`).join("");

export const COLOR_CSS = `
:root{--sky:#0369a1;--ind:#4338ca;--g0:#4f46e5;--g1:#0f766e;--g2:#1d4ed8;--g3:#b45309;--g4:#be185d;--g5:#475569;--m0:#6d28d9;--m1:#0369a1;--m2:#047857;--m3:#92400e;--m4:#be123c;--m5:#4338ca;--m6:#0f766e;--m7:#a21caf}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
${hues("m", "h", 8)}${hues("g", "ag", 6)}.gi{--ag:var(--accent)}
.k1{--h:var(--sky)}.k2{--h:var(--warn)}.k3{--h:var(--accent)}.k4{--h:var(--ok)}.k5,.k6,.k7,.k8,.k9{--h:var(--bad)}
.av2,.signed-in .av2{background:color-mix(in srgb,var(--h,var(--accent)) 14%,var(--surface));color:color-mix(in srgb,var(--h,var(--accent)) 82%,var(--text));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--h,var(--accent)) 26%,transparent)}
.st .ic svg{width:13px;height:13px}.st:has(>.ic)::before{display:none}
.st.waiting_cfo{background:var(--accent-soft);color:var(--accent)}
a.row.s-waiting_cfo{box-shadow:inset 3px 0 var(--accent)}a.row.s-needs_review,a.row.s-needs_vendor{box-shadow:inset 3px 0 var(--warn)}a.row.s-blocked,a.row.s-rejected{box-shadow:inset 3px 0 var(--bad)}
.isum{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.isc{--c:var(--accent);flex:1 1 170px;display:grid;gap:6px;text-align:left;padding:12px 14px;border:1px solid var(--border);border-radius:14px;font:inherit;color:var(--text);cursor:pointer;background:linear-gradient(160deg,color-mix(in srgb,var(--c) 11%,var(--surface)),var(--surface) 70%);box-shadow:inset 0 2px 0 color-mix(in srgb,var(--c) 70%,transparent)}
.isc.a{--c:var(--warn)}.isc.p{--c:var(--ok)}.isc.r{--c:var(--bad)}
.isc:hover,.isc[aria-pressed=true]{border-color:color-mix(in srgb,var(--c) 55%,var(--border))}
.isl{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--muted)}.isl i{width:8px;height:8px;border-radius:3px;background:var(--c)}
.isn{margin-left:auto;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--c) 16%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--text));font-size:11.5px}
.isc b{font-size:19px;font-weight:680;letter-spacing:-.02em;white-space:nowrap}
@media (max-width:640px){.isc{flex-basis:96px;padding:10px 11px;gap:4px}.isc b{font-size:15px}.isl{font-size:11.5px}.isn{display:none}}
.isb{flex:1 1 100%;display:flex;gap:2px;height:6px;border-radius:99px;overflow:hidden;background:var(--sunken)}.isb .v{background:var(--accent)}.isb .a{background:var(--warn)}.isb .p{background:var(--ok)}.isb .r{background:var(--bad)}
.tile .l .ic{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;flex:none;margin:-3px 2px -3px 0;background:color-mix(in srgb,var(--kc,var(--faint)) 15%,transparent);color:var(--kc,var(--muted))}
.tile.k-in,.tile.calm{--kc:var(--ok)}.tile.k-out{--kc:var(--accent)}.tile.k-fee{--kc:var(--warn)}.tile.alert{--kc:var(--bad)}
.tile[class*=k-],.tile.calm,.tile.alert{background-image:radial-gradient(120% 90% at 0 0,color-mix(in srgb,var(--kc) 9%,transparent),transparent 62%)}
.trow .rail.r-awx::before,.trow .rail.r-metal::before{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:7px;background:var(--awx)}.trow .rail.r-metal::before{background:var(--metal)}
.trow.f-in{background:linear-gradient(90deg,color-mix(in srgb,var(--ok) 5%,transparent),transparent 40%)}
a.ovk{--kc:var(--accent);background-image:radial-gradient(130% 100% at 0 0,color-mix(in srgb,var(--kc) 12%,transparent),transparent 58%)}
a.ovk.k-sky{--kc:var(--sky)}a.ovk.k-ok{--kc:var(--ok)}a.ovk.k-ind{--kc:var(--ind)}
.ovk-i,a.ovk.hot .ovk-i{background:color-mix(in srgb,var(--kc) 16%,transparent);color:var(--kc)}
.ovk-st{display:flex;gap:2px}.ovk-st>span,.as-row .as-bar>span,.sbars li[class^=g] .sf{background:var(--ag,var(--accent))}
.opsrow .sl>span{display:flex;align-items:center;gap:9px}.opsup .sbars .opsrow .sf{background:linear-gradient(90deg,color-mix(in srgb,var(--h) 55%,transparent),var(--h))}.opsrow .av2{width:22px;height:22px;border-radius:6px;font-size:9.5px}
.ov-feed li{border-top:0;position:relative}.ov-feed li:not(:last-child)>a::after{content:"";position:absolute;left:13px;top:38px;bottom:-9px;width:2px;border-radius:2px;background:var(--line)}
.ov-ai{background:var(--accent-soft);color:var(--accent)}a.ovk.k-sky svg.ovspark polyline{stroke:var(--sky)}
.f-ok .ov-fi{background:var(--ok-soft)}.f-bad .ov-fi{background:var(--bad-soft)}.f-wait .ov-fi{background:var(--accent-soft)}
.dk-meta[class*=" g"] .ac-bar>span{background:linear-gradient(90deg,color-mix(in srgb,var(--ag) 45%,transparent),var(--ag))}
.acn{display:inline-block;padding:0 6px;border-radius:6px;font:600 12px/1.6 var(--mono);background:color-mix(in srgb,var(--h) 13%,transparent);color:color-mix(in srgb,var(--h) 82%,var(--text))}
.bsr.k1 span::before,.bsr.k2 span::before,.bsr.k3 span::before,.bsr.k4 span::before{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:8px;background:var(--h)}
.bsb{display:grid;gap:5px;margin-top:12px}.bsb span{display:flex;gap:2px;height:8px;border-radius:99px;overflow:hidden;background:var(--sunken)}.bsb i{background:var(--h)}
.cx-stat.ok,.cx-stat.tmoney,.cx-stat.warn{box-shadow:inset 0 2px 0 var(--sc)}.cx-stat.ok{--sc:var(--ok)}.cx-stat.tmoney{--sc:var(--accent)}.cx-stat.warn{--sc:var(--warn)}
`;
