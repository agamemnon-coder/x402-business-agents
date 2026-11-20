// Purser Cloud's console, the charts the Overview and Books share (21 Nov, the owner: "clean charts from the company's
// real data: spend over time, by agent, by rail, open payables and the cash position"). Every figure is GET
// /v1/dashboard's (cloud/src/dashboard.ts) or the invoices' own, counted by the cloud from the company's rows; nothing is
// estimated, and with no rows a chart says so instead of drawing. Pure SVG and DOM, built with the console's own el()
// and sv() (no library, no inline style markup: the page's nonce policy), sized to the card so its words stay legible on a
// phone. Each SVG chart carries a <title> and <desc> and a table of the same numbers one click away; colour is never the
// only carrier (every part is named with its value). The palette is set for light and dark below.
//
// The script goes into the console at __UI__ (cloud/src/console.ts), after the dashboard's helpers it uses: el, sv, t, tk,
// amt, toCents, dday, kfmt, cur, cents, segbar, spendBars, cashChart, dcard, RM.

export const CHARTS_JS = String.raw`
// --- Charts (21 Nov) --------------------------------------------------------------------------------------------------
let chartSeq=0;
// A chart's name and its numbers in words, for a screen reader: <title> and <desc>, the svg labelled by both.
function chartA11y(g,title,desc){const k='ch'+(++chartSeq);g.removeAttribute('aria-label');g.setAttribute('role','img');g.setAttribute('aria-labelledby',k+'t '+k+'d');
  g.prepend(sv('title',{id:k+'t'},[document.createTextNode(title)]),sv('desc',{id:k+'d'},[document.createTextNode(desc)]));return g}
// The same numbers as a table, folded under the chart.
function chartTable(cols,rows){
  const tb=el('table','table ctab',[el('thead','',[el('tr','',cols.map((c,i)=>el('th',i?'r':'',c)))]),el('tbody','',rows.map((r)=>el('tr','',r.map((c,i)=>el('td',i?'r num':'',c)))))]);
  return el('details','ctable',[el('summary','',t('cs.ch.table')),el('div','scroll',tb)])}
const chartEmpty=(text)=>el('div','chempty',[ic('circle-dot'),el('span','',text)]);
// The words for a rail as the register names it (airwallex_card, metal, ...): the catalogue's, else the name tidied.
const railWords=(r)=>tk('cs.rail.'+String(r||'other').toLowerCase().replace(/[^a-z0-9]+/g,'_'),String(r||'other').replace(/[_-]+/g,' ').replace(/^./,(c)=>c.toUpperCase()));
// The Monday of a day's week (UTC), as the dashboard counts weeks.
const mondayOf=(day)=>{const d=new Date(String(day).slice(0,10)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)};
// Money in and out per week, from the dashboard's days (moved rows, the main currency; fees count as out).
function weekFlows(D){const m=new Map();for(const p of D.cash||[]){const w=mondayOf(p.day);const x=m.get(w)||{week:w,i:0,o:0};x.i+=toCents(p.in);x.o+=toCents(p.out);m.set(w,x)}return [...m.values()].sort((a,b)=>a.week.localeCompare(b.week))}
// Money in and out per week: two columns a week, in (green) and out (the accent), a gridline at the top value.
function flowChart(D,W){
  const ws=weekFlows(D);if(!ws.length)return chartEmpty(t('cs.ch.none'));
  const H=Math.max(180,Math.min(240,Math.round(W*0.42))),l=44,r=8,tp=14,b=26;
  const max=Math.max(1,...ws.map((w)=>Math.max(w.i,w.o)));const step=(W-l-r)/ws.length,bw=Math.max(4,Math.min(22,step*0.32));
  const Y=(v)=>tp+(1-v/max)*(H-tp-b);
  const g=sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'chart flows'});
  for(const v of [0,max/2,max]){const y=Y(v);g.append(sv('line',{x1:l,x2:W-r,y1:y,y2:y,class:v===0?'zero':'grid'}),sv('text',{x:l-8,y:y+4,class:'ax','text-anchor':'end'},[document.createTextNode(v===0?'0':kfmt(v))]))}
  const every=Math.max(1,Math.ceil(ws.length/Math.max(1,Math.floor((W-l-r)/64))));
  ws.forEach((w,k)=>{const x=l+step*k+step/2;
    const col=sv('g',{class:'col'},[sv('title',{},[document.createTextNode(t('cs.ch.week_of',{day:dday(w.week)})+': '+t('cs.dash.in')+' '+amt(D,w.i)+' · '+t('cs.dash.out')+' '+amt(D,w.o))])]);
    if(w.i)col.append(sv('rect',{x:x-bw-1,y:Y(w.i),width:bw,height:Y(0)-Y(w.i),rx:2.5,class:'b fin'}));
    if(w.o)col.append(sv('rect',{x:x+1,y:Y(w.o),width:bw,height:Y(0)-Y(w.o),rx:2.5,class:'b fout'}));
    if(k%every===0)col.append(sv('text',{x,y:H-8,class:'ax','text-anchor':'middle'},[document.createTextNode(dday(w.week))]));
    g.append(col)});
  const tin=ws.reduce((n,w)=>n+w.i,0),tout=ws.reduce((n,w)=>n+w.o,0);
  chartA11y(g,t('cs.ch.flows_title'),t('cs.ch.flows_desc',{n:ws.length,in:amt(D,tin),out:amt(D,tout)}));
  return el('div','',[el('div','cv',[g]),el('ul','klegend',[el('li','',[el('i','fin'),t('cs.dash.in')+' · '+amt(D,tin)]),el('li','',[el('i','fout'),t('cs.dash.out')+' · '+amt(D,tout)])]),
    chartTable([t('cs.ch.week'),t('cs.dash.in'),t('cs.dash.out')],ws.map((w)=>[dday(w.week),amt(D,w.i),amt(D,w.o)]))])}
// A ring of parts (up to five named, the rest as "Other"), the total in its middle, a legend with each amount and share.
function donut(D,parts,title,centre){
  parts=parts.filter((p)=>p.v>0).sort((a,b)=>b.v-a.v);if(!parts.length)return chartEmpty(t('cs.ch.none'));
  if(parts.length>5){const rest=parts.slice(4).reduce((n,p)=>n+p.v,0);parts=parts.slice(0,4).concat([{l:t('cs.ch.other'),v:rest,n:parts.slice(4).reduce((n,p)=>n+(p.n||0),0)}])}
  const tot=parts.reduce((n,p)=>n+p.v,0);const pc=(v)=>Math.round(v/tot*100)+'%';
  const g=sv('svg',{viewBox:'0 0 120 120',width:132,height:132,class:'ring donut'});
  g.append(sv('circle',{cx:60,cy:60,r:46,class:'track'}));let off=0;
  parts.forEach((p,i)=>{const f=p.v/tot*100;g.append(sv('circle',{cx:60,cy:60,r:46,pathLength:100,class:'seg c'+i,'stroke-dasharray':(Math.max(.4,f-(parts.length>1?1.2:0))).toFixed(2)+' '+(100-f+(parts.length>1?1.2:0)).toFixed(2),'stroke-dashoffset':(25-off).toFixed(2)},[sv('title',{},[document.createTextNode(p.l+': '+amt(D,p.v)+' ('+pc(p.v)+')')])]));off+=f});
  g.append(sv('text',{x:60,y:58,class:'rt sm','text-anchor':'middle'},[document.createTextNode(kfmt(tot))]),sv('text',{x:60,y:76,class:'rs','text-anchor':'middle'},[document.createTextNode(centre)]));
  chartA11y(g,title,parts.map((p)=>p.l+' '+amt(D,p.v)+' ('+pc(p.v)+')').join(', '));
  const lg=el('ul','rlegend clegend',parts.map((p,i)=>el('li','',[el('i','c'+i),el('span','',p.l),el('b','num',pc(p.v)),el('small','num',amt(D,p.v)+(p.n?' · '+t(p.n===1?'cs.dash.n_payments_1':'cs.dash.n_payments',{n:p.n}):''))])));
  return el('div','',[el('div','ringwrap',[g,el('div','',[lg])]),chartTable([title,t('cs.ch.amount'),t('cs.ch.share')],parts.map((p)=>[p.l,amt(D,p.v),pc(p.v)]))])}
// Spend by rail: what moved out, by the rail it moved on.
function railsChart(D){return donut(D,(D.rails||[]).map((r)=>({l:railWords(r.rail),v:toCents(r.amount),n:r.count})),t('cs.ch.rails_title'),t('cs.ch.out_word'))}
// Spend by agent (and the supplier invoices the CFO approved), the dashboard's own bars, with their table.
function agentSpend(D){if(!(D.spend||[]).length)return chartEmpty(t('cs.ch.none'));
  return el('div','',[spendBars(D),chartTable([t('cs.ch.who'),t('cs.ch.amount'),t('cs.ch.payments')],D.spend.map((s)=>[tk('cs.dash.spend.'+s.key,s.label),amt(D,toCents(s.amount)),String(s.count)]))])}
// The cash line with its table: where cash stood at the end of each week.
function cashWithTable(D,W){const g=cashChart(D,W);const last=D.cash[D.cash.length-1];
  chartA11y(g,t('cs.dash.cash_title'),t('cs.ch.cash_desc',{from:dday(D.cash[0].day),to:dday(last.day),end:amt(D,toCents(last.net))}));
  const ends=new Map();for(const p of D.cash)ends.set(mondayOf(p.day),p);
  return el('div','',[el('div','cv',[g]),chartTable([t('cs.ch.week'),t('cs.dash.in'),t('cs.dash.out'),t('cs.ch.cash_end')],weekFlows(D).map((w)=>[dday(w.week),amt(D,w.i),amt(D,w.o),amt(D,toCents(ends.get(w.week).net))]))])}
// When the open invoices fall due, in their main currency (other currencies said, not mixed in).
function dueChart(items){
  const opn=items.filter(i=>!['paid','rejected'].includes(i.status));const per={};for(const i of opn)per[i.currency]=(per[i.currency]||0)+toCents(i.total);
  const main=Object.entries(per).sort((a,b)=>b[1]-a[1])[0];if(!main)return el('p','lede',t('cs.due.none'));
  const days=(d)=>Math.round((Date.parse(d)-Date.parse(today))/86400000);
  const b=[0,0,0,0];for(const i of opn){if(i.currency!==main[0])continue;const n=i.due_date?days(i.due_date):99999;b[n<=0?0:n<=7?1:n<=30?2:3]+=toCents(i.total)}
  const lab=['cs.due.late','cs.due.d7','cs.due.d30','cs.due.later'];
  return el('div','',[segbar(b.map((v,k)=>({l:t(lab[k]),v,t:cur(main[0])+' '+cents(v)})),t('cs.due.title')),Object.keys(per).length>1?el('p','fine',t('cs.due.other_cur')):null])}
// Books (21 Nov): the money at a glance above the balance sheet. One empty card when nothing has moved yet.
function booksCharts(D,items){
  const full=view().clientWidth||960,wide=innerWidth>=980;
  if(!D||!D.cash||!D.cash.length)return el('section','card dcard chempty-card',[el('div','dh',[el('h2','',t('cs.ch.books_h')),el('p','',t('cs.ch.books_none'))])]);
  const half=Math.round(wide?full*0.5-48:full-40);
  return el('div','dash bcharts',[
    el('div','dgrid g2',[dcard('cash',t('cs.ch.position_title'),t('cs.dash.cash_sub',{cur:cur(D.currency),date:dday(D.since)}),cashWithTable(D,half)),
      dcard('flows',t('cs.ch.flows_title'),t('cs.ch.flows_sub',{cur:cur(D.currency)}),flowChart(D,half))]),
    el('div','dgrid g3',[dcard('spend',t('cs.ch.agents_title'),t('cs.dash.spend_sub',{cur:cur(D.currency)}),agentSpend(D)),
      dcard('rails',t('cs.ch.rails_title'),t('cs.ch.rails_sub',{cur:cur(D.currency)}),railsChart(D)),
      dcard('due',t('cs.ch.payables_title'),t('cs.ch.payables_sub'),dueChart(items))])])}
`;

export const CHARTS_CSS = `
/* Charts (cloud/src/consoleCharts.ts): a categorical palette in light and dark; every part also named with its value. */
:root { --c0: var(--accent); --c1: #0f9a86; --c2: #d08a1c; --c3: #d4537a; --c4: #8a94a3; --fin: #12a150; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --c1: #2cc9b0; --c2: #f0b24e; --c3: #f17fa0; --c4: #7f8a99; --fin: #3ccf7f; } }
:root[data-theme="dark"] { --c1: #2cc9b0; --c2: #f0b24e; --c3: #f17fa0; --c4: #7f8a99; --fin: #3ccf7f; }
svg.ring .seg.c0 { stroke: var(--c0); } svg.ring .seg.c1 { stroke: var(--c1); } svg.ring .seg.c2 { stroke: var(--c2); } svg.ring .seg.c3 { stroke: var(--c3); } svg.ring .seg.c4 { stroke: var(--c4); }
.clegend li i.c0 { background: var(--c0); } .clegend li i.c1 { background: var(--c1); } .clegend li i.c2 { background: var(--c2); } .clegend li i.c3 { background: var(--c3); } .clegend li i.c4 { background: var(--c4); }
svg.ring .rt.sm { font-size: 21px; }
svg.chart .b.fin { fill: var(--fin); } svg.chart .b.fout { fill: var(--accent); }
.klegend i.fin { background: var(--fin); } .klegend i.fout { background: var(--accent); }
svg.chart.flows .col:hover .b { opacity: .82; }
details.ctable { margin-top: 10px; font-size: 13px; }
details.ctable > summary { cursor: pointer; color: var(--muted); font-weight: 600; width: max-content; list-style: none; display: inline-flex; align-items: center; gap: 6px; }
details.ctable > summary::-webkit-details-marker { display: none; }
details.ctable > summary::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform .15s; }
details.ctable[open] > summary::before { transform: rotate(45deg); }
details.ctable > summary:hover { color: var(--accent); }
details.ctable table.ctab { margin-top: 8px; font-size: 13px; }
details.ctable table.ctab td, details.ctable table.ctab th { padding: 6px 10px; }
.chempty { display: flex; align-items: center; gap: 8px; padding: 18px 14px; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); font-size: 13.5px; }
.chempty-card .dh p { margin-bottom: 0; }
.bcharts-slot { margin: 10px 0 16px; } .bcharts-slot .bcharts { margin: 0; }
.split2.books2 { align-items: start; }
.chskel i { display: block; height: 300px; border-radius: 14px; background: var(--sunken); }
.bcharts-slot .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 979px) { .chskel i + i { display: none; } }
.bcharts .dgrid + .dgrid { margin-top: 16px; }
@media (min-width: 980px) { .dgrid.g3 { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { details.ctable > summary::before { transition: none; } }
`;
