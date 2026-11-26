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
// --- Reading a chart by pointer, keyboard and touch (owner, 21 Nov: "if I go over something with my cursor I want it to
// show me the numbers… no dead zones, everything should be a thing and connected"). One quiet tooltip per chart with the
// exact figures; the whole plot answers (a line snaps to its nearest day, a column is its full height, a ring is every
// angle round it). Keyboard: the chart is one tab stop; arrows step, Home and End jump, Enter opens the related list,
// Escape closes; a screen reader hears each figure. Touch: a tap shows the figures, a second tap on the same opens.
// o: {root, n, at(clientX,clientY)->index, anchor(i)->{x,y} (client px), mark(i) (-1: none), tip(i)->{h,rows:[{k,l,v}]},
//     href(i)->hash|null, legend: [element per index]}
const CH_OPEN=new Set();
document.addEventListener('pointerdown',(e)=>{for(const c of CH_OPEN)if(!c.root.contains(e.target)&&!(c.legend||[]).some((x)=>x&&x.contains(e.target)))c.set(-1)},{passive:true});
function chartTipBox(wrap){let tip=wrap.querySelector(':scope > .chtip');if(!tip){tip=el('div','chtip');tip.setAttribute('aria-hidden','true');wrap.append(tip)}
  let say=wrap.querySelector(':scope > .chsay');if(!say){say=el('span','chsay vh');say.setAttribute('aria-live','polite');wrap.append(say)}return [tip,say]}
function chartPoint(o){
  const root=o.root;let cur=-1,touch=false,kb=false;const c={root,legend:o.legend,set:null};
  root.tabIndex=0;root.classList.add('chi');if(o.href)root.classList.add('chlink');
  root.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End Enter Escape');
  const set=(i,speak)=>{
    if(i===cur&&!speak)return;cur=i;o.mark(i);(o.legend||[]).forEach((x,k)=>{if(x)x.classList.toggle('hot',k===i)});
    const wrap=root.closest('.dcard,.card')||root.parentElement;if(!wrap)return;const [tip,say]=chartTipBox(wrap);
    if(i<0){tip.classList.remove('on');CH_OPEN.delete(c);return}
    CH_OPEN.add(c);const d=o.tip(i),h=o.href?o.href(i):null;
    tip.replaceChildren(...[el('b','cth',d.h),...d.rows.map((r)=>el('span','ctr',[el('i','sw'+(r.k?' '+r.k:'')),el('span','ctl',r.l),el('b','num',r.v)])),h?el('span','cgo',kb?cw('key_open'):touch?cw('tap_open'):cw('click_open')):null].filter(Boolean));
    tip.classList.add('on');
    const p=o.anchor(i),wr=wrap.getBoundingClientRect(),W=wrap.clientWidth,tw=tip.offsetWidth,th=tip.offsetHeight;
    // Above the point when it fits, else beside it (never over the part it describes), else below; always inside the card.
    const x=p.x-wr.left,y=p.y-wr.top,Hc=wrap.clientHeight,mid=Math.max(2,Math.min(x-tw/2,W-tw-2));let left=mid,top=y-th-12;
    // A ring prefers its side (above, the box would cover the ring it describes).
    const sideTop=Math.max(2,Math.min(y-th/2,Hc-th-2)),sideL=x+16+tw<=W?x+16:x-16-tw>=0?x-16-tw:null;
    if(o.side&&sideL!==null){left=sideL;top=sideTop}
    else if(top<0){top=sideTop;if(sideL!==null)left=sideL;else{left=mid;top=Math.min(y+16,Hc-th-2)}}
    tip.style.transform='translate('+Math.round(left)+'px,'+Math.round(top)+'px)';
    if(speak)say.textContent=d.h+': '+d.rows.map((r)=>r.l+' '+r.v).join(', ')};
  c.set=set;
  const open=(i)=>{const h=i>=0&&o.href?o.href(i):null;if(h)location.hash=h};
  root.addEventListener('pointerdown',(e)=>{touch=e.pointerType!=='mouse';kb=false});
  root.addEventListener('pointermove',(e)=>{if(e.pointerType==='mouse'){touch=false;kb=false;set(o.at(e.clientX,e.clientY))}});
  root.addEventListener('pointerleave',(e)=>{if(e.pointerType==='mouse'&&document.activeElement!==root)set(-1)});
  root.addEventListener('click',(e)=>{const i=o.at(e.clientX,e.clientY);if(i<0)return;if(touch&&cur!==i){set(i);return}open(i)});
  root.addEventListener('focus',()=>{if(!touch){kb=true;set(cur<0?(o.start||0):cur,true)}});
  root.addEventListener('blur',()=>{kb=false;set(-1)});
  root.addEventListener('keydown',(e)=>{const k=e.key;let i=cur<0?0:cur;kb=true;touch=false;
    if(k==='ArrowRight'||k==='ArrowDown')i=Math.min(o.n-1,i+1);else if(k==='ArrowLeft'||k==='ArrowUp')i=Math.max(0,i-1);else if(k==='Home')i=0;else if(k==='End')i=o.n-1;
    else if(k==='Enter'||k===' '){if(cur>=0&&o.href&&o.href(cur)){e.preventDefault();open(cur)}return}else if(k==='Escape'){set(-1);return}else return;
    e.preventDefault();set(i,true)});
  // The legend answers too: pointing at an entry lights its part; a click opens its list.
  (o.legend||[]).forEach((x,k)=>{if(!x)return;x.classList.add('chleg');
    x.addEventListener('pointerenter',(e)=>{if(e.pointerType==='mouse')set(k)});x.addEventListener('pointerleave',(e)=>{if(e.pointerType==='mouse'&&document.activeElement!==root)set(-1)});
    x.addEventListener('click',()=>{if(cur!==k&&touch){set(k);return}open(k)})});
  return root}
// The page coordinates of an SVG's own point (its viewBox is W wide and H high), wherever CSS has scaled it.
const svgAt=(g,W,H,x,y)=>{const r=g.getBoundingClientRect();return {x:r.left+x*r.width/W,y:r.top+y*r.height/H}};
const svgX=(g,W,cx)=>{const r=g.getBoundingClientRect();return (cx-r.left)*W/(r.width||1)};
const svgY=(g,H,cy)=>{const r=g.getBoundingClientRect();return (cy-r.top)*H/(r.height||1)};
// A ring's part under the pointer: any angle round its centre (no dead zone in the hole or the corners).
function ringPick(g,fr,cx,cy){const r=g.getBoundingClientRect();const dx=cx-(r.left+r.width/2),dy=cy-(r.top+r.height/2);let a=Math.atan2(dx,-dy)/(2*Math.PI);if(a<0)a+=1;a*=100;
  let s=0;for(let i=0;i<fr.length;i++){s+=fr[i];if(a<=s)return i}return fr.length-1}
// The box goes beside the ring, at the height of the part it describes, so it never covers the ring.
function ringAnchor(g,fr,i){let s=0;for(let k=0;k<i;k++)s+=fr[k];const a=(s+fr[i]/2)/100*2*Math.PI;const p=svgAt(g,120,120,60+46*Math.sin(a),60-46*Math.cos(a));return {x:g.getBoundingClientRect().right-6,y:p.y}}
function ringMark(g,i){g.querySelectorAll('.seg').forEach((s,k)=>{s.classList.toggle('hot',k===i);s.classList.toggle('dim',i>=0&&k!==i)})}
// Columns: the one under the pointer lit, the others dimmed.
function colMark(g,i){g.querySelectorAll('.col').forEach((s,k)=>{s.classList.toggle('hot',k===i);s.classList.toggle('dim',i>=0&&k!==i)})}
// A week's movements in Transactions (Monday to Sunday), a day's, or a rail's.
const plusDays=(day,n)=>{const d=new Date(String(day).slice(0,10)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const txWeek=(w)=>'#/transactions?from='+w+'&to='+plusDays(w,6);
const txDay=(d)=>'#/transactions?from='+String(d).slice(0,10)+'&to='+String(d).slice(0,10);
const TX_RAILS=['airwallex_transfer','airwallex_fx','airwallex_card','airwallex_airi','airwallex_receipt','metal','metal_clearing'];
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
    // The whole column answers the pointer, from the top of the plot to its axis.
    const col=sv('g',{class:'col'},[sv('rect',{x:l+step*k,y:tp,width:step,height:H-tp-b,class:'hit'})]);
    if(w.i)col.append(sv('rect',{x:x-bw-1,y:Y(w.i),width:bw,height:Y(0)-Y(w.i),rx:2.5,class:'b fin'}));
    if(w.o)col.append(sv('rect',{x:x+1,y:Y(w.o),width:bw,height:Y(0)-Y(w.o),rx:2.5,class:'b fout'}));
    if(k%every===0)col.append(sv('text',{x,y:H-8,class:'ax','text-anchor':'middle'},[document.createTextNode(dday(w.week))]));
    g.append(col)});
  const pick=(cx)=>Math.max(0,Math.min(ws.length-1,Math.floor((svgX(g,W,cx)-l)/step)));
  const lg=el('ul','klegend',[el('li','',[el('i','fin'),t('cs.dash.in')+' · '+amt(D,ws.reduce((n,w)=>n+w.i,0))]),el('li','',[el('i','fout'),t('cs.dash.out')+' · '+amt(D,ws.reduce((n,w)=>n+w.o,0))])]);
  // A legend entry lights its series across every week.
  lg.querySelectorAll('li').forEach((li,k)=>{li.classList.add('chleg');li.addEventListener('pointerenter',()=>g.classList.add(k?'only-out':'only-in'));li.addEventListener('pointerleave',()=>g.classList.remove('only-in','only-out'))});
  chartPoint({root:g,n:ws.length,start:ws.length-1,at:(cx)=>pick(cx),anchor:(i)=>{const w=ws[i];return svgAt(g,W,H,l+step*i+step/2,Y(Math.max(w.i,w.o)))},mark:(i)=>colMark(g,i),
    tip:(i)=>{const w=ws[i];return {h:t('cs.ch.week_of',{day:dday(w.week)}),rows:[{k:'fin',l:t('cs.dash.in'),v:amt(D,w.i)},{k:'fout',l:t('cs.dash.out'),v:amt(D,w.o)},{l:t('cs.dash.net'),v:amt(D,w.i-w.o)}]}},
    href:(i)=>ws[i].i||ws[i].o?txWeek(ws[i].week):null});
  const tin=ws.reduce((n,w)=>n+w.i,0),tout=ws.reduce((n,w)=>n+w.o,0);
  chartA11y(g,t('cs.ch.flows_title'),t('cs.ch.flows_desc',{n:ws.length,in:amt(D,tin),out:amt(D,tout)}));
  return el('div','',[el('div','cv',[g]),lg,
    chartTable([t('cs.ch.week'),t('cs.dash.in'),t('cs.dash.out')],ws.map((w)=>[dday(w.week),amt(D,w.i),amt(D,w.o)]))])}
// A ring of parts (up to five named, the rest as "Other"), the total in its middle, a legend with each amount and share.
// Every part answers the pointer (any angle round the ring), the keyboard and its legend entry; href(part) opens its list.
function donut(D,parts,title,centre,href){
  parts=parts.filter((p)=>p.v>0).sort((a,b)=>b.v-a.v);if(!parts.length)return chartEmpty(t('cs.ch.none'));
  if(parts.length>5){const rest=parts.slice(4).reduce((n,p)=>n+p.v,0);parts=parts.slice(0,4).concat([{l:t('cs.ch.other'),v:rest,n:parts.slice(4).reduce((n,p)=>n+(p.n||0),0)}])}
  const tot=parts.reduce((n,p)=>n+p.v,0);const pc=(v)=>Math.round(v/tot*100)+'%';
  const g=sv('svg',{viewBox:'0 0 120 120',width:132,height:132,class:'ring donut'});
  g.append(sv('circle',{cx:60,cy:60,r:46,class:'track'}));let off=0;const fr=[];
  parts.forEach((p,i)=>{const f=p.v/tot*100;fr.push(f);g.append(sv('circle',{cx:60,cy:60,r:46,pathLength:100,class:'seg c'+i,'stroke-dasharray':(Math.max(.4,f-(parts.length>1?1.2:0))).toFixed(2)+' '+(100-f+(parts.length>1?1.2:0)).toFixed(2),'stroke-dashoffset':(25-off).toFixed(2)}));off+=f});
  g.append(sv('text',{x:60,y:58,class:'rt sm','text-anchor':'middle'},[document.createTextNode(kfmt(tot))]),sv('text',{x:60,y:76,class:'rs','text-anchor':'middle'},[document.createTextNode(centre)]));
  chartA11y(g,title,parts.map((p)=>p.l+' '+amt(D,p.v)+' ('+pc(p.v)+')').join(', '));
  const items=parts.map((p,i)=>el('li','',[el('i','c'+i),el('span','',p.l),el('b','num',pc(p.v)),el('small','num',amt(D,p.v)+(p.n?' · '+t(p.n===1?'cs.dash.n_payments_1':'cs.dash.n_payments',{n:p.n}):''))]));
  const lg=el('ul','rlegend clegend',items);
  chartPoint({root:g,n:parts.length,side:true,at:(x,y)=>ringPick(g,fr,x,y),anchor:(i)=>ringAnchor(g,fr,i),mark:(i)=>ringMark(g,i),legend:items,
    tip:(i)=>{const p=parts[i];return {h:p.l,rows:[{k:'c'+i,l:t('cs.ch.amount'),v:amt(D,p.v)},{l:t('cs.ch.share'),v:pc(p.v)},p.n?{l:t('cs.ch.payments'),v:String(p.n)}:null].filter(Boolean)}},
    href:href?(i)=>href(parts[i]):null});
  return el('div','',[el('div','ringwrap',[g,el('div','',[lg])]),chartTable([title,t('cs.ch.amount'),t('cs.ch.share')],parts.map((p)=>[p.l,amt(D,p.v),pc(p.v)]))])}
// Spend by rail: what moved out, by the rail it moved on.
function railsChart(D){return donut(D,(D.rails||[]).map((r)=>({l:railWords(r.rail),v:toCents(r.amount),n:r.count,rail:r.rail})),t('cs.ch.rails_title'),t('cs.ch.out_word'),(p)=>TX_RAILS.includes(p.rail)?'#/transactions?rail='+p.rail:null)}
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
  return el('div','',[segbar(b.map((v,k)=>({l:t(lab[k]),v,t:cur(main[0])+' '+cents(v)})),t('cs.due.title'),()=>'#/invoices?f=open'),Object.keys(per).length>1?el('p','fine',t('cs.due.other_cur')):null])}
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
:root { --c0: var(--accent); --c1: #0f9a86; --c2: #d08a1c; --c3: #d4537a; --c4: #8a94a3; --fin: #12a150; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --c1: #2cc9b0; --c2: #f0b24e; --c3: #f17fa0; --c4: #7f8a99; --fin: #3ccf7f; } }
:root[data-theme="dark"] { --c1: #2cc9b0; --c2: #f0b24e; --c3: #f17fa0; --c4: #7f8a99; --fin: #3ccf7f; }
svg.ring .seg.c0 { stroke: var(--c0); } svg.ring .seg.c1 { stroke: var(--c1); } svg.ring .seg.c2 { stroke: var(--c2); } svg.ring .seg.c3 { stroke: var(--c3); } svg.ring .seg.c4 { stroke: var(--c4); }
.clegend li i.c0 { background: var(--c0); } .clegend li i.c1 { background: var(--c1); } .clegend li i.c2 { background: var(--c2); } .clegend li i.c3 { background: var(--c3); } .clegend li i.c4 { background: var(--c4); }
svg.ring .rt.sm { font-size: 21px; }
svg.chart .b.fin { fill: var(--fin); } svg.chart .b.fout { fill: var(--accent); }
.klegend i.fin { background: var(--fin); } .klegend i.fout { background: var(--accent); }
.dcard { position: relative; }
.chtip { position: absolute; left: 0; top: 0; z-index: 20; min-width: 150px; max-width: min(280px, calc(100% - 4px)); padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 10px 24px -10px rgba(16,24,40,.28); font-size: 12.5px; line-height: 1.35;
  pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .12s ease; display: grid; gap: 3px; }
.chtip.on { opacity: 1; visibility: visible; }
.chtip .cth { font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 1px; }
.chtip .ctr { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; column-gap: 7px; }
.chtip .ctr .ctl { color: var(--muted); overflow-wrap: anywhere; } .chtip .ctr b { font-weight: 650; text-align: right; white-space: nowrap; }
.chtip .sw { width: 8px; height: 8px; border-radius: 2px; background: transparent; }
.chtip .sw.fin { background: var(--fin); } .chtip .sw.fout, .chtip .sw.cash, .chtip .sw.cfo, .chtip .sw.bar { background: var(--accent); }
.chtip .sw.alone { background: color-mix(in srgb, var(--accent) 30%, var(--surface)); }
.chtip .sw.c0 { background: var(--c0); } .chtip .sw.c1 { background: var(--c1); } .chtip .sw.c2 { background: var(--c2); } .chtip .sw.c3 { background: var(--c3); } .chtip .sw.c4 { background: var(--c4); }
.chtip .sw.r0 { background: var(--ok); } .chtip .sw.r1 { background: var(--accent); } .chtip .sw.r2 { background: #d08a1c; } .chtip .sw.r3 { background: #98a1ae; } .chtip .sw.r4 { background: var(--bad); }
.chtip .sw.s0 { background: var(--accent); } .chtip .sw.s1 { background: color-mix(in srgb, var(--accent) 64%, var(--surface)); } .chtip .sw.s2 { background: color-mix(in srgb, var(--accent) 38%, var(--surface)); } .chtip .sw.s3 { background: color-mix(in srgb, var(--accent) 18%, var(--surface)); }
.chtip .cgo { margin-top: 3px; padding-top: 5px; border-top: 1px solid var(--border); color: var(--accent); font-size: 11.5px; font-weight: 600; }
.chsay { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.chi { outline: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.chi.chlink { cursor: pointer; }
.chi:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 6px; }
svg.chart .xh { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0; }
svg.chart .xd { fill: var(--surface); stroke: var(--accent); stroke-width: 2.5; opacity: 0; }
svg.chart.xon .xh, svg.chart.xon .xd { opacity: 1; }
svg.chart .col .b, svg.ring .seg, .seg span, .sbars li { transition: opacity .12s ease; }
svg.chart .col.hot .hit { fill: color-mix(in srgb, var(--text) 5%, transparent); }
svg.chart .col.dim .b, svg.chart .col.dim .val { opacity: .4; }
svg.ring .seg.dim { opacity: .35; } svg.ring .seg.hot { stroke-width: 16; }
.seghit { padding: 9px 0; margin: -9px 0; }
.seg span.dim { opacity: .4; }
.sbars.chi li { cursor: inherit; } .sbars li.dim { opacity: .5; } .sbars li.hot .sl span { color: var(--accent); }
svg.chart.flows.only-in .b.fout, svg.chart.flows.only-out .b.fin { opacity: .2; }
.chleg { cursor: pointer; border-radius: 6px; transition: background .12s; } .chleg.hot, .chleg:hover { background: var(--sunken); }
.rlegend li.chleg { padding: 2px 4px; margin: -2px -4px; }
ul.legend li.chleg { padding: 1px 4px; margin: -1px -4px; }
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
@media (min-width: 980px) { .dgrid.g3 { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { details.ctable > summary::before, .chtip, svg.chart .col .b, svg.ring .seg, .seg span, .sbars li, .chleg { transition: none; } }
`;
