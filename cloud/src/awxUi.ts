// Purser Cloud's Airwallex tab (14 Nov): live, read-only, from the Airwallex sandbox through the site Worker's gateway
// (cloud/src/awxLive.ts, worker/src/awxRead.ts). One card per view, each loaded on its own: it says "Live from the
// Airwallex sandbox · <time>" with the time Airwallex was read, or "Airwallex sandbox unavailable" with the reason and a
// way to try again. Every id is shown in full with a copy button, so anyone can check it. Nothing on this page writes.
// Every value is put on the page as text (el() and textContent), never as HTML. The console's script carries this at
// __UI__ (cloud/src/console.ts), next to the other views.

import { AIRWALLEX_LOGO_DATA_URL } from "./awxLogo.gen.js";

export const AWX_UI_JS = String.raw`
// --- Airwallex (live, sandbox) ------------------------------------------------------------------------------------
// The official wordmark, unaltered, as "Built on Airwallex" (cloud/src/awxLogo.gen.ts).
const AWL_LOGO=__AWL_LOGO__;
function awlLogo(cls){const i=el('img','awlogo'+(cls?' '+cls:''));i.src=AWL_LOGO;i.alt='Airwallex';i.decoding='async';return i}
const awlPill=()=>el('span','awpill',[el('i',''),t('cs.awl.pill')]);
// A figure counts up once, from 0, when the page is in view and motion is allowed; it always ends on Airwallex's own
// figure (set again after the animation's time, so a tab hidden half way never keeps a figure that is not the real one).
function awlCount(node,v,fmt){node.textContent=fmt(v);const target=Number(v);if(!isFinite(target)||target===0||RM()||document.visibilityState!=='visible')return;
  const t0=performance.now(),d=800;node.textContent=fmt((0).toFixed(2));
  const step=(n)=>{const k=Math.min(1,(n-t0)/d);if(k>=1){node.textContent=fmt(v);return}node.textContent=fmt((target*(1-Math.pow(1-k,3))).toFixed(2));requestAnimationFrame(step)};
  requestAnimationFrame(step);setTimeout(()=>{node.textContent=fmt(v)},d+400)}
const awlSkel=()=>{const s=el('div','awskel',[el('i',''),el('i',''),el('i','')]);s.setAttribute('aria-hidden','true');return s};
// The currencies of Purser's books first, then the rest by code.
const AWL_ORDER=['EUR','USD','GBP'];const awlOrder=(a,b)=>{const i=AWL_ORDER.indexOf(a.currency),j=AWL_ORDER.indexOf(b.currency);return (i<0?9:i)-(j<0?9:j)||String(a.currency).localeCompare(String(b.currency))};
const awlZero=(x)=>!(Number(x.total)||Number(x.available)||Number(x.pending)||Number(x.reserved));
const AWL_VIEWS=['balances','rates','reconcile','financial','transfers','beneficiaries','accounts','issuing','calls'];
const awlTime=(iso)=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString(L.lang==='nl'?'nl-NL':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'})+' UTC'};
// An id in full, in a code face, with a copy button: what a judge can check at Airwallex.
function awlId(id){if(!id)return el('span','sub','—');const c=el('code','awid',String(id));const b=btn(t('cs.claude.copy'),'mini awcopy','copy');b.setAttribute('aria-label',t('cs.claude.copy')+' '+id);
  b.onclick=async()=>{try{await navigator.clipboard.writeText(String(id));b.replaceChildren(ic('circle-check'),t('cs.copied'))}catch(x){const r=document.createRange();r.selectNodeContents(c);const s=getSelection();s.removeAllRanges();s.addRange(r)}};
  return el('span','awidw',[c,b])}
const awlAmt=(c,v)=>v===null||v===undefined||v===''?'—':(c?cur(c)+' ':'')+(/^-?\d+(\.\d+)?$/.test(String(v))?amount(Number(v).toFixed(2)):String(v));
const awlDay=(iso)=>iso?dday(String(iso).replace(/([+-]\d\d)(\d\d)$/,'$1:$2')):'—';
function awlTable(heads,rows){const tb=el('tbody','',rows);return el('div','awscroll',[el('table','table awt',[el('thead','',[el('tr','',heads.map((h)=>el('th',h[1]||'',h[0])))]),tb])])}
const awlTd=(v,cls)=>el('td',cls||'',v instanceof Node?v:v===null||v===undefined||v===''?'—':String(v));
// One card: its title, what it reads, then the live answer or the plain reason it has none.
function awlCard(key,icon,titleKey,subText){
  const body=el('div','awbody',awlSkel());const stamp=el('span','awstamp');
  const card=el('section','card panel awcard aw-'+key,[el('div','th',[el('h2','',[ic(icon),' '+t(titleKey)]),stamp]),subText?el('p','sub',subText):null,body]);
  card.dataset.view=key;return {card,body,stamp}}
function awlUnavailable(slot,a,retry){slot.stamp.replaceChildren(el('span','awbad',[ic('triangle-alert'),t('cs.awl.unavailable')]));
  const again=btn(t('cs.awl.retry'),'','arrow-right');again.onclick=retry;
  slot.body.replaceChildren(el('div','awdown',[el('b','',t('cs.awl.unavailable')),el('p','sub',a&&a.reason?String(a.reason):t('cs.awl.no_answer')),again]))}
function awlLive(slot,a){slot.stamp.replaceChildren(el('span','awlive',[el('i',''),t('cs.awl.live',{time:awlTime(a.read_at)})]))}
const AWL_RENDER={
  balances(d){const all=d.balances||[];if(!all.length)return el('p','sub',t('cs.awl.empty'));
    // The sandbox holds a row for every currency it offers (46 live, 14 Nov): the ones with money first and big, the
    // ones at 0 folded into one line that opens.
    const b=all.filter((x)=>!awlZero(x)).sort(awlOrder),z=all.filter(awlZero);
    if(!b.length)return el('p','awcalm',t('cs.awl.bal_all_zero',{n:z.length}));
    const tiles=el('div','awtiles',b.map((x)=>{const v=el('b','num');awlCount(v,x.available,(n)=>awlAmt('',n));
      return el('div','awtile big',[el('span','awtl',x.currency),v,el('span','sub',t('cs.awl.bal_detail',{total:awlAmt('',x.total),pending:awlAmt('',x.pending)}))])}));
    const zeros=z.length?el('details','awzero',[el('summary','',t('cs.awl.bal_zero',{n:z.length})),el('div','chips',z.map((x)=>el('span','mchip',x.currency)))]):null;
    return el('div','',[el('p','awline',t('cs.awl.bal_line',{n:b.length})),tiles,zeros])},
  rates(d){return el('div','awtiles',(d.rates||[]).map((r)=>el('div','awtile big',[el('span','awtl',t('cs.awl.rate_buy',{buy:r.buy_currency,sell:r.sell_currency})),
    el('b','num',r.says||String(r.rate)),el('span','sub',r.says?t('cs.awl.rate_pair',{pair:r.base+'/'+r.quote}):t('cs.awl.rate_nopair'))])))},
  reconcile(d){
    const ok=d.computed&&d.differences===0&&d.checked>0;
    const sum=el('div','awrec '+(ok?'ok':'bad'),[ic(ok?'circle-check':'triangle-alert'),el('b','',ok?t('cs.awl.rec_zero',{n:d.checked}):t('cs.awl.rec_diff',{d:d.differences,m:d.matched,n:d.checked}))]);
    const rows=(d.movements||[]).map((m)=>el('tr','',[awlTd(m.label),awlTd(m.kind),awlTd(awlId(m.source_id)),awlTd(m.ledger,'num wrap'),awlTd(m.airwallex,'num wrap'),awlTd(el('span','obadge '+(m.matched?'ok':'bad'),[ic(m.matched?'circle-check':'ban'),t(m.matched?'cs.awl.matched':'cs.awl.unmatched')])),awlTd(m.reason,'sub')]));
    const extra=[];
    if((d.unknown_at_airwallex||[]).length)extra.push(el('p','note-bad',t('cs.awl.unknown',{n:d.unknown_at_airwallex.length})),awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.type')],[t('cs.awl.col.amount'),'r']],d.unknown_at_airwallex.map((u)=>el('tr','',[awlTd(awlId(u.id)),awlTd(u.sourceType),awlTd(u.amount,'num r')]))));
    const oos=Object.entries(d.out_of_scope||{});if(oos.length)extra.push(el('p','sub',t('cs.awl.out_scope',{list:oos.map(([k,v])=>k+' '+v).join(', ')})));
    return el('div','',[sum,el('p','sub',t('cs.awl.rec_rows',{rows:d.airwallex_rows,from:awlDay(d.window&&d.window.from)})),awlTable([[t('cs.awl.col.invoice')],[t('cs.awl.col.kind')],[t('cs.awl.col.awx_id')],[t('cs.awl.col.ledger')],[t('cs.awl.col.airwallex')],[t('cs.awl.col.result')],[t('cs.awl.col.reason')]],rows),...extra,el('p','links',[ext(d.ledger.url,t('cs.awl.ledger_record',{run:d.ledger.run}))])])},
  financial(d){const r=d.recent||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    return el('div','',[d.recent_cut?el('p','sub',t('cs.awl.ft_cut',{n:d.recent_rows})):null,awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.type')],[t('cs.awl.col.amount'),'r'],[t('cs.awl.col.status')],[t('cs.awl.col.source')],[t('cs.awl.col.date')]],
      r.map((f)=>el('tr','',[awlTd(awlId(f.id)),awlTd(f.transaction_type||f.source_type),awlTd(awlAmt(f.currency,f.amount),'num r'),awlTd(f.status),awlTd(awlId(f.source_id)),awlTd(awlDay(f.created_at),'num')])))])},
  transfers(d){const r=d.transfers||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    const hash=(x)=>{if(!x.approval_sha256)return el('span','sub',t('cs.awl.no_hash'));const w=el('div','awhash',[awlId(x.approval_sha256)]);
      if(x.recorded)w.append(el('span','obadge '+(x.recorded.matches?'ok':'bad'),[ic(x.recorded.matches?'circle-check':'ban'),t(x.recorded.matches?'cs.awl.hash_match':'cs.awl.hash_differs',{inv:x.recorded.invoice})]));return w};
    // The headline: each recorded payout read back live by id, Airwallex's hash next to the one the CFO signed.
    const rb=(d.readback||[]).map((x)=>el('div','awrb '+(x.matches?'ok':'bad'),[el('div','awrbh',[el('span','obadge '+(x.matches?'ok':'bad'),[ic(x.matches?'circle-check':'ban'),t(x.matches?'cs.awl.rb_match':'cs.awl.rb_differs')]),el('b','',x.invoice),el('span','sub',[x.status||'',' · ',awlAmt(x.currency,x.amount)])]),
      dl([[t('cs.awl.col.id'),awlId(x.id)],[t('cs.awl.rb_awx'),awlId(x.airwallex_sha256)],[t('cs.awl.rb_signed'),awlId(x.signed_sha256)]])]));
    return el('div','',[rb.length?el('div','awrbs',[el('h3','tsec',t('cs.awl.rb_title')),...rb]):null,el('p','sub',t('cs.awl.with_hash',{n:d.with_approval_hash,all:r.length})),awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.status')],[t('cs.awl.col.amount'),'r'],[t('cs.awl.col.beneficiary')],[t('cs.awl.col.approval')],[t('cs.awl.col.date')]],
      r.map((x)=>el('tr','',[awlTd(awlId(x.id)),awlTd(x.status),awlTd(awlAmt(x.currency,x.amount),'num r'),awlTd(awlId(x.beneficiary_id)),awlTd(hash(x)),awlTd(awlDay(x.created_at),'num')]))),el('p','links',[ext(d.record.url,t('cs.awl.run_record',{run:d.record.run}))])])},
  beneficiaries(d){const r=d.beneficiaries||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    const chk=(b)=>b.payee_check?el('span','obadge '+(b.payee_check.match==='FULL_MATCH'?'ok':'wait'),t('cs.awl.check_recorded',{match:b.payee_check.match,day:awlDay(b.payee_check.at)})):el('span','sub',b.status?b.status:t('cs.awl.no_check'));
    return el('div','',[awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.name')],[t('cs.awl.col.account')],[t('cs.awl.col.methods')],[t('cs.awl.col.validation')]],
      r.map((b)=>el('tr','',[awlTd(awlId(b.id)),awlTd(b.name||b.nickname),awlTd([b.country,b.currency,b.iban_last4?'•••• '+b.iban_last4:b.account_number_last4?'•••• '+b.account_number_last4:''].filter(Boolean).join(' · ')),awlTd((b.methods||[]).join(', ')),awlTd(chk(b))]))),el('p','links',[ext(d.payee_check_record,t('cs.awl.payee_record'))])])},
  accounts(d){const r=d.accounts||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    return el('div','awaccts',r.map((a)=>el('div','awacct',[el('div','awah',[el('b','',a.name||a.nickname||'—'),a.status?el('span','obadge '+(a.status==='ACTIVE'?'ok':'wait'),a.status):null]),
      dl([[t('cs.awl.col.id'),awlId(a.id)],[t('cs.awl.k.bank'),a.institution],[t('cs.awl.k.country'),a.country],[t('cs.awl.k.currency'),a.currency],[t('cs.awl.k.number'),a.iban_last4?'IBAN •••• '+a.iban_last4:a.account_number_last4?'•••• '+a.account_number_last4:null],[t('cs.awl.k.swift'),a.swift,'mono'],...(a.routing||[]).map((x)=>[x.type,x.value,'mono'])])])))},
  issuing(d){const c=d.cards||[],tx=d.transactions||[];
    const lim=(x)=>(x.limits||[]).map((l)=>(x.currency?cur(x.currency)+' ':'')+amount(Number(l.amount).toFixed(2))+' '+String(l.interval).toLowerCase().replace(/_/g,' ')).join(' · ')||'—';
    const cards=c.length?awlTable([[t('cs.awl.col.agent')],[t('cs.awl.col.card')],[t('cs.awl.col.status')],[t('cs.awl.col.limits')],[t('cs.awl.col.mcc')]],
      c.map((x)=>el('tr','',[awlTd(x.agent||x.nickname),awlTd(el('span','',[awlId(x.id),x.last4?el('span','sub',' •••• '+x.last4):null])),awlTd(x.status),awlTd(lim(x)),awlTd((x.merchant_categories||[]).join(', '))]))):el('p','sub',t('cs.awl.empty'));
    const auths=tx.length?awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.card')],[t('cs.awl.col.type')],[t('cs.awl.col.status')],[t('cs.awl.col.amount'),'r'],[t('cs.awl.col.merchant')]],
      tx.map((x)=>el('tr','',[awlTd(awlId(x.id)),awlTd(awlId(x.card_id)),awlTd(x.type),awlTd(x.status),awlTd(awlAmt(x.currency,x.amount),'num r'),awlTd([x.merchant,x.mcc?'MCC '+x.mcc:''].filter(Boolean).join(' · '))]))):el('p','sub',t('cs.awl.no_auths'));
    const cut=(on,n)=>on?el('p','sub',t('cs.awl.iss_cut',{n})):null;
    return el('div','',[cut(d.cards_cut,d.cards_read),cards,el('h3','tsec',t('cs.awl.auths')),cut(d.transactions_cut,d.transactions_read),auths])},
  calls(d){const e=d.endpoints||[];
    return el('div','',[el('p','awcalls',[el('b','num',String(d.total)),' '+t('cs.awl.calls_today',{day:d.day})]),e.length?awlTable([[t('cs.awl.col.endpoint')],[t('cs.awl.col.calls'),'r'],[t('cs.awl.col.ok'),'r']],e.map((x)=>el('tr','',[awlTd(el('code','',x.endpoint)),awlTd(String(x.calls),'num r'),awlTd(String(x.ok),'num r')]))):el('p','sub',t('cs.awl.empty')),
      el('p','fine',[ic('lock'),t('cs.awl.calls_rules',{s:d.cache_seconds,max:d.ceiling,min:d.per_minute})])])},
};
const AWL_META={balances:['wallet','cs.awl.balances','cs.awl.balances_sub'],rates:['zap','cs.awl.rates','cs.awl.rates_sub'],reconcile:['shield-check','cs.awl.reconcile','cs.awl.reconcile_sub'],
  financial:['receipt','cs.awl.financial','cs.awl.financial_sub'],transfers:['arrow-up-right','cs.awl.transfers','cs.awl.transfers_sub'],beneficiaries:['users','cs.awl.beneficiaries','cs.awl.beneficiaries_sub'],
  accounts:['landmark','cs.awl.accounts','cs.awl.accounts_sub'],issuing:['credit-card','cs.awl.issuing','cs.awl.issuing_sub'],calls:['clock','cs.awl.calls','cs.awl.calls_sub']};
async function awlLoad(key,slot){
  slot.body.replaceChildren(awlSkel());slot.stamp.replaceChildren();
  let a;try{a=await api('/v1/airwallex-live/'+key)}catch(e){if(e instanceof Expired)throw e;a={source:'unavailable',reason:e.message}}
  if(!a||a.source!=='airwallex-sandbox'){awlUnavailable(slot,a,()=>awlLoad(key,slot));return a}
  awlLive(slot,a);try{slot.body.replaceChildren(AWL_RENDER[key](a.data||{}))}catch(e){awlUnavailable(slot,{reason:t('cs.awl.no_answer')},()=>awlLoad(key,slot))}
  return a}
// The live events feed: what Airwallex sent the site's webhook, signature verified, newest first (worker/src/awxEvents.ts).
const awlWhen=(iso)=>iso?awlDay(iso)+' '+awlTime(iso):'—';
async function awlEvents(slot){
  slot.body.replaceChildren(awlSkel());slot.stamp.replaceChildren();
  let a;try{a=await api('/v1/airwallex-live/events')}catch(e){if(e instanceof Expired)throw e;a={source:'unavailable',reason:e.message}}
  if(!a||a.source!=='airwallex-webhooks'){awlUnavailable(slot,a,()=>awlEvents(slot));return}
  const ev=a.events||[];
  slot.stamp.replaceChildren(...(ev.length?[el('span','awlive',[el('i',''),t('cs.awl.ev_last',{time:awlWhen(a.last_event_at)})])]:[]));
  if(!ev.length){slot.body.replaceChildren(el('p','sub',a.receiving?t('cs.awl.ev_none'):t('cs.awl.ev_off')));return}
  slot.body.replaceChildren(awlTable([[t('cs.awl.col.event')],[t('cs.awl.col.object')],[t('cs.awl.col.received')],[t('cs.awl.ev_verified')]],
    ev.map((x)=>el('tr','',[awlTd(el('span','awev',[el('b','',x.topic),el('code','',x.type)])),awlTd(awlId(x.object_id||x.event_id)),awlTd(awlWhen(x.received_at),'num'),awlTd(el('span','obadge ok',[ic('circle-check'),t('cs.awl.ev_verified')]))]))))}
// The Overview's live card (14 Nov): the Airwallex sandbox's money and one rate, read now, apart from the demo month.
// Live measurement, 15 Nov: the card could sit as a skeleton for about 4 s. It says it is reading, with a spinner; when the
// live read takes over 2 s it shows this browser's last live read (kept in localStorage, marked with its time) until the
// live answer lands. Never a figure the sandbox did not give: the cache is a past live read, said as such.
const AWL_OV_KEY='purser.awl.ov';
const awlReading=()=>{const p=el('p','awreading',[el('i','awspin'),t('cs.awl.reading')]);p.setAttribute('role','status');return p};
function awlOverview(){
  const body=el('div','awov-b',awlReading()),stamp=el('span','awstamp');
  const go=el('a','awov-go',[t('cs.awl.ov_open'),' ',ic('arrow-right')]);go.href='#/airwallex';
  const card=el('section','card awov rise',[el('div','awov-h',[awlLogo('sm'),awlPill(),stamp]),el('p','sub awov-s',t('cs.awl.ov_sub')),body,go]);
  const draw=(b,r,cached)=>{
    stamp.replaceChildren(cached?el('span','awcached',[ic('clock'),t('cs.awl.cached',{time:awlTime(b.read_at)})]):el('span','awlive',[el('i',''),t('cs.awl.live',{time:awlTime(b.read_at)})]));
    const nz=((b.data&&b.data.balances)||[]).filter((x)=>!awlZero(x)).sort(awlOrder).slice(0,3);
    const rate=r&&r.source==='airwallex-sandbox'?((r.data&&r.data.rates)||[]).find((x)=>x.says):null;
    const figs=nz.map((x)=>{const v=el('b','num');if(cached)v.textContent=awlAmt('',x.available);else awlCount(v,x.available,(n)=>awlAmt('',n));return el('div','awov-f',[el('span','awtl',x.currency),v])});
    body.replaceChildren(el('div','awov-row',[...(figs.length?figs:[el('p','awcalm',t('cs.awl.bal_all_zero',{n:((b.data&&b.data.balances)||[]).length}))]),
      rate?el('div','awov-f rate',[el('span','awtl',t('cs.awl.rate_buy',{buy:rate.buy_currency,sell:rate.sell_currency})),el('b','num',rate.says)]):null]))};
  let done=false;
  setTimeout(()=>{if(done)return;let c=null;try{c=JSON.parse(localStorage.getItem(AWL_OV_KEY)||'null')}catch(e){c=null}
    if(c&&c.b&&c.b.source==='airwallex-sandbox')draw(c.b,c.r,true)},2000);
  (async()=>{try{
    const [b,r]=await Promise.all([api('/v1/airwallex-live/balances'),api('/v1/airwallex-live/rates')]);done=true;
    if(b.source!=='airwallex-sandbox'){stamp.replaceChildren();body.replaceChildren(el('p','sub',t('cs.awl.unavailable')+(b.reason?': '+b.reason:'')));return}
    try{localStorage.setItem(AWL_OV_KEY,JSON.stringify({b,r}))}catch(e){}
    draw(b,r,false);
  }catch(e){done=true;if(!(e instanceof Expired)){stamp.replaceChildren();body.replaceChildren(el('p','sub',t('cs.awl.unavailable')))}}})();
  return card}
async function airwallexView(){
  title(t('cs.nav.awx'));
  const m=await me();shell();
  const badges=el('div','awbadges',[el('span','awb',[ic('landmark'),t('cs.awl.b_sandbox')]),el('span','awb',[ic('flask'),t('cs.awl.b_test')]),el('span','awb',[ic('lock'),t('cs.awl.b_read')]),el('span','awb',t('cs.awl.b_built'))]);
  const slots={};for(const k of AWL_VIEWS){const [i,h,s]=AWL_META[k];slots[k]=awlCard(k,i,h,t(s))}
  const evSlot=awlCard('events','inbox','cs.awl.events',t('cs.awl.events_sub'));
  const grid=(ks,cls)=>el('div','awgrid '+(cls||''),ks.map((k)=>slots[k].card));
  const top=el('div','head awhead',[el('div','',[el('div','awbrand',[awlLogo(),awlPill()]),el('h1','',t('cs.awl.h1')),el('p','lede',t('cs.awl.lede'))])]);
  view().replaceChildren(top,badges,m.demo?note(t('cs.awl.demo_note')):null,
    slots.balances.card,slots.rates.card,slots.reconcile.card,evSlot.card,slots.transfers.card,slots.financial.card,slots.beneficiaries.card,slots.accounts.card,slots.issuing.card,slots.calls.card);
  // The cards rise in one after another; with reduced motion the CSS shows them at once.
  AWL_VIEWS.forEach((k,n)=>{const c=slots[k].card;c.classList.add('rise');c.style.transitionDelay=(n*60)+'ms'});
  evSlot.card.classList.add('rise');evSlot.card.style.transitionDelay='180ms';
  requestAnimationFrame(()=>{for(const k of AWL_VIEWS)slots[k].card.classList.add('in');evSlot.card.classList.add('in')});
  // The calls panel last, so it counts this visit's reads.
  await Promise.all([...AWL_VIEWS.filter((k)=>k!=='calls').map((k)=>awlLoad(k,slots[k]).catch((e)=>{if(e instanceof Expired)throw e})),awlEvents(evSlot).catch((e)=>{if(e instanceof Expired)throw e})]);
  await awlLoad('calls',slots.calls);
}
`.replace("__AWL_LOGO__", () => JSON.stringify(AIRWALLEX_LOGO_DATA_URL));

export const AWX_UI_CSS = `
/* The Airwallex tab (14 Nov): live sandbox cards, ids in full with a copy button, tables that scroll inside their card. */
.awbadges { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
.awb { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: var(--sunken); color: var(--text); font-size: 13px; font-weight: 600; }
.awb .ic svg { width: 14px; height: 14px; }
.awgrid { display: grid; gap: 16px; margin-top: 16px; }
.awgrid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#view > .awcard { margin-top: 16px; }
.awcard { min-width: 0; }
.awcard .th { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.awcard .th h2 { margin: 0; display: inline-flex; align-items: center; gap: 6px; }
.awstamp { font-size: 12.5px; color: var(--muted); }
.awlive, .awbad { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-weight: 600; }
.awlive { background: var(--ok-soft); color: var(--ok); }
.awlive i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); display: inline-block; }
.awbad { background: var(--warn-soft); color: var(--warn); }
.awbad .ic svg { width: 13px; height: 13px; }
.awdown { display: grid; gap: 6px; justify-items: start; padding: 12px 14px; border-radius: 10px; background: var(--sunken); }
.awdown p { margin: 0; }
.awtiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.awtile { display: grid; gap: 2px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; min-width: 0; }
.awtile .awtl { font-size: 12px; font-weight: 700; letter-spacing: .05em; color: var(--muted); }
.awtile b { font-size: 19px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.awscroll { overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; margin-top: 8px; }
.awt { min-width: 640px; }
.awt td { vertical-align: top; }
.awt th, .awt td { white-space: nowrap; }
.awt td.wrap, .awt td.sub { white-space: normal; min-width: 200px; }
.awt code.awid { word-break: normal; }
.awhash code.awid { white-space: normal; word-break: break-all; display: inline-block; min-width: 240px; max-width: 300px; }
.awt td.r, .awt th.r { text-align: right; }
.awidw { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; }
code.awid { font-size: 12px; word-break: break-all; background: var(--sunken); padding: 2px 6px; border-radius: 6px; }
.btn.mini.awcopy { padding: 3px 7px; min-height: 0; font-size: 12px; flex: none; }
.awhash { display: grid; gap: 4px; justify-items: start; }
.awrec { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; font-size: 15px; }
.awrec.ok { background: var(--ok-soft); color: var(--ok); }
.awrec.bad { background: var(--bad-soft); color: var(--bad); }
.awaccts { display: grid; gap: 12px; }
.awacct { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.awah { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
/* The feed keeps 50: the card scrolls inside itself, its header row stays in sight. */
.aw-events .awscroll { max-height: 460px; overflow-y: auto; }
.aw-events .awt thead th { position: sticky; top: 0; z-index: 1; }
.awev { display: inline-grid; gap: 2px; } .awev code { font-size: 12px; color: var(--muted); }
.awrbs { display: grid; gap: 10px; margin-bottom: 14px; }
.awrb { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.awrb.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); background: color-mix(in srgb, var(--ok) 5%, var(--surface)); }
.awrb.bad { border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); }
.awrbh { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.awrb dl.read code.awid { word-break: break-all; white-space: normal; }
.awcalls { margin: 4px 0 0; font-size: 15px; } .awcalls b { font-size: 22px; }
@media (max-width: 900px) { .awgrid.two { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) { .awt { min-width: 560px; } code.awid { font-size: 11px; } }
/* 14 Nov, the polish: the logo, a live dot that pulses, a skeleton while loading, big figures, the Overview card. */
.awbrand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
img.awlogo { height: 22px; width: auto; display: block; }
img.awlogo.sm { height: 16px; }
/* 15 Nov: the official file is dark letters; on a dark scheme it sits on a white chip, unaltered (as the site's tiles do). */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) img.awlogo { background: #fff; padding: 4px 8px; border-radius: 6px; box-sizing: content-box; } }
.awpill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font-size: 12.5px; font-weight: 700; letter-spacing: .02em; }
.awpill i, .awlive i { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); display: inline-block; flex: none; }
.awskel { display: grid; gap: 10px; padding: 4px 0; }
.awreading { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: var(--muted); font-size: 14px; }
.awspin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: awspin .8s linear infinite; flex: none; }
@keyframes awspin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .awspin { animation: none; } }
.awcached { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12.5px; }
.awskel i { display: block; height: 14px; border-radius: 6px; background: var(--sunken); }
.awskel i:nth-child(1) { width: 62%; height: 22px; } .awskel i:nth-child(2) { width: 88%; } .awskel i:nth-child(3) { width: 45%; }
.awtile.big b { font-size: clamp(19px, 2vw, 26px); letter-spacing: -.01em; white-space: nowrap; overflow-wrap: normal; }
.aw-balances .awtiles, .aw-rates .awtiles { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
#view > .awcard.aw-balances { margin-top: 16px; }
.awline { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
.awcalm { margin: 4px 0; color: var(--muted); }
details.awzero { margin-top: 12px; }
details.awzero summary { cursor: pointer; color: var(--muted); font-size: 13.5px; font-weight: 600; }
details.awzero .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.card.awov { padding: 18px 20px; margin: 0 0 16px; display: grid; gap: 10px; border-color: color-mix(in srgb, var(--ok) 30%, var(--border)); }
.awov-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.awov-h .awstamp { margin-left: auto; }
.awov-s { margin: 0; }
.awov-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.awov-f { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--sunken); min-width: 0; }
.awov-f b { font-size: 20px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.awov-f.rate b { font-size: 16px; }
.awov-go { justify-self: start; display: inline-flex; align-items: center; gap: 6px; font-weight: 650; color: var(--accent); text-decoration: none; }
.awov-go:hover { text-decoration: underline; }
@media (prefers-reduced-motion: no-preference) {
  .awpill i::after, .awlive i::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--ok); animation: awpulse 1.8s ease-out infinite; }
  @keyframes awpulse { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(2.8); opacity: 0; } }
  .awskel i { background: linear-gradient(90deg, var(--sunken) 0%, color-mix(in srgb, var(--sunken) 40%, var(--surface)) 50%, var(--sunken) 100%); background-size: 200% 100%; animation: awshimmer 1.2s linear infinite; }
  @keyframes awshimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
}
@media (max-width: 520px) { .awtile.big b { font-size: 20px; } .aw-balances .awtiles, .aw-rates .awtiles { grid-template-columns: minmax(0, 1fr); } .awov-h .awstamp { margin-left: 0; } }
`;
