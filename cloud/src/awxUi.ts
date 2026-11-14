// Purser Cloud's Airwallex tab (14 Nov): live, read-only, from the Airwallex sandbox through the site Worker's gateway
// (cloud/src/awxLive.ts, worker/src/awxRead.ts). One card per view, each loaded on its own: it says "Live from the
// Airwallex sandbox · <time>" with the time Airwallex was read, or "Airwallex sandbox unavailable" with the reason and a
// way to try again. Every id is shown in full with a copy button, so anyone can check it. Nothing on this page writes.
// Every value is put on the page as text (el() and textContent), never as HTML. The console's script carries this at
// __UI__ (cloud/src/console.ts), next to the other views.

export const AWX_UI_JS = String.raw`
// --- Airwallex (live, sandbox) ------------------------------------------------------------------------------------
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
  const body=el('div','awbody',el('p','sub',t('cs.awl.loading')));const stamp=el('span','awstamp');
  const card=el('section','card panel awcard aw-'+key,[el('div','th',[el('h2','',[ic(icon),' '+t(titleKey)]),stamp]),subText?el('p','sub',subText):null,body]);
  card.dataset.view=key;return {card,body,stamp}}
function awlUnavailable(slot,a,retry){slot.stamp.replaceChildren(el('span','awbad',[ic('triangle-alert'),t('cs.awl.unavailable')]));
  const again=btn(t('cs.awl.retry'),'','arrow-right');again.onclick=retry;
  slot.body.replaceChildren(el('div','awdown',[el('b','',t('cs.awl.unavailable')),el('p','sub',a&&a.reason?String(a.reason):t('cs.awl.no_answer')),again]))}
function awlLive(slot,a){slot.stamp.replaceChildren(el('span','awlive',[el('i',''),t('cs.awl.live',{time:awlTime(a.read_at)})]))}
const AWL_RENDER={
  balances(d){const all=d.balances||[];if(!all.length)return el('p','sub',t('cs.awl.empty'));
    // The sandbox holds a balance row for every currency it offers (46 live, 14 Nov); the ones at 0 are counted, not shown.
    const zero=(x)=>!(Number(x.total)||Number(x.available)||Number(x.pending)||Number(x.reserved));const b=all.filter((x)=>!zero(x)),nz=all.length-b.length;
    if(!b.length)return el('p','sub',t('cs.awl.bal_zero',{n:nz}));
    return el('div','',[el('div','awtiles',b.map((x)=>el('div','awtile',[el('span','awtl',x.currency),el('b','num',awlAmt(x.currency,x.available)),el('span','sub',t('cs.awl.bal_detail',{total:awlAmt('',x.total),pending:awlAmt('',x.pending)}))]))),nz?el('p','sub',t('cs.awl.bal_zero',{n:nz})):null])},
  rates(d){return el('div','awtiles',(d.rates||[]).map((r)=>el('div','awtile',[el('span','awtl',r.sell_currency+' → '+r.buy_currency),el('b','num',String(r.rate)),el('span','sub',t('cs.awl.rate_detail',{sell:r.sell_currency,rate:String(r.rate),buy:r.buy_currency}))])))},
  reconcile(d){
    const ok=d.computed&&d.differences===0&&d.checked>0;
    const sum=el('div','awrec '+(ok?'ok':'bad'),[ic(ok?'circle-check':'triangle-alert'),el('b','',ok?t('cs.awl.rec_zero',{n:d.checked}):t('cs.awl.rec_diff',{d:d.differences,m:d.matched,n:d.checked}))]);
    const rows=(d.movements||[]).map((m)=>el('tr','',[awlTd(m.label),awlTd(m.kind),awlTd(awlId(m.source_id)),awlTd(m.ledger,'num wrap'),awlTd(m.airwallex,'num wrap'),awlTd(el('span','obadge '+(m.matched?'ok':'bad'),[ic(m.matched?'circle-check':'ban'),t(m.matched?'cs.awl.matched':'cs.awl.unmatched')])),awlTd(m.reason,'sub')]));
    const extra=[];
    if((d.unknown_at_airwallex||[]).length)extra.push(el('p','note-bad',t('cs.awl.unknown',{n:d.unknown_at_airwallex.length})),awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.type')],[t('cs.awl.col.amount'),'r']],d.unknown_at_airwallex.map((u)=>el('tr','',[awlTd(awlId(u.id)),awlTd(u.sourceType),awlTd(u.amount,'num r')]))));
    const oos=Object.entries(d.out_of_scope||{});if(oos.length)extra.push(el('p','sub',t('cs.awl.out_scope',{list:oos.map(([k,v])=>k+' '+v).join(', ')})));
    return el('div','',[sum,el('p','sub',t('cs.awl.rec_rows',{rows:d.airwallex_rows,from:awlDay(d.window&&d.window.from)})),awlTable([[t('cs.awl.col.invoice')],[t('cs.awl.col.kind')],[t('cs.awl.col.awx_id')],[t('cs.awl.col.ledger')],[t('cs.awl.col.airwallex')],[t('cs.awl.col.result')],[t('cs.awl.col.reason')]],rows),...extra,el('p','links',[ext(d.ledger.url,t('cs.awl.ledger_record',{run:d.ledger.run}))])])},
  financial(d){const r=d.recent||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    return awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.type')],[t('cs.awl.col.amount'),'r'],[t('cs.awl.col.status')],[t('cs.awl.col.source')],[t('cs.awl.col.date')]],
      r.map((f)=>el('tr','',[awlTd(awlId(f.id)),awlTd(f.transaction_type||f.source_type),awlTd(awlAmt(f.currency,f.amount),'num r'),awlTd(f.status),awlTd(awlId(f.source_id)),awlTd(awlDay(f.created_at),'num')])))},
  transfers(d){const r=d.transfers||[];if(!r.length)return el('p','sub',t('cs.awl.empty'));
    const hash=(x)=>{if(!x.approval_sha256)return el('span','sub',t('cs.awl.no_hash'));const w=el('div','awhash',[awlId(x.approval_sha256)]);
      if(x.recorded)w.append(el('span','obadge '+(x.recorded.matches?'ok':'bad'),[ic(x.recorded.matches?'circle-check':'ban'),t(x.recorded.matches?'cs.awl.hash_match':'cs.awl.hash_differs',{inv:x.recorded.invoice})]));return w};
    return el('div','',[el('p','sub',t('cs.awl.with_hash',{n:d.with_approval_hash,all:r.length})),awlTable([[t('cs.awl.col.id')],[t('cs.awl.col.status')],[t('cs.awl.col.amount'),'r'],[t('cs.awl.col.beneficiary')],[t('cs.awl.col.approval')],[t('cs.awl.col.date')]],
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
    return el('div','',[cards,el('h3','tsec',t('cs.awl.auths')),auths])},
  calls(d){const e=d.endpoints||[];
    return el('div','',[el('p','awcalls',[el('b','num',String(d.total)),' '+t('cs.awl.calls_today',{day:d.day})]),e.length?awlTable([[t('cs.awl.col.endpoint')],[t('cs.awl.col.calls'),'r'],[t('cs.awl.col.ok'),'r']],e.map((x)=>el('tr','',[awlTd(el('code','',x.endpoint)),awlTd(String(x.calls),'num r'),awlTd(String(x.ok),'num r')]))):el('p','sub',t('cs.awl.empty')),
      el('p','fine',[ic('lock'),t('cs.awl.calls_rules',{s:d.cache_seconds,max:d.ceiling,min:d.per_minute})])])},
};
const AWL_META={balances:['wallet','cs.awl.balances','cs.awl.balances_sub'],rates:['zap','cs.awl.rates','cs.awl.rates_sub'],reconcile:['shield-check','cs.awl.reconcile','cs.awl.reconcile_sub'],
  financial:['receipt','cs.awl.financial','cs.awl.financial_sub'],transfers:['arrow-up-right','cs.awl.transfers','cs.awl.transfers_sub'],beneficiaries:['users','cs.awl.beneficiaries','cs.awl.beneficiaries_sub'],
  accounts:['landmark','cs.awl.accounts','cs.awl.accounts_sub'],issuing:['credit-card','cs.awl.issuing','cs.awl.issuing_sub'],calls:['clock','cs.awl.calls','cs.awl.calls_sub']};
async function awlLoad(key,slot){
  slot.body.replaceChildren(el('p','sub',t('cs.awl.loading')));slot.stamp.replaceChildren();
  let a;try{a=await api('/v1/airwallex-live/'+key)}catch(e){if(e instanceof Expired)throw e;a={source:'unavailable',reason:e.message}}
  if(!a||a.source!=='airwallex-sandbox'){awlUnavailable(slot,a,()=>awlLoad(key,slot));return a}
  awlLive(slot,a);try{slot.body.replaceChildren(AWL_RENDER[key](a.data||{}))}catch(e){awlUnavailable(slot,{reason:t('cs.awl.no_answer')},()=>awlLoad(key,slot))}
  return a}
async function airwallexView(){
  title(t('cs.nav.awx'));
  const m=await me();shell();
  const badges=el('div','awbadges',[el('span','awb',[ic('landmark'),t('cs.awl.b_sandbox')]),el('span','awb',[ic('flask'),t('cs.awl.b_test')]),el('span','awb',[ic('lock'),t('cs.awl.b_read')]),el('span','awb',t('cs.awl.b_built'))]);
  const slots={};for(const k of AWL_VIEWS){const [i,h,s]=AWL_META[k];slots[k]=awlCard(k,i,h,t(s))}
  const grid=(ks,cls)=>el('div','awgrid '+(cls||''),ks.map((k)=>slots[k].card));
  view().replaceChildren(head(t('cs.nav.awx'),t('cs.awl.lede')),badges,m.demo?note(t('cs.awl.demo_note')):null,
    grid(['balances','rates'],'two'),slots.reconcile.card,slots.transfers.card,slots.financial.card,slots.beneficiaries.card,slots.accounts.card,slots.issuing.card,slots.calls.card);
  // The calls panel last, so it counts this visit's reads.
  await Promise.all(AWL_VIEWS.filter((k)=>k!=='calls').map((k)=>awlLoad(k,slots[k]).catch((e)=>{if(e instanceof Expired)throw e})));
  await awlLoad('calls',slots.calls);
}
`;

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
.awcalls { margin: 4px 0 0; font-size: 15px; } .awcalls b { font-size: 22px; }
@media (max-width: 900px) { .awgrid.two { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) { .awt { min-width: 560px; } code.awid { font-size: 11px; } }
`;
