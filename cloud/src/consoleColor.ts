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

// The icons a state carries in every pill (lucide's, as CSS masks in the text's own colour: no image of their own).
const mask = (paths: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`)}")`;
const ICONS = {
  ok: "<circle cx='12' cy='12' r='10'/><path d='m8.5 12 2.5 2.5 4.5-5'/>",
  bad: "<circle cx='12' cy='12' r='10'/><path d='m15 9-6 6M9 9l6 6'/>",
  warn: "<path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'/><path d='M12 9v4M12 17h.01'/>",
  wait: "<circle cx='12' cy='12' r='10'/><path d='M12 6v6l4 2'/>",
  face: "<path d='M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2'/><path d='M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'/>",
  flask: "<path d='M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55A1 1 0 0 0 5.62 22h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12a2 2 0 0 1-.21-.9V2M8.5 2h7M7 16h10'/>",
  none: "<circle cx='12' cy='12' r='10'/><path d='M8 12h8'/>",
  up: "<path d='M22 7 13.5 15.5 8.5 10.5 2 17'/><path d='M16 7h6v6'/>",
  down: "<path d='M22 17 13.5 8.5 8.5 13.5 2 7'/><path d='M16 17h6v-6'/>",
  plan: "<circle cx='12' cy='12' r='10' stroke-dasharray='3 3'/>",
};
const ICON_VARS = Object.entries(ICONS).map(([k, p]) => `--i-${k}:${mask(p)}`).join(";");

const hues = (p: string, v: string, n: number) => Array.from({ length: n }, (_, i) => `.${p}${i}{--${v}:var(--${p === "m" ? "m" : "g"}${i})}`).join("");

// 26 Nov, later (Max: "can we get more out of it? cause this is barely anything i like the colours"): the same
// meanings, pushed. Every tile and card carries its own hue as a wash and a top band, each figure's series in that hue
// under it, the charts in sky (cash) and rose (below zero), every state pill with its icon, tables with a coloured edge
// per state and a violet zebra, each agent's card in its own colour with its limit as a ring, the sidebar's page as a
// violet pill, and the connections by their honest label (live green, test money amber, built indigo, planned dashed).
// Text stays in the theme's text colours or a hue mixed with them: at least 4.5:1 on the colour behind it, measured in
// both themes on every page of the guest console and the sign-up (26 Nov). The sign-up's steps in violet, a done step in
// green, its test money in amber. Nothing here moves.
const MORE_CSS = `
:root{${ICON_VARS}}
.pill.ok::before,.pill.bad::before,.pill.warn::before,.pill.tmoney::before,.pill.plan::before,.stx .pill::before,.ov-st::before,.ovs-run::before{content:"";display:inline-block;width:12px;height:12px;margin:0 5px 0 -2px;vertical-align:-2px;background:currentColor;-webkit-mask:var(--pi,var(--i-none)) center/contain no-repeat;mask:var(--pi,var(--i-none)) center/contain no-repeat}
.pill.ok{--pi:var(--i-ok)}.pill.bad{--pi:var(--i-bad)}.pill.warn{--pi:var(--i-warn)}.pill.tmoney{--pi:var(--i-flask)}.pill.plan{--pi:var(--i-plan)}
.ov-st.hot{--pi:var(--i-face)}.ov-st.warn{--pi:var(--i-warn)}.ov-st.ok{--pi:var(--i-ok)}
.pill.tmoney,.ovs-run.sandbox,.ovs-run.testnet{background:var(--warn-soft);color:var(--warn)}
.pill.ok,.pill.bad,.pill.warn,.pill.tmoney{box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 22%,transparent)}
.st{box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 20%,transparent)}
/* Tables: a violet zebra and hover, the header in violet's own ground, a coloured edge per state. */
.signed-in .card.list>.row:not(.th):nth-child(odd),.signed-in .card.list>.trow:not(.th):nth-child(odd),.ov-tbl>a.ov-tr:nth-of-type(even),table.table.jt tbody tr:nth-child(even){background-color:color-mix(in srgb,var(--accent) 3.5%,transparent)}
.signed-in .card.list>a.row:hover,.signed-in .card.list>.trow:not(.th):hover,.ov-tbl>a.ov-tr:hover,table.table.jt tbody tr:hover{background-color:color-mix(in srgb,var(--accent) 8%,transparent)}
.signed-in .card.list>.row.th,.signed-in .card.list>.trow.th,.ov-th{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 10%,var(--surface)),color-mix(in srgb,var(--sky) 6%,var(--surface)));color:color-mix(in srgb,var(--accent) 45%,var(--muted))}
.card.list{overflow:clip}
a.row.s-paid{box-shadow:inset 3px 0 var(--ok)}a.row.s-ready{box-shadow:inset 3px 0 var(--sky)}
a.row.s-paid .why .ic{color:var(--ok)}a.row.s-waiting_cfo .why .ic{color:var(--accent)}a.row.s-needs_vendor .why .ic,a.row.s-needs_review .why .ic{color:var(--warn)}a.row.s-blocked .why .ic,a.row.s-rejected .why .ic{color:var(--bad)}
.trow.f-in{background:none;background-image:linear-gradient(90deg,color-mix(in srgb,var(--sky) 9%,transparent),transparent 45%);box-shadow:inset 3px 0 var(--sky)}
.trow.f-out{box-shadow:inset 3px 0 color-mix(in srgb,var(--ok) 75%,transparent)}.trow.f-out.f-not{box-shadow:inset 3px 0 var(--bad);background-image:linear-gradient(90deg,color-mix(in srgb,var(--bad) 7%,transparent),transparent 45%)}
.trow .amt.in{color:color-mix(in srgb,var(--sky) 85%,var(--text))}
.trow .rail.r-awx::before,.trow .rail.r-metal::before{display:none}
.trow .rail .rc{display:inline;-webkit-box-decoration-break:clone;box-decoration-break:clone;line-height:1.75;padding:2px 8px 2px 7px;border-radius:7px;font-size:12.5px;font-weight:600;background:color-mix(in srgb,var(--rc,var(--accent)) 12%,transparent);color:color-mix(in srgb,var(--rc,var(--accent)) 78%,var(--text));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,var(--accent)) 24%,transparent)}
.trow .rail .rc::before{content:"";display:inline-block;width:7px;height:7px;margin-right:6px;vertical-align:1px;border-radius:2px;background:var(--rc,var(--accent))}
.trow .rail.r-awx{--rc:var(--awx)}.trow .rail.r-metal{--rc:var(--metal)}.trow .rail .sub{display:block;margin-top:3px}
.stx .pill.ok{--pi:var(--i-ok)}
/* Tiles: a wash in the tile's hue, its icon chip filled, a band at the top. */
.tile[class*=k-],.tile.calm,.tile.alert{position:relative;overflow:hidden;background-image:linear-gradient(160deg,color-mix(in srgb,var(--kc) 16%,transparent),transparent 58%);border-color:color-mix(in srgb,var(--kc) 28%,var(--border));box-shadow:inset 0 2px 0 var(--kc)}
.tile .l .ic{background:var(--kc,var(--faint));color:var(--bg);box-shadow:0 6px 14px -8px var(--kc,transparent)}
.tile.k-in{--kc:var(--sky)}.tile.k-out{--kc:var(--accent)}.tile.calm .v{color:color-mix(in srgb,var(--ok) 85%,var(--text))}.tile.alert .v{color:color-mix(in srgb,var(--bad) 85%,var(--text))}
a.ovk{--kc:var(--accent);position:relative;overflow:hidden;isolation:isolate;background:linear-gradient(158deg,color-mix(in srgb,var(--kc) 18%,var(--surface)),color-mix(in srgb,var(--kc) 4%,var(--surface)) 62%);border-color:color-mix(in srgb,var(--kc) 32%,var(--border));box-shadow:inset 0 2px 0 var(--kc),0 18px 40px -28px color-mix(in srgb,var(--kc) 70%,transparent)}
.ov-k a.ovk{background:linear-gradient(158deg,color-mix(in srgb,var(--kc) 18%,var(--surface)),color-mix(in srgb,var(--kc) 4%,var(--surface)) 62%)}
a.ovk:hover{border-color:color-mix(in srgb,var(--kc) 55%,var(--border))}
.ovk-i,a.ovk.hot .ovk-i{background:linear-gradient(140deg,color-mix(in srgb,var(--kc) 80%,#fff),var(--kc));color:var(--bg);box-shadow:0 8px 18px -8px var(--kc)}
.ovk-top,.ovk-b{position:relative;z-index:1}
a.ovk svg.ovspark{display:block;position:absolute;z-index:0;left:0;right:0;bottom:0;width:100%;height:40px;pointer-events:none}
a.ovk svg.ovspark polyline{stroke:var(--kc);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}a.ovk svg.ovspark stop{stop-color:var(--kc)}
a.ovk.sp .ovk-b{padding-bottom:40px}
.ovk-s.pos,.ovk-s.neg{justify-self:start;display:inline-flex;align-items:center;gap:5px;margin-top:4px;padding:2px 8px 2px 6px;border-radius:999px;font-size:12px;font-weight:650;background:color-mix(in srgb,var(--c) 15%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--text));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 26%,transparent)}
.ovk-s.pos{--c:var(--ok)}.ovk-s.neg{--c:var(--bad)}
.ovk-s.pos::before,.ovk-s.neg::before{content:"";width:13px;height:13px;background:currentColor;-webkit-mask:var(--i-up) center/contain no-repeat;mask:var(--i-up) center/contain no-repeat}.ovk-s.neg::before{-webkit-mask-image:var(--i-down);mask-image:var(--i-down)}
.ovk-m{height:7px}
@media (max-width:640px){.ovk-s.pos,.ovk-s.neg{display:block;padding:0;margin-top:2px;background:none;box-shadow:none}.ovk-s.pos::before,.ovk-s.neg::before{display:inline-block;vertical-align:-2px;margin-right:4px}}
/* The Overview's cards: each its own soft corner light in the colour of what it holds. */
.dash.ov2 section.dcard,.dash.bcharts section.dcard{--dc:var(--accent);background-image:radial-gradient(120% 70% at 100% 0,color-mix(in srgb,var(--dc) 9%,transparent),transparent 60%)}
.dash section.dcard.ov-cash,.dash section.dcard.cash,.dash section.dcard.opw,.dash section.dcard.flows{--dc:var(--sky)}.dash section.dcard.ov-ag,.dash section.dcard.spend{--dc:var(--ind)}.dash section.dcard.ov-par{--dc:var(--ok)}.dash section.dcard.ops,.dash section.dcard.due{--dc:var(--warn)}.dash section.dcard.rails{--dc:var(--awx)}
.ov-appr{background:radial-gradient(130% 90% at 100% 0,color-mix(in srgb,var(--accent) 20%,transparent),transparent 62%),var(--surface);border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.ov-ai{background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 75%,#fff),var(--accent));color:var(--bg);box-shadow:0 10px 22px -10px var(--accent)}
.ov-aw{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 14%,var(--surface)),var(--surface));border-color:color-mix(in srgb,var(--accent) 45%,var(--border));box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 8%,transparent)}
.ov-n{background:var(--accent);color:var(--bg)}
.ov-sb.on{background:linear-gradient(135deg,color-mix(in srgb,var(--sky) 70%,var(--accent)),var(--accent));color:var(--bg);box-shadow:0 6px 14px -8px var(--accent)}
.ovc.ok{background:var(--ok-soft)}.ovc.warn{background:var(--warn-soft)}
svg.chart.chcash .line{stroke:url(#cashline);stroke-width:2.5}svg.chart.chcash .end,svg.chart.chcash .xd{stroke:var(--sky)}
.chtip .sw.cash{background:var(--sky)}
svg.chart .b.fin{fill:var(--sky)}.klegend i.fin,.chtip .sw.fin{background:var(--sky)}
.klegend li,.rlegend li,.legend li{font-weight:550}
.astrip a.as-row[class*=" g"]{background-image:linear-gradient(90deg,color-mix(in srgb,var(--ag) 10%,transparent),transparent 55%);box-shadow:inset 3px 0 var(--ag);padding-left:12px;border-radius:4px}
.as-row .as-bar{height:6px}
.ov-feed .f-info .ov-fi{background:color-mix(in srgb,var(--sky) 16%,transparent);color:var(--sky)}.f-ok .ov-fi{color:var(--ok)}.f-bad .ov-fi{color:var(--bad)}.f-wait .ov-fi{color:var(--accent)}
.ov-feed li:not(:last-child)>a::after{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 45%,transparent),color-mix(in srgb,var(--sky) 25%,transparent))}
.ovs-run{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-weight:650}.ovs-run.live{background:var(--ok-soft);color:var(--ok);--pi:var(--i-ok)}.ovs-run.sandbox,.ovs-run.testnet{--pi:var(--i-flask)}
.ovs-m:has(.ovs-run.sandbox) .ovs-dot,.ovs-m:has(.ovs-run.testnet) .ovs-dot{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 20%,transparent)}
.pf-in .pf-dot{background:linear-gradient(140deg,color-mix(in srgb,var(--sky) 75%,#fff),var(--sky));color:var(--bg)}.pf-rv .pf-dot{background:linear-gradient(140deg,color-mix(in srgb,var(--warn) 75%,#fff),var(--warn));color:var(--bg)}.pf-fid .pf-dot{background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 75%,#fff),var(--accent));color:var(--bg)}.pf-pd .pf-dot{background:linear-gradient(140deg,color-mix(in srgb,var(--ok) 75%,#fff),var(--ok));color:var(--bg)}
.pf-st.zero .pf-dot{background:var(--sunken);color:var(--faint)}
.pf-in .pf-n{color:color-mix(in srgb,var(--sky) 80%,var(--text))}.pf-rv .pf-n{color:color-mix(in srgb,var(--warn) 80%,var(--text))}.pf-fid .pf-n{color:color-mix(in srgb,var(--accent) 80%,var(--text))}.pf-pd .pf-n{color:color-mix(in srgb,var(--ok) 80%,var(--text))}
.awov{background-image:radial-gradient(120% 80% at 100% 0,color-mix(in srgb,var(--awx) 10%,transparent),transparent 60%);box-shadow:inset 0 2px 0 var(--awx)}
/* Invoices: the summary cards as filled tiles. */
.isc{background:linear-gradient(155deg,color-mix(in srgb,var(--c) 20%,var(--surface)),color-mix(in srgb,var(--c) 4%,var(--surface)) 70%);border-color:color-mix(in srgb,var(--c) 30%,var(--border));box-shadow:inset 0 2px 0 var(--c),0 16px 34px -26px var(--c)}
.isl i{width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
.isb{height:8px}
.signed-in .chip[aria-pressed="true"]{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 24%,var(--surface)),color-mix(in srgb,var(--accent) 10%,var(--surface)));border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}
/* The sidebar: the page in a violet pill, each section's icons in its colour, the integrations' state as a dot. */
.signed-in .appbar nav.apptabs a[aria-current="page"]{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 30%,transparent),color-mix(in srgb,var(--accent) 9%,transparent));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent),0 8px 20px -14px var(--accent);font-weight:650}
.signed-in .appbar nav.apptabs a[aria-current="page"]::before{content:"";position:absolute;left:-12px;top:7px;bottom:7px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}
.signed-in .appbar nav.apptabs a .ic{color:color-mix(in srgb,var(--nc,var(--faint)) 80%,var(--muted))}
.signed-in .appbar nav.apptabs a[aria-current="page"] .ic{color:var(--nc,var(--accent))}
#tabs a[data-tab=overview]{--nc:var(--accent)}#tabs a[data-tab=invoices],#tabs a[data-tab=transactions],#tabs a[data-tab=books]{--nc:var(--sky)}#tabs a[data-tab=agents],#tabs a[data-tab=tokenisation]{--nc:var(--ind)}#tabs a[data-tab=airwallex]{--nc:var(--awx)}#tabs a[data-tab=claude]{--nc:var(--claude)}#tabs a[data-tab=connections]{--nc:var(--ok)}
.signed-in .apptabs .ng:not(.sep)::before{content:"";display:inline-block;width:6px;height:6px;margin-right:8px;border-radius:2px;vertical-align:1px;background:var(--gc,var(--faint))}
.apptabs .ng[data-sg=money]{--gc:var(--sky)}.apptabs .ng[data-sg=agents]{--gc:var(--ind)}.apptabs .ng[data-sg=rails]{--gc:var(--ok)}
#tabs a[data-tab=airwallex]::after{content:"";margin-left:auto;width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 20%,transparent)}
#tabs a[data-n]::after{background:var(--accent);color:var(--bg)}
/* Agents: each card's own colour under it, its limit as a ring, the figures above in colour. */
.dk-item:has(.dk-meta[class*=" g"]){--agc:var(--ag)}
.dk-meta[class*=" g"]{padding:10px 12px;border-radius:14px;border:1px solid color-mix(in srgb,var(--ag) 28%,var(--border));background:linear-gradient(150deg,color-mix(in srgb,var(--ag) 14%,var(--surface)),color-mix(in srgb,var(--ag) 3%,var(--surface)) 70%);box-shadow:inset 0 2px 0 var(--ag)}
.dk-mw{display:flex;align-items:center;gap:12px;min-width:0}.dk-mw .dk-mt{flex:1;min-width:0}
.dk-ring{--p:0;flex:none;position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:conic-gradient(var(--ag,var(--accent)) calc(var(--p)*1%),color-mix(in srgb,var(--ag,var(--accent)) 16%,transparent) 0)}
.dk-ring::before{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--surface)}
.dk-ring b{position:relative;font-size:11.5px;font-weight:700;color:color-mix(in srgb,var(--ag,var(--accent)) 70%,var(--text))}
.dk-ring.full{--ag:var(--bad)}
.dk-meta[class*=" g"] .ac-bar{height:4px}.dk-meta[class*=" g"] .dk-st .dk-hon{color:var(--muted)}
.dk-meta[class*=" g"] .dk-st>span:not(.dk-hon){color:color-mix(in srgb,var(--ag) 55%,var(--text))}
.dk-stat:nth-child(1) b{color:color-mix(in srgb,var(--accent) 80%,var(--text))}.dk-stat:nth-child(2) b{color:color-mix(in srgb,var(--ok) 80%,var(--text))}.dk-stat:nth-child(3) b{color:color-mix(in srgb,var(--ind) 80%,var(--text))}
.dk-tick{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 10%,var(--surface)),var(--surface) 60%);border-color:color-mix(in srgb,var(--accent) 28%,var(--border))}
.dk-nego{background-image:radial-gradient(110% 80% at 100% 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent 60%)}
/* Connections: a band at the top of each card by its honest label, a dot of health by its name. */
.cx-stat{--sc:var(--sky);position:relative;overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--sc) 15%,var(--surface)),var(--surface) 65%);border-color:color-mix(in srgb,var(--sc) 30%,var(--border));box-shadow:inset 0 2px 0 var(--sc)}
.cx-stat.ok{--sc:var(--ok)}.cx-stat.tmoney{--sc:var(--warn)}.cx-stat.warn{--sc:var(--ind)}.cx-stat.plan{--sc:var(--faint);background:var(--surface);border-style:dashed;box-shadow:none}
.cx-stat b{color:color-mix(in srgb,var(--sc) 85%,var(--text))}.cx-stat.tmoney b{color:color-mix(in srgb,var(--warn) 85%,var(--text))}.cx-stat.warn b{color:color-mix(in srgb,var(--ind) 85%,var(--text))}
ul.cx-grid>li.cx-card{--bc:var(--sky);position:relative;overflow:hidden;box-shadow:inset 0 3px 0 var(--bc);background-image:linear-gradient(180deg,color-mix(in srgb,var(--bc) 8%,transparent),transparent 42%)}
ul.cx-grid>li.cx-card:has(.cx-nm .pill.ok){--bc:var(--ok)}ul.cx-grid>li.cx-card:has(.cx-nm .pill.tmoney){--bc:var(--warn)}ul.cx-grid>li.cx-card:has(.cx-nm .pill.warn){--bc:var(--ind)}ul.cx-grid>li.cx-card.planned{--bc:transparent;background-image:none}
ul.cx-grid>li.cx-card:hover{border-color:color-mix(in srgb,var(--bc) 50%,var(--border))}
.connections .cx-card .pill.warn{background:color-mix(in srgb,var(--ind) 14%,transparent);color:color-mix(in srgb,var(--ind) 82%,var(--text));--pi:var(--i-wait)}
.cx-nm>b::after{content:"";display:inline-block;width:7px;height:7px;margin-left:8px;vertical-align:2px;border-radius:50%;background:var(--bc);box-shadow:0 0 0 3px color-mix(in srgb,var(--bc) 20%,transparent)}
.cx-card.planned .cx-nm>b::after{background:transparent;box-shadow:inset 0 0 0 1.5px var(--faint)}
.cx-jump button{border-color:color-mix(in srgb,var(--accent) 22%,var(--border))}.cx-jump button:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}.cx-jump .num{color:color-mix(in srgb,var(--accent) 80%,var(--text))}
.cx-more summary{color:color-mix(in srgb,var(--accent) 80%,var(--text))}
/* Airwallex, Claude, Settings: a band at the top of each card in the colour of what it holds. */
.awcard{--bc:var(--awx);box-shadow:inset 0 2px 0 var(--bc);background-image:linear-gradient(180deg,color-mix(in srgb,var(--bc) 7%,transparent),transparent 36%)}
.awcard.aw-balances,.awcard.aw-accounts,.awcard.aw-financial{--bc:var(--sky)}.awcard.aw-transfers,.awcard.aw-beneficiaries{--bc:var(--ok)}.awcard.aw-reconcile,.awcard.aw-calls{--bc:var(--accent)}.awcard.aw-issuing{--bc:var(--ind)}.awcard.aw-rates,.awcard.aw-events{--bc:var(--warn)}
.awpill.down{--pi:var(--i-wait)}
.card.kpi.pos{background:linear-gradient(155deg,color-mix(in srgb,var(--claude) 16%,var(--surface)),var(--surface) 70%);border-color:color-mix(in srgb,var(--claude) 30%,var(--border));box-shadow:inset 0 2px 0 var(--claude)}
.card.kpi.pos .kl{color:color-mix(in srgb,var(--claude) 70%,var(--text))}
section.dcard:has(>.cl-list.ok),section.dcard:has(.cl-list.ok):not(:has(.cl-list.no)){--dc:var(--ok)}
section.dcard:has(.cl-list.no){--dc:var(--bad)}section.dcard.cl-addr{--dc:var(--accent)}
.dgrid section.dcard,section.dcard.cl-addr{box-shadow:inset 0 2px 0 var(--dc,var(--accent));background-image:radial-gradient(120% 80% at 100% 0,color-mix(in srgb,var(--dc,var(--accent)) 9%,transparent),transparent 60%)}
.set-you{--bc:var(--accent)}.set-pol{--bc:var(--sky)}.set-danger{--bc:var(--bad)}.card.panel.exports{--bc:var(--ok)}.card.panel.balance{--bc:var(--sky)}.card.panel.prbooks,.card.panel.t0close{--bc:var(--ind)}
.set-you,.set-pol,.set-danger,.card.panel.exports,.card.panel.balance,.card.panel.prbooks,.card.panel.t0close{box-shadow:inset 0 2px 0 var(--bc);background-image:radial-gradient(120% 70% at 100% 0,color-mix(in srgb,var(--bc) 8%,transparent),transparent 60%)}
table.table.jt thead th,table.table.vat thead th,table.table.ctab thead th{color:color-mix(in srgb,var(--accent) 45%,var(--muted))}
/* Agents: the card itself glows faintly in its agent's colour. */
.dk-item:has(.dk-meta.g0){--agc:var(--g0)}.dk-item:has(.dk-meta.g1){--agc:var(--g1)}.dk-item:has(.dk-meta.g2){--agc:var(--g2)}.dk-item:has(.dk-meta.g3){--agc:var(--g3)}.dk-item:has(.dk-meta.g4){--agc:var(--g4)}.dk-item:has(.dk-meta.g5){--agc:var(--g5)}
.dk-item:has(.dk-meta[class*=" g"]) button.dk-face{box-shadow:0 26px 46px -30px var(--agc),0 0 0 1px color-mix(in srgb,var(--agc) 30%,transparent)}
/* The sign-up ("Set it up") and a passkey's enrolment: the steps in violet, done in green, test money in amber. */
.auth p.tm-chip{display:inline-flex;align-items:center;gap:7px;margin:2px 0 4px;padding:5px 12px 5px 9px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font:650 11.5px/1.2 var(--mono,ui-monospace,monospace);letter-spacing:.05em;text-transform:uppercase;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warn) 30%,transparent)}
.auth p.tm-chip .ic,.auth p.tm-chip svg{width:13px;height:13px;display:inline-flex}
.auth.start ol.stepper{margin-top:14px;gap:4px}
ol.stepper li .sl{flex:0 1 auto}
ol.stepper li:not(:last-child)::after{content:"";flex:1 1 12px;min-width:8px;height:2px;margin:0 4px 0 2px;border-radius:2px;background:var(--border)}
ol.stepper li.done::after{background:linear-gradient(90deg,var(--ok),color-mix(in srgb,var(--accent) 80%,var(--ok)))}
ol.stepper li.now::after{background:linear-gradient(90deg,var(--accent),var(--border))}
@media (max-width:640px){ol.stepper li:not(:last-child)::after{display:none}}
ol.stepper li.now .n{background:var(--btn-bg,var(--accent));color:var(--btn-ink,#fff);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent),0 8px 20px -8px var(--accent)}
ol.stepper li.now .sl{color:color-mix(in srgb,var(--accent) 55%,var(--text))}
ol.stepper li.done{color:color-mix(in srgb,var(--ok) 65%,var(--text))}ol.stepper li.done .n{background:linear-gradient(140deg,color-mix(in srgb,var(--ok) 75%,#fff),var(--ok));color:var(--bg);box-shadow:0 6px 16px -8px var(--ok)}
ol.stepper li:not(.now):not(.done) .n{background:transparent;box-shadow:inset 0 0 0 1.5px var(--border)}
.auth p.stepsub{border-top-color:color-mix(in srgb,var(--accent) 22%,var(--border));color:color-mix(in srgb,var(--accent) 30%,var(--muted))}
.signed-out .auth .addr:focus-within,.signed-out .auth input.field:focus{border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent);outline:none}
.auth .note-ok,.auth .note-bad{display:flex;gap:9px;align-items:flex-start;box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 26%,transparent)}
.auth .note-ok::before,.auth .note-bad::before{content:"";flex:none;width:16px;height:16px;margin-top:2px;background:currentColor;-webkit-mask:var(--i-ok) center/contain no-repeat;mask:var(--i-ok) center/contain no-repeat}.auth .note-bad::before{-webkit-mask-image:var(--i-bad);mask-image:var(--i-bad)}
.auth .note-ok{background:linear-gradient(135deg,color-mix(in srgb,var(--ok) 18%,var(--surface)),var(--ok-soft))}
.auth p.inbox .ic{color:var(--sky)}
.auth.enrol .en-mk{display:grid;place-items:center;width:48px;height:48px;margin:0 0 18px;border-radius:14px;background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 70%,#fff),var(--accent));color:var(--bg);box-shadow:0 14px 30px -14px var(--accent)}
.auth.enrol .en-mk svg{width:22px;height:22px}.auth.enrol h1{margin-bottom:6px}
.signed-out p.trust span:last-child{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--border));background:color-mix(in srgb,var(--warn-soft) 80%,transparent)}
`;

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
${MORE_CSS}`;
