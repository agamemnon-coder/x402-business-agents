// Purser Cloud's Cash & FX and Receivables (v1.5.1, Max): two pages for the money loop the runner already runs
// (src/treasury, src/receivables/ar.ts) and its own dashboard shows at GET /api/treasury, read from what the runner last
// pushed (GET /v1/treasury and GET /v1/receivables, cloud/src/moneyLoop.ts). Cash & FX: cash per currency against the
// CFO's floors, the 13-week forecast as a small chart (a forecast, not a promise of cash), and the FX advisor's
// proposal: above the CFO's threshold (treasury.fx_threshold_eur) a conversion is proposed and waits for the CFO's
// passkey, which this page says and never offers to skip (there is no button that converts or approves). Receivables:
// open invoices by number and amount (no customer name ever reaches the cloud), the payments matched to them, the ones
// waiting for a person and the reminder steps (drafts a person sends; Purser sends nothing).
//
// Colours as everywhere in the console (cloud/src/consoleColor.ts): emerald paid, sky money moving, amber test money and
// what waits, violet the CFO's approval. Every value is set as text; the chart is SVG built here, with its title, its
// description and its table. The script goes into the console at __UI__ (cloud/src/console.ts), after the charts'
// helpers it uses: el, ic, t, tk, cur, cents, day, dday, stamp, kfmt, sv, chartPoint, chartA11y, chartTable, chartEmpty,
// svgAt, svgX, colMark, dcard, tile, money, others, segbar, head, title, view, api, dl, riseIn.

export const MONEY_JS = String.raw`
// --- Cash & FX and Receivables (v1.5.1) -------------------------------------------------------------------------------
const mc=(c,n)=>cur(c)+'\u00a0'+cents(n);
const mlWhen=(w)=>w?t('cs.cash.in_week',{n:w}):t('cs.cash.now');
// What the page is read from: the demo company or test money, and the day the runner read it.
function mlTags(d,asOf,gen){return el('div','ml-tags',[el('span','pill tmoney',t(d.demo?'cs.ml.demo':'cs.ml.test')),el('span','pill',t('cs.ml.as_of',{day:day(asOf)})),gen?el('span','ml-gen',t('cs.ml.read',{at:stamp(gen)})):null])}
// Nothing pushed yet: what the page will show, and the one command that sends it.
function mlNone(){return el('div','card panel ml-none',[el('h2','',t('cs.ml.none_h')),el('p','lede',t('cs.ml.none')),el('code','cmd','npm run cloud -- push')])}
const mlSum=(rows,f)=>{const m={};for(const r of rows)m[r.currency]=(m[r.currency]||0)+f(r);return m};

// The forecast for one currency: the balance now and at the end of each week as columns (sky; amber below the CFO's
// floor), the floor as a dashed line. Each column answers the pointer and the keyboard with its in, out and closing.
function fcChart(T,c,W){
  const F=T.forecast,s=F.currencies.find((x)=>x.currency===c);if(!s)return chartEmpty(t('cs.ch.none'));
  const pts=[{w:0,from:T.as_of,to:T.as_of,v:s.opening_cents,i:0,o:0,low:s.opening_cents<s.floor_cents}].concat(F.weeks.map((w)=>{const r=w.rows.find((x)=>x.currency===c);return r?{w:w.week,from:w.from,to:w.to,v:r.closing_cents,i:r.in_cents,o:r.out_cents,low:r.below_floor}:null}).filter(Boolean));
  const H=Math.max(176,Math.min(236,Math.round(W*0.38))),l=46,r=10,tp=14,b=26;
  const vals=pts.map((p)=>p.v).concat([s.floor_cents,0]);const min=Math.min(...vals),max=Math.max(1,...vals);
  const Y=(v)=>tp+(max-v)/((max-min)||1)*(H-tp-b);const step=(W-l-r)/pts.length,bw=Math.max(5,Math.min(26,step*0.56));
  const g=sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'chart mlfc'});
  for(const v of [min<-max*0.05?min:null,0,max].filter((v)=>v!==null)){const y=Y(v);g.append(sv('line',{x1:l,x2:W-r,y1:y,y2:y,class:v===0?'zero':'grid'}),sv('text',{x:l-8,y:y+4,class:'ax','text-anchor':'end'},[document.createTextNode(v===0?'0':kfmt(v))]))}
  const every=Math.max(1,Math.ceil(pts.length/Math.max(1,Math.floor((W-l-r)/34))));
  pts.forEach((p,k)=>{const x=l+step*k+step/2,y0=Y(0),y1=Y(p.v);
    const col=sv('g',{class:'col'},[sv('rect',{x:l+step*k,y:tp,width:step,height:H-tp-b,class:'hit'}),sv('rect',{x:x-bw/2,y:Math.min(y0,y1),width:bw,height:Math.max(1.5,Math.abs(y1-y0)),rx:2.5,class:'b '+(p.low?'low':k?'fc':'now')})]);
    if(k%every===0)col.append(sv('text',{x,y:H-8,class:'ax','text-anchor':'middle'},[document.createTextNode(k?t('cs.cash.w_short',{n:p.w}):t('cs.cash.now_short'))]));
    g.append(col)});
  if(s.floor_cents>0){const y=Y(s.floor_cents);g.append(sv('line',{x1:l,x2:W-r,y1:y,y2:y,class:'floor'}),sv('text',{x:W-r-2,y:y-5,class:'fl','text-anchor':'end'},[document.createTextNode(t('cs.cash.floor_short',{amt:kfmt(s.floor_cents)}))]))}
  const pick=(cx)=>Math.max(0,Math.min(pts.length-1,Math.floor((svgX(g,W,cx)-l)/step)));
  chartPoint({root:g,n:pts.length,start:0,at:(cx)=>pick(cx),anchor:(i)=>svgAt(g,W,H,l+step*i+step/2,Y(Math.max(0,pts[i].v))),mark:(i)=>colMark(g,i),
    tip:(i)=>{const p=pts[i];return {h:i?t('cs.cash.week_h',{n:p.w,from:dday(p.from),to:dday(p.to)}):t('cs.cash.now_h',{day:dday(T.as_of)}),rows:[i?{k:'fin',l:t('cs.cash.in'),v:mc(c,p.i)}:null,i?{k:'fout',l:t('cs.cash.out'),v:mc(c,p.o)}:null,{k:p.low?'low':'fc',l:i?t('cs.cash.closing'):t('cs.cash.balance'),v:mc(c,p.v)},{l:t('cs.cash.floor_l'),v:mc(c,s.floor_cents)}].filter(Boolean)}}});
  const lows=pts.filter((p)=>p.low).length;
  chartA11y(g,t('cs.cash.fc_title_cur',{cur:c}),t('cs.cash.fc_desc',{cur:c,now:mc(c,s.opening_cents),end:mc(c,s.closing_cents),low:mc(c,s.min_closing_cents),when:mlWhen(s.min_week),floor:mc(c,s.floor_cents),n:lows}));
  const lg=el('ul','klegend ml-lg',[el('li','',[el('i','fc'),t('cs.cash.lg_close')]),lows?el('li','',[el('i','low'),t('cs.cash.lg_low')]):null,s.floor_cents>0?el('li','',[el('i','floor'),t('cs.cash.lg_floor',{amt:mc(c,s.floor_cents)})]):null]);
  return el('div','',[el('div','cv ml-chart',[g]),lg,chartTable([t('cs.ch.week'),t('cs.cash.in'),t('cs.cash.out'),t('cs.cash.closing')],pts.map((p,k)=>[k?t('cs.cash.week_h',{n:p.w,from:dday(p.from),to:dday(p.to)}):t('cs.cash.now_h',{day:dday(T.as_of)}),k?mc(c,p.i):'',k?mc(c,p.o):'',mc(c,p.v)+(p.low?' · '+t('cs.cash.lg_low'):'')]))])}

// The FX advisor: the CFO's threshold, each conversion it filed (waiting for the passkey: said, never a button), and
// what it made of each currency's exposure.
const FX_WAIT=['PENDING_APPROVAL','NEEDS_REAPPROVAL'],FX_OPEN=FX_WAIT.concat(['APPROVED','EXECUTING']);
function fxProp(p,thr){const wait=FX_WAIT.includes(p.status),tone=wait?'appr':p.status==='EXECUTED'?'ok':['APPROVED','EXECUTING'].includes(p.status)?'sky':'';
  return el('div','ml-prop'+(wait?' wait':''),[
    el('div','mp-top',[el('span','pill '+tone,tk('cs.fx.st.'+p.status,p.status)),el('code','idc',p.proposal_id)]),
    el('p','mp-what',t('cs.fx.buy',{buy:mc(p.buy_currency,p.buy_cents),sell:mc(p.sell_currency,p.sell_max_cents)})),
    dl([[t('cs.fx.indicative'),mc(p.sell_currency,p.indicative_sell_cents)+' · '+t('cs.fx.rate',{rate:p.rate})],[t('cs.fx.for'),p.week?t('cs.fx.for_w',{cur:p.buy_currency,n:p.week}):''],[wait?t('cs.fx.expires'):t('cs.fx.filed'),wait?stamp(p.expires_at):stamp(p.created_at)]]),
    wait?el('p','mp-pass',[ic('scan-face'),el('span','',thr!==null?t('cs.fx.passkey',{amt:mc('EUR',thr)}):t('cs.fx.passkey_any'))]):null])}
const FX_TONE={none:'ok',proposal:'appr',below_threshold:'warn',no_threshold:'warn',no_rate:'warn',no_source:'bad',not_priced:'warn'};
function fxCard(T){
  const fx=T.fx,thr=fx.threshold_eur_cents,open=fx.proposals.filter((p)=>FX_OPEN.includes(p.status)),past=fx.proposals.filter((p)=>!FX_OPEN.includes(p.status)).slice(0,3);
  const exp=fx.exposures.map((e)=>{const about=e.eur_cents!==null&&e.currency!=='EUR'?' '+t('cs.fx.about',{eur:mc('EUR',e.eur_cents)}):'';
    const words=e.decision==='none'?t('cs.fx.d.none',{low:mc(e.currency,e.min_closing_cents),when:mlWhen(e.min_week)}):t('cs.fx.d.'+e.decision,{short:mc(e.currency,e.shortfall_cents),when:mlWhen(e.min_week),about,thr:thr!==null?mc('EUR',thr):''});
    return el('li','x-'+FX_TONE[e.decision],[el('b','cc',e.currency),el('span','',[el('span','pill '+FX_TONE[e.decision],t('cs.fx.p.'+e.decision)),el('span','xw',words)])])});
  return dcard('ml-fx',t('cs.fx.title'),t('cs.fx.sub'),el('div','',[
    el('p','ml-thr',[ic('shield-check'),el('span','',thr===null?t('cs.fx.no_thr'):t('cs.fx.thr',{amt:mc('EUR',thr)}))]),
    ...open.map((p)=>fxProp(p,thr)),open.length?null:el('p','fine',t('cs.fx.none_open')),
    el('h3','ml-h3',t('cs.fx.exposure')),el('ul','ml-exp',exp),
    past.length?el('details','ctable',[el('summary','',t('cs.fx.past',{n:past.length})),...past.map((p)=>fxProp(p,thr))]):null]))}

async function cashView(){
  title(t('cs.nav.cash'));
  const d=await api('/v1/treasury'),T=d.treasury;
  if(!T){view().replaceChildren(head(t('cs.cash.title'),t('cs.cash.lede_none')),mlNone());return}
  const F=T.forecast,waiting=T.fx.proposals.filter((p)=>FX_WAIT.includes(p.status));
  const tiles=el('div','tiles ml-tiles',T.cash.map((c)=>{const s=F.currencies.find((x)=>x.currency===c.currency)||{below_floor_weeks:[],min_closing_cents:c.cents,min_week:0};const low=s.below_floor_weeks.length>0||c.cents<c.floor_cents;
    return tile(t('cs.cash.k_cur',{cur:c.currency}),'coins',mc(c.currency,c.cents),el('span','',[c.floor_cents?t('cs.cash.k_floor',{amt:mc(c.currency,c.floor_cents)})+' · ':'',t(low?'cs.cash.k_low':'cs.cash.k_ok',{amt:mc(c.currency,s.min_closing_cents),when:mlWhen(s.min_week)})]),low?'k-wait':'k-sky')}));
  tiles.append(tile(t('cs.cash.k_wait'),'scan-face',String(waiting.length),waiting.length?t('cs.cash.k_wait_sub',{ids:waiting.map((p)=>p.proposal_id).join(', ')}):t('cs.cash.k_wait_none'),waiting.length?'k-vio':'k-ok'));
  let pickC=(waiting[0]||{}).buy_currency||(F.currencies.find((c)=>c.below_floor_weeks.length)||F.currencies[0]||{}).currency;
  const box=el('div','ml-fcbox'),seg=el('div','ml-seg');seg.setAttribute('role','group');seg.setAttribute('aria-label',t('cs.cash.pick'));
  const draw=()=>{for(const b of seg.children)b.setAttribute('aria-pressed',String(b.dataset.c===pickC));box.replaceChildren(fcChart(T,pickC,Math.max(300,Math.min(820,box.clientWidth||600))))};
  for(const c of F.currencies){const b=el('button','',c.currency);b.type='button';b.dataset.c=c.currency;b.onclick=()=>{pickC=c.currency;draw()};seg.append(b)}
  const left=F.excluded.length?el('details','ctable ml-left',[el('summary','',t('cs.cash.left',{n:F.excluded.length})),el('ul','plain',F.excluded.map((x)=>el('li','',[el('code','idc',x.ref),mc(x.currency,x.cents),el('span','sub',x.why)])))]):null;
  view().replaceChildren(head(t('cs.cash.title'),t('cs.cash.lede')),mlTags(d,T.as_of,T.generated_at),tiles,
    el('div','ml-grid fx',[dcard('ml-fc',t('cs.cash.fc_title'),t('cs.cash.fc_sub'),el('div','',[seg,box,left])),fxCard(T)]),
    el('p','fine ml-foot',[ic('info'),el('span','',t('cs.cash.foot'))]));
  draw();riseIn();
}

// Receivables: an invoice's reminder steps (due + 3, + 10, + 20 days), drafted or still to come.
const AR_STEPS=[3,10,20];
const plusD=(d,n)=>{const x=new Date(String(d).slice(0,10)+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
function arDots(i,R){const drafted=new Set(R.dunning.filter((x)=>x.invoice_no===i.invoice_no).map((x)=>x.stage));const n=drafted.size;
  const s=el('span','ml-dots',AR_STEPS.map((d,k)=>{const on=drafted.has(k+1);const x=el('i',on?'on':'');x.title=t(on?'cs.ar.step_on':'cs.ar.step_off',{n:k+1,day:day(plusD(i.due_date,d))});return x}));
  s.setAttribute('role','img');s.setAttribute('aria-label',t('cs.ar.steps_of',{n}));return el('span','ml-st',[s,el('span','sub',n?t('cs.ar.steps_of',{n}):i.days_overdue?t('cs.ar.step_next',{day:day(plusD(i.due_date,3))}):t('cs.ar.steps_none'))])}
function arState(i){if(i.status==='PARTIAL')return el('span','pill warn',t('cs.ar.partial',{amt:mc(i.currency,i.paid_cents)}));if(i.days_overdue>0)return el('span','pill warn',t('cs.ar.k_late'));return el('span','pill sky',t('cs.ar.open'))}
const AR_OUT={MATCHED:['ok','e-ok'],MATCHED_TOLERANCE:['ok','e-ok'],PARTIAL:['sky','e-sky'],OVERPAID:['warn','e-wait'],REVIEW:['warn','e-wait']};
function arOutcome(p){const w=p.outcome==='MATCHED_TOLERANCE'?t('cs.ar.o.MATCHED_TOLERANCE',{amt:mc(p.currency,p.written_off_cents)}):p.outcome==='OVERPAID'?t('cs.ar.o.OVERPAID',{amt:mc(p.currency,p.suspense_cents)}):t('cs.ar.o.'+p.outcome);return el('span','pill '+AR_OUT[p.outcome][0],w)}
// The runner's reason for a payment to review, in the page's language where it is one Purser writes; else as written.
const AR_WHY=[[/^no invoice named and no open invoice is open for exactly this amount$/,(m)=>t('cs.ar.r.none')],[/^no invoice named and (\d+) open invoices are open for exactly this amount$/,(m)=>t('cs.ar.r.many',{n:m[1]})],
  [/^(\S+) overpaid by ([A-Z]{3}) (\d+)\.(\d{2}): a refund or a credit is the CFO's decision$/,(m)=>t('cs.ar.r.over',{inv:m[1],amt:mc(m[2],Number(m[3])*100+Number(m[4]))})],[/^the reference names (\d+) invoices$/,(m)=>t('cs.ar.r.refs',{n:m[1]})],
  [/^(\S+) is invoiced in ([A-Z]{3}), the payment is in ([A-Z]{3})$/,(m)=>t('cs.ar.r.cur',{inv:m[1],a:m[2],b:m[3]})]];
const arWhy=(s)=>{for(const [re,f] of AR_WHY){const m=re.exec(s);if(m)return f(m)}return s};
const mlRow=(cls,cells)=>el('div','ml-r'+(cls?' '+cls:''),cells);
const mlTh=(cells)=>el('div','ml-r th',cells.map((c,k)=>el('span',typeof c==='object'?c[1]:'',typeof c==='object'?c[0]:c)));

async function receivablesView(){
  title(t('cs.nav.ar'));
  const d=await api('/v1/receivables'),R=d.receivables;
  if(!R){view().replaceChildren(head(t('cs.ar.title'),t('cs.ar.lede_none')),mlNone());return}
  const open=R.invoices.filter((i)=>i.status==='OPEN'||i.status==='PARTIAL').sort((a,b)=>b.days_overdue-a.days_overdue||a.due_date.localeCompare(b.due_date)||a.invoice_no.localeCompare(b.invoice_no));
  const late=open.filter((i)=>i.days_overdue>0),matched=R.payments.filter((p)=>p.outcome!=='REVIEW');
  const openBy=mlSum(open,(i)=>i.amount_cents-i.paid_cents),lateBy=mlSum(late,(i)=>i.amount_cents-i.paid_cents),inBy=mlSum(matched,(p)=>p.applied_cents),revBy=mlSum(R.payments,(p)=>p.suspense_cents||0);
  // Waiting for a person: only what is held in suspense. An overpayment's applied part is already matched (v1.5.2 sweep:
  // EUR 1,425.00 counted the EUR 950.00 applied to NW-2026-136 twice; EUR 475.00 is held).
  const x=(m,s)=>{const o=others(m);return o?o+' · '+s:s};
  const tiles=el('div','tiles ml-tiles',[
    tile(t('cs.ar.k_open'),'receipt',money(openBy,mc('EUR',0)),x(openBy,t(open.length===1?'cs.ar.n_inv_1':'cs.ar.n_inv',{n:open.length})),'k-sky'),
    tile(t('cs.ar.k_late'),'clock',money(lateBy,mc('EUR',0)),x(lateBy,t(late.length===1?'cs.ar.n_inv_1':'cs.ar.n_inv',{n:late.length})),late.length?'k-wait':'k-ok'),
    tile(t('cs.ar.k_in'),'circle-check',money(inBy,mc('EUR',0)),x(inBy,t(matched.length===1?'cs.ar.n_pay_1':'cs.ar.n_pay',{n:matched.length})),'k-ok'),
    tile(t('cs.ar.k_review'),'inbox',money(revBy,mc('EUR',0)),R.review.length?t('cs.ar.k_review_sub',{n:R.review.length}):t('cs.ar.k_review_none'),R.review.length?'k-wait':'k-ok')]);
  // Aged debtors per currency: not yet due, then overdue by 1-30, 31-60, 61-90 and over 90 days; never added across currencies.
  const aged=el('div','ml-aged',R.aged.length?R.aged.map((a)=>{const nd=a.not_due_cents,b=a.buckets;const parts=[{l:t('cs.ar.b.not_due'),v:nd},{l:t('cs.ar.b.d30'),v:Math.max(0,b['0-30']-nd)},{l:t('cs.ar.b.d60'),v:b['31-60']},{l:t('cs.ar.b.d90'),v:b['61-90']},{l:t('cs.ar.b.d90p'),v:b['90+']}].map((p)=>Object.assign(p,{t:mc(a.currency,p.v)})).filter((p,k)=>p.v>0||k===0);
    return el('div','ml-ag',[el('b','cc',a.currency),segbar(parts,t('cs.ar.aged_cur',{cur:a.currency}))])}):[chartEmpty(t('cs.ar.none_open'))]);
  const drafts=R.dunning.slice().sort((a,b)=>b.due_on.localeCompare(a.due_on)||a.invoice_no.localeCompare(b.invoice_no));
  const dun=el('div','',[el('p','ml-rule',[ic('mail'),el('span','',t('cs.ar.dun_rule'))]),drafts.length?el('ol','ml-dun',drafts.map((r)=>el('li','',[el('span','ml-dn','#'+r.stage),el('span','',[el('b','',r.invoice_no),el('span','sub',t('cs.ar.dun_line',{n:r.stage,day:day(r.due_on)}))]),el('span','pill tmoney',t('cs.ar.draft'))]))):el('p','fine',t('cs.ar.dun_none'))]);
  const ar=el('div','card ml-list ml-ar',[mlTh([t('cs.ar.c.inv'),t('cs.ar.c.due'),[t('cs.ar.c.amount'),'amt hide-s'],[t('cs.ar.c.open'),'amt'],t('cs.ar.c.state'),t('cs.ar.c.steps')]),
    ...(open.length?open.map((i)=>mlRow(i.days_overdue||i.status==='PARTIAL'?'e-wait':'e-sky',[el('span','c1',[el('b','',i.invoice_no),el('span','sub',t('cs.ar.issued',{day:day(i.issue_date)})+(i.pay_link?' · '+t('cs.ar.link'):''))]),
      el('span','',[day(i.due_date),el('span','sub',i.days_overdue?t(i.days_overdue===1?'cs.ar.late_1':'cs.ar.late',{n:i.days_overdue}):t('cs.ar.not_due'))]),el('span','amt hide-s',mc(i.currency,i.amount_cents)),el('span','amt',mc(i.currency,i.amount_cents-i.paid_cents)),el('span','',arState(i)),arDots(i,R)])):[el('div','empty',t('cs.ar.none_open'))])]);
  const pays=el('div','card ml-list ml-pay',[mlTh([t('cs.ar.c.pay'),t('cs.ar.c.inv'),[t('cs.ar.c.amount'),'amt'],t('cs.ar.c.result')]),
    ...(R.payments.length?R.payments.map((p)=>mlRow(AR_OUT[p.outcome][1],[el('span','c1',[el('code','idc',p.payment_id),el('span','sub',stamp(p.received_at))]),el('span','',p.invoice_no?el('b','',p.invoice_no):el('span','sub',t('cs.ar.no_inv'))),el('span','amt',mc(p.currency,p.amount_cents)),
      el('span','',[arOutcome(p),el('span','sub',[p.applied_cents?t('cs.ar.applied',{amt:mc(p.currency,p.applied_cents)}):'',p.suspense_cents?(p.applied_cents?' · ':'')+t('cs.ar.held',{amt:mc(p.currency,p.suspense_cents)}):''].join(''))])])):[el('div','empty',t('cs.ar.none_pay'))])]);
  const rev=el('div','card ml-list ml-rev',[mlTh([t('cs.ar.c.pay'),t('cs.ar.c.ref'),[t('cs.ar.c.amount'),'amt'],t('cs.ar.c.why')]),
    ...(R.review.length?R.review.map((r)=>mlRow('e-wait',[el('span','c1',[el('code','idc',r.payment_id),el('span','sub',stamp(r.created_at))]),el('span','ref',r.reference?'\u201c'+r.reference+'\u201d':t('cs.ar.no_ref')),el('span','amt',mc(r.currency,r.amount_cents)),el('span','',[el('span','pill warn',t('cs.ar.waits')),el('span','sub',arWhy(r.reason))])])):[el('div','empty',t('cs.ar.none_review'))])]);
  const sec=(h,sub,body)=>el('section','section ml-sec',[el('div','ml-sh',[el('h2','',h),sub?el('p','',sub):null]),body]);
  view().replaceChildren(head(t('cs.ar.title'),t('cs.ar.lede')),mlTags(d,R.as_of,R.generated_at),tiles,
    el('div','ml-grid g2',[dcard('ml-agec',t('cs.ar.aged'),t('cs.ar.aged_sub'),aged),dcard('ml-dunc',t('cs.ar.dun'),t('cs.ar.dun_sub'),dun)]),
    sec(t('cs.ar.open_h'),t('cs.ar.open_sub'),ar),sec(t('cs.ar.pay_h'),t('cs.ar.pay_sub'),pays),sec(t('cs.ar.rev_h'),t('cs.ar.rev_sub'),rev),
    el('p','fine ml-foot',[ic('info'),el('span','',t('cs.ar.foot'))]));
  riseIn();
}
`;

export const MONEY_CSS = `
.ml-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: -6px 0 4px; }
.ml-tags .ml-gen { color: var(--muted); font-size: 12.5px; }
.tile.k-sky { --kc: var(--sky); } .tile.k-ok { --kc: var(--ok); } .tile.k-wait { --kc: var(--warn); } .tile.k-vio { --kc: var(--accent); }
.tiles.ml-tiles { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
@media (max-width: 1099px) { .tiles.ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .tiles.ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tiles.ml-tiles .tile:last-child { grid-column: auto; } .tiles.ml-tiles .tile:last-child:nth-child(odd) { grid-column: 1 / -1; } }
.tiles.ml-tiles .tile .x { overflow-wrap: anywhere; }
.ml-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin: 16px 0; align-items: start; }
@media (min-width: 1100px) { .ml-grid.fx { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); } .ml-grid.g2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.ml-grid > .dcard { min-width: 0; }
.ml-fc { box-shadow: inset 0 2px 0 var(--sky); } .ml-fx { box-shadow: inset 0 2px 0 var(--accent); } .ml-agec { box-shadow: inset 0 2px 0 var(--sky); } .ml-dunc { box-shadow: inset 0 2px 0 var(--warn); }
.ml-seg { display: inline-flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 10px; background: var(--sunken); margin: 0 0 10px; }
.ml-seg button { border: 0; background: none; font: 650 13px/1 Inter, system-ui, sans-serif; padding: 7px 12px; border-radius: 8px; color: var(--muted); cursor: pointer; }
.ml-seg button:hover { color: var(--text); }
.ml-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(16,24,40,.08), 0 1px 1px rgba(16,24,40,.04); }
.ml-seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.ml-fcbox { min-width: 0; }
.ml-chart svg { display: block; width: 100%; height: auto; }
svg.chart.mlfc .b.fc { fill: var(--sky); } svg.chart.mlfc .b.now { fill: color-mix(in srgb, var(--sky) 50%, var(--surface)); stroke: var(--sky); stroke-width: 1; } svg.chart.mlfc .b.low { fill: var(--warn); }
svg.chart.mlfc line.floor { stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 4; }
svg.chart.mlfc text.fl { fill: color-mix(in srgb, var(--warn) 82%, var(--text)); font-size: 11px; font-weight: 650; }
.klegend.ml-lg { display: flex; flex-wrap: wrap; gap: 6px 16px; list-style: none; margin: 8px 0 0; padding: 0; font-size: 12.5px; color: var(--muted); }
.klegend.ml-lg li { display: inline-flex; align-items: center; gap: 6px; }
.klegend.ml-lg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.klegend i.fc { background: var(--sky); } .klegend i.low { background: var(--warn); } .klegend i.floor { width: 14px; height: 0; border-radius: 0; border-top: 2px dashed var(--warn); }
.chtip .sw.fc { background: var(--sky); } .chtip .sw.low { background: var(--warn); }
.ml-left { margin-top: 12px; } .ml-left ul.plain li { gap: 6px 10px; font-size: 13px; } .ml-left .sub { flex-basis: 100%; color: var(--muted); font-size: 12px; }
.ml-thr { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 4px; padding: 9px 11px; border-radius: 10px; font-size: 13.5px; background: var(--accent-soft); color: color-mix(in srgb, var(--accent) 82%, var(--text)); }
.ml-thr .ic, .mp-pass .ic, .ml-rule .ic, .ml-foot .ic { flex: none; margin-top: 1px; display: inline-flex; }
.ml-prop { display: grid; gap: 8px; margin: 10px 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); }
.ml-prop.wait { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 11%, var(--surface)), var(--surface) 72%); box-shadow: inset 3px 0 var(--accent); }
.mp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.mp-what { margin: 0; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.ml-prop dl.read { margin: 0; }
.mp-pass { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 13px; font-weight: 550; color: color-mix(in srgb, var(--accent) 82%, var(--text)); }
.pill.appr { background: var(--accent-soft); color: color-mix(in srgb, var(--accent) 82%, var(--text)); --pi: var(--i-face); }
.pill.sky { background: color-mix(in srgb, var(--sky) 15%, transparent); color: color-mix(in srgb, var(--sky) 80%, var(--text)); --pi: var(--i-up); }
.pill.appr, .pill.sky { box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent); }
.pill.appr::before, .pill.sky::before { content: ""; display: inline-block; width: 12px; height: 12px; margin: 0 5px 0 -2px; vertical-align: -2px; background: currentColor; -webkit-mask: var(--pi) center/contain no-repeat; mask: var(--pi) center/contain no-repeat; }
.ml-h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 650; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.ml-exp { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ml-exp li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 12px; border-radius: 10px; background: var(--sunken); font-size: 13.5px; box-shadow: inset 3px 0 var(--xc, var(--border)); }
.ml-exp li.x-ok { --xc: var(--ok); } .ml-exp li.x-appr { --xc: var(--accent); } .ml-exp li.x-warn { --xc: var(--warn); } .ml-exp li.x-bad { --xc: var(--bad); }
.ml-exp li > span { display: grid; gap: 5px; justify-items: start; min-width: 0; } .ml-exp .xw { overflow-wrap: anywhere; line-height: 1.4; }
b.cc { font: 700 12.5px/1.9 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em; }
.ml-aged { display: grid; gap: 14px; } .ml-ag { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start; } .ml-ag .segwrap { min-width: 0; }
.ml-aged .seg span.s0 { background: var(--sky); } .ml-aged .seg span.s1 { background: color-mix(in srgb, var(--warn) 55%, var(--surface)); } .ml-aged .seg span.s2 { background: var(--warn); } .ml-aged .seg span.s3 { background: color-mix(in srgb, var(--bad) 70%, var(--warn)); } .ml-aged .seg span.s4 { background: var(--bad); }
.ml-aged .legend i.s0 { background: var(--sky); } .ml-aged .legend i.s1 { background: color-mix(in srgb, var(--warn) 55%, var(--surface)); } .ml-aged .legend i.s2 { background: var(--warn); } .ml-aged .legend i.s3 { background: color-mix(in srgb, var(--bad) 70%, var(--warn)); } .ml-aged .legend i.s4 { background: var(--bad); }
.ml-agec .chtip .sw.s0 { background: var(--sky); } .ml-agec .chtip .sw.s1 { background: color-mix(in srgb, var(--warn) 55%, var(--surface)); } .ml-agec .chtip .sw.s2 { background: var(--warn); } .ml-agec .chtip .sw.s3 { background: color-mix(in srgb, var(--bad) 70%, var(--warn)); } .ml-agec .chtip .sw.s4 { background: var(--bad); }
.ml-rule { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
.ml-dun { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ml-dun li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 11px; border-radius: 10px; background: var(--sunken); font-size: 13.5px; box-shadow: inset 3px 0 var(--warn); }
.ml-dun .ml-dn { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-weight: 700; font-size: 12.5px; background: var(--warn-soft); color: color-mix(in srgb, var(--warn) 82%, var(--text)); }
.ml-dun .sub, .ml-r .sub { display: block; color: var(--muted); font-size: 12px; font-weight: 500; }
.ml-sec { margin-top: 18px; } .ml-sh h2 { margin: 0; font-size: 17px; } .ml-sh p { margin: 3px 0 10px; color: var(--muted); font-size: 13.5px; }
.ml-list { padding: 0; overflow: clip; }
.ml-r { display: grid; align-items: center; gap: 12px; padding: 10px 16px; min-height: 52px; border-top: 1px solid var(--line, var(--border)); font-size: 13.5px; }
.ml-r:first-child { border-top: 0; }
.ml-r > * { min-width: 0; overflow-wrap: anywhere; }
.ml-r.th { min-height: 0; padding-top: 8px; padding-bottom: 8px; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), color-mix(in srgb, var(--sky) 6%, var(--surface))); color: color-mix(in srgb, var(--accent) 45%, var(--muted)); }
.ml-list > .ml-r:not(.th):nth-child(odd) { background-color: color-mix(in srgb, var(--accent) 3.5%, transparent); }
.ml-r .amt { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ml-r .c1 b, .ml-r > span > b { font-weight: 650; }
.ml-r.e-ok { box-shadow: inset 3px 0 var(--ok); } .ml-r.e-sky { box-shadow: inset 3px 0 var(--sky); } .ml-r.e-wait { box-shadow: inset 3px 0 var(--warn); } .ml-r.e-vio { box-shadow: inset 3px 0 var(--accent); }
.ml-r .pill { white-space: normal; line-height: 1.3; }
.ml-r .ref { color: var(--muted); font-style: italic; }
.ml-ar .ml-r { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, .9fr) minmax(0, .9fr) minmax(0, 1.25fr) minmax(0, 1.05fr); }
.ml-pay .ml-r { grid-template-columns: minmax(0, 1.2fr) minmax(0, .9fr) minmax(0, .8fr) minmax(0, 1.7fr); }
.ml-rev .ml-r { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, .8fr) minmax(0, 1.9fr); }
.ml-list .empty { padding: 18px 16px; color: var(--muted); font-size: 13.5px; }
.ml-st { display: grid; gap: 4px; justify-items: start; }
.ml-dots { display: inline-flex; gap: 5px; } .ml-dots i { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--warn) 45%, var(--border)); }
.ml-dots i.on { background: var(--warn); border-color: var(--warn); }
.ml-none .cmd { max-width: 420px; }
.ml-foot { display: flex; gap: 8px; align-items: flex-start; margin-top: 18px; color: var(--muted); }
@media (max-width: 760px) {
  .ml-list .ml-r.th { display: none; }
  .ml-list .ml-r { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 12px 14px; }
  .ml-list .ml-r > * { grid-column: 1 / -1; }
  .ml-list .ml-r > .c1 { grid-column: 1; grid-row: 1; }
  .ml-list .ml-r > .amt:not(.hide-s) { grid-column: 2; grid-row: 1; }
  .ml-list .ml-r > .hide-s { display: none; }
  .ml-dun li { grid-template-columns: 30px minmax(0, 1fr); } .ml-dun li > .pill { grid-column: 2; justify-self: start; }
}
`;
