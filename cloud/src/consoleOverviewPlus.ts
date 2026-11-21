// Purser Cloud's Overview, more to read (Max, 21 Nov: "too simple"): two more charts from the company's own records,
// each with its figures on hover, focus and touch like every chart here (consoleCharts.ts chartPoint), and the site's
// wave behind the whole console (src/ui/wave.ts, faint below the header).
//
//   Cash in and out, by week   the dashboard's own days (GET /v1/dashboard cash) summed by week, Monday to Sunday: in
//                              and out side by side; a week opens its transactions.
//   Paid out, by counterparty  the transactions register (GET /v1/transactions), every movement out summed by its
//                              counterparty in EUR (the register's own EUR equivalent), the six largest with their counts.
//
// Nothing is typed in: a company with no days or no payments out shows the chart's empty line. A per-agent activity line
// is left out on purpose: the records hold only a few payments and the newest five decisions per agent, too few points
// for a line that would read as a trend. The script goes into the console at __UI__ (cloud/src/console.ts), after
// consoleCharts.ts, and uses its el, sv, ic, t, cur, cents, toCents, dday, api, dcard, cardLink, chartPoint, svgX,
// svgAt, colMark, txWeek and chartEmpty.

import { WAVE_CANVAS_CSS, waveScript } from "../../src/ui/wave.js";

export const OVERVIEW_PLUS_JS = String.raw`
// --- The Overview's two more charts (cloud/src/consoleOverviewPlus.ts) -------------------------------------------------
const opMonday=(day)=>{const d=new Date(String(day).slice(0,10)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)};
function opWeeks(D,W){
  const per={};for(const d of D.cash||[]){const k=opMonday(d.day);const w=per[k]||(per[k]={week:k,in:0,out:0});w.in+=toCents(d.in);w.out+=toCents(d.out)}
  const ws=Object.values(per).sort((a,b)=>a.week.localeCompare(b.week));
  if(!ws.length)return chartEmpty(t('cs.op.sup_none'));
  const H=210,l=10,b=26,tp=20,max=Math.max(1,...ws.map((w)=>Math.max(w.in,w.out))),step=(W-l*2)/ws.length,bw=Math.max(6,Math.min(24,step*0.3));
  const g=sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'chart flows opweeks',role:'img','aria-label':t('cs.op.weeks_title')});
  const h=(n)=>n/max*(H-tp-b);
  ws.forEach((w,k)=>{const cx=l+step*k+step/2;const col=sv('g',{class:'col'},[sv('rect',{x:l+step*k,y:0,width:step,height:H-b,class:'hit'})]);
    col.append(sv('rect',{x:cx-bw-2,y:H-b-Math.max(1,h(w.in)),width:bw,height:Math.max(1,h(w.in)),rx:3,class:'b fin'}),sv('rect',{x:cx+2,y:H-b-Math.max(1,h(w.out)),width:bw,height:Math.max(1,h(w.out)),rx:3,class:'b fout'}),
      sv('text',{x:cx,y:H-8,class:'ax','text-anchor':'middle'},[document.createTextNode(dday(w.week))]));
    g.append(col)});
  chartPoint({root:g,n:ws.length,start:ws.length-1,at:(cx)=>Math.max(0,Math.min(ws.length-1,Math.floor((svgX(g,W,cx)-l)/step))),
    anchor:(i)=>svgAt(g,W,H,l+step*i+step/2,H-b-Math.max(h(ws[i].in),h(ws[i].out))),mark:(i)=>colMark(g,i),
    tip:(i)=>{const w=ws[i],c=cur(D.currency)+' ';return {h:t('cs.op.week_of',{day:dday(w.week)}),rows:[{k:'fin',l:t('cs.op.in'),v:c+cents(w.in)},{k:'fout',l:t('cs.op.out'),v:c+cents(w.out)},{l:t('cs.op.net'),v:(w.in-w.out<0?'−':'')+c+cents(Math.abs(w.in-w.out))}]}},
    href:(i)=>txWeek(ws[i].week)});
  return el('div','',[el('div','cv',[g]),el('ul','klegend',[el('li','',[el('i','fin'),t('cs.op.in')]),el('li','',[el('i','fout'),t('cs.op.out')])])])}
// Paid out, by counterparty: drawn once the register answers; its own empty line without payments out.
function opSuppliers(){
  const box=el('div','opsup',[el('div','chskel',[el('i','')])]);
  api('/v1/transactions?limit=500').then((r)=>{
    const per={};for(const x of (r&&r.items)||[]){if(x.direction!=='out'||!x.moved)continue;const k=x.counterparty||x.description||'—';const p=per[k]||(per[k]={k,c:0,n:0});p.c+=toCents(x.eur_equivalent||x.amount);p.n++}
    const top=Object.values(per).sort((a,b)=>b.c-a.c).slice(0,6);
    if(!top.length){box.replaceChildren(chartEmpty(t('cs.op.sup_none')));return}
    const max=Math.max(1,...top.map((s)=>s.c));
    box.replaceChildren(el('ul','sbars',top.map((s)=>{const f=el('span','sf');f.style.width=(s.c/max*100).toFixed(1)+'%';
      const a=el('a','opsrow',[el('div','sl',[el('span','',s.k),el('b','num','EUR '+cents(s.c))]),el('span','strk',[f]),el('span','ss',s.n===1?t('cs.op.sup_1'):t('cs.op.sup_n',{n:s.n}))]);a.href='#/transactions';return el('li','',[a])})));
    requestAnimationFrame(()=>{const c=box.closest('.rise');if(c)c.classList.add('in')});
  }).catch(()=>box.replaceChildren(chartEmpty(t('cs.op.sup_none'))));
  return box}
// The row the Overview adds under its own: the weeks beside the counterparties.
function overviewPlus(D){
  const wide=innerWidth>=980,full=view().clientWidth||960,W=Math.round(wide?full*0.6-40:full-40);
  return el('div','dgrid g1 opgrid',[cardLink(dcard('opw',t('cs.op.weeks_title'),t('cs.op.weeks_sub',{cur:cur(D.currency),date:dday(D.since)}),opWeeks(D,W)),'#/transactions',sw('to_tx')),
    cardLink(dcard('ops',t('cs.op.sup_title'),t('cs.op.sup_sub'),opSuppliers()),'#/transactions',sw('to_tx'))])}
`;

/** The site's wave behind the whole console, strongest under the header, faint behind the cards. */
export const CONSOLE_WAVE_JS = `
(function () { if (document.querySelector("canvas.pw-wave")) return; var c = document.createElement("canvas"); c.className = "pw-wave"; c.setAttribute("aria-hidden", "true"); document.body.prepend(c); })();
${waveScript({ selector: "canvas.pw-wave", placement: "page", density: 0.8, intensity: 1.35 })}`;

export const OVERVIEW_PLUS_CSS = `
${WAVE_CANVAS_CSS}
canvas.pw-wave { z-index: -1; }
.opsrow { display: block; text-decoration: none; color: inherit; border-radius: 10px; padding: 2px 4px; margin: 0 -4px; transition: background-color .15s ease; }
.opsrow:hover, .opsrow:focus-visible { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.opsrow .sl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.opsup .sbars .sf { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e879f9)); }
.opgrid { margin-top: 16px; }
/* The flow strip: particles that run along each connector to the next step (Max: "animated particles along the path"). */
@media (prefers-reduced-motion: no-preference) and (min-width: 721px) {
  .rise.in ol.pflow > li:not(:last-child)::before { background-image: radial-gradient(circle, color-mix(in srgb, var(--accent) 95%, #fff) 0 1.2px, transparent 1.8px), linear-gradient(90deg, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 10%, transparent)); background-size: 9px 2px, 100% 100%; background-repeat: repeat-x, no-repeat; animation: opflow 1.1s linear infinite; box-shadow: 0 0 10px -2px var(--accent); }
}
@keyframes opflow { from { background-position: 0 0, 0 0; } to { background-position: 9px 0, 0 0; } }
`;
