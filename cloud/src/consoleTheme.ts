// Purser Cloud's console, the premium pass (21 Nov, the owner: "an extreme, premium visual upgrade"; the site's Home
// leads with the agents' cards in metal). Style only, last in the console's one stylesheet: it changes no markup, no
// word and no behaviour, so the console's views and charts (cloud/src/console.ts, consoleUi.ts, consoleCharts.ts,
// consoleShell.ts) stay as their own modules draw them. Cards on one surface (a hairline border, a lit top edge, one
// radius), larger figures on the KPI cards, chart lines and bars that glow in the accent, a sidebar whose current page
// is lit. Dark first; light keeps its white surfaces with the same shapes. No animation is added.

export const CONSOLE_THEME_CSS = `
/* --- The premium pass (cloud/src/consoleTheme.ts) ------------------------------------------------------------------ */
.signed-in main { background: radial-gradient(1100px 420px at 60% -160px, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%) no-repeat; }
/* One surface for every card. */
.card, .auth { border-radius: 16px; border-color: color-mix(in srgb, var(--border) 88%, var(--text)); background: linear-gradient(180deg, color-mix(in srgb, var(--text) 2%, var(--surface)), var(--surface)); box-shadow: var(--hi), 0 1px 2px rgba(16, 24, 40, .05), 0 22px 44px -34px rgba(0, 0, 0, .55); }
.card.next.hero.act { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: var(--hi), 0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 24px 60px -30px color-mix(in srgb, var(--accent) 55%, transparent); }
.next.hero .nic { box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent); }
/* The KPI cards: the figure large, its icon lit. */
.kpi { padding: 18px 20px; gap: 8px; }
.kpi b { font-size: clamp(24px, 2.3vw, 32px); font-weight: 720; letter-spacing: -.035em; line-height: 1.1; }
.kpi .kl .ic { border-radius: 9px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent); }
.kpi.pos .kl .ic { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ok) 30%, transparent), 0 6px 18px -8px color-mix(in srgb, var(--ok) 70%, transparent); }
.kpi.wait .kl .ic { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 30%, transparent), 0 6px 18px -8px color-mix(in srgb, var(--warn) 70%, transparent); }
@media (max-width: 520px) { .kpi { padding: 14px; } .kpi b { font-size: 22px; } }
.dcard .dh h2 { font-size: 16.5px; letter-spacing: -.015em; }
/* Charts: the lines and bars glow in their colour; the grid steps back. */
svg.chart .grid { stroke: color-mix(in srgb, var(--border) 70%, transparent); }
svg.chart .line { stroke-width: 2.5; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 90%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)); }
svg.chart .end { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 80%, transparent)); }
svg.chart .b.cfo, svg.chart .b.fout { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 60%, transparent)); }
svg.chart .b.fin { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--fin, var(--ok)) 40%, transparent)); }
svg.ring .seg { filter: drop-shadow(0 0 6px color-mix(in srgb, currentColor 55%, transparent)); }
svg.ring .seg.c0 { color: var(--c0); } svg.ring .seg.c1 { color: var(--c1); } svg.ring .seg.c2 { color: var(--c2); } svg.ring .seg.c3 { color: var(--c3); } svg.ring .seg.c4 { color: var(--c4); }
.sbars .strk { height: 8px; }
.sbars .sf { box-shadow: 0 0 12px -2px color-mix(in srgb, var(--accent) 70%, transparent); }
/* The sidebar: a quieter ground, the current page lit with a bar of the accent. */
@media (min-width: 1024px) {
  .signed-in .appbar { background: linear-gradient(180deg, color-mix(in srgb, var(--text) 1.5%, var(--surface)), var(--surface)); }
  .signed-in .appbar nav.apptabs a[aria-current="page"] { position: relative; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 6%, transparent)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent); }
  .signed-in .appbar nav.apptabs a[aria-current="page"]::before { content: ""; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
  .signed-in .apptabs .ng { font-family: var(--mono); font-weight: 600; letter-spacing: .14em; }
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) svg.chart .line { filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--accent) 35%, transparent)); } }
:root[data-theme="light"] svg.chart .line { filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--accent) 35%, transparent)); }
@media print { .card, .auth, svg.chart .line, svg.chart .b, svg.ring .seg { box-shadow: none; filter: none; } }
`;
