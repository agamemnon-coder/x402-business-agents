// The transactions page (src/servers/payables.ts at /transactions): the register of every money movement Purser knows
// (src/money/register.ts), on every rail. The same design, rules and script discipline as the payables pages: one
// module script with the response's nonce, every value rendered with textContent, nothing posted from here.

import { DEFAULT_LANG, t, type Lang } from "../ui/i18n.js";
import { COMMON, ICON_SET, shell, svg } from "./payablesPage.js";

const BODY = (lang: Lang) => `
<div class="head"><div><h1>${t(lang, "tx.h1")}</h1><p class="lede">${t(lang, "tx.lede")}</p></div>
<div class="tools"><a class="btn" id="csv" href="/api/payables/export/transactions.csv">${svg("download", 16)} CSV</a><a class="btn" id="json" href="/api/payables/export/transactions.json">${svg("download", 16)} JSON</a></div></div>
<p id="msg" role="status"></p>
<div class="tiles" id="tiles"></div>
<section class="section"><div class="bar" id="filters"><h2>${t(lang, "tx.register")}</h2></div>
<div class="bar"><select class="sel" id="period" aria-label="${t(lang, "tx.period")}"><option value="all">${t(lang, "tx.all_dates")}</option><option value="month">${t(lang, "tx.this_month")}</option><option value="30">${t(lang, "tx.last30")}</option></select>
<select class="sel" id="currency" aria-label="${t(lang, "tx.currency")}"><option value="">${t(lang, "tx.all_currencies")}</option></select>
<select class="sel" id="rec" aria-label="${t(lang, "tx.reconciliation")}"><option value="">${t(lang, "tx.every_state")}</option><option value="attention">${t(lang, "tx.attention")}</option><option value="matched">${t(lang, "rec.matched")}</option><option value="not_applicable">${t(lang, "rec.not_applicable")}</option></select>
<span class="grow"></span><input class="search" id="q" type="search" placeholder="${t(lang, "tx.search")}" aria-label="${t(lang, "tx.search_label")}"></div>
<div class="card list" id="list"></div></section>
<p class="foot">${t(lang, "tx.foot")}</p>
<div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" aria-label="${t(lang, "tx.drawer")}" aria-hidden="true"></aside>`;

const SCRIPT = `
const IC=${ICON_SET(["arrow-down-left", "arrow-up-right", "arrow-left-right", "chevron-right", "triangle-alert", "circle-check", "wallet", "receipt", "landmark", "shield-alert", "x", "external-link"])};
${COMMON}
let all=[],totals=[],check=null,railF='all';
const RAILS=['all','airwallex_transfer','airwallex_fx','airwallex_card','airwallex_airi','airwallex_receipt','metal','metal_clearing'].map(k=>[k,t('tx.rail.'+k)]);
const FLAG=(f)=>tk('flag.'+f,f);
const isIn=(r)=>r.flow==='in';
function periodOk(r){const v=$('#period').value;if(v==='all')return true;if(v==='month')return r.at.slice(0,7)===today.slice(0,7);const d=new Date(Date.now()-30*86400000).toISOString().slice(0,10);return r.at.slice(0,10)>=d}
function shown(){const cur=$('#currency').value,rec=$('#rec').value,q=$('#q').value.trim().toLowerCase();
  return all.filter(r=>(railF==='all'||r.rail===railF)&&(!cur||r.currency===cur)&&periodOk(r)&&(!rec||(rec==='attention'?(r.moved&&r.reconciliation!=='matched')||r.flags.length:r.reconciliation===rec))
    &&(!q||[r.id,r.counterparty,r.description,r.proof||'',r.invoice?r.invoice.supplier_no:''].some(s=>String(s).toLowerCase().includes(q))))}
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const l=el('div','l',[ic(icon),label]);const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(l,v);if(extra)t.append(el('div','x',extra));return t}
function sums(rows,pick){const m=new Map();for(const r of rows){const k=pick(r);if(!k)continue;const c=Math.round(Number(k.amount)*100);m.set(k.currency,(m.get(k.currency)||0)+c)}return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([currency,c])=>({currency,total:(c/100).toFixed(2)}))}
function first(a,none){if(!a.length)return none;const s=el('span');s.append(el('small','',cur(a[0].currency)),amount(a[0].total));return s}
const others=(a)=>a.slice(1).map(x=>ma(x.currency,x.total)).join(' · ');
function tiles(){const tl=$('#tiles');tl.replaceChildren();const month=all.filter(r=>r.moved&&r.at.slice(0,7)===today.slice(0,7));
  const ins=sums(month.filter(r=>r.direction==='in'),r=>r),outs=sums(month.filter(r=>r.direction==='out'),r=>r),fees=sums(month,r=>r.fee);
  const open=all.filter(r=>r.moved&&r.reconciliation!=='matched');const noAppr=check?check.without_approval.length:0;
  const why=[['missing_booking',t('tx.not_booked')],['missing_rail_record',t('tx.no_proof_short')],['amount_mismatch',t('tx.differ')]].map(([k,w])=>{const n=all.filter(r=>r.reconciliation===k).length;return n?n+' '+w:null}).filter(Boolean).join(' · ');
  tl.append(tile(t('tx.tile.in'),'arrow-down-left',first(ins,t('none')),others(ins)||(ins.length?'':t('tx.no_money_in'))),
    tile(t('tx.tile.out'),'arrow-up-right',first(outs,t('none')),others(outs)||(outs.length?'':t('tx.nothing_paid'))),
    tile(t('tx.tile.fees'),'receipt',first(fees,t('none')),others(fees)||t('tx.rails_charged')),
    tile(t('tx.tile.unreconciled'),'shield-alert',String(open.length),why||t('tx.all_matched'),open.length?'alert':'calm'),
    tile(t('tx.tile.no_approval'),'landmark',String(noAppr),noAppr?t('tx.moved_no_approval'):t('tx.all_approved'),noAppr?'alert':'calm'))}
function filters(){const bar=$('#filters');bar.querySelectorAll('.chip').forEach(c=>c.remove());for(const [k,label] of RAILS){const n=k==='all'?all.length:all.filter(r=>r.rail===k).length;if(k!=='all'&&!n)continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(railF===k));b.onclick=()=>{railF=k;filters();rows()};bar.append(b)}}
function statusChip(r,full){const cls=r.moved?'moved':/^(failed|declined|refused|aborted|settlement failed)/.test(r.status_words)?'void':'idle';const w=data('status',r.status_words);const s=chip(cls,full?w:w.split(':')[0]);s.title=w;return s}
function recChip(r){const w=tk('rec.'+r.reconciliation,r.reconciliation_words);const s=chip(r.reconciliation,w);s.title=w;return s}
function rows(){const list=$('#list');list.replaceChildren();
  if(!all.length){list.append(el('div','empty',[el('b','',t('tx.empty')),t('tx.empty_sub')]));return}
  list.append(el('div','trow th',[el('span','',t('date')),el('span','',t('what')),el('span','',t('rail')),el('span','amt',t('amount')),el('span','',t('status')),el('span','',t('books')),el('span','')]));
  const rs=shown();if(!rs.length){list.append(el('div','empty',[el('b','',t('nothing_here')),t('tx.no_match')]));return}
  for(const r of rs){const b=el('button','trow');b.type='button';b.onclick=()=>open(r.id);
    const dir=el('span','dir '+(isIn(r)?'in':'out'));dir.append(ic(r.direction==='internal'?'arrow-left-right':isIn(r)?'arrow-down-left':'arrow-up-right'));
    const desc=data('description',r.description);const what=el('span','what',[dir,data('counterparty',r.counterparty)||desc]);what.append(el('span','sub',desc+(r.invoice&&r.invoice.ap_id?' · '+r.invoice.ap_id:'')));what.title=desc;
    const amt=el('span','amt'+(!r.moved?' void':isIn(r)?' in':''),[el('span','c',cur(r.currency)),(r.moved?(isIn(r)?'+':'−'):'')+amount(r.amount)]);
    const rail=el('span','rail',[tk('rail.'+r.rail,r.rail_label),el('span','sub',r.proof?String(r.proof).slice(0,18)+(String(r.proof).length>18?'…':''):t('tx.no_proof_short'))]);
    b.append(el('span','when',day(r.at)),what,rail,amt,el('span','stc',[statusChip(r)]),el('span','recc',[recChip(r)]),ic('chevron-right'));b.lastChild.className='go';list.append(b)}}
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=v;d.append(dd)}return d};
function open(id){const r=all.find(x=>x.id===id);if(!r)return;history.replaceState(null,'','#'+encodeURIComponent(id));
  const d=$('#drawer');d.replaceChildren();const x=el('button','btn x');x.type='button';x.setAttribute('aria-label',t('close'));x.append(ic('x'));x.onclick=close;
  const big=el('div','big num',[el('small','',cur(r.currency)),(r.moved?(isIn(r)?'+':'−'):'')+amount(r.amount)]);
  const desc=data('description',r.description);d.append(x,el('div','kicker',tk('rail.'+r.rail,r.rail_label)+' · '+(r.direction==='internal'?t('tx.between_own'):r.direction==='in'?t('tx.money_in'):t('tx.money_out'))),el('h2','',data('counterparty',r.counterparty)||desc),big,el('div','chips',[statusChip(r,true),recChip(r)]));
  for(const f of r.flags)d.append(el('div','flag',[ic('triangle-alert'),FLAG(f)]));
  if(r.moved&&!r.flags.length)d.append(el('div','flag ok',[ic('circle-check'),t('flag.ok')]));
  const inv=r.invoice?(r.invoice.ap_id?(()=>{const a=el('a','',r.invoice.supplier_no+' · '+r.invoice.ap_id);a.href='/invoices/'+encodeURIComponent(r.invoice.ap_id);return a})():r.invoice.supplier_no):null;
  const sec=(title,node)=>{const s=el('section');s.append(el('h3','',title),node);d.append(s)};
  sec(t('tx.movement'),dl([[t('tx.when'),stamp(r.at)],[t('what'),desc],[t('tx.counterparty'),data('counterparty',r.counterparty)],[t('dt.account'),r.counterparty_account,'mono'],[t('amount'),ma(r.currency,r.amount)],[t('tx.in_euro'),r.eur_equivalent&&r.currency!=='EUR'?ma('EUR',r.eur_equivalent):null],[t('tx.fee'),r.fee?ma(r.fee.currency,r.fee.amount):null],[t('status'),data('status',r.status_words)],[t('invoice'),inv]]));
  const a=r.approval;const dec=a.decision?tk('decision.'+a.decision.toLowerCase(),a.decision.toLowerCase()):null;sec(t('tx.approval'),dl([[t('tx.authority'),data('authority',a.authority)],[t('tx.proposal'),a.proposal_id,'mono'],[t('tx.decision'),dec?(a.method?t('tx.with',{decision:dec,method:a.method==='passkey'?t('tx.passkey'):a.method}):dec):(a.required?t('tx.none_on_file'):null)],[t('tx.when'),a.approved_at?stamp(a.approved_at):null],[t('tx.terms_hash'),a.terms_sha256?a.terms_sha256.slice(0,16)+'…':null,'mono']]));
  sec(t('books'),dl([[t('tx.state'),tk('rec.'+r.reconciliation,r.reconciliation_words)],[t('tx.entries'),r.booking.entry_ids.length?r.booking.entry_ids.join(', '):t('tx.none')],[t('tx.accounts'),r.booking.accounts.join(', ')],[t('tx.bank_lines'),r.booking.booked?ma(r.currency,r.booking.booked):null]]));
  sec(t('tx.proof'),dl([[t('tx.from_rail'),r.proof||t('tx.none'),'mono'],[t('tx.register_id'),r.id,'mono']]));
  d.classList.add('open');d.setAttribute('aria-hidden','false');$('#scrim').classList.add('open');x.focus()}
function close(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#scrim').classList.remove('open');history.replaceState(null,'',location.pathname)}
$('#scrim').onclick=close;window.addEventListener('hashchange',()=>{const h=decodeURIComponent(location.hash.slice(1));if(h)open(h);else close()});document.addEventListener('keydown',(e)=>{if(e.key==='Escape')close()});
for(const s of ['#period','#currency','#rec'])$(s).onchange=rows;$('#q').oninput=rows;
async function load(){const j=await fetch('/api/payables/transactions').then(r=>{if(!r.ok)throw new Error(r.statusText);return r.json()});
  all=j.rows;totals=j.totals;check=j.check;
  const cur=$('#currency');for(const t of totals){const o=document.createElement('option');o.value=t.currency;o.textContent=t.currency;cur.append(o)}
  tiles();filters();rows();const h=decodeURIComponent(location.hash.slice(1));if(h)open(h)}
load().catch(e=>{const m=$('#msg');m.textContent=t('tx.load_failed',{error:e.message});m.className='bad'});
`;

export function transactionsPage(csrf: string, nonce: string, lang: Lang = DEFAULT_LANG): string {
  return shell({ title: t(lang, "tx.title"), csrf, nonce, body: BODY(lang), script: SCRIPT, page: "transactions", lang });
}
