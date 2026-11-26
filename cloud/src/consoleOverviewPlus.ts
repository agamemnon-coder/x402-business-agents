// Purser Cloud's Overview, more to read (Max, 21 Nov: "too simple"): two more charts from the company's own records,
// each with its figures on hover, focus and touch like every chart here (consoleCharts.ts chartPoint). The site's wave
// no longer runs behind the console (26 Nov: a product, not a landing page).
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

import { SITE_ORIGIN } from "./siteHeader.js";
import { connectionsCatalogue } from "./connections.js";
import { globeScript } from "../../src/ui/globe.js";

/**
 * The stack shown round the Overview's globe (21 Nov, Max): ONLY the connections with a recorded run, each a green ping.
 * The ids are the catalogue's (cloud/src/connections.ts); the full name and the kind of run come from it, so a label is
 * never stronger than the catalogue's. A connection here without a recorded run (or a live label) throws at build.
 */
const STACK: readonly (readonly [id: string, label: string, name?: string])[] = [
  ["airwallex", "Airwallex"], ["alta", "Alta", "Alta (formerly Metal)"], ["visa-airi", "Visa · Airi"], ["claude", "Claude"],
  ["t0", "T:0"], ["moneybird", "Moneybird"], ["mcp", "Purser MCP", "Purser MCP server"],
];
export interface StackItem { id: string; label: string; name: string; run: "live" | "sandbox" | "testnet" }
export function overviewStack(): StackItem[] {
  const c = connectionsCatalogue("");
  const all = [...c.connections, ...c.money];
  return STACK.map(([id, label, name]) => {
    const x = all.find((y) => y.id === id);
    if (!x || !(x.record || x.kind === "live")) throw new Error(`overview stack: ${id} has no recorded run in the catalogue`);
    return { id, label, name: name ?? x.name.replace(/ \((API|outside ledger)\)$/, ""), run: x.kind === "live" ? "live" : x.kind === "testnet" ? "testnet" : "sandbox" };
  });
}

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
// --- The Overview, laid out on twelve columns (Max, 21 Nov: "make purser cloud like this ... no dead zones, everything
// in a clean order"); 26 Nov, the console redesign (Max: "enterprise grade"): the page's own header (later that day, a
// small connected Earth in it for the demo company, and the purple glow back behind it), four
// figures (cash position, waiting for the CFO, paid this month, agent spend against limits), the approvals queue beside
// how to approve, the cash beside the agents, what happened beside the connected rails, the flow, then the two charts. Every figure is the
// records'; nothing here approves or pays: approval is the CFO's, on the phone, over the exact terms.
const OV_SITE=` + JSON.stringify(SITE_ORIGIN) + String.raw`;
function ovSpark(vals,cls){
  if(!vals||vals.length<2)return null;const W=120,H=36,mn=Math.min(...vals),mx=Math.max(...vals),r=(mx-mn)||1;
  const pts=vals.map((v,i)=>(i/(vals.length-1)*W).toFixed(1)+','+(H-3-(v-mn)/r*(H-6)).toFixed(1));
  return sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'ovspark '+(cls||''),'aria-hidden':'true'},[sv('polyline',{points:pts.join(' '),fill:'none'})])}
function ovKpi(o){const a=el('a','card ovk rise'+(o.hot?' hot':''),[el('div','ovk-top',[el('span','ovk-i',ic(o.icon)),el('span','ovk-l',o.label),o.spark||null]),el('div','ovk-b',[el('b','num ovk-v',o.value),o.meter||null,o.sub?el('span','ovk-s'+(o.tone?' '+o.tone:''),o.sub):null])]);a.href=o.href;return a}
// Relative time against the demo world's own day (its records are dated in it), or now for a real company.
function ovAgo(at,now){const s=Math.max(0,(now-Date.parse(at))/1000);if(s<3600)return t('cs.ov2.ago_m',{n:Math.max(1,Math.round(s/60))});if(s<86400)return t('cs.ov2.ago_h',{n:Math.round(s/3600)});return t('cs.ov2.ago_d',{n:Math.round(s/86400)})}
// The connected rails (26 Nov, the console redesign): only what is connected with a recorded run (OV_STACK, from the
// connections catalogue, cloud/src/connections.ts), one row each, the product's own mark on a white tile, never
// recoloured (Visa and T:0 as text), its kind of run as the catalogue says it; nothing planned. Each says so to a
// screen reader; the four with a proof page on the site link to it.
const OV_STACK=` + JSON.stringify(overviewStack()) + String.raw`;
const OV_PROOF={airwallex:'/airwallex',alta:'/alta','visa-airi':'/visa',claude:'/claude'};
function ovRails(){
  const L=(k)=>{const x=typeof BRAND_LOGOS!=='undefined'&&BRAND_LOGOS[k];if(!x)return null;const i=el('img','');i.src=x.uri;i.alt='';i.decoding='async';return i};
  const MK={airwallex:()=>el('span','ovs-k wide',[L('airwallex')||el('b','','Airwallex')]),'visa-airi':()=>el('span','ovs-k visa',[el('b','','VISA')]),t0:()=>el('span','ovs-k txt',[el('b','','T:0')])};
  const item=(s)=>{const name=s.run==='live'?t('cs.ov2.stack_live',{name:s.name}):t('cs.ov2.stack_run',{name:s.name,run:s.run});
    const k=(MK[s.id]||(()=>el('span','ovs-k',[L(s.id)||el('b','',s.label.charAt(0))])))();
    const v=el('span','ovs-v',[k,el('b','ovs-l',s.label),el('span','ovs-run '+s.run,s.run==='live'?sw('live'):t('cs.ov2.'+s.run)),el('i','ovs-dot')]);v.setAttribute('aria-hidden','true');
    const h=OV_PROOF[s.id];const inner=h?Object.assign(el('a','',[v,el('span','vh',name)]),{href:OV_SITE+h,target:'_blank',rel:'noopener'}):el('span','',[v,el('span','vh',name)]);
    const li=el('li','ovs-m',[inner]);li.title=name;li.dataset.id=s.id;return li};
  const list=el('ul','ovs-ms',OV_STACK.map(item));list.setAttribute('aria-label',t('cs.ov2.globe'));
  return el('section','card dcard rise ov-par',[el('div','dh',[el('h2','',sw('rails_h')),el('p','',t('cs.ov2.stack_n',{n:OV_STACK.length})+' · '+t('cs.ov2.stack_k'))]),list])}
// The small "connected" picture in the header (26 Nov, Max: "the globe small like a small connected thing"): the sign-in's
// Earth (src/ui/globe.ts), small, the demo company in Amsterdam pulsing green, a thin curve from it to four of the
// connections above, each row with its dot in the run's colour (live green; sandbox or testnet amber, the console's
// colour for test money). Only for the demo company: its place is the repository's (the test world's payer address);
// a real company's place is not in the records, so it gets no pin. The states are OV_STACK's, nothing more.
const OV_NET=['airwallex','claude','visa-airi','alta'];
function ovNet(){
  const rows=OV_NET.map((id)=>OV_STACK.find((s)=>s.id===id)).filter(Boolean).map((s)=>{const run=s.run==='live'?sw('live'):t('cs.ov2.'+s.run);
    const li=el('li','ovn-r '+s.run,[el('i','ovn-d'),el('b','',s.label),el('span','ovn-k',run)]);li.title=s.run==='live'?t('cs.ov2.stack_live',{name:s.name}):t('cs.ov2.stack_run',{name:s.name,run:s.run});return li});
  const c=el('canvas','ovn-c');c.setAttribute('aria-hidden','true');
  const a=el('a','card ovn',[c,el('div','ovn-b',[el('div','ovn-h',[el('b','',[el('i','ovn-p'),sw('net_h')]),el('span','',sw('net_sub'))]),el('ul','',rows)])]);
  a.href='#/connections';a.title=sw('net_to');return a}
function ovGlobe(){` + globeScript({ selector: "a.ovn canvas.ovn-c", avoid: ".ovn-b", maxR: 52, places: [[4.9, 52.37, "", true]], view: [-6, 34, 12], links: ".ovn-d", labels: false }) + String.raw`}
async function overviewNext(){
  title(t('cs.nav.overview'));
  const soft=(p)=>api(p).catch((e)=>{if(e instanceof Expired)throw e;return null});
  const [m,all,D,BK,AG]=await Promise.all([me(),api('/v1/invoices?limit=200'),soft('/v1/dashboard'),soft('/v1/books/bookings'),soft('/v1/agents')]);shell();
  const items=all.items||[],C=(D&&D.currency)||'EUR',now=m.demo&&m.demo.as_of?Date.parse(m.demo.as_of):Date.now();
  const wait=items.filter((i)=>i.status==='waiting_cfo'),todo=items.filter((i)=>['ready','needs_review','needs_vendor'].includes(i.status));
  const open=items.filter((i)=>!['paid','rejected','blocked'].includes(i.status));
  const sumOf=(xs)=>xs.reduce((n,i)=>n+toCents(i.total),0);
  // The header: the page's name, the company and the day its figures stand at (the demo's own end, else today).
  const hero=head(t('cs.nav.overview'),sw('as_of',{name:m.tenant.name||'',day:dday(new Date(now).toISOString())}),m.demo?[ovNet()]:null);hero.classList.add('ov-head');
  // Four figures, each from the records; a change or a meter only where the records hold what it compares with.
  const days=(D&&D.cash)||[],nets=days.map((d)=>toCents(d.net)),last=nets[nets.length-1],prev=nets.length>7?nets[nets.length-8]:null;
  const delta=prev!==null&&prev!==0?(last-prev)/Math.abs(prev)*100:null;
  const sup=new Set(open.map((i)=>i.vendor)).size,dups=(D&&D.invoices&&D.invoices.duplicates_stopped)||0;
  // Paid this month: the invoices paid in the month the figures stand at, beside the month before.
  const mo=new Date(now).toISOString().slice(0,7),pm=new Date(Date.UTC(+mo.slice(0,4),+mo.slice(5,7)-2,15)).toISOString().slice(0,7);
  const paidIn=(k)=>items.filter((i)=>i.status==='paid'&&String(i.paid_at||'').slice(0,7)===k),pd=paidIn(mo),pp=paidIn(pm);
  const C0=(pd[0]||pp[0]||{}).currency||C;
  // The agents' cards: what each spent this month against its monthly limit, in the cards' currency.
  const cards=((AG&&AG.agents)||[]).map((a)=>a.card).filter((c)=>c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined);
  const cc=cards.filter((c)=>c.currency===(cards[0]||{}).currency),sp=cc.reduce((n,c)=>n+toCents(c.spent_month),0),capc=cc.reduce((n,c)=>n+toCents(c.per_month),0);
  const bar=(v,max)=>{const b=el('span','as-bar ovk-m'+(v>=max?' full':''));const f=el('span','');f.style.width=(max>0?Math.min(100,v/max*100):0).toFixed(1)+'%';b.append(f);return b};
  const kpis=el('div','ov-row ov-k',[
    D&&D.money?ovKpi({icon:'wallet',label:sw('k_cash'),value:cur(C)+' '+cents(toCents(D.money.net)),sub:delta!==null?(delta>=0?'+':'−')+Math.abs(delta).toFixed(1)+'% '+t('cs.ov2.vs7'):D.since?t('cs.dash.net_sub',{date:dday(D.since)}):t('cs.dash.net_none'),tone:delta===null?'':delta>=0?'pos':'neg',spark:ovSpark(nets.slice(-30),'pos'),href:'#/transactions'}):null,
    ovKpi({icon:'scan-face',label:sw('k_wait'),value:String(wait.length),sub:wait.length?cur(wait[0].currency)+' '+cents(sumOf(wait)):t('cs.ov.nothing_waits'),hot:wait.length>0,href:'#/invoices?f=waiting_cfo'}),
    ovKpi({icon:'circle-check',label:sw('k_paid'),value:cur(C0)+' '+cents(sumOf(pd)),sub:sw('k_paid_sub',{n:pd.length,prev:cur(C0)+' '+cents(sumOf(pp)),month:MONTHS[+pm.slice(5,7)-1]}),href:'#/invoices?f=paid'}),
    ovKpi({icon:'bot',label:sw('k_spend'),value:cc.length?cur(cc[0].currency)+' '+cents(sp):'—',sub:cc.length?sw('k_spend_sub',{cap:cur(cc[0].currency)+' '+cents(capc),n:cc.length}):sw('k_spend_none'),meter:cc.length?bar(sp,capc):null,href:'#/agents'})].filter(Boolean));
  // What waits for you, and how it is approved: on the phone, never here.
  const st=(i)=>i.status==='waiting_cfo'?['hot',t('cs.ov2.st_cfo')]:i.status==='needs_vendor'?['warn',t('cs.ov2.st_vendor')]:i.status==='needs_review'?['warn',t('cs.ov2.st_review')]:['ok',t('cs.ov2.st_ready')];
  const chk=(ok,label)=>el('span','ovc '+(ok?'ok':'warn'),[ic(ok?'circle-check':'triangle-alert'),label]);
  const rows=[...wait,...todo].slice(0,5).map((i)=>{const s=st(i);const r=el('a','ov-tr',[el('span','ov-sup',[el('span','ov-si',ic('landmark')),el('span','',[el('b','',i.vendor||''),el('small','mono',i.invoice_no||i.id)])]),el('span','ov-amt',[el('b','num',ma(i.currency,i.total)),i.due_date?el('small','ov-due',t('cs.ov2.t_due')+' '+dday(i.due_date)):null]),
      el('span','ov-chks',[chk(!!i.read_by,t('cs.ov2.c_read')),chk(!(i.findings||[]).length,t('cs.ov2.c_policy')),chk(i.status!=='waiting_cfo',i.status==='waiting_cfo'?t('cs.ov2.c_over'):t('cs.ov2.c_limits'))]),el('span','ov-st '+s[0],s[1])]);r.href='#/invoices/'+encodeURIComponent(i.id);return r});
  const table=cardLink(el('section','card dcard rise ov-inv',[el('div','dh',[el('h2','',[t('cs.ov2.wait_h'),wait.length+todo.length?el('span','ov-n',String(wait.length+todo.length)):null]),el('p','',t('cs.ov2.wait_sub'))]),
    rows.length?el('div','ov-tbl',[el('div','ov-th',[el('span','',t('cs.ov2.t_sup')),el('span','',t('cs.ov2.t_amt')),el('span','',t('cs.ov2.t_chk')),el('span','',t('cs.ov2.t_st'))]),...rows]):chartEmpty(t('cs.ov.nothing_waits')),open.length?Object.assign(el('a','ov-tfoot',[el('span','',t('cs.ov.payables')),el('b','num',cur(open[0].currency)+' '+cents(sumOf(open))),el('span','',t('cs.ov2.n_inv_sup',{n:open.length,s:sup})),ic('chevron-right')]),{href:'#/invoices?f=open'}):null]),'#/invoices',t('cs.ov2.all_inv'));
  const go=el('a','btn primary ov-go',[ic('scan-face'),t('cs.next.faceid_go')]);go.href=wait[0]?'#/invoices/'+encodeURIComponent(wait[0].id):'#/invoices?f=waiting_cfo';
  const approve=el('section','card dcard rise ov-appr',[el('div','ov-ah',[el('span','ov-ai',ic('scan-face')),el('div','',[el('h2','',t('cs.ov2.appr_h')),el('p','',t('cs.ov2.appr_sub'))])]),wait[0]?Object.assign(el('a','ov-aw',[el('span','ov-awl',[ic('clock'),t('status.waiting_cfo')]),el('span','ov-awi',[el('b','',wait[0].vendor||''),el('b','num',ma(wait[0].currency,wait[0].total))]),el('small','mono',wait[0].invoice_no||wait[0].id)]),{href:'#/invoices/'+encodeURIComponent(wait[0].id)}):null,go,el('p','fine',t('cs.ov2.appr_fine'))]);
  // The flow beside the cash, with 7, 30 or 90 days; the whole plot answers on hover.
  const wide=innerWidth>=1280,full=view().clientWidth||960,cw=Math.round(wide?full*7/12-60:full-40);
  const cv=el('div','cv'),seg=el('div','ov-seg');let span=30;
  const draw=()=>{const n=Math.min(span,days.length);cv.replaceChildren(D&&days.length?cashChart(Object.assign({},D,{cash:days.slice(-n)}),cw):chartEmpty(t('cs.dash.net_none')));[...seg.children].forEach((b)=>b.classList.toggle('on',+b.dataset.d===span))};
  [7,30,90].forEach((d)=>{const b=el('button','ov-sb',d+'D');b.type='button';b.dataset.d=String(d);b.onclick=()=>{span=d;draw()};seg.append(b)});draw();
  const cash=el('section','card dcard rise ov-cash',[el('div','dh withseg',[el('div','',[el('h2','',t('cs.dash.cash_title')),el('p','',D&&D.since?t('cs.op.weeks_sub',{cur:cur(C),date:dday(D.since)}):t('cs.dash.net_none'))]),seg]),cv]);
  const flow=payFlow(items,(BK&&BK.bookings)||{},dups,C);
  // What happened, newest first, in the records' words; each row opens the invoice it names, or the agents' decisions.
  const feedHref=(f)=>{const i=items.find((x)=>(x.invoice_no&&f.text.includes(x.invoice_no))||f.text.includes(x.id));return i?'#/invoices/'+encodeURIComponent(i.id):'#/agents'};
  const feed=((D&&D.feed)||[]).slice(0,5);
  const act=cardLink(el('section','card dcard rise ov-act',[el('div','dh',[el('h2','',t('cs.ov2.act_h'))]),feed.length?el('ul','ov-feed',feed.map((f)=>el('li','f-'+f.tone,Object.assign(el('a','',[el('span','ov-fi',ic(f.tone==='ok'?'circle-check':f.tone==='bad'?'octagon-x':f.tone==='wait'?'scan-face':'circle-dot')),el('span','ov-ft',[el('b','',f.who),el('span','',f.text)]),el('time','',ovAgo(f.at,now))]),{href:feedHref(f)})))):chartEmpty(t('cs.agents.no_decisions'))]),'#/agents',sw('to_agents'));
  // The agents at work: each one's spend against its card's limit and its newest decision (consoleShell.ts agentStrip).
  const ags=agentStrip(AG&&AG.agents);
  const agents=cardLink(el('section','card dcard rise ov-ag',[el('div','dh',[el('h2','',sw('ag_h')),el('p','',sw('ag_sub'))]),ags||chartEmpty(t('cs.agents.no_decisions'))]),'#/agents',sw('to_agents'));
  // The sidebar's count of open invoices, from the same records (a mark in CSS: the menu's words stay the page names).
  {const a=document.querySelector('#tabs a[data-tab=invoices]');if(a){if(open.length)a.dataset.n=String(open.length);else delete a.dataset.n}}
  // A company with nothing in it yet: its first steps right under the header (cloud/src/consoleUi.ts startCard).
  const first=!items.length&&!m.demo&&typeof startCard==='function'?startCard(m):null;
  const dash=el('div','dash ov2',[hero,first,kpis,el('div','ov-row ov-r84',[table,approve]),el('div','ov-row ov-r75',[cash,agents]),el('div','ov-row ov-r75',[act,ovRails()]),el('div','ov-row',[flow])]);
  if(D&&days.length)dash.append(el('div','ov-row ov-r66 ov-more',[cardLink(dcard('opw',t('cs.op.weeks_title'),t('cs.op.weeks_sub',{cur:cur(C),date:dday(D.since)}),opWeeks(D,Math.round(wide?full/2-60:full-40))),'#/transactions',sw('to_tx')),cardLink(dcard('ops',t('cs.op.sup_title'),t('cs.op.sup_sub'),opSuppliers()),'#/transactions',sw('to_tx'))]));
  view().replaceChildren(dash,awlOverview());if(m.demo)ovGlobe();
  requestAnimationFrame(()=>{for(const n of view().querySelectorAll('.rise'))n.classList.add('in')});
}
`;

export const OVERVIEW_PLUS_CSS = `
.opsrow { display: block; text-decoration: none; color: inherit; border-radius: 10px; padding: 2px 4px; margin: 0 -4px; transition: background-color .15s ease; }
.opsrow:hover, .opsrow:focus-visible { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.opsrow .sl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.opsup .sbars .sf { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e879f9)); }
/* The Overview on twelve columns: one gutter, rows whose cards share a height, no hole. */
.dash.ov2 { display: grid; gap: 20px; margin: 0 0 28px; position: relative; isolation: isolate; }
/* The purple glow behind the top of the dashboard (Max, 26 Nov: "add the purple glow back"): two soft lights under the
   header and the figures, strongest in the dark. */
.dash.ov2::before { content: ""; position: absolute; z-index: -1; left: 0; right: 0; top: -150px; height: 720px; pointer-events: none;
  background: radial-gradient(38% 44% at 27% 40%, color-mix(in srgb, var(--accent) var(--ovg, 38%), transparent), transparent 72%),
    radial-gradient(24% 34% at 80% 36%, color-mix(in srgb, #e879f9 var(--ovg2, 13%), transparent), transparent 72%); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .dash.ov2 { --ovg: 11%; --ovg2: 6%; } }
:root[data-theme="light"] .dash.ov2 { --ovg: 11%; --ovg2: 6%; }
.ov-k a.ovk { background: color-mix(in srgb, var(--surface) 84%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
/* The header and its small "connected" picture. */
.dash.ov2 > .ov-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px 24px; }
.ov-head > .tools { flex: none; }
a.ovn { position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: center; justify-content: flex-end; width: 380px; min-height: 124px; margin: 0; padding: 12px 16px 12px 0; box-sizing: border-box; text-decoration: none; color: inherit;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), color-mix(in srgb, var(--surface) 88%, transparent)); transition: border-color .15s ease; }
a.ovn:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line, var(--border))); }
canvas.ovn-c { position: absolute; z-index: -1; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.ovn-b { width: 196px; display: grid; gap: 8px; }
.ovn-h { display: grid; gap: 1px; } .ovn-h b { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 650; } .ovn-h span { font-size: 11.5px; color: var(--faint); }
.ovn-p { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent); }
.ovn ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.ovn-r { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 9px; align-items: center; font-size: 12.5px; line-height: 1.5; } .ovn-r b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ovn-k { font: 600 10px/1 var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); letter-spacing: .05em; text-transform: uppercase; color: var(--faint); }
.ovn-d { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); } .ovn-r.live .ovn-d { background: var(--ok); }
@media (max-width: 760px) { .ov-head > .tools, a.ovn { width: 100%; } a.ovn { min-height: 116px; } .dash.ov2::before { top: -110px; height: 560px; } }
@media (prefers-reduced-motion: reduce) { a.ovn { transition: none; } }
.ov-row { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; align-items: stretch; }
.ov-row > * { min-width: 0; margin: 0 !important; height: 100%; box-sizing: border-box; } .ov-row > :only-child { grid-column: 1 / -1; }
.ov-k > * { grid-column: span 3; } .ov-r84 > :first-child { grid-column: span 8; } .ov-r84 > :last-child { grid-column: span 4; }
.ov-r75 > :first-child { grid-column: span 7; } .ov-r75 > :last-child { grid-column: span 5; } .ov-r66 > * { grid-column: span 6; }
@media (max-width: 1279px) { .ov-k > * { grid-column: span 6; } .ov-r75 > *, .ov-r84 > * { grid-column: span 12 !important; } }
@media (max-width: 760px) { .dash.ov2, .ov-row { gap: 12px; } .ov-row > * { grid-column: span 12 !important; } .ov-row.ov-k > * { grid-column: span 6 !important; }
  a.ovk { padding: 14px; gap: 10px; } a.ovk svg.ovspark { display: none; } a.ovk .ovk-top { align-items: flex-start; } a.ovk .ovk-l { font-size: 12.5px; line-height: 1.25; } a.ovk .ovk-v { font-size: 18px; } a.ovk .ovk-s { font-size: 12px; } }
/* The connected rails: one row each, the product's own mark on a white tile, never recoloured; its run on the right. */
.ov-par { display: flex; flex-direction: column; }
ul.ovs-ms { list-style: none; margin: 0; padding: 0; display: grid; }
li.ovs-m { border-top: 1px solid var(--line); } li.ovs-m > * { display: block; padding: 8px 6px; margin: 0 -6px; border-radius: 8px; color: inherit; text-decoration: none; }
li.ovs-m > a:hover { background: var(--hover); }
.ovs-v { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto 8px; gap: 12px; align-items: center; font-size: 13px; }
.ovs-l { font-weight: 600; }
.ovs-run { font-size: 12px; color: var(--muted); }
.ovs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
.ovs-k { justify-self: start; height: 24px; min-width: 24px; padding: 0 4px; border-radius: 6px; display: inline-grid; place-items: center; background: #fff; border: 1px solid rgba(16,24,40,.08); }
.ovs-k img { display: block; width: 16px; height: 16px; object-fit: contain; }
.ovs-k.wide { padding: 0 6px; overflow: hidden; } .ovs-k.wide img { width: auto; max-width: 52px; height: 10px; }
.ovs-k b { font-size: 11px; font-weight: 800; color: #1a1f2e; }
.ovs-k.visa b { font-style: italic; font-weight: 900; color: #1a1f71; }
.ov-par .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* The four figures. */
a.ovk { display: flex; flex-direction: column; gap: 10px; padding: 16px; text-decoration: none; color: inherit; transition: border-color .12s; }
a.ovk:hover { border-color: color-mix(in srgb, var(--text) 20%, var(--line)); }
.ovk-top { display: flex; align-items: center; gap: 8px; min-width: 0; } .ovk-top .ovk-l { flex: 1; min-width: 0; }
svg.ovspark { flex: none; width: 60px; height: 26px; }
a.ovk.hot { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); box-shadow: inset 0 2px 0 var(--accent); }
.ovk-i { width: 26px; height: 26px; border-radius: 7px; flex: none; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
a.ovk.hot .ovk-i { color: var(--accent); }
.ovk-m { margin: 6px 0 2px; }
.ovk-b { display: grid; gap: 2px; min-width: 0; } .ovk-l { font-size: 12.5px; color: var(--muted); font-weight: 550; }
.ovk-v { font-size: clamp(20px, 1.8vw, 26px); font-weight: 680; letter-spacing: -.025em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ovk-s { font-size: 12px; color: var(--faint); } .ovk-s.pos { color: var(--ok); } .ovk-s.neg { color: var(--bad); }
svg.ovspark polyline { stroke: var(--accent); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
svg.ovspark.pos polyline { stroke: var(--ok); }
/* Invoices waiting for you: a table on a fixed grid of columns. */
.ov-n { display: inline-grid; place-items: center; min-width: 22px; height: 22px; margin-left: 8px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: var(--btn-ink, #fff); font-size: 12px; vertical-align: 2px; }
.ov-inv { display: flex; flex-direction: column; }
a.ov-tfoot { margin-top: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 12px 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; text-decoration: none; } a.ov-tfoot b { color: var(--text); } a.ov-tfoot .ic { margin-left: auto; } a.ov-tfoot:hover { color: var(--text); }
.ov-tbl { display: grid; grid-template-columns: minmax(140px, 1fr) max-content minmax(150px, 1.15fr) max-content; column-gap: 16px; }
.ov-th, a.ov-tr { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; padding: 10px 12px; }
.ov-th { font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); font-weight: 600; border-radius: 6px; background: color-mix(in srgb, var(--sunken) 70%, var(--surface)); }
a.ov-tr { text-decoration: none; color: inherit; border-top: 1px solid var(--line); min-height: 52px; font-size: 13.5px; }
a.ov-tr:hover { background: var(--hover); }
.ov-sup { display: flex; gap: 10px; align-items: center; min-width: 0; } .ov-sup > span:last-child { display: grid; min-width: 0; } .ov-amt { display: grid; white-space: nowrap; } .ov-sup b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ov-sup small { color: var(--faint); font-size: 12px; }
.ov-si { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); flex: none; }
.ov-due { color: var(--faint); font-size: 12px; }
.ov-chks { display: flex; flex-wrap: wrap; gap: 4px; } .ovc { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; font-size: 11.5px; font-weight: 650; border: 1px solid; }
.ovc .ic svg { width: 11px; height: 11px; } .ovc.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); } .ovc.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.ov-st { justify-self: start; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; border: 1px solid; white-space: nowrap; }
.ov-st.hot { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); } .ov-st.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); } .ov-st.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
@media (max-width: 760px) { .ov-tbl { display: block; } .ov-th { display: none; } a.ov-tr { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; } .ov-chks { grid-column: 1 / -1; } }
/* Approve on your phone: how it is done, never a button that approves here. */
.ov-appr { display: flex; flex-direction: column; gap: 14px; }
.ov-ah { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: start; } .ov-ah h2 { margin: 0; font-size: 14.5px; } .ov-ah p { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
.ov-ai { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--sunken)); }
a.btn.ov-go { justify-content: center; height: 38px; margin-top: auto; }
a.ov-aw:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.ov-aw { color: inherit; text-decoration: none; display: grid; gap: 4px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: color-mix(in srgb, var(--sunken) 45%, var(--surface)); }
.ov-awl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650; color: var(--accent); } .ov-awl .ic svg { width: 13px; height: 13px; }
.ov-awi { display: flex; justify-content: space-between; gap: 10px; font-size: 14.5px; } .ov-awi b:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ov-aw small { color: var(--faint); font-size: 12px; }
/* The cash beside the flow: 7, 30 or 90 days. */
.dh.withseg { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.ov-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--sunken); flex: none; }
.ov-sb { appearance: none; border: 0; background: none; color: var(--muted); font: 650 12.5px/1 Inter, system-ui, sans-serif; padding: 0 12px; min-height: 32px; border-radius: 999px; cursor: pointer; }
.ov-sb.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
/* The agents on the Overview: the name and its spend, the meter under them, then the newest decision. */
.ov-ag a.as-row { grid-template-columns: 30px minmax(0, 1fr) 16px; } .ov-ag a.as-row > .as-bar { grid-column: 2; grid-row: 2; } .ov-ag a.as-row > .as-d { grid-column: 2; grid-row: 3; } .ov-ag a.as-row > .ic { grid-column: 3; grid-row: 1 / span 3; } .ov-ag .as-av { width: 30px; height: 30px; border-radius: 8px; }
/* Recent activity. */
.ov-feed { list-style: none; margin: 0; padding: 0; display: grid; }
.ov-feed li { border-top: 1px solid var(--line); } .ov-feed li > a { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 6px; margin: 0 -6px; border-radius: 10px; color: inherit; text-decoration: none; } .ov-feed li > a:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ov-fi { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); } .f-ok .ov-fi { color: var(--ok); } .f-bad .ov-fi { color: var(--bad); } .f-wait .ov-fi { color: var(--accent); }
.ov-fi svg { width: 15px; height: 15px; } .ov-ft { display: grid; min-width: 0; font-size: 13.5px; } .ov-ft b { font-size: 13px; } .ov-ft span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-feed time { font-size: 12px; color: var(--faint); white-space: nowrap; }
/* The sidebar: a count of open invoices, and a green dot on a connection only when the company has it. */
#tabs a[data-n]::after { content: attr(data-n); margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-grid; place-items: center; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
#tabs a[data-on]::after { content: ""; margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent); }
.dash.ov2 > .startc { margin: 0; }
`;
