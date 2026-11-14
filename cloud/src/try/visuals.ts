// The visual layer of /try (14 Nov, the owner: "far more visuals, animations and graphs"). Kept apart from the
// screens (cloud/src/tryPage.ts draws them; this file only adds to what is on the page), so the other work on /try
// can change the screens without touching this:
// - A money-flow strip on the work, approve, pay and books screens: Invoice → reads → checks → your passkey → the bank
//   → booked. Its state is the screen's own: a stage is done when the screen shows it done (the checks' answer, the
//   paid stamp), the next one glows, and a refusal (the checks holding the invoice, a changed term refused at the
//   signature) turns the line red at that stage. Nothing is assumed.
// - Three charts on the company screen (the finish), inline SVG, no library, each from this test company's own records:
//   the stand-in bank's money from the start to now (GET /v1/engine for now, the ledger's bank lines for what moved),
//   spend by expense account (the ledger's debits on expense accounts), and the invoices' checks (GET
//   /v1/engine/invoices: passed or held). A chart whose reads fail or are empty is not drawn; nothing is made up.
// - Micro-animations: the charts' totals count up, a check mark draws on each passed stage, cards fade in. The pay
//   screen's refusal already shakes (tryPage). All of it off under prefers-reduced-motion.
// Its own module script under the page's nonce; it reads the session from the page's own state in sessionStorage
// ("purser.try") and only ever makes GET requests. Every value from the API goes on the page as text (textContent or
// an SVG text node), never as HTML. The words are here, outside /try's word budget (they are figures and labels).
import { LEDGER_ACCOUNTS, accountType } from "../../../src/ledger/accounts.js";

export const VIS = {
  flow: { invoice: "Invoice", readClaude: "Claude reads", readCode: "Code reads", checks: "Purser checks", passkey: "Your passkey", bankAwx: "Airwallex (sandbox)", bankTest: "Test bank", booked: "Booked", label: "Where the money is" },
  charts: "Your test company in numbers",
  source: "From this test company's own records. Test money.",
  cash: { head: "Bank, start to now", start: "Start", paid: "Paid", fees: "Fees", in: "In", now: "Now", note: "Now is the stand-in bank's balance; each step is the ledger's bank lines." },
  spend: { head: "Spend by account", note: "Debits on expense accounts in the ledger." },
  checks: { head: "Invoices checked", passed: "Passed", held: "Held", of: "invoices" },
} as const;

/** Expense accounts' names, by number (the chart in src/ledger/accounts.ts): the bar chart's labels. */
const EXPENSE_NAMES: Record<string, string> = Object.fromEntries(Object.entries(LEDGER_ACCOUNTS).filter(([a]) => accountType(a) === "expense"));

export const VIS_CSS = `
/* The visual layer (cloud/src/try/visuals.ts). */
.vflow { display: flex; margin: 0 0 14px; padding: 0; list-style: none; counter-reset: v; }
.vflow li { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11.5px; line-height: 1.2; color: var(--faint); text-align: center; }
.vflow li::before { content: ""; position: absolute; top: 11px; left: -50%; width: 100%; height: 2px; background: var(--border); z-index: 0; }
.vflow li:first-child::before { display: none; }
.vflow li.done::before, .vflow li.cur::before { background: var(--ok); }
.vflow li.bad::before { background: var(--bad); }
.vflow .vd { position: relative; z-index: 1; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); border: 2px solid var(--border); }
.vflow .vd svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.vflow li.done { color: var(--muted); } .vflow li.done .vd { border-color: var(--ok); background: var(--ok); color: #fff; }
.vflow li.done .vd path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: vdraw .45s ease-out forwards; }
.vflow li.cur { color: var(--text); font-weight: 650; } .vflow li.cur .vd { border-color: var(--accent); animation: vglow 1.4s ease-in-out infinite alternate; }
.vflow li.cur .vd::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.vflow li.bad { color: var(--bad); font-weight: 650; } .vflow li.bad .vd { border-color: var(--bad); background: var(--bad); color: #fff; }
.vflow li.after { opacity: .55; }
@media (max-width: 520px) { .vflow li { font-size: 10px; } .vflow .vl { overflow-wrap: anywhere; } }
.vis-charts { margin-top: 16px; animation: vfade .4s ease-out both; }
.vis-charts h2 { margin: 0 0 2px; font-size: 17px; }
.vis-charts > p { margin: 0 0 12px; font-size: 13px; color: var(--muted); }
.vis-grid { display: grid; gap: 14px; }
/* Two charts side by side where /try's column allows (it is about 660 px wide on a laptop); the donut on its own row. */
@media (min-width: 700px) { .vis-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .vis-c:has(svg.dn) { grid-column: 1 / -1; } }
.vis-c { margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); animation: vfade .4s ease-out both; }
.vis-c:nth-child(2) { animation-delay: .1s; } .vis-c:nth-child(3) { animation-delay: .2s; }
.vis-c h3 { margin: 0 0 6px; font-size: 14px; }
.vis-c figcaption { margin-top: 6px; font-size: 12px; color: var(--faint); }
.vis-c svg { display: block; width: 100%; height: auto; overflow: visible; font-variant-numeric: tabular-nums; }
.vis-c text { fill: var(--muted); font-size: 11px; font-family: inherit; }
.vis-c text.v { fill: var(--text); font-weight: 650; font-size: 10.5px; }
.vis-c svg.dn { max-width: 150px; margin: 0 auto; }
.vis-c .b { fill: var(--accent); } .vis-c .b.neg { fill: var(--bad); } .vis-c .b.pos { fill: var(--ok); } .vis-c .b.base { fill: var(--muted); }
.vis-c .k { stroke: var(--border); stroke-dasharray: 3 3; }
.vis-c .bar, .vis-c .seg { transition: opacity .15s; } .vis-c svg:hover .bar, .vis-c svg:hover .seg { opacity: .55; } .vis-c svg .bar:hover, .vis-c svg .seg:hover { opacity: 1; }
.vis-c .bar rect { transform-box: fill-box; transform-origin: bottom; animation: vgrow .6s cubic-bezier(.2,.7,.2,1) both; }
.vis-c .hb rect { transform-origin: left; animation-name: vgrowx; }
.vis-c .seg { fill: none; stroke-width: 18; } .vis-c .seg.ok { stroke: var(--ok); } .vis-c .seg.held { stroke: var(--bad); } .vis-c .seg.none { stroke: var(--sunken); }
.vis-c .dl { list-style: none; margin: 8px 0 0; padding: 0; display: flex; gap: 14px; font-size: 13px; }
.vis-c .dl i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; } .vis-c .dl .ok i { background: var(--ok); } .vis-c .dl .held i { background: var(--bad); }
.screen:not(.start) .card, .screen .blk { animation: vfade .35s ease-out both; }
.screen .bal.ok .i > *, .did .dic .i > * { stroke-dasharray: 60; stroke-dashoffset: 60; animation: vdraw .6s ease-out .2s forwards; }
@keyframes vdraw { to { stroke-dashoffset: 0; } }
@keyframes vglow { from { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); } to { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 30%, transparent); } }
@keyframes vfade { from { opacity: .01; transform: translateY(6px); } }
@keyframes vgrow { from { transform: scaleY(.02); } }
@keyframes vgrowx { from { transform: scaleX(.02); } }
@media (prefers-reduced-motion: reduce) {
  .vflow *, .vis-charts, .vis-c, .vis-c *, .screen:not(.start) .card, .screen .blk, .screen .bal.ok .i > *, .did .dic .i > * { animation: none !important; transition: none !important; stroke-dashoffset: 0 !important; }
}`;

const SCRIPT = String.raw`
const V=__VIS__,EXP=__EXP__;
const NS='http://www.w3.org/2000/svg';
const calm=matchMedia('(prefers-reduced-motion: reduce)');
const st=()=>{try{return JSON.parse(sessionStorage.getItem('purser.try')||'null')||{}}catch(e){return {}}};
const h=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[]))if(k!=null)e.append(k);return e};
const s=(tag,at,kids)=>{const e=document.createElementNS(NS,tag);for(const k in at)e.setAttribute(k,String(at[k]));for(const k of [].concat(kids??[]))if(k!=null)e.append(k);return e};
const tip=(words)=>s('title',{},words);
// GET only, with the page's own session; a failed read is null (the chart is then not drawn).
async function get(path){const t=st().session;if(!t)return null;try{const r=await fetch(path,{headers:{authorization:'Bearer '+t}});return r.ok?await r.json():null}catch(e){return null}}
async function all(path){let out=[],c=null;for(let n=0;n<20;n++){const j=await get(path+'?limit=200'+(c?'&cursor='+encodeURIComponent(c):''));if(!j||!Array.isArray(j.items))return null;out=out.concat(j.items);c=typeof j.next_cursor==='string'&&j.next_cursor?j.next_cursor:null;if(!c)break}return out}
const cents=(x)=>Math.round(Number(x)*100);
const num=(c)=>(c/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}),fmt=(cur,c)=>cur+' '+num(c);
// A total that counts up to its value (the exact value at the end; at once under reduced motion).
function countUp(node,c,pre){pre=pre||'';if(calm.matches||!c){node.textContent=pre+num(c);return}const t0=performance.now(),d=700;
  const f=(t)=>{const k=Math.min(1,(t-t0)/d),e=1-Math.pow(1-k,3);node.textContent=pre+num(Math.round(c*e));if(k<1)requestAnimationFrame(f)};requestAnimationFrame(f)}

// The money-flow strip: the screen's own state, read from what it shows.
const CHECK='M5 12.5 10 17 19 7';
function flowOf(name,box){
  // [done up to (exclusive), current, red]
  if(name==='work'){const b=box.querySelector('.result .big');if(!b)return [1,1,-1];if(b.classList.contains('bad'))return [2,-1,2];return [3,3,-1]}
  if(name==='approve')return [3,3,-1];
  if(name==='pay'){if(box.querySelector('.refusal'))return [3,-1,3];return [3,3,-1]}
  if(name==='books'){if(box.querySelector('.paidstamp'))return [6,-1,-1];return [4,-1,4]}
  return null;
}
function flow(name,box){
  const at=flowOf(name,box);if(!at)return;const [done,cur,bad]=at,o=st(),m=o.mode||{},awx=m.rail_awx==='on'||!!o.awx;
  const names=[V.flow.invoice,m.claude==='live'?V.flow.readClaude:V.flow.readCode,V.flow.checks,V.flow.passkey,awx?V.flow.bankAwx:V.flow.bankTest,V.flow.booked];
  const key=done+'/'+cur+'/'+bad;let ol=box.querySelector(':scope > .vflow');
  if(ol&&ol.dataset.k===key)return;
  const n=h('ol','vflow');n.dataset.k=key;n.setAttribute('aria-label',V.flow.label);
  names.forEach((w,i)=>{const c=i===bad?'bad':i<done?'done':i===cur?'cur':bad>=0&&i>bad?'after':'';
    const dot=h('span','vd',c==='done'?s('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},s('path',{d:CHECK})):c==='bad'?s('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},s('path',{d:'M7 7l10 10M17 7 7 17'})):null);
    const li=h('li',c,[dot,h('span','vl',w)]);if(c==='cur')li.setAttribute('aria-current','step');n.append(li)});
  if(ol)ol.replaceWith(n);else box.prepend(n);
}

// The charts on the company screen.
function chart(head,svg,cap,extra){return h('figure','vis-c',[h('h3','',head),svg,extra||null,h('figcaption','',cap)])}
function cashChart(cur,steps){
  // A waterfall: Start, then each movement from the running level, then Now.
  const W=300,H=170,top=22,base=H-24,max=Math.max(...steps.map((x)=>x.lvl),...steps.map((x)=>x.from||0),1),y=(c)=>base-(base-top)*c/max,bw=W/steps.length;
  const g=s('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':V.cash.head});
  steps.forEach((x,i)=>{const a=x.from==null?0:x.from,b=x.lvl,y0=y(Math.max(a,b)),y1=y(Math.min(a,b)),X=i*bw+bw*.18,w=bw*.64;
    const val=s('text',{x:X+w/2,y:y0-6,'text-anchor':'middle',class:'v'});
    const bar=s('g',{class:'bar'},[tip(x.label+': '+(x.sign||'')+fmt(cur,x.amt)),s('rect',{x:X,y:y0,width:w,height:Math.max(2,y1-y0),rx:3,class:'b '+x.cls}),val,s('text',{x:X+w/2,y:H-8,'text-anchor':'middle'},x.label)]);
    g.append(bar);countUp(val,x.amt,x.sign);
    if(i<steps.length-1)g.append(s('line',{x1:X+w,x2:X+bw,y1:y(b),y2:y(b),class:'k'}))});
  return g;
}
function spendChart(cur,rows){
  const W=300,rh=30,H=rows.length*rh,max=Math.max(...rows.map((r)=>r.c),1);
  const g=s('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':V.spend.head});
  rows.forEach((r,i)=>{const w=Math.max(3,(W-110)*r.c/max),val=s('text',{x:w+6,y:i*rh+27,class:'v'});
    g.append(s('g',{class:'bar hb'},[tip(r.a+' '+r.n+': '+fmt(cur,r.c)),s('text',{x:0,y:i*rh+11},r.a+' '+r.n),s('rect',{x:0,y:i*rh+16,width:w,height:12,rx:3,class:'b'}),val]));countUp(val,r.c)});
  return g;
}
function checksChart(ok,held){
  const n=ok+held,R=42,C=2*Math.PI*R,g=s('svg',{viewBox:'0 0 120 120',role:'img','aria-label':V.checks.head,class:'dn'});
  let off=0;for(const [k,v,w] of [['ok',ok,V.checks.passed],['held',held,V.checks.held]]){if(!v)continue;const len=C*v/n;
    g.append(s('circle',{cx:60,cy:60,r:R,class:'seg '+k,'stroke-dasharray':len+' '+(C-len),'stroke-dashoffset':-off,transform:'rotate(-90 60 60)'},tip(w+': '+v+' / '+n)));off+=len}
  g.append(s('text',{x:60,y:62,'text-anchor':'middle',class:'v'},String(n)),s('text',{x:60,y:78,'text-anchor':'middle'},V.checks.of));
  return g;
}
async function charts(box){
  if(box.querySelector('.vis-charts'))return;
  const sec=h('section','card vis-charts',[h('h2','',V.charts),h('p','',V.source)]),grid=h('div','vis-grid');sec.append(grid);sec.hidden=true;
  const anchor=box.querySelector('.did');if(anchor)anchor.after(sec);else box.append(sec);
  const [eng,es,inv]=await Promise.all([get('/v1/engine'),all('/v1/ledger/entries'),get('/v1/engine/invoices')]);
  if(!sec.isConnected)return;
  const lines=(es||[]).flatMap((e)=>Array.isArray(e.lines)?e.lines.map((l)=>Object.assign({e},l)):[]);
  // Bank: the currency the payments went out in; now from the stand-in bank, what moved from the ledger's bank lines.
  const bank=lines.filter((l)=>String(l.account||'').startsWith('12'));
  // The supplier payments' currency: a bank credit in an entry that debits payables (2100); else the first bank credit.
  const cur=(bank.find((l)=>l.credit_cents&&(l.e.lines||[]).some((x)=>String(x.account)==='2100'&&x.debit_cents))||bank.find((l)=>l.credit_cents)||{}).currency;
  const nowC=eng&&eng.balances&&cur&&eng.balances[cur]!=null?cents(eng.balances[cur]):null;
  if(es&&cur&&nowC!=null&&isFinite(nowC)){
    let paid=0,fees=0,inn=0;
    for(const l of bank){if(l.currency!==cur)continue;const fee=(l.e.lines||[]).some((x)=>EXP[String(x.account)]&&x.debit_cents);
      if(l.credit_cents){if(fee)fees+=l.credit_cents;else paid+=l.credit_cents}if(l.debit_cents)inn+=l.debit_cents}
    const start=nowC+paid+fees-inn;let lvl=start;
    // Where the ledger holds the money coming in too, Start is zero and is left out: the chart starts at In.
    const steps=start?[{label:V.cash.start,amt:start,lvl:start,cls:'base'}]:[];
    if(inn){steps.push({label:V.cash.in,amt:inn,from:lvl,lvl:lvl+inn,cls:'pos',sign:'+ '});lvl+=inn}
    if(paid){steps.push({label:V.cash.paid,amt:paid,from:lvl,lvl:lvl-paid,cls:'neg',sign:'− '});lvl-=paid}
    if(fees){steps.push({label:V.cash.fees,amt:fees,from:lvl,lvl:lvl-fees,cls:'neg',sign:'− '});lvl-=fees}
    steps.push({label:V.cash.now,amt:nowC,lvl:nowC,cls:''});
    if(steps.length>2)grid.append(chart(V.cash.head+' ('+cur+')',cashChart(cur,steps),V.cash.note));
  }
  // Spend: debits on expense accounts, by account, largest first.
  const by={};for(const l of lines){const a=String(l.account||'');if(!EXP[a]||!l.debit_cents||(cur&&l.currency!==cur))continue;by[a]=(by[a]||0)+l.debit_cents}
  const rows=Object.entries(by).map(([a,c])=>({a,n:EXP[a],c})).sort((p,q)=>q.c-p.c).slice(0,6);
  if(rows.length&&cur)grid.append(chart(V.spend.head+' ('+cur+')',spendChart(cur,rows),V.spend.note));
  // Checks: each invoice passed (ready, waiting for you, paid) or held.
  const items=inv&&Array.isArray(inv.items)?inv.items:[];
  const ok=items.filter((i)=>['ready','waiting_cfo','paid'].includes(i&&i.status)).length,held=items.length-ok;
  if(items.length)grid.append(chart(V.checks.head,checksChart(ok,held),'',h('ul','dl',[h('li','ok',[h('i'),V.checks.passed+' '+ok]),h('li','held',[h('i'),V.checks.held+' '+held])])));
  if(grid.children.length)sec.hidden=false;else sec.remove();
}

// Watch the page: each new screen, and what a screen adds (the checks' answer, the paid stamp, a refusal).
const main=document.getElementById('main');let q=false;
function look(){q=false;const box=main&&main.querySelector(':scope > .screen');if(!box)return;const name=[...box.classList].find((c)=>c!=='screen');
  flow(name,box);if(name==='company')charts(box)}
if(main)new MutationObserver(()=>{if(!q){q=true;requestAnimationFrame(look)}}).observe(main,{childList:true,subtree:true});
`;

/** The visual layer's module script, its words and the expense accounts' names put in as JSON. */
export function visScript(json: (v: unknown) => string): string {
  return SCRIPT.replace("__VIS__", () => json(VIS)).replace("__EXP__", () => json(EXPENSE_NAMES));
}
