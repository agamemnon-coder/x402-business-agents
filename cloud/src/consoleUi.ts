// Purser Cloud's console, the CFO's pass (14 Nov, Max: "a lot of text and not nice visuals… the decisions I can barely
// understand at Agents… make it just Invoices and make it more clear"). The views a CFO reads first, in the console's own
// script (cloud/src/console.ts puts this in at __UI__) and its own design tokens:
//   Overview   the next action first, four figures, the cash line and the invoices ring, the decisions as a short
//              timeline with who acted (an agent, Purser's code, the CFO, the rail), six rows and "Show all"
//   Agents     one card per agent: its card as a card, its limits as settings with a meter (spent this month against the
//              monthly limit), may and may not, newest decisions as sentences with what they came to; model and runs in
//              a fold. Read only: changing a limit stays a proposal the CFO signs with Face ID
//   Invoices   the invoices only (the books have their own tab)
//   Books      the balance sheet per currency (no wrapped "EUR"), the VAT overview, the journal and the exports
//   An invoice a document: supplier, number, dates, lines with VAT, totals; the trail from read to booked as a stepper;
//              the PDF as received; the ledger entries it produced
// Every figure on these pages is read from the API's answer; nothing is typed in here.

export const UI_JS = String.raw`
// --- Overview -----------------------------------------------------------------------------------------------------
const WHO_IC={agent:'bot',code:'shield-check',cfo:'scan-face',rail:'landmark'};
// The audit trail as a timeline: an icon for who acted, one sentence, the day. Six rows, then "Show all".
function timeline(D,shown){
  const rows=D.feed.map((f)=>{const li=el('li','tl-'+f.tone+' by-'+(f.by||'code'),[el('span','tlic',ic(WHO_IC[f.by]||'shield-check')),el('div','tlb',[el('span','tlw',f.who),el('p','',f.text)]),el('time','num',dday(f.at))]);li.querySelector('time').dateTime=String(f.at||'');return li});
  const ol=el('ol','tline',rows);if(rows.length<=shown)return ol;
  rows.forEach((r,k)=>{if(k>=shown)r.hidden=true});
  const more=btn(t('cs.ov.show_all',{n:rows.length}),'linkbtn','chevron-down');more.setAttribute('aria-expanded','false');
  more.onclick=()=>{const open=more.getAttribute('aria-expanded')!=='true';rows.forEach((r,k)=>{if(k>=shown)r.hidden=!open});more.setAttribute('aria-expanded',String(open));more.replaceChildren(ic('chevron-down'),open?t('cs.ov.show_less'):t('cs.ov.show_all',{n:rows.length}))};
  return el('div','',[ol,more])}
async function overviewView(){
  title(t('cs.nav.overview'));
  const [m,x,all,D]=await Promise.all([me(),api('/v1/insights'),api('/v1/invoices?limit=200'),api('/v1/dashboard').catch((e)=>{if(e instanceof Expired)throw e;return null})]);shell();
  const items=all.items||[];
  const blocked=Object.entries(x.blocked_by_reason||{}).sort((a,b)=>b[1]-a[1]);const nb=blocked.reduce((n,[,c])=>n+c,0);
  // The next thing to do, from the same invoices: the CFO's Face ID first, then what needs a person.
  const wait=items.filter(i=>i.status==='waiting_cfo'),faceid=wait.length,todo=items.filter(i=>['ready','needs_review','needs_vendor'].includes(i.status)).length;
  const nx=el('a','card next hero'+(faceid||todo?' act':''));nx.href=faceid?'#/invoices?f=waiting_cfo':'#/invoices?f=act';
  const first=wait[0];
  nx.append(el('span','nic',ic(faceid?'scan-face':todo?'triangle-alert':'circle-check')),el('div','nb',[el('span','nl',t('cs.next.label')),el('b','',faceid?t(faceid===1?'cs.next.faceid_1':'cs.next.faceid_n',{n:faceid}):todo?t(todo===1?'cs.next.todo_1':'cs.next.todo_n',{n:todo}):t('cs.next.done')),
    el('span','ns',faceid?t('cs.next.faceid_go'):todo?t('cs.next.todo_go'):t('cs.next.done_sub'))]),
    first?el('div','nw',[el('span','nv',first.vendor||''),el('b','num',ma(first.currency,first.total))]):null,faceid||todo?el('span','ngo',[faceid?t('cs.ov.review'):t('cs.ov.go_open'),ic('chevron-right')]):null);
  // Four figures: cash, what is open to pay, what waits for the CFO's Face ID, what is blocked.
  const open=byCur(x.open_net_cents),over=byCur(x.overdue_cents),waitAmt={};for(const i of wait)waitAmt[i.currency]=(waitAmt[i.currency]||0)+toCents(i.total);
  const fig=(label,icon,value,sub,tone)=>{const v=el('b','num');if(value instanceof Node)v.append(value);else v.textContent=value;return el('div','card kpi rise'+(tone?' '+tone:''),[el('span','kl',[ic(icon),label]),v,sub?el('span','ks',sub):null])};
  const cash=D&&D.money?fig(t('cs.ov.cash'),'wallet',amt(D,toCents(D.money.net)),t('cs.dash.net_sub',{date:dday(D.since)}),toCents(D.money.net)>=0?'pos':'neg'):null;
  const k=el('div','kpis',[cash,
    fig(t('cs.ov.payables'),'receipt',open.length?cur(open[0][0])+' '+cents(open[0][1]):t('cs.nothing_open'),over.length?t('cs.ov.overdue',{amount:over.map(([c,v])=>cur(c)+' '+cents(v)).join(' · ')}):t('cs.ov.none_overdue'),over.length?'neg':''),
    fig(t('cs.ov.faceid'),'scan-face',String(x.waiting.for_cfo),byCur(waitAmt).length?byCur(waitAmt).map(([c,v])=>cur(c)+' '+cents(v)).join(' · '):t('cs.ov.nothing_waits'),x.waiting.for_cfo?'wait':''),
    fig(t('cs.t.blocked'),'octagon-x',String(nb),blocked.length?tk('cs.w.f.'+blocked[0][0],t('cs.w.blocked')):t('cs.x.none_blocked'),nb?'neg':'')].filter(Boolean));
  // When the open invoices fall due, in their main currency (other currencies are said, not mixed in).
  const opn=items.filter(i=>!['paid','rejected'].includes(i.status));const per={};for(const i of opn)per[i.currency]=(per[i.currency]||0)+toCents(i.total);
  const main=Object.entries(per).sort((a,b)=>b[1]-a[1])[0];const days=(d)=>Math.round((Date.parse(d)-Date.parse(today))/86400000);
  const b=[0,0,0,0];for(const i of opn){if(!main||i.currency!==main[0])continue;const n=i.due_date?days(i.due_date):99999;b[n<=0?0:n<=7?1:n<=30?2:3]+=toCents(i.total)}
  const lab=['cs.due.late','cs.due.d7','cs.due.d30','cs.due.later'];
  const due=el('section','card dcard rise due',[el('div','dh',[el('h2','',t('cs.due.title'))]),main?segbar(b.map((v,k)=>({l:t(lab[k]),v,t:cur(main[0])+' '+cents(v)})),t('cs.due.title')):el('p','lede',t('cs.due.none')),
    Object.keys(per).length>1?el('p','fine',t('cs.due.other_cur')):null]);
  const inbox=m.inbox?el('p','inbox',[ic('mail'),t('cs.mail_to'),el('b','mono',m.inbox)]):null;
  const nodes=[head(t('cs.nav.overview'),t('cs.overview_lede',{name:m.tenant.name||''})),nx,k];
  if(D&&D.cash&&D.cash.length){
    const wide=innerWidth>=980,full=view().clientWidth||960;const cashW=Math.round(wide?full*0.64-40:full-40),weekW=Math.round(wide?full*0.5-44:full-40);
    const sub=D.agents.by_fallback?t(ME&&ME.demo?'cs.dash.decisions_fallback_demo':'cs.dash.decisions_fallback',{n:D.agents.by_fallback,a:D.agents.decisions-D.agents.by_fallback}):t('cs.dash.decisions_sub');
    nodes.push(el('div','dgrid g1',[dcard('cash',t('cs.dash.cash_title'),t('cs.dash.cash_sub',{cur:cur(D.currency),date:dday(D.since)}),el('div','cv',[cashChart(D,cashW)])),
        dcard('inv',t('cs.dash.inv_title'),t('cs.dash.inv_sub',{cur:cur(D.currency)}),invoiceRing(D))]),
      el('div','dgrid g1',[dcard('feedc',t('cs.dash.feed_title'),sub,timeline(D,6)),el('div','stack',[due,dcard('weeks',t('cs.dash.appr_title'),t('cs.dash.appr_sub'),el('div','',[el('div','cv',[weekChart(D,Math.round(wide?full*0.36-40:weekW))]),el('ul','klegend',[el('li','',[el('i','cfo'),t('cs.dash.appr_cfo')]),el('li','',[el('i','alone'),t('cs.dash.appr_alone')])])]))])]),
      dcard('spend',t('cs.dash.spend_title'),t('cs.dash.spend_sub',{cur:cur(D.currency)}),spendBars(D)));
  }else nodes.push(due);
  if(inbox)nodes.push(inbox);
  nodes.push(whatCloud(m));
  view().replaceChildren(...nodes);
  // Every card rises in on the next frame; with reduced motion the CSS shows all at once.
  requestAnimationFrame(()=>{for(const n of view().querySelectorAll('.rise'))n.classList.add('in')});
}

// --- Agents -------------------------------------------------------------------------------------------------------
const OUTCOME={paid:['circle-check','ok'],declined:['ban','bad'],asked:['scan-face','wait'],note:['circle-dot','info']};
// The agent's Airwallex card, drawn as a card: its last four, its brand where the record has one, active or frozen.
function bankCard(a,demo){
  const c=a.card;const frozen=a.status!=='active';
  return el('div','bcard'+(frozen?' frozen':''),[el('div','bct',[el('span','bcb','Airwallex'),el('span','bcs',[ic(frozen?'snowflake':'circle-check'),tk('cs.agents.card_status.'+(frozen?'frozen':'active'),frozen?'Frozen':'Active')])]),
    el('span','bcchip'),el('div','bcn num',[el('span','bcd','•••• •••• •••• '),c.last4]),
    el('div','bcf',[el('span','',a.name),el('span','bcbr',c.brand||t('cs.agents.virtual'))])])}
function limitRow(icon,label,value,extra){return el('div','lim',[el('span','limic',ic(icon)),el('div','limb',[el('span','liml',label),extra||null]),el('b','limv num',value)])}
function agentCard(a,demo){
  const st=el('span','ast '+String(a.status).replace(/[^a-z]/g,''),[ic(a.status==='active'?'circle-check':a.status==='paused'?'snowflake':'ban'),' '+tk('cs.agents.status.'+a.status,a.status)]);
  const hd=el('div','ah',[el('span','av',ic('bot')),el('div','',[el('h2','',a.name),el('p','sub',a.job)]),st]);
  let settings;
  if(a.card){const c=a.card;const C=cur(c.currency)+' ';
    const spent=c.spent_month!==null&&c.spent_month!==undefined&&c.per_month?toCents(c.spent_month):null,cap=c.per_month?toCents(c.per_month):0;
    const mon=c.month?MONTHS[Number(c.month.slice(5,7))-1]+' '+c.month.slice(0,4):'';
    const bar=spent===null?null:(()=>{const m=el('span','lbar'+(spent>=cap?' full':''));const f=el('span','');f.style.width=(cap>0?Math.min(100,spent/cap*100):0).toFixed(1)+'%';m.append(f);m.setAttribute('role','img');m.setAttribute('aria-label',t('cs.agents.spent_of',{spent:C+cents(spent),cap:C+cents(cap),month:mon}));return m})();
    settings=el('div','lims',[el('h3','',t('cs.agents.limits_h')),
      c.per_purchase?limitRow('credit-card',t('cs.agents.lim_purchase'),C+amount(c.per_purchase)):null,
      c.per_month?limitRow('calendar-range',t('cs.agents.lim_month'),C+amount(c.per_month),spent===null?null:el('div','limm',[bar,el('span','sub',t('cs.agents.spent_of',{spent:C+cents(spent),cap:C+cents(cap),month:mon}))])):null,
      c.pays_for?el('div','lim cats',[el('span','limic',ic('receipt')),el('div','limb',[el('span','liml',t('cs.agents.lim_merchants')),el('div','chips',c.pays_for.split(/,\s*/).map((w)=>el('span','mchip',w)))])]):null,
      el('p','fine',[ic('lock'),t('cs.agents.change_note')])]);
  }else settings=el('div','lims',[el('h3','',t('cs.agents.limits_h')),el('p','sub',t('cs.agents.no_card'))]);
  const top=el('div','atop',[a.card?el('div','bcwrap',[bankCard(a,demo),demo?el('p','fine',[ic('flask'),t('cs.agents.card_demo')]):null]):null,settings]);
  const rules=el('div','rules',[el('div','',[el('h3','',t('cs.agents.may')),el('ul','can',a.may.map((x)=>el('li','',[ic('circle-check'),el('span','',x)])))]),
    el('div','',[el('h3','',t('cs.agents.may_not')),el('ul','cannot',a.may_not.map((x)=>el('li','',[ic('ban'),el('span','',x)])))])]);
  const dec=el('div','adec',[el('h3','',t('cs.agents.decisions')),a.decisions.length?el('ul','outs',a.decisions.map((d)=>{const o=OUTCOME[d.outcome]||OUTCOME.note;
    return el('li','',[el('span','obadge '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[d.outcome]?d.outcome:'note'))]),el('span','otext',d.text.replace(/\s*\(code's fallback, no model\)$/,'')),el('time','num',day(d.at))])})):el('p','sub',t('cs.agents.no_decisions'))]);
  // The technical record, one click away: the Claude model, its runs, the rails, who decided each of the newest decisions.
  const det=el('details','adet',[el('summary','',t('cs.agents.details')),el('div','agrid',[
    el('div','',[el('h3','',t('cs.agents.model')),a.models.length?el('p','mono',a.models.join(', ')):el('p','sub',t('cs.agents.no_model')),a.runs&&a.runs.total?el('p','sub',t('cs.agents.runs',{n:a.runs.total,k:a.runs.without_model})):null]),
    el('div','',[el('h3','',t('cs.agents.rails')),a.rails.length?el('p','',a.rails.join(', ')):el('p','sub',t('cs.agents.no_rail')),a.spent||a.declined?el('p','sub',t('cs.agents.moved',{n:a.spent,k:a.declined})):null]),
    el('div','',[el('h3','',t('cs.agents.decided')),el('ul','plain',a.decisions.filter((d)=>d.decided_by).map((d)=>el('li','sub',day(d.at)+' · '+d.decided_by)))]),
    a.status_since?el('div','',[el('h3','',t('cs.agents.status_h')),el('p','',tk('cs.agents.status.'+a.status,a.status)+' '+t('cs.agents.since',{day:day(a.status_since)}))]):null])]);
  return el('section','card agent rise',[hd,top,rules,dec,det])}
async function agentsView(){
  title(t('cs.nav.agents'));
  const [m,r]=await Promise.all([me(),api('/v1/agents')]);shell();
  const cards=(r.agents||[]).map((a)=>agentCard(a,!!m.demo));
  view().replaceChildren(...[head(t('cs.nav.agents'),t('cs.agents.lede2')+(m.demo?' '+t('cs.agents.read_only'):'')),
    cards.length?el('div','agents',cards):el('div','card empty',[el('b','',t('cs.agents.none'))]),note(t('cs.agents.controls'))]);
  requestAnimationFrame(()=>{for(const n of view().querySelectorAll('.rise'))n.classList.add('in')});
}

// --- Books --------------------------------------------------------------------------------------------------------
async function booksView(){
  title(t('cs.nav.ledger'));
  const now=new Date();const qs=[];for(let k=0;k<6;k++){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-3*k,1));qs.push(d.getUTCFullYear()+'Q'+(Math.floor(d.getUTCMonth()/3)+1))}
  const pick=el('select','field');for(const v of qs){const o=el('option','',v);o.value=v;pick.append(o)}
  const vat=el('div','card panel');const journal=el('div','card panel');
  // With an engine, its archive is one link away from the books.
  const arch=(await engineStatus())?(()=>{const a=el('a','btn',[ic('file-text'),t('cs.eng.open_archive')]);a.href='#/archive';return a})():null;
  const bal=el('div','card panel balance',[el('h2','',t('cs.books.balance')),el('p','sub',t('loading'))]);
  view().replaceChildren(head(t('cs.nav.ledger'),ME&&ME.demo?t('cs.books.demo_lede2'):t('cs.books.lede2'),arch?[arch]:null),el('div','split2',[el('div','stack',[bal,vat]),journal]),exportsCard());
  // The balance sheet from the ledger (GET /v1/reports/balance), one block per currency: what the company owns, owes
  // and is worth, and whether it balances. A block, not a table row, so nothing wraps on a phone (14 Nov).
  api('/v1/reports/balance').then((b)=>{const blocks=[];for(const [c,v] of Object.entries(b.by_currency||{})){
      const row=(k,val)=>el('div','bsr',[el('span','',t(k)),el('b','num',cur(c)+' '+cents(val||0))]);
      blocks.push(el('div','bsc',[el('div','bsh',[el('b','',c),v.balanced?el('span','ast active',[ic('circle-check'),t('cs.books.balanced')]):el('span','ast revoked',t('cs.books.not_balanced'))]),row('cs.books.assets',v.assets_cents),row('cs.books.liabilities',v.liabilities_cents),row('cs.books.equity',v.equity_cents)]))}
    bal.replaceChildren(el('h2','',t('cs.books.balance')),el('p','sub',t('cs.books.balance_at',{day:day(b.to)})),blocks.length?el('div','bsheet',blocks):el('p','sub',t('cs.no_entries')))},
    (e)=>{if(!(e instanceof Expired))bal.replaceChildren(el('h2','',t('cs.books.balance')),note(e.message,'bad'))});
  async function drawVat(){
    const v=await api('/v1/reports/vat?quarter='+encodeURIComponent(pick.value));
    const tbl=el('table','table vat',[el('thead','',[el('tr','',[el('th','',t('cs.rubric')),el('th','sh',t('cs.vat.share')),el('th','r',t('cs.base')),el('th','r',t('dt.vat'))])])]);const tb=el('tbody','');
    const maxBase=Math.max(0,...Object.values(v.rubrics||{}).map(r=>Math.abs(r.base_cents||0)));
    const eur=(c)=>cur('EUR')+' '+cents(c);
    for(const [k,r] of Object.entries(v.rubrics||{})){if(!r.base_cents&&!r.vat_cents)continue;tb.append(el('tr','',[el('td','',RUBRIC(k)),el('td','sh',meter(Math.abs(r.base_cents||0),maxBase)),el('td','r',eur(r.base_cents)),el('td','r',eur(r.vat_cents))]))}
    // VAT a supplier abroad charged (13 Nov: German 19%): its own row, outside the Dutch return's boxes and not in 5b.
    const fv=v.foreign_vat;if(fv&&fv.lines)tb.append(el('tr','',[el('td','',t('cs.vat_foreign',{n:fv.lines})),el('td',''),el('td','r',eur(fv.base_cents)),el('td','r',eur(fv.vat_cents))]));
    // No rubric row: the quarter may still hold input VAT (5b), so "nothing" is said only when 5a and 5b are nil too.
    if(!tb.children.length)tb.append(el('tr','',[el('td','',t(v.owed_5a_cents||v.input_5b_cents?'cs.no_rubrics':'cs.nothing_quarter')),el('td',''),el('td',''),el('td','')]));
    tb.append(el('tr','tot',[el('td','',el('b','',t('cs.owed_5a'))),el('td',''),el('td',''),el('td','r',eur(v.owed_5a_cents))]),el('tr','tot',[el('td','',el('b','',t('cs.input_5b'))),el('td',''),el('td',''),el('td','r',eur(v.input_5b_cents))]),el('tr','tot',[el('td','',el('b','',t('cs.balance_5c'))),el('td',''),el('td',''),el('td','r',el('b','',eur(v.balance_5c_cents)))]));
    tbl.append(tb);
    vat.replaceChildren(el('h2','',t('cs.vat_overview')),el('div','form-row',[el('div','',[el('label','',t('cs.quarter')),pick])]),el('div','scroll',tbl),
      v.uncoded_lines?note(t('cs.uncoded',{n:v.uncoded_lines}),'warn'):null,note(NL?t('cs.vat_notice'):(v.notice||t('cs.vat_notice'))));
  }
  pick.onchange=()=>drawVat().catch(e=>{if(!(e instanceof Expired))vat.append(note(e.message,'bad'))});
  const j=await api('/v1/ledger/entries?limit=30');
  journal.replaceChildren(el('h2','',t('cs.journal')),el('p','sub',t('cs.books.journal_sub',{n:j.items.length})),journalTable(j.items,t('cs.no_entries'),true),note(t('cs.journal_note')));
  await drawVat();
}

// --- An invoice, as a document ------------------------------------------------------------------------------------
// The trail from read to booked: done, now, still to come, or stopped (blocked or rejected), from the read model and
// the ledger entries that book it (n, once they are read; null while they load).
function trailOf(i,n){
  const s=i.status,stop=s==='blocked'||s==='rejected',fs=i.findings||[];
  const st=(done,now)=>done?'done':now?'now':'todo';
  return [
    ['file-text',t('cs.inv.step.read'),'done',i.read_by==='claude'?t('cs.inv.by_claude'):t('cs.inv.by_code')],
    ['shield-check',t('cs.inv.step.checked'),stop?'stop':s==='needs_review'||s==='needs_vendor'?'now':'done',stop?statusWords(s,i.status_words):fs.length?t('cs.inv.findings',{n:fs.length}):t('cs.all_passed')],
    ['scan-face',t('cs.inv.step.faceid'),stop?'todo':st(s==='paid',s==='waiting_cfo'),s==='waiting_cfo'?t('cs.inv.waits_since',{day:day(i.updated_at)}):s==='paid'?(i.proposal_id||t('cs.inv.signed')):''],
    ['wallet',t('cs.inv.step.paid'),st(!!i.paid_at,s==='ready'),i.paid_at?day(i.paid_at):''],
    ['receipt',t('cs.inv.step.booked'),n===null?'todo':st(n>0,false),n?t('cs.inv.entries',{n}):'']]}
function trailBar(i,n){
  const ol=el('ol','trail',trailOf(i,n).map(([icon,label,state,sub])=>{const li=el('li',state,[el('span','tdot',ic(state==='done'?'check':state==='stop'?'octagon-x':icon)),el('b','',label),sub?el('span','sub',sub):null]);if(state==='now')li.setAttribute('aria-current','step');return li}));
  ol.setAttribute('aria-label',t('cs.inv.trail'));return el('section','card trailc',[ol])}
// The invoice as a document: the supplier, its numbers and dates, the lines as the ledger booked them (net, VAT code,
// VAT), and the totals as read. Without a booking yet, one line: the invoice's own subtotal and VAT.
function invoiceDoc(i,entries){
  const r=i.reading||{};const c=r.currency||i.currency||'';
  const acct=r.iban?'IBAN '+String(r.iban):r.account_number?t('dt.account')+' …'+String(r.account_number).slice(-4):(i.iban_last4?'…'+i.iban_last4:'');
  const accrual=(entries||[]).find((e)=>/^ap-accrual\|/.test(e.source_key||''));
  const lines=accrual?accrual.lines.filter((l)=>l.debit_cents&&l.vat_code!==null&&l.vat_code!==undefined||l.debit_cents&&/^[4-9]/.test(l.account)&&!/^(1|2)/.test(l.account)):[];
  const tb=el('tbody','');const lab=(td,l)=>{td.dataset.l=l;return td};
  if(lines.length)for(const l of lines)tb.append(el('tr','',[el('td','',[el('span','',l.memo||l.account),el('span','sub',t('cs.inv.account',{a:l.account}))]),el('td','',l.vat_code?vatWord(l.vat_code):'–'),lab(el('td','r num',cur(l.currency)+' '+cents(l.debit_cents)),t('cs.inv.net')),lab(el('td','r num',l.vat_cents?cur(l.currency)+' '+cents(l.vat_cents):'–'),t('cs.inv.vat_amt'))]));
  else tb.append(el('tr','',[el('td','',[el('span','',t('cs.inv.whole')),el('span','sub',entries===null?t('loading'):t('cs.inv.not_booked'))]),el('td','','–'),lab(el('td','r num',r.subtotal?ma(c,r.subtotal):'–'),t('cs.inv.net')),lab(el('td','r num',r.tax?ma(c,r.tax):'–'),t('cs.inv.vat_amt'))]));
  const tot=el('dl','totals',[el('dt','',t('dt.subtotal')),el('dd','num',r.subtotal?ma(c,r.subtotal):'–'),el('dt','',t('dt.vat')),el('dd','num',r.tax?ma(c,r.tax):'–'),el('dt','grand',t('dt.total')),el('dd','grand num',ma(c,r.total||i.total))]);
  const meta=(k,v)=>v?el('div','',[el('span','',k),el('b','',v)]):null;
  return el('section','card paper',[
    el('div','pp-top',[el('div','pp-from',[av(r.vendor||i.vendor),el('div','',[el('b','',r.vendor||i.vendor||t('unknown_supplier')),r.vat_id?el('span','sub',t('cs.vat_number')+' '+r.vat_id):null,acct?el('span','sub mono',[acct,r.bic?' · BIC '+r.bic:'',r.bank_country?' · '+r.bank_country:'']):null])]),
      el('div','pp-title',[el('span','',t('cs.invoice')),el('b','num',r.invoice_no||i.invoice_no||t('no_number'))])]),
    el('div','pp-meta',[meta(t('dt.invoice_date'),day(r.issue_date||i.issue_date)),meta(t('dt.due_date'),day(r.due_date||i.due_date)),meta(t('dt.reference'),r.reference),meta(t('dt.booked_to'),i.gl_account?(i.gl_account+(i.cost_centre?' · '+i.cost_centre:'')):''),meta(t('cs.inv.our_ref'),i.id)]),
    el('div','scroll',el('table','table lines',[el('thead','',el('tr','',[el('th','',t('cs.inv.line')),el('th','',t('dt.vat')),el('th','r',t('cs.inv.net')),el('th','r',t('cs.inv.vat_amt'))])),tb])),tot])}
async function invoiceView(id){
  title(t('cs.invoice'));
  // With an engine, its own view of this invoice too: what it can do with it is the engine's to say, not the read model's.
  const eng=await engineStatus();
  const [i,ev]=await Promise.all([api('/v1/invoices/'+encodeURIComponent(id)),eng?api('/v1/engine/invoices').catch((e)=>{if(e instanceof Expired)throw e;return null}):null]);
  title((i.vendor||t('cs.invoice'))+' '+(i.invoice_no||i.id));
  const back=el('a','back',[ic('arrow-left'),' '+t('cs.inv.all')]);back.href='#/invoices';
  let cur0=i,entries=null;
  let top=detailTop(i),trail=trailBar(i,null),paper=invoiceDoc(i,null);
  // With an engine, a paid invoice shows its proof (paid, booked, archived) where the payment card was: first.
  let proof=eng&&i.status==='paid'?proofCard(i):null;let stack=null;
  const redraw=()=>{const nt=detailTop(cur0),nr=trailBar(cur0,entries===null?null:entries.length),np=invoiceDoc(cur0,entries);top.replaceWith(nt);trail.replaceWith(nr);paper.replaceWith(np);top=nt;trail=nr;paper=np};
  const jr=el('div','card panel journal-for',[el('h2','',t('cs.books.journal_for')),el('p','sub',t('loading'))]);
  const readJournal=()=>api('/v1/books/invoices/'+encodeURIComponent(id)+'/journal').then((j)=>{entries=j.items||[];jr.replaceChildren(el('h2','',t('cs.books.journal_for')),journalTable(entries,t('cs.books.no_journal')));if(top.isConnected)redraw()},(e)=>{if(!(e instanceof Expired))jr.replaceChildren(el('h2','',t('cs.books.journal_for')),note(e.message,'bad'))});
  // The read model again, once the engine filed or paid it: the head (its status chip), the trail and the proof follow.
  const again=async()=>{const j=await api('/v1/invoices/'+encodeURIComponent(id));if(!top.isConnected)return;cur0=j;redraw();readJournal();
    if(!eng||j.status!=='paid')return;
    if(pay)for(const x of pay.querySelectorAll('.acts'))x.remove();
    if(proof){await proof.refresh(j);return}
    proof=proofCard(j);if(pay&&pay.isConnected)pay.after(proof);else stack.prepend(proof)};
  const mine=ev&&(ev.items||[]).find((x)=>x.id===id);
  const pay=mine?payCard({inv:mine,eng,write:(await me()).scopes.includes('admin'),moved:again}):null;
  const fs=i.findings||[];const fl=el('ul','findings');
  if(!fs.length)fl.append(el('li','ok',[ic('circle-check'),el('span','',t('cs.all_passed'))]));
  for(const f of fs){const m=RES[f.level]||['circle-minus',f.level];fl.append(el('li',f.level,[ic(m[0]),el('span','',[el('b','',m[1]+': '),finding(f)])]))}
  const checks=el('div','card panel',[el('h2','',t('dt.checks')),fl]);
  const getDoc=btn(t('cs.download'),'','download');
  getDoc.onclick=async()=>{getDoc.disabled=true;try{await download('/v1/invoices/'+encodeURIComponent(id)+'/document',(i.invoice_no||i.id).replace(/[^\w.-]+/g,'_')+'.pdf')}catch(e){if(!(e instanceof Expired))getDoc.after(note(e.message,'bad'))}finally{getDoc.disabled=false}};
  const pages=el('div','pages',[el('p','wait',t('drawing_document'))]);
  const doc=el('div','card docv',[el('div','bar2',[ic('file-text'),el('span','fn',t('cs.as_received')),getDoc]),pages]);
  // The payment card where the person acts, or the proof once paid, first; then the checks, the entries it produced; the
  // panel "At work" last; without an engine, the note that the phone approves. On a phone this column comes first.
  stack=el('div','stack'+(pay||proof?'':' later'),[pay,proof,checks,jr,pay||proof?workPanel():note(t('cs.approved_on_phone'))]);
  view().replaceChildren(back,top,trail,el('div','split inv',[el('div','docs',[paper,doc]),stack]));
  readJournal();
  if(pay||proof)WORK.onEvents=(evs)=>{if(evs.some((e)=>e.event==='vault.filed'||(e.event==='ap.status'&&e.fields&&e.fields.status==='paid')))again().catch(()=>{})};
  drawPdf('/v1/invoices/'+encodeURIComponent(id)+'/document',pages,t('cs.invoice_drawn'));
}
`;

export const UI_CSS = `
/* The CFO's pass (14 Nov): calm cards, one accent, numbers that settle, motion only when the person allows it. */
.card.next.hero { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto auto; align-items: center; gap: 16px; padding: 18px 20px; margin: 4px 0 16px; text-decoration: none; color: var(--text); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, #fff), #fff); }
.card.next.hero:not(.act) { border-color: var(--border); background: #fff; }
.next.hero .nic { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.next.hero .nic svg { width: 26px; height: 26px; }
.next.hero .nb { display: grid; gap: 2px; min-width: 0; }
.next.hero .nl { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.next.hero .nb b { font-size: 20px; letter-spacing: -.01em; }
.next.hero .ns { color: var(--muted); font-size: 14px; }
.next.hero .nw { display: grid; justify-items: end; gap: 2px; padding-right: 8px; border-right: 1px solid var(--border); }
.next.hero .nw .nv { color: var(--muted); font-size: 13px; }
.next.hero .nw b { font-size: 20px; font-variant-numeric: tabular-nums; }
.next.hero .ngo { display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 10px; background: var(--text); color: #fff; font-weight: 650; font-size: 14px; white-space: nowrap; }
.next.hero:hover .ngo { background: var(--accent); }
@media (max-width: 720px) { .card.next.hero { grid-template-columns: 44px minmax(0, 1fr); gap: 12px; padding: 16px; } .next.hero .nic { width: 44px; height: 44px; }
  .next.hero .nw { grid-column: 1 / -1; justify-items: start; border-right: 0; padding: 0; display: flex; gap: 10px; align-items: baseline; } .next.hero .ngo { grid-column: 1 / -1; justify-content: center; } .next.hero .nb b { font-size: 17px; } }
.kpi.wait .kl .ic { background: var(--warn-soft); color: var(--warn); }
.kpi.neg b { color: var(--bad); } .kpi.wait b { color: var(--warn); }
.dash-gap, #view > .dgrid, #view > .dcard { margin-top: 16px; }
#view > .kpis { margin-bottom: 0; }
.dgrid .stack { display: grid; gap: 16px; align-content: start; }
.dcard.due .segwrap { margin-top: 4px; }
/* The decisions as a timeline: who acted (an icon), one sentence, the day. */
.tline { list-style: none; margin: 0; padding: 0; position: relative; }
.tline::before { content: ""; position: absolute; left: 15px; top: 8px; bottom: 8px; width: 2px; background: var(--border); }
.tline li { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 8px 0; }
.tline li[hidden] { display: none; }
.tline .tlic { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 1px solid var(--border); color: var(--muted); position: relative; }
.tline .tlic svg { width: 15px; height: 15px; }
.tline .by-agent .tlic { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.tline .by-cfo .tlic { color: var(--ok); background: var(--ok-soft); border-color: transparent; }
.tline .by-rail .tlic { color: #7a4a00; background: #fff4dc; border-color: transparent; }
.tline .tl-bad .tlic { color: var(--bad); background: var(--bad-soft); border-color: transparent; }
.tline p { margin: 6px 0 0; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; } .tline p b { font-weight: 650; }
.tline time { font-size: 12.5px; color: var(--faint); padding-top: 7px; white-space: nowrap; }
.btn.linkbtn { background: none; border: 0; padding: 8px 0 0 44px; color: var(--accent); font-weight: 650; min-height: 40px; box-shadow: none; }
.btn.linkbtn[aria-expanded="true"] .ic { transform: rotate(180deg); }
.what-cloud { margin-top: 24px; }
/* Agents: one card each. */
.card.agent { padding: 22px; display: grid; gap: 18px; }
.agent .ah { grid-template-columns: 40px minmax(0, 1fr) auto; margin: 0; align-items: center; }
.agent .atop { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: start; }
.bcard { position: relative; aspect-ratio: 1.586; border-radius: 16px; padding: 18px 20px; color: #fff; display: grid; grid-template-rows: auto 1fr auto auto; gap: 6px; overflow: hidden;
  background: radial-gradient(120% 140% at 100% 0%, #4f46e5 0%, #312e81 45%, #111827 100%); box-shadow: 0 10px 30px -14px rgba(49, 46, 129, .6); }
.bcard::after { content: ""; position: absolute; inset: 0; background: linear-gradient(115deg, rgba(255,255,255,.14), transparent 40%); pointer-events: none; }
.bcard.frozen { background: linear-gradient(135deg, #9aa3af, #4b5563); filter: saturate(.4); }
.bcard .bct { display: flex; justify-content: space-between; align-items: center; }
.bcard .bcb { font-weight: 700; letter-spacing: .01em; }
.bcard .bcs { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 650; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.16); }
.bcard .bcs svg { width: 13px; height: 13px; }
.bcard .bcchip { width: 38px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #f5d98b, #c9a24a); align-self: center; }
.bcard .bcn { font-size: 19px; letter-spacing: .08em; font-variant-numeric: tabular-nums; } .bcard .bcd { opacity: .7; }
.bcard .bcf { display: flex; justify-content: space-between; font-size: 13px; opacity: .92; } .bcard .bcbr { font-weight: 700; font-style: italic; }
.lims h3, .rules h3, .adec h3 { margin: 0 0 8px; }
.lim { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); }
.lim:first-of-type { border-top: 0; }
.lim .limic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
.lim .limb { display: grid; gap: 6px; min-width: 0; } .lim .liml { font-weight: 600; font-size: 14px; }
.lim .limv { font-size: 16px; white-space: nowrap; }
.lim.cats { grid-template-columns: 32px minmax(0, 1fr); }
.limm { display: grid; gap: 4px; }
.lbar { display: block; height: 8px; border-radius: 99px; background: var(--sunken); overflow: hidden; }
.lbar span { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
.lbar.full span { background: var(--warn); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; } .mchip { padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 600; }
.lims .fine { display: flex; gap: 6px; align-items: center; margin: 10px 0 0; color: var(--muted); font-size: 12.5px; } .lims .fine svg { width: 13px; height: 13px; }
.agent .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.agent .adec { padding-top: 16px; border-top: 1px solid var(--border); margin: 0; }
ul.outs { list-style: none; margin: 0; padding: 0; display: grid; }
ul.outs li { display: grid; grid-template-columns: 172px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 9px 0; border-top: 1px solid var(--border); font-size: 14px; }
ul.outs li:first-child { border-top: 0; }
ul.outs time { color: var(--faint); font-size: 12.5px; white-space: nowrap; }
.obadge { display: inline-flex; align-items: center; gap: 5px; justify-self: start; padding: 3px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 650; white-space: nowrap; }
.obadge svg { width: 13px; height: 13px; }
.obadge.ok { background: var(--ok-soft); color: var(--ok); } .obadge.bad { background: var(--bad-soft); color: var(--bad); } .obadge.wait { background: var(--warn-soft); color: var(--warn); } .obadge.info { background: var(--sunken); color: var(--muted); }
details.adet { border-top: 1px solid var(--border); padding-top: 12px; }
details.adet summary { cursor: pointer; font-weight: 650; color: var(--muted); font-size: 14px; min-height: 32px; display: flex; align-items: center; }
details.adet .agrid { margin-top: 10px; }
@media (max-width: 860px) { .agent .atop { grid-template-columns: minmax(0, 1fr); } .bcard { max-width: 340px; } }
@media (max-width: 640px) { .card.agent { padding: 16px; } .agent .rules { grid-template-columns: 1fr; gap: 14px; }
  ul.outs li { grid-template-columns: minmax(0, 1fr) auto; } ul.outs .otext { grid-column: 1 / -1; grid-row: 2; } }
/* Books: the balance sheet as one block per currency. */
.bsheet { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 8px; }
.bsc { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: grid; gap: 6px; }
.bsh { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .bsh .ast { white-space: nowrap; }
.bsr { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; } .bsr span { color: var(--muted); } .bsr b { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* An invoice: the trail, the document, the PDF. */
.card.trailc { padding: 16px 20px; margin: 16px 0; }
ol.trail { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
ol.trail li { position: relative; display: grid; justify-items: center; text-align: center; gap: 4px; padding: 0 6px; font-size: 14px; }
ol.trail li::before { content: ""; position: absolute; top: 15px; left: calc(-50% + 18px); right: calc(50% + 18px); height: 2px; background: var(--border); }
ol.trail li:first-child::before { display: none; }
ol.trail .tdot { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 2px solid var(--border); color: var(--faint); }
ol.trail .tdot svg { width: 15px; height: 15px; }
ol.trail li.done .tdot { background: var(--ok); border-color: var(--ok); color: #fff; }
ol.trail li.now .tdot { border-color: var(--warn); color: var(--warn); background: var(--warn-soft); box-shadow: 0 0 0 4px color-mix(in srgb, var(--warn) 14%, transparent); }
ol.trail li.stop .tdot { border-color: var(--bad); background: var(--bad); color: #fff; }
ol.trail li.todo b { color: var(--muted); font-weight: 600; }
ol.trail .sub { font-size: 12.5px; }
@media (max-width: 640px) { ol.trail { grid-template-columns: minmax(0, 1fr); gap: 10px; } ol.trail li { grid-template-columns: 32px auto minmax(0, 1fr); justify-items: start; text-align: left; align-items: center; gap: 10px; padding: 0; }
  ol.trail li::before { top: -10px; left: 15px; right: auto; width: 2px; height: 10px; } ol.trail .sub { justify-self: end; text-align: right; } }
.card.paper { padding: 28px 30px; display: grid; gap: 20px; box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -18px rgba(16,24,40,.22); }
.paper .pp-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.paper .pp-from { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: start; }
.paper .pp-from .av2 { width: 40px; height: 40px; font-size: 14px; }
.paper .pp-from > div { display: grid; gap: 2px; } .paper .pp-from b { font-size: 16px; } .paper .pp-from .sub { font-size: 13px; overflow-wrap: anywhere; }
.paper .pp-title { text-align: right; display: grid; gap: 2px; } .paper .pp-title span { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); } .paper .pp-title b { font-size: 18px; }
.paper .pp-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; padding: 14px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.paper .pp-meta div { display: grid; gap: 2px; } .paper .pp-meta span { font-size: 12px; color: var(--faint); font-weight: 600; } .paper .pp-meta b { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.paper table.lines td { vertical-align: top; } .paper table.lines td .sub { display: block; font-size: 12.5px; }
.paper table.lines td.r, .paper table.lines th.r { text-align: right; white-space: nowrap; }
.paper dl.totals { display: grid; grid-template-columns: auto auto; justify-content: end; gap: 6px 28px; margin: 0; font-size: 14px; }
.paper dl.totals dt { color: var(--muted); } .paper dl.totals dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.paper dl.totals .grand { font-size: 18px; font-weight: 700; color: var(--text); padding-top: 8px; border-top: 2px solid var(--text); }
@media (max-width: 640px) { .card.paper { padding: 18px 16px; } .paper .pp-title { text-align: left; } }

.tline .tlb { display: grid; gap: 1px; padding-top: 1px; } .tline .tlw { font-size: 12.5px; font-weight: 650; color: var(--muted); }
.tline p { margin: 0; }
.bcwrap { display: grid; gap: 8px; } .bcwrap .fine { display: flex; gap: 6px; align-items: center; margin: 0; color: var(--muted); font-size: 12.5px; } .bcwrap .fine svg { width: 13px; height: 13px; }
.rules ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rules li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; font-size: 14px; line-height: 1.45; }
.rules li .ic { margin-top: 2px; } .rules .can .ic { color: var(--ok); } .rules .cannot .ic { color: var(--bad); }
.rules li svg { width: 16px; height: 16px; }
ol.trail li::before { background: var(--border) !important; }
ol.trail li.done + li.done::before, ol.trail li.done + li.now::before, ol.trail li.done + li.stop::before { background: var(--ok) !important; }
.paper table.lines th:first-child { width: 44%; }
.split2 .table td:first-child { white-space: nowrap; }
/* A phone: the invoice's lines and a journal stack, so no column is squeezed to a letter per line. */
@media (max-width: 640px) {
  .paper table.lines thead { display: none; } .paper table.lines, .paper table.lines tbody { display: block; }
  .paper table.lines tr { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
  .paper table.lines td { display: block; padding: 0; border: 0; } .paper table.lines td:nth-child(-n+2) { grid-column: 1 / -1; } .paper table.lines td:nth-child(2) { color: var(--muted); font-size: 13px; }
  .paper table.lines td.r { text-align: left; } .paper table.lines td[data-l]::before { content: attr(data-l); display: block; font-size: 12px; color: var(--faint); font-weight: 600; }
  table.jt thead { display: none; } table.jt, table.jt tbody { display: block; }
  table.jt tr.en { display: grid; grid-template-columns: minmax(0, 1fr); padding-top: 10px; } table.jt tr.en td { padding: 0; border: 0; } table.jt tr.en td:first-child { font-size: 12.5px; color: var(--faint); } table.jt tr.en td:nth-child(n+3) { display: none; }
  table.jt tr.ln { display: grid; grid-template-columns: minmax(0, 1fr) 96px 96px; gap: 8px; } table.jt tr.ln td { padding: 2px 0; border: 0; } table.jt tr.ln td:first-child { display: none; }
}
/* An invoice: the document and its PDF on the left; on a phone the column where the CFO acts comes first, else the document. */
.split.inv > .docs { display: grid; gap: 16px; min-width: 0; }
@media (max-width: 980px) { .split.inv > .stack.later { order: 0; } }
/* Transactions: a long status (a rail's decline and its reason) wraps inside its pill instead of being cut off. */
.trow > .stx { white-space: normal; } .trow > .stx .pill { white-space: normal; overflow-wrap: anywhere; line-height: 1.3; height: auto; padding-top: 3px; padding-bottom: 3px; }
/* Tokenisation: three steps side by side, the hashes in a fold; the Visa runs with their outcome. */
ol.tsteps3 { list-style: none; margin: 14px 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
ol.tsteps3 > li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; }
ol.tsteps3 .tdot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); font-weight: 700; font-size: 13px; }
ol.tsteps3 li.done .tdot { background: var(--ok); color: #fff; } ol.tsteps3 .tdot svg { width: 14px; height: 14px; }
ol.tsteps3 p.sub { margin: 2px 0 8px; font-size: 13px; }
ul.txw { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; } ul.txw li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 6px; } ul.txw svg { width: 14px; height: 14px; color: var(--ok); margin-top: 2px; }
details.tokdet { margin: 12px 0 4px; } details.tokdet summary { cursor: pointer; font-weight: 650; color: var(--muted); font-size: 14px; min-height: 32px; display: flex; align-items: center; }
ul.viclist { list-style: none; padding: 0; margin: 12px 0; display: grid; }
ul.viclist li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); font-size: 14px; }
ul.viclist li:first-child { border-top: 0; }
ul.viclist .vstep { width: 28px; height: 28px; border-radius: 8px; background: var(--sunken); display: grid; place-items: center; font-weight: 700; font-size: 12.5px; }
ul.viclist .vr { display: block; font-size: 12.5px; overflow-wrap: anywhere; } ul.viclist b { white-space: nowrap; }
@media (max-width: 760px) { ol.tsteps3 { grid-template-columns: minmax(0, 1fr); } ul.viclist li { grid-template-columns: 34px minmax(0, 1fr) auto; } ul.viclist .obadge { grid-column: 2; } }
@media (prefers-reduced-motion: no-preference) {
  .card.agent.rise, .card.next.hero { animation: rise-in .4s ease both; }
  .card.next.hero { animation-delay: .02s; }
  .kpi.rise.in b { animation: settle .5s cubic-bezier(.2, .7, .2, 1) both; }
  .lbar span { animation: grow .7s cubic-bezier(.2, .7, .2, 1) .1s both; transform-origin: left; }
  .tline li { animation: rise-in .35s ease both; }
  .tline li:nth-child(2) { animation-delay: .04s; } .tline li:nth-child(3) { animation-delay: .08s; } .tline li:nth-child(4) { animation-delay: .12s; } .tline li:nth-child(5) { animation-delay: .16s; } .tline li:nth-child(6) { animation-delay: .2s; }
  ol.trail li .tdot { animation: rise-in .35s ease both; }
}
@keyframes rise-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes settle { from { opacity: .2; transform: translateY(4px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
`;
