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
import { SITE_ORIGIN } from "./siteHeader.js";
import { connectionsCatalogue } from "./connections.js";

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
// in a clean order"): a header with the partners' globe, four figures, what waits for you beside how to approve it, the
// flow beside the cash, what happened beside what is connected, then the two charts above. Every figure is the
// records'; nothing here approves or pays: approval is the CFO's, on the phone, over the exact terms.
const OV_SITE=` + JSON.stringify(SITE_ORIGIN) + String.raw`;
function ovSpark(vals,cls){
  if(!vals||vals.length<2)return null;const W=120,H=36,mn=Math.min(...vals),mx=Math.max(...vals),r=(mx-mn)||1;
  const pts=vals.map((v,i)=>(i/(vals.length-1)*W).toFixed(1)+','+(H-3-(v-mn)/r*(H-6)).toFixed(1));
  return sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'ovspark '+(cls||''),'aria-hidden':'true'},[sv('polyline',{points:pts.join(' '),fill:'none'})])}
function ovKpi(o){const a=el('a','card ovk rise'+(o.hot?' hot':''),[el('div','ovk-top',[el('span','ovk-i',ic(o.icon)),el('span','ovk-l',o.label),o.spark||null]),el('div','ovk-b',[el('b','num ovk-v',o.value),o.sub?el('span','ovk-s'+(o.tone?' '+o.tone:''),o.sub):null])]);a.href=o.href;return a}
// Relative time against the demo world's own day (its records are dated in it), or now for a real company.
function ovAgo(at,now){const s=Math.max(0,(now-Date.parse(at))/1000);if(s<3600)return t('cs.ov2.ago_m',{n:Math.max(1,Math.round(s/60))});if(s<86400)return t('cs.ov2.ago_h',{n:Math.round(s/3600)});return t('cs.ov2.ago_d',{n:Math.round(s/86400)})}
// The globe, in the header's background (21 Nov, Max: "more into the background", the loose white chips "look detached"):
// a sphere of points turning slowly, dim, to the right and partly off the edge, never under the words or the figures.
// Every frame (21 Nov, Max: smooth, no 30 fps cap), kept light: one sprite and the halo's gradient made per size, the
// pixel ratio at most 1.5, paused off screen and in a hidden tab, still under reduced motion or on a slow device.
const OV_STACK=` + JSON.stringify(overviewStack()) + String.raw`;
function ovGlobe(){
  const c=el('canvas','ovg-c');c.setAttribute('aria-hidden','true');
  const box=el('div','ovg',[c]);
  requestAnimationFrame(()=>ovGlobeRun(c));
  return box}
// The stack (21 Nov, Max: the purple pills on the globe "look ugly"): one quiet strip under the headline, on the grid.
// One green dot and "7 connected · recorded runs", then each mark at one height: the products' own files on a white tile,
// never recoloured (the Airwallex wordmark as it is; Visa as text). Only what is connected with a recorded run
// (OV_STACK, from the connections catalogue, cloud/src/connections.ts); each says so to a screen reader. Nothing planned.
function ovStack(){
  const L=(k)=>{const x=typeof BRAND_LOGOS!=='undefined'&&BRAND_LOGOS[k];if(!x)return null;const i=el('img','');i.src=x.uri;i.alt='';i.decoding='async';return i};
  const MK={airwallex:()=>[el('span','ovs-k wide',[L('airwallex')||el('b','','Airwallex')]),null],
    alta:()=>[el('span','ovs-k',[L('alta')]),'Alta'],'visa-airi':()=>[el('span','ovs-k visa',[el('b','','VISA')]),'Airi'],
    claude:()=>[el('span','ovs-k',[L('claude')]),'Claude'],t0:()=>[el('span','ovs-k txt',[el('b','','T:0')]),null],
    moneybird:()=>[el('span','ovs-k',[L('moneybird')]),'Moneybird'],mcp:()=>[el('span','ovs-k',[L('mcp')]),'Purser MCP']};
  const item=(s)=>{const name=s.run==='live'?t('cs.ov2.stack_live',{name:s.name}):t('cs.ov2.stack_run',{name:s.name,run:s.run});
    const [k,label]=(MK[s.id]||(()=>[el('span','ovs-k txt',[el('b','',s.label.charAt(0))]),s.label]))();
    const v=el('span','ovs-v',[k,label?el('span','ovs-l',label):null]);v.setAttribute('aria-hidden','true');
    const li=el('li','ovs-m',[v,el('span','vh',name)]);li.title=name;li.dataset.id=s.id;return li};
  const list=el('ul','ovs-ms',OV_STACK.map(item));list.setAttribute('aria-label',t('cs.ov2.globe'));
  // A space first: read as text the strip is a sentence of its own, never joined to the line above ("controle.7").
  return el('div','ov-stack',[el('p','ovs-h',[document.createTextNode(' '),el('i','ovs-dot'),el('b','',t('cs.ov2.stack_n',{n:OV_STACK.length})),el('span','',' · '+t('cs.ov2.stack_k'))]),list])}
function ovGlobeRun(c){
  const g=c.getContext('2d');if(!g)return;let still=RM(),lastF=0,emaF=0,nF=0;let raf=0,seen=true,px=0,py=0,mx=0,my=0;
  const N=innerWidth<700?420:760,pts=[];for(let i=0;i<N;i++){const y=1-(i+0.5)/N*2,r=Math.sqrt(1-y*y),a=i*2.399963;pts.push([Math.cos(a)*r,y,Math.sin(a)*r])}
  const spr=(()=>{const s=document.createElement('canvas');s.width=s.height=32;const x=s.getContext('2d'),gr=x.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'rgba(235,228,255,1)');gr.addColorStop(.25,'rgba(167,139,250,.85)');gr.addColorStop(1,'rgba(124,92,255,0)');x.fillStyle=gr;x.fillRect(0,0,32,32);return s})();
  // The size, the centre and the halo change only on a resize: the halo's gradient is made then, not every frame.
  let R,cx,cy,rad,halo;
  function size(){R=c.getBoundingClientRect();const d=Math.min(devicePixelRatio||1,1.5);c.width=Math.max(1,Math.round(R.width*d));c.height=Math.max(1,Math.round(R.height*d));g.setTransform(d,0,0,d,0,0);
    cx=R.width*0.5;cy=R.height*0.5;rad=Math.min(R.width*0.42,R.height*0.5);
    halo=g.createRadialGradient(cx,cy,rad*0.2,cx,cy,rad*1.3);halo.addColorStop(0,'rgba(124,92,255,0.16)');halo.addColorStop(1,'rgba(124,92,255,0)')}
  size();
  function frame(now){raf=0;if(lastF&&now-lastF<1000){const dtF=now-lastF;emaF=emaF?emaF*0.9+dtF*0.1:dtF;if(dtF>400||(++nF>12&&emaF>60))still=true}lastF=now;const W=R.width,H=R.height,t=now/1000;
    px+=(mx-px)*0.06;py+=(my-py)*0.06;g.clearRect(0,0,W,H);g.globalCompositeOperation=document.documentElement.getAttribute('data-theme')==='light'||!matchMedia('(prefers-color-scheme: dark)').matches?'source-over':'lighter';
    g.globalAlpha=1;g.fillStyle=halo;g.fillRect(0,0,W,H);
    const ry=t*0.12+px*0.4,rx=-0.35+py*0.25,cs=Math.cos(ry),sn=Math.sin(ry),cxr=Math.cos(rx),sxr=Math.sin(rx);
    for(const p of pts){let x=p[0]*cs+p[2]*sn,z=-p[0]*sn+p[2]*cs,y=p[1];const y2=y*cxr-z*sxr;z=y*sxr+z*cxr;const f=1.6/(2.6-z),X=cx+x*rad*f,Y=cy+y2*rad*f,front=z>0;
      const a=front?0.3+0.5*z:0.06+0.08*(1+z),s=(front?2.2:1.3)*f;g.globalAlpha=a;g.drawImage(spr,X-s,Y-s,s*2,s*2)}
    // The orbit ring: a tilted ellipse of points, turning the other way.
    for(let i=0;i<120;i++){const a=i/120*Math.PI*2+t*0.25,x=Math.cos(a)*1.45,z=Math.sin(a)*1.45,y=0.12*Math.sin(a*2);const y2=y*Math.cos(0.5)-z*Math.sin(0.5),z2=y*Math.sin(0.5)+z*Math.cos(0.5),f=1.6/(2.6-z2*0.6);
      g.globalAlpha=z2>0?0.45:0.12;const s=1.5*f;g.drawImage(spr,cx+x*rad*f-s,cy+y2*rad*f-s,s*2,s*2)}
    g.globalAlpha=1;if(!still)go()}
  function go(){if(!raf&&seen&&!document.hidden&&c.isConnected)raf=requestAnimationFrame(frame)}
  frame(performance.now());if(still)return;
  if('IntersectionObserver' in window)new IntersectionObserver((es)=>{seen=es[0].isIntersecting;if(seen)go()}).observe(c);
  if('ResizeObserver' in window)new ResizeObserver(()=>{size();go()}).observe(c);
  document.addEventListener('visibilitychange',()=>{lastF=0;if(!document.hidden)go()});
  addEventListener('pointermove',(e)=>{if(e.pointerType!=='mouse')return;mx=(e.clientX/innerWidth-0.5)*2;my=(e.clientY/innerHeight-0.5)*2},{passive:true})}
async function overviewNext(){
  title(t('cs.nav.overview'));
  const soft=(p)=>api(p).catch((e)=>{if(e instanceof Expired)throw e;return null});
  const [m,x,all,D,BK]=await Promise.all([me(),api('/v1/insights'),api('/v1/invoices?limit=200'),soft('/v1/dashboard'),soft('/v1/books/bookings')]);shell();
  const items=all.items||[],C=(D&&D.currency)||'EUR',now=m.demo&&m.demo.as_of?Date.parse(m.demo.as_of):Date.now();
  const wait=items.filter((i)=>i.status==='waiting_cfo'),todo=items.filter((i)=>['ready','needs_review','needs_vendor'].includes(i.status));
  const open=items.filter((i)=>!['paid','rejected','blocked'].includes(i.status));
  const sumOf=(xs)=>xs.reduce((n,i)=>n+toCents(i.total),0);
  // The header: the one quiet line for the demo, the headline, and the partners' globe.
  const hero=el('section','ov-hero rise',[el('div','ov-ht',[m.demo?el('p','ov-pill',[ic('flask'),t('cs.ov2.pill')]):el('p','ov-pill',[ic('building-2'),t('cs.nav.overview')+(m.tenant.name?' · '+m.tenant.name:'')]),
      el('h1','ov-h',[t('cs.ov2.h_a')+' ',el('em','',t('cs.ov2.h_b'))]),el('p','ov-sub',t('cs.ov2.sub'))]),ovGlobe(),ovStack()]);
  // Four figures, each from the records; a change only where an earlier figure exists to compare with.
  const days=(D&&D.cash)||[],nets=days.map((d)=>toCents(d.net)),last=nets[nets.length-1],prev=nets.length>7?nets[nets.length-8]:null;
  const delta=prev!==null&&prev!==0?(last-prev)/Math.abs(prev)*100:null;
  const sup=new Set(open.map((i)=>i.vendor)).size,dups=(D&&D.invoices&&D.invoices.duplicates_stopped)||0;
  const blocked=Object.values(x.blocked_by_reason||{}).reduce((n,v)=>n+v,0);
  const kpis=el('div','ov-row ov-k',[
    D&&D.money?ovKpi({icon:'wallet',label:t('cs.ov.cash'),value:cur(C)+' '+cents(toCents(D.money.net)),sub:delta!==null?(delta>=0?'+':'−')+Math.abs(delta).toFixed(1)+'% '+t('cs.ov2.vs7'):D.since?t('cs.dash.net_sub',{date:dday(D.since)}):t('cs.dash.net_none'),tone:delta===null?'':delta>=0?'pos':'neg',spark:ovSpark(nets.slice(-30),'pos'),href:'#/transactions'}):null,
    ovKpi({icon:'receipt',label:t('cs.ov.payables'),value:open.length?cur(open[0].currency)+' '+cents(sumOf(open)):t('cs.nothing_open'),sub:t('cs.ov2.n_inv_sup',{n:open.length,s:sup}),href:'#/invoices?f=open'}),
    ovKpi({icon:'scan-face',label:t('cs.ov2.awaiting'),value:String(wait.length),sub:wait.length?cur(wait[0].currency)+' '+cents(sumOf(wait)):t('cs.ov.nothing_waits'),hot:wait.length>0,href:'#/invoices?f=waiting_cfo'}),
    ovKpi({icon:'shield-check',label:t('cs.ov2.blocks'),value:String(blocked),sub:dups?t('cs.ov2.dup',{n:dups}):t('cs.x.none_blocked'),tone:dups?'pos':'',href:'#/invoices?f=blocked'})].filter(Boolean));
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
  const wide=innerWidth>=1100,full=view().clientWidth||960,cw=Math.round(wide?full*5/12-60:full-40);
  const cv=el('div','cv'),seg=el('div','ov-seg');let span=30;
  const draw=()=>{const n=Math.min(span,days.length);cv.replaceChildren(D&&days.length?cashChart(Object.assign({},D,{cash:days.slice(-n)}),cw):chartEmpty(t('cs.dash.net_none')));[...seg.children].forEach((b)=>b.classList.toggle('on',+b.dataset.d===span))};
  [7,30,90].forEach((d)=>{const b=el('button','ov-sb',d+'D');b.type='button';b.dataset.d=String(d);b.onclick=()=>{span=d;draw()};seg.append(b)});draw();
  const cash=el('section','card dcard rise ov-cash',[el('div','dh withseg',[el('div','',[el('h2','',t('cs.dash.cash_title')),el('p','',D&&D.since?t('cs.op.weeks_sub',{cur:cur(C),date:dday(D.since)}):t('cs.dash.net_none'))]),seg]),cv]);
  const flow=payFlow(items,(BK&&BK.bookings)||{},dups,C);
  // What happened, newest first, in the records' words; each row opens the invoice it names, or the agents' decisions.
  const feedHref=(f)=>{const i=items.find((x)=>(x.invoice_no&&f.text.includes(x.invoice_no))||f.text.includes(x.id));return i?'#/invoices/'+encodeURIComponent(i.id):'#/agents'};
  const feed=((D&&D.feed)||[]).slice(0,5);
  const act=cardLink(el('section','card dcard rise ov-act',[el('div','dh',[el('h2','',t('cs.ov2.act_h'))]),feed.length?el('ul','ov-feed',feed.map((f)=>el('li','f-'+f.tone,Object.assign(el('a','',[el('span','ov-fi',ic(f.tone==='ok'?'circle-check':f.tone==='bad'?'octagon-x':f.tone==='wait'?'scan-face':'circle-dot')),el('span','ov-ft',[el('b','',f.who),el('span','',f.text)]),el('time','',ovAgo(f.at,now))]),{href:feedHref(f)})))):chartEmpty(t('cs.agents.no_decisions'))]),'#/agents',sw('to_agents'));
  // Connected and verified: each partner as this deployment runs it, each to its proof on the site.
  const logo=(k)=>{const L=typeof BRAND_LOGOS!=='undefined'&&BRAND_LOGOS[k];if(!L)return null;const i=el('img','');i.src=L.uri;i.alt='';return i};
  const tile=(k,name,status,href,mark)=>{const a=el('a','ov-pt',[el('span','ov-pm',mark),el('span','',[el('b','',name),el('span','ov-ps',[status,' ',ic('circle-check')])])]);a.href=OV_SITE+href;a.target='_blank';a.rel='noopener';return a};
  const partners=el('section','card dcard rise ov-par',[el('div','dh',[el('h2','',t('cs.ov2.par_h')),el('p','',t('cs.ov2.par_sub'))]),el('div','ov-pts',[
    tile('awx','Airwallex',t('cs.ov2.sandbox'),'/airwallex',logo('airwallex')||el('b','','A')),tile('alta','Alta',t('cs.ov2.testnet'),'/alta',logo('alta')||el('b','','A')),
    tile('visa','Visa (Airi)',t('cs.ov2.sandbox'),'/visa',el('b','visa','VISA')),tile('claude','Claude',t('cs.ov2.recorded'),'/claude',logo('claude')||el('b','','C'))])]);
  // The sidebar's count of open invoices, from the same records (a mark in CSS: the menu's words stay the page names).
  {const a=document.querySelector('#tabs a[data-tab=invoices]');if(a){if(open.length)a.dataset.n=String(open.length);else delete a.dataset.n}}
  // A company with nothing in it yet: its first steps right under the header (cloud/src/consoleUi.ts startCard).
  const first=!items.length&&!m.demo&&typeof startCard==='function'?startCard(m):null;
  const dash=el('div','dash ov2',[hero,first,kpis,el('div','ov-row ov-r84',[table,approve]),el('div','ov-row ov-r75',[flow,cash]),el('div','ov-row ov-r66',[act,partners])]);
  if(D&&days.length)dash.append(el('div','ov-row ov-r66 ov-more',[cardLink(dcard('opw',t('cs.op.weeks_title'),t('cs.op.weeks_sub',{cur:cur(C),date:dday(D.since)}),opWeeks(D,Math.round(wide?full/2-60:full-40))),'#/transactions',sw('to_tx')),cardLink(dcard('ops',t('cs.op.sup_title'),t('cs.op.sup_sub'),opSuppliers()),'#/transactions',sw('to_tx'))]));
  view().replaceChildren(dash,awlOverview());
  requestAnimationFrame(()=>{for(const n of view().querySelectorAll('.rise'))n.classList.add('in')});
}
// The row the Overview adds under its own: the weeks beside the counterparties.
function overviewPlus(D){
  const wide=innerWidth>=980,full=view().clientWidth||960,W=Math.round(wide?full*0.6-40:full-40);
  return el('div','dgrid g1 opgrid',[cardLink(dcard('opw',t('cs.op.weeks_title'),t('cs.op.weeks_sub',{cur:cur(D.currency),date:dday(D.since)}),opWeeks(D,W)),'#/transactions',sw('to_tx')),
    cardLink(dcard('ops',t('cs.op.sup_title'),t('cs.op.sup_sub'),opSuppliers()),'#/transactions',sw('to_tx'))])}
`;

/** The site's wave behind the whole console, strongest under the header, faint behind the cards. */
export const CONSOLE_WAVE_JS = `
(function () { if (document.querySelector("canvas.pw-wave")) return; var c = document.createElement("canvas"); c.className = "pw-wave"; c.setAttribute("aria-hidden", "true"); document.body.prepend(c); })();
${waveScript({ selector: "canvas.pw-wave", placement: "page", density: 0.6, intensity: 1.35 })}`;

export const OVERVIEW_PLUS_CSS = `
${WAVE_CANVAS_CSS}
canvas.pw-wave { z-index: -1; }
/* 21 Nov (Max: the flow "looks really on each other"): on the Overview the page's wave stays out of the header's words:
   faded out over the left of the screen's top, full on the right and below the header. */
@media (min-width: 761px) { body:has(.ov2) canvas.pw-wave {
  -webkit-mask-image: linear-gradient(90deg, transparent 0 50%, rgba(0,0,0,.35) 85%), linear-gradient(180deg, transparent 0 300px, rgba(0,0,0,.5) 440px, rgba(0,0,0,.28) 100%);
  mask-image: linear-gradient(90deg, transparent 0 50%, rgba(0,0,0,.35) 85%), linear-gradient(180deg, transparent 0 300px, rgba(0,0,0,.5) 440px, rgba(0,0,0,.28) 100%); } }
@media (max-width: 760px) { body:has(.ov2) canvas.pw-wave {
  -webkit-mask-image: linear-gradient(180deg, transparent 0 420px, rgba(0,0,0,.5) 560px, rgba(0,0,0,.28) 100%); mask-image: linear-gradient(180deg, transparent 0 420px, rgba(0,0,0,.5) 560px, rgba(0,0,0,.28) 100%); } }
.opsrow { display: block; text-decoration: none; color: inherit; border-radius: 10px; padding: 2px 4px; margin: 0 -4px; transition: background-color .15s ease; }
.opsrow:hover, .opsrow:focus-visible { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.opsrow .sl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.opsup .sbars .sf { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e879f9)); }
.opgrid { margin-top: 16px; }
/* The Overview on twelve columns: one gutter, rows whose cards share a height, no hole. */
.dash.ov2 { display: grid; gap: 20px; margin: 0 0 28px; }
.ov-row { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; align-items: stretch; }
.ov-row > * { min-width: 0; margin: 0 !important; height: 100%; box-sizing: border-box; }
.ov-k > * { grid-column: span 3; } .ov-r84 > :first-child { grid-column: span 8; } .ov-r84 > :last-child { grid-column: span 4; }
.ov-r75 > :first-child { grid-column: span 7; } .ov-r75 > :last-child { grid-column: span 5; } .ov-r66 > * { grid-column: span 6; }
@media (max-width: 1279px) { .ov-k > * { grid-column: span 6; } .ov-r75 > *, .ov-r84 > * { grid-column: span 12 !important; } }
@media (max-width: 760px) { .dash.ov2, .ov-row { gap: 12px; } .ov-row > * { grid-column: span 12 !important; } .ov-row.ov-k > * { grid-column: span 6 !important; }
  a.ovk { padding: 14px; gap: 10px; } a.ovk svg.ovspark { display: none; } a.ovk .ovk-top { align-items: flex-start; } a.ovk .ovk-l { font-size: 12.5px; line-height: 1.25; } a.ovk .ovk-v { font-size: 18px; } a.ovk .ovk-s { font-size: 12px; } }
/* The header (21 Nov, Max: up, the globe in the background): the words on the left in a clean area; the globe behind,
   dim, to the right and partly past the edge (clipped by the header, so never under the figures); under both, on the
   grid, the one strip of the connected stack (no pills on the globe, Max 21 Nov). */
.ov-hero { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 44%; grid-template-rows: auto auto; align-items: start; margin-top: -18px; overflow: clip; overflow-clip-margin: 0; }
@media (max-width: 760px) { .ov-hero { margin-top: 0; } }
.ov-ht { position: relative; z-index: 1; grid-column: 1; grid-row: 1; max-width: 640px; min-height: 176px; padding-top: 6px; box-sizing: border-box; }
.ov-pill { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 14px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--glass-line, var(--border)); background: var(--glass, var(--surface)); color: var(--muted); font-size: 12.5px; font-weight: 600; }
.ov-pill .ic svg { width: 13px; height: 13px; }
.ov-h { margin: 0; font-size: clamp(30px, 3.2vw, 44px); line-height: 1.08; letter-spacing: -.035em; font-weight: 760; }
.ov-h em { font-style: italic; background: var(--grad-text, linear-gradient(100deg, #c4b5fd, #a78bfa)); -webkit-background-clip: text; background-clip: text; color: transparent; padding-right: .06em; white-space: nowrap; }
.ov-sub { margin: 10px 0 0; color: var(--muted); font-size: 16px; max-width: 34em; }
.ovg { position: relative; z-index: 0; grid-column: 2; grid-row: 1; align-self: stretch; right: -6%; min-height: 176px; pointer-events: none; }
.ovg-c { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .85; }
/* The connected stack: one row, one green dot, every mark at one height. */
.ov-stack { position: relative; z-index: 1; grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; flex-wrap: wrap; gap: 10px 22px; margin-top: 14px; padding: 10px 16px; border-radius: 14px;
  border: 1px solid var(--glass-line, var(--border)); background: color-mix(in srgb, var(--surface) 72%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.ovs-h { display: inline-flex; align-items: center; gap: 8px; margin: 0; padding-right: 22px; border-right: 1px solid var(--border); font-size: 13px; color: var(--muted); white-space: nowrap; }
.ovs-h b { color: var(--text); font-weight: 650; }
.ovs-dot { position: relative; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
li.ovs-m { display: flex; align-items: center; }
ul.ovs-ms { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; flex: 1; min-width: 0; }
.ovs-v { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--text) 82%, var(--muted)); white-space: nowrap; }
/* The products' own files on a white tile in both themes, never recoloured; Visa and T:0 as text. */
.ovs-k { flex: none; height: 24px; min-width: 24px; box-sizing: border-box; padding: 0 4px; border-radius: 7px; display: inline-grid; place-items: center; background: #fff; border: 1px solid rgba(16,24,40,.10); }
.ovs-k img { display: block; width: 16px; height: 16px; object-fit: contain; }
.ovs-k.wide { padding: 0 8px; } .ovs-k.wide img { width: auto; height: 11px; }
.ovs-k b { font-size: 11px; font-weight: 800; color: #1a1f2e; letter-spacing: .01em; }
.ovs-k.visa b { font-style: italic; font-weight: 900; color: #1a1f71; letter-spacing: .02em; }
.ovs-k.txt { padding: 0 6px; }
.ov-stack .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .ovs-dot::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 1px solid var(--ok); opacity: 0; animation: ovping 2.6s ease-out infinite; }
}
@keyframes ovping { 0% { transform: scale(.6); opacity: .8; } 80%, 100% { transform: scale(2.2); opacity: 0; } }
/* A narrower screen: the words over the whole width, the globe in a band below them, then the strip. */
@media (max-width: 1100px) { .ov-hero { grid-template-columns: minmax(0, 1fr); } .ov-ht { max-width: none; min-height: 0; } .ovg { grid-column: 1; grid-row: 2; right: auto; height: 150px; min-height: 0; margin-top: 8px; } .ov-stack { grid-row: 3; } }
@media (max-width: 640px) { .ovg { height: 108px; } .ov-h { font-size: 29px; } .ov-pill { font-size: 12px; }
  .ov-stack { gap: 10px; padding: 10px 12px; } .ovs-h { padding-right: 0; border-right: 0; flex-basis: 100%; } ul.ovs-ms { gap: 8px 14px; } .ovs-v { font-size: 12.5px; gap: 6px; } }
/* The four figures. */
.ov-pm b.visa { font-style: italic; font-weight: 900; letter-spacing: .02em; color: #f2f4ff; background: #1a1f71; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
a.ovk { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; text-decoration: none; color: inherit; }
.ovk-top { display: flex; align-items: center; gap: 8px; min-width: 0; } .ovk-top .ovk-l { flex: 1; min-width: 0; }
svg.ovspark { flex: none; width: 60px; height: 26px; }
a.ovk.hot { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), color-mix(in srgb, var(--surface) 92%, transparent)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 20px 50px -30px var(--glow, rgba(124,92,255,.5)); }
.ovk-i { width: 30px; height: 30px; border-radius: 10px; flex: none; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 12%, var(--sunken)); color: var(--accent); }
.ovk-b { display: grid; gap: 2px; min-width: 0; } .ovk-l { font-size: 13px; color: var(--muted); font-weight: 600; }
.ovk-v { font-size: clamp(22px, 2vw, 28px); font-weight: 740; letter-spacing: -.03em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ovk-s { font-size: 12.5px; color: var(--faint); } .ovk-s.pos { color: var(--ok); } .ovk-s.neg { color: var(--bad); }
svg.ovspark polyline { stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent)); }
svg.ovspark.pos polyline { stroke: var(--ok); filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ok) 55%, transparent)); }
/* Invoices waiting for you: a table on a fixed grid of columns. */
.ov-n { display: inline-grid; place-items: center; min-width: 22px; height: 22px; margin-left: 8px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: var(--btn-ink, #fff); font-size: 12px; vertical-align: 2px; }
.ov-inv { display: flex; flex-direction: column; }
a.ov-tfoot { margin-top: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 12px 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; text-decoration: none; } a.ov-tfoot b { color: var(--text); } a.ov-tfoot .ic { margin-left: auto; } a.ov-tfoot:hover { color: var(--text); }
.ov-tbl { display: grid; grid-template-columns: minmax(140px, 1fr) max-content minmax(150px, 1.15fr) max-content; column-gap: 16px; }
.ov-th, a.ov-tr { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; padding: 10px 12px; }
.ov-th { font-size: 12px; color: var(--faint); font-weight: 600; border-radius: 10px; background: color-mix(in srgb, var(--text) 4%, transparent); }
a.ov-tr { text-decoration: none; color: inherit; border-top: 1px solid var(--border); min-height: 56px; }
a.ov-tr:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ov-sup { display: flex; gap: 10px; align-items: center; min-width: 0; } .ov-sup > span:last-child { display: grid; min-width: 0; } .ov-amt { display: grid; white-space: nowrap; } .ov-sup b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ov-sup small { color: var(--faint); font-size: 12px; }
.ov-si { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); flex: none; }
.ov-due { color: var(--faint); font-size: 12px; }
.ov-chks { display: flex; flex-wrap: wrap; gap: 4px; } .ovc { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; font-size: 11.5px; font-weight: 650; border: 1px solid; }
.ovc .ic svg { width: 11px; height: 11px; } .ovc.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); } .ovc.warn { color: #f0b24e; border-color: color-mix(in srgb, #f0b24e 40%, transparent); }
.ov-st { justify-self: start; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; border: 1px solid; white-space: nowrap; }
.ov-st.hot { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); } .ov-st.warn { color: #f0b24e; border-color: color-mix(in srgb, #f0b24e 40%, transparent); } .ov-st.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
@media (max-width: 760px) { .ov-tbl { display: block; } .ov-th { display: none; } a.ov-tr { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; } .ov-chks { grid-column: 1 / -1; } }
/* Approve on your phone: how it is done, never a button that approves here. */
.ov-appr { display: flex; flex-direction: column; gap: 14px; border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), color-mix(in srgb, var(--surface) 92%, transparent)); }
.ov-ah { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 14px; align-items: center; } .ov-ah h2 { margin: 0; font-size: 18px; } .ov-ah p { margin: 4px 0 0; color: var(--muted); font-size: 13.5px; line-height: 1.45; }
.ov-ai { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--sunken)); } .ov-ai svg { width: 28px; height: 28px; }
a.btn.ov-go { justify-content: center; height: 48px; margin-top: auto; }
a.ov-aw:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.ov-aw { color: inherit; text-decoration: none; display: grid; gap: 4px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 70%, transparent); }
.ov-awl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650; color: var(--accent); } .ov-awl .ic svg { width: 13px; height: 13px; }
.ov-awi { display: flex; justify-content: space-between; gap: 10px; font-size: 14.5px; } .ov-awi b:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ov-aw small { color: var(--faint); font-size: 12px; }
/* The cash beside the flow: 7, 30 or 90 days. */
.dh.withseg { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.ov-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--sunken); flex: none; }
.ov-sb { appearance: none; border: 0; background: none; color: var(--muted); font: 650 12.5px/1 Inter, system-ui, sans-serif; padding: 0 12px; min-height: 32px; border-radius: 999px; cursor: pointer; }
.ov-sb.on { background: var(--accent); color: var(--btn-ink, #fff); }
/* Recent activity and the partners. */
.ov-feed { list-style: none; margin: 0; padding: 0; display: grid; }
.ov-feed li { border-top: 1px solid var(--border); } .ov-feed li > a { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 6px; margin: 0 -6px; border-radius: 10px; color: inherit; text-decoration: none; } .ov-feed li > a:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ov-fi { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); } .f-ok .ov-fi { color: var(--ok); } .f-bad .ov-fi { color: var(--bad); } .f-wait .ov-fi { color: var(--accent); }
.ov-fi svg { width: 15px; height: 15px; } .ov-ft { display: grid; min-width: 0; font-size: 13.5px; } .ov-ft b { font-size: 13px; } .ov-ft span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-feed time { font-size: 12px; color: var(--faint); white-space: nowrap; }
.ov-par { display: flex; flex-direction: column; } .ov-pts { flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(76px, 1fr); gap: 12px; }
a.ov-pt { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; align-items: center; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 3%, transparent); text-decoration: none; color: inherit; min-height: 64px; }
a.ov-pt:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.ov-pm { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: #fff; overflow: hidden; } .ov-pm img { max-width: 34px; max-height: 20px; display: block; }
.ov-pt b { display: block; font-size: 14.5px; } .ov-ps { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ok); } .ov-ps .ic svg { width: 12px; height: 12px; }
/* The sidebar: a count of open invoices, and a green dot on a connection only when the company has it. */
#tabs a[data-n]::after { content: attr(data-n); margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-grid; place-items: center; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
#tabs a[data-on]::after { content: ""; margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent); }
.dash.ov2 > .startc { margin: 0; }
/* On the Overview the demo's one quiet line is the header's pill. */
body:has(.ov2) #demo { display: none; }
/* The flow strip: particles that run along each connector to the next step (Max: "animated particles along the path"). */
@media (prefers-reduced-motion: no-preference) and (min-width: 721px) {
  .rise.in ol.pflow > li:not(:last-child)::before { background-image: radial-gradient(circle, color-mix(in srgb, var(--accent) 95%, #fff) 0 1.2px, transparent 1.8px), linear-gradient(90deg, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 10%, transparent)); background-size: 9px 2px, 100% 100%; background-repeat: repeat-x, no-repeat; animation: opflow 1.1s linear infinite; box-shadow: 0 0 10px -2px var(--accent); }
}
@keyframes opflow { from { background-position: 0 0, 0 0; } to { background-position: 9px 0, 0 0; } }
`;
