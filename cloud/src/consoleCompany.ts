// Purser Cloud's console: the company and the session around the pages (21 Nov, the owner: "the company block becomes a
// real switcher", "one tidy session block", "if you connect you get an extra tab"). Here:
//   cw()          this module's words, English and Dutch (and the charts' few words)
//   the switcher  the company in the sidebar's top block: its page one click away, the companies this browser has
//                 signed in to (each opens the sign-in with its address filled in: a session is one company's), the
//                 demo company, and "Set up a new company" (the existing first run, #/start)
//   the session   who is signed in, a countdown that formats itself and updates, and sign out, in one block
//   test money    the switcher's workspace line (26 Nov: no pill in the header)
//   Company page  #/company: the company at a glance from the API's own answers (nothing is typed in here)
//   connected     a tab in the menu for each connection this company really has (Claude through MCP), read from the
//                 same state the Connections page shows; the demo company shows what its demo world has
//   Settings      the person, the approval policy in short, alerts, API and MCP access, the danger zone
// Every value from the API is put on the page as text (el() and textContent), never as HTML. The console's script
// carries this at __UI__ (cloud/src/console.ts). The Company page ends with the runner's compliance evidence in short,
// folded (./complianceView.ts).

import { COMPLIANCE_JS } from "./complianceView.js";

/** This module's words, English and Dutch. */
export const CO_WORDS = {
  en: {
    tap_open: "Tap again to open", click_open: "Click to open the list", key_open: "Enter opens the list", open_tab: "Open its page", net_so_far: "Net so far",
    // The session
    left_min: "Ends in {n} min", left_h: "Ends in {h} h {m} min", left_lt1: "Ends in under a minute", guest: "Guest", session: "Session",
    // The switcher
    switch: "Switch company", this_company: "This company", open_page: "Company page", other_companies: "Signed in before on this browser",
    sign_in_to: "Sign in to {slug}", demo_company: "Demo company", demo_sub: "Made-up data, read only", open_demo: "Open the demo company",
    sign_in_co: "Sign in to your company", sign_in_sub: "With its address and your passkey",
    add_company: "Set up a new company", add_sub: "With the starter key Purser gives you", signs_out: "Switching signs you out of {name}: a session is one company's.",
    // The Company page
    co_h: "Company", co_lede: "{name} at a glance: its profile, money, limits and connections, from its own records.",
    k_cash: "Net cash flow", k_open: "Open payables", k_wait: "Waits for Face ID", k_agents: "Agents at work",
    n_inv: "{n} invoices", n_inv_1: "1 invoice",
    profile: "Profile", slug: "Address", lang: "Language", role: "Your role", awx_acct: "Airwallex account", awx_demo: "Simulated Airwallex rails (demo)",
    money_h: "Where money moved", money_sub: "Out, by rail, in {cur}", limits_h: "Limits and approvals", limits_rule: "Every supplier payment waits for the CFO's Face ID. Agents spend only on their own cards, within these limits.",
    per_purchase: "a purchase", per_month: "a month", no_limits: "No agent card on record.",
    open_h: "Open payables", open_none: "Nothing open to pay.", recent_h: "Recent payments", recent_none: "No payments yet.",
    conn_h: "Connected services", conn_none: "Nothing connected yet.", conn_manage: "Manage connections", see_all: "See all",
    // Connected tabs
    g_connected: "Connected", claude: "Claude",
    cl_h: "Claude and your AI", cl_lede: "Purser's MCP server: your AI reads the books, and never approves or pays.",
    cl_status: "Status", cl_on: "Connected", cl_demo: "Demo token, read only", cl_tokens: "{n} live connector tokens", cl_tokens_1: "1 live connector token",
    cl_last: "Last read", cl_never: "Not used yet", cl_addr: "Address", cl_can: "Your AI can", cl_cannot: "It can never",
    cl_can_1: "Read invoices, payments and the books", cl_can_2: "Explain a payment and its audit trail", cl_can_3: "See what waits for the CFO",
    cl_cannot_1: "Approve or pay", cl_cannot_2: "Change a limit", cl_cannot_3: "Write to the books",
    cl_setup: "Set up or add a token", cl_try: "Ask it: \"What needs my attention?\"",
    // The Airwallex tab
    awx_reading: "Reading the sandbox…", awx_lede_demo: "What Airwallex does here: money, FX, payouts, the agents' cards and webhooks. Read live from the sandbox behind Purser's recorded runs, not the demo's simulated month.",
    awx_lede_co: "What Airwallex does here: money, FX, payouts, the agents' cards and webhooks. Read live from the sandbox behind Purser's recorded runs, not your company's own account.",
    awx_tags: "Test money · read only · every id in full", awx_more: "More from Airwallex", awx_more_sub: "Its ledger, payees, receiving accounts and the API calls Purser made.", awx_down_h: "The Airwallex sandbox did not answer",
    // Settings
    you_h: "You", signed_in_with: "Signed in with", passkey: "Passkey", ends: "Session", policy_h: "Approval policy",
    policy_sub: "How Purser holds every payment.", policy_rules: "Every supplier payment: the CFO's Face ID over its exact terms", policy_agents: "Agents: their own card, within its limits",
    policy_agents_n: "{n} agent cards with limits", policy_see: "See the agents' limits",
    alerts_h: "Notifications", alerts_sub: "Who hears when a payment waits for the CFO.", alerts_set: "{n} alert targets", alerts_none: "No alert target yet",
    alerts_go: "Set up alerts", access_h: "API and MCP access", access_sub: "How software reads this company.",
    mcp_addr: "MCP address", rest_addr: "REST API", your_scopes: "This session may", keys_owner: "Keys are made by an owner, under People and keys below.",
    danger_h: "Danger zone", danger_sub: "Sign out of this browser. Your session ends at once.", danger_guest: "Leave the demo company. Nothing you saw is kept.",
  },
  nl: {
    tap_open: "Tik nog eens om te openen", click_open: "Klik om de lijst te openen", key_open: "Enter opent de lijst", open_tab: "Open de pagina", net_so_far: "Netto tot nu",
    left_min: "Nog {n} min", left_h: "Nog {h} u {m} min", left_lt1: "Nog minder dan een minuut", guest: "Gast", session: "Sessie",
    switch: "Ander bedrijf", this_company: "Dit bedrijf", open_page: "Bedrijfspagina", other_companies: "Eerder aangemeld in deze browser",
    sign_in_to: "Aanmelden bij {slug}", demo_company: "Demobedrijf", demo_sub: "Verzonnen gegevens, alleen lezen", open_demo: "Open het demobedrijf",
    sign_in_co: "Aanmelden bij je bedrijf", sign_in_sub: "Met het adres en je passkey",
    add_company: "Een nieuw bedrijf instellen", add_sub: "Met de startsleutel die Purser je geeft", signs_out: "Wisselen meldt je af bij {name}: een sessie hoort bij één bedrijf.",
    co_h: "Bedrijf", co_lede: "{name} in één oogopslag: profiel, geld, limieten en koppelingen, uit de eigen gegevens.",
    k_cash: "Netto kasstroom", k_open: "Openstaand te betalen", k_wait: "Wacht op Face ID", k_agents: "Agents aan het werk",
    n_inv: "{n} facturen", n_inv_1: "1 factuur",
    profile: "Profiel", slug: "Adres", lang: "Taal", role: "Jouw rol", awx_acct: "Airwallex-rekening", awx_demo: "Gesimuleerde Airwallex-rails (demo)",
    money_h: "Waar het geld ging", money_sub: "Uit, per rail, in {cur}", limits_h: "Limieten en goedkeuring", limits_rule: "Elke leveranciersbetaling wacht op de Face ID van de CFO. Agents betalen alleen met hun eigen kaart, binnen deze limieten.",
    per_purchase: "per aankoop", per_month: "per maand", no_limits: "Geen agentkaart vastgelegd.",
    open_h: "Openstaand te betalen", open_none: "Niets open om te betalen.", recent_h: "Recente betalingen", recent_none: "Nog geen betalingen.",
    conn_h: "Gekoppelde diensten", conn_none: "Nog niets gekoppeld.", conn_manage: "Koppelingen beheren", see_all: "Alles zien",
    g_connected: "Gekoppeld", claude: "Claude",
    cl_h: "Claude en je AI", cl_lede: "De MCP-server van Purser: je AI leest de boeken, en keurt nooit goed of betaalt.",
    cl_status: "Status", cl_on: "Gekoppeld", cl_demo: "Demotoken, alleen lezen", cl_tokens: "{n} geldige koppeltokens", cl_tokens_1: "1 geldig koppeltoken",
    cl_last: "Laatst gelezen", cl_never: "Nog niet gebruikt", cl_addr: "Adres", cl_can: "Je AI kan", cl_cannot: "Hij kan nooit",
    cl_can_1: "Facturen, betalingen en de boeken lezen", cl_can_2: "Een betaling en het spoor ervan uitleggen", cl_can_3: "Zien wat op de CFO wacht",
    cl_cannot_1: "Goedkeuren of betalen", cl_cannot_2: "Een limiet wijzigen", cl_cannot_3: "In de boeken schrijven",
    cl_setup: "Instellen of een token toevoegen", cl_try: "Vraag hem: \"Wat vraagt mijn aandacht?\"",
    awx_reading: "De sandbox wordt gelezen…", awx_lede_demo: "Wat Airwallex hier doet: geld, valuta, uitbetalingen, de kaarten van de agents en webhooks. Live gelezen uit de sandbox achter de vastgelegde runs van Purser, niet de gesimuleerde maand van de demo.",
    awx_lede_co: "Wat Airwallex hier doet: geld, valuta, uitbetalingen, de kaarten van de agents en webhooks. Live gelezen uit de sandbox achter de vastgelegde runs van Purser, niet de eigen rekening van je bedrijf.",
    awx_tags: "Testgeld · alleen lezen · elk id volledig", awx_more: "Meer van Airwallex", awx_more_sub: "Het grootboek, begunstigden, ontvangstrekeningen en de API-aanroepen van Purser.", awx_down_h: "De Airwallex-sandbox antwoordde niet",
    you_h: "Jij", signed_in_with: "Aangemeld met", passkey: "Passkey", ends: "Sessie", policy_h: "Goedkeuringsbeleid",
    policy_sub: "Hoe Purser elke betaling vasthoudt.", policy_rules: "Elke leveranciersbetaling: de Face ID van de CFO over de exacte voorwaarden", policy_agents: "Agents: hun eigen kaart, binnen de limieten",
    policy_agents_n: "{n} agentkaarten met limieten", policy_see: "Bekijk de limieten van de agents",
    alerts_h: "Meldingen", alerts_sub: "Wie het hoort als een betaling op de CFO wacht.", alerts_set: "{n} meldingsadressen", alerts_none: "Nog geen meldingsadres",
    alerts_go: "Meldingen instellen", access_h: "API- en MCP-toegang", access_sub: "Hoe software dit bedrijf leest.",
    mcp_addr: "MCP-adres", rest_addr: "REST-API", your_scopes: "Deze sessie mag", keys_owner: "Sleutels maakt een eigenaar, onder Mensen en sleutels hieronder.",
    danger_h: "Gevarenzone", danger_sub: "Afmelden in deze browser. Je sessie stopt meteen.", danger_guest: "Het demobedrijf verlaten. Er wordt niets bewaard.",
  },
} as const;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export const COMPANY_JS = COMPLIANCE_JS + String.raw`
// --- The company, the session and the connected tabs (21 Nov) ---------------------------------------------------------
const CO_W=` + json(CO_WORDS) + String.raw`;
function cw(k,v){const W=CO_W[L.lang==='nl'?'nl':'en'];let s=W[k]??CO_W.en[k]??k;for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
// The company's own name, without the bracketed part the demo carries ("Northwind Outdoor (demo company)").
const coName=(n)=>String(n||'').replace(/\s+\([^)]*\)$/,'');
// How long the session has left, in words that read well: "Ends in 8 min", "Ends in 1 h 5 min", "Ends in under a minute".
function leftWords(ms){const m=Math.floor(Math.max(0,ms)/60000);if(m<1)return cw('left_lt1');if(m<60)return cw('left_min',{n:m});return cw('left_h',{h:Math.floor(m/60),m:m%60})}
// The session block at the foot of the sidebar: initials, the person, the countdown; sign out beside it.
function sessionBlock(){
  const w=$('#who');if(!w||!S)return;const u=ME&&ME.user;const guest=!!(S.guest||(ME&&ME.demo));
  const name=guest?cw('guest'):u&&u.display_name?coName(u.display_name):'';
  const ms=S.exp-Date.now();const role=u&&u.role?tk('cs.role.'+u.role,u.role):'';
  const left=el('span','we'+(ms<5*60000?' soon':''),leftWords(ms));left.setAttribute('role','timer');
  const sub=el('span','ws',[role&&!guest?role+' · ':'',left]);
  w.replaceChildren(el('span','sav',initials(name||'?')),el('span','wtx',[el('b','wn',name||cw('session')),sub]));
  w.title=[name,ME&&ME.tenant?ME.tenant.name:'',leftWords(ms)].filter(Boolean).join(' · ')}
// Companies this browser has signed in to (their address and name only: no token, no key), newest first, six at most.
const CO_SEEN_KEY='purser.cloud.companies';
function seenCompanies(){try{const v=JSON.parse(localStorage.getItem(CO_SEEN_KEY)||'[]');return Array.isArray(v)?v.filter((x)=>x&&/^[a-z0-9][a-z0-9-]{1,40}$/.test(x.slug)).slice(0,6):[]}catch(e){return []}}
function rememberCompany(m){if(!m||m.demo||!m.tenant||!m.tenant.slug)return;try{const rest=seenCompanies().filter((x)=>x.slug!==m.tenant.slug);localStorage.setItem(CO_SEEN_KEY,JSON.stringify([{slug:m.tenant.slug,name:String(m.tenant.name||'').slice(0,120)}].concat(rest).slice(0,6)))}catch(e){}}
// Leave this session and go on: to the sign-in with another company's address filled in, to the demo, or to the first run.
async function switchTo(hash,slug){workStop();try{await api('/v1/auth/logout',{method:'POST'})}catch(e){}forget();S=null;ME=null;
  if(slug)try{localStorage.setItem('purser.cloud.slug',slug)}catch(e){}
  if(hash==='#/guest'){location.hash='#/sign-in';return guestIn()}go(hash)}
// The company block: the name opens the Company page; the chevron opens the switcher.
function companyBlock(){
  const co=$('#co'),more=$('#co-more'),menu=$('#co-menu');if(!co||!S)return;
  const c=ME&&ME.tenant?ME.tenant.name:'';co.href='#/company';co.replaceChildren();
  if(c){const aw=ME.airwallex;co.append(el('span','av',coName(c).charAt(0).toUpperCase()),el('span','cn',[coName(c),c!==coName(c)?el('span','cx',' '+c.slice(coName(c).length).trim()):null]),
    ME.demo?el('span','aw demo',[el('i',''),el('span','aww',t('cs.demo.chip'))]):ENG_ON?Object.assign(el('span','aw demo',[el('i',''),el('span','aww',t('cs.eng.chip'))]),{title:t('cs.eng.chip_title')}):aw?el('span','aw '+String(aw.status).replace(/[^a-z_]/g,''),[el('i',''),el('span','aww',[el('span','awl','Airwallex · '),tk('cs.awx.status.'+aw.status,aw.status)])]):el('span','aw none',[el('i',''),el('span','aww',t('cs.awx.none'))]));
    co.title=cw('open_page')+': '+c}
  if(more){more.hidden=!c;more.setAttribute('aria-label',cw('switch'));more.title=cw('switch')}
  if(menu&&!menu.hidden)drawCoMenu()}
function drawCoMenu(){
  const menu=$('#co-menu');if(!menu||!ME)return;const c=ME.tenant.name;
  const item=(icon,b,sub,fn,cls)=>{const x=el('button','co-it'+(cls?' '+cls:''),[el('span','co-ic',typeof icon==='string'?ic(icon):icon),el('span','co-tx',[el('b','',b),sub?el('span','',sub):null])]);x.type='button';x.setAttribute('role','menuitem');x.onclick=()=>{closeCoMenu();fn()};return x};
  const kids=[el('p','co-lab',cw('this_company')),item(el('span','av',coName(c).charAt(0).toUpperCase()),coName(c),ME.demo?t('cs.demo.chip'):ME.tenant.slug,()=>go('#/company'),'cur')];
  const others=seenCompanies().filter((x)=>x.slug!==ME.tenant.slug);
  if(others.length){kids.push(el('p','co-lab',cw('other_companies')));for(const o of others)kids.push(item(el('span','av ghost',coName(o.name||o.slug).charAt(0).toUpperCase()),coName(o.name)||o.slug,cw('sign_in_to',{slug:o.slug}),()=>switchTo('#/sign-in',o.slug)))}
  if(!ME.demo)kids.push(item('flask',cw('open_demo'),cw('demo_sub'),()=>switchTo('#/guest')));
  else kids.push(item('scan-face',cw('sign_in_co'),cw('sign_in_sub'),()=>switchTo('#/sign-in')));
  kids.push(el('hr',''),item('arrow-right',cw('add_company'),cw('add_sub'),()=>switchTo('#/start')),el('p','co-fine',cw('signs_out',{name:coName(c)})));
  menu.replaceChildren(...kids)}
function openCoMenu(){const m=$('#co-menu'),b=$('#co-more');if(!m||!ME)return;drawCoMenu();m.hidden=false;b.setAttribute('aria-expanded','true');const f=m.querySelector('[role=menuitem]');if(f)f.focus()}
function closeCoMenu(back){const m=$('#co-menu'),b=$('#co-more');if(!m||m.hidden)return;m.hidden=true;b.setAttribute('aria-expanded','false');if(back)b.focus()}
{const b=$('#co-more'),m=$('#co-menu');if(b&&m){b.onclick=(e)=>{e.stopPropagation();if(m.hidden)openCoMenu();else closeCoMenu()};
  m.addEventListener('keydown',(e)=>{const its=[...m.querySelectorAll('[role=menuitem]')];const i=its.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();closeCoMenu(true)}else if(e.key==='ArrowDown'){e.preventDefault();(its[i+1]||its[0]).focus()}else if(e.key==='ArrowUp'){e.preventDefault();(its[i-1]||its[its.length-1]).focus()}else if(e.key==='Tab')closeCoMenu()});
  document.addEventListener('pointerdown',(e)=>{if(!m.hidden&&!m.contains(e.target)&&!b.contains(e.target))closeCoMenu()});
  window.addEventListener('hashchange',()=>closeCoMenu())}}
// --- Connected tabs: a connection this company has gets its own page in the menu -------------------------------------
// Claude (MCP): the demo company's read-only demo token is live; a company of its own has it once an owner made a
// connector token (GET /v1/claude/connectors, owners only). Nothing is shown for what the console cannot know.
const CONN={key:null,claude:null};
async function connState(force){
  if(!S||!ME)return CONN;const key=S.token+'|'+ME.tenant.slug;if(CONN.key===key&&!force)return CONN;CONN.key=key;
  if(ME.demo)CONN.claude={demo:true,live:1,last:null};
  else if(ME.scopes.includes('admin')){try{const r=await api('/v1/claude/connectors');const live=(r.items||[]).filter((x)=>!x.revoked_at&&x.expires_at>new Date().toISOString());
    CONN.claude=live.length?{demo:false,live:live.length,last:live.map((x)=>x.last_used_at).filter(Boolean).sort().pop()||null,items:live}:null}catch(e){if(e instanceof Expired)throw e;CONN.claude=null}}
  else CONN.claude=null;
  connTabs();return CONN}
function connTabs(){const a=document.querySelector('#tabs a[data-tab=claude]');if(a){a.hidden=!CONN.claude;if(CONN.claude)a.dataset.on='1';else delete a.dataset.on}navSync()}
// --- The Company page ---------------------------------------------------------------------------------------------
async function companyView(){
  const m=await me();title(cw('co_h'));shell();
  const soft=(p)=>api(p).catch((e)=>{if(e instanceof Expired)throw e;return null});
  const [x,D,AG,inv,tx]=await Promise.all([soft('/v1/insights'),soft('/v1/dashboard'),soft('/v1/agents'),soft('/v1/invoices?limit=200'),soft('/v1/transactions?limit=6')]);
  await connState().catch((e)=>{if(e instanceof Expired)throw e});
  const name=m.tenant.name||'';const items=(inv&&inv.items)||[];const agents=(AG&&AG.agents)||[];
  const open=items.filter((i)=>!['paid','rejected','blocked'].includes(i.status)).sort((a,b)=>String(a.due_date||'9').localeCompare(String(b.due_date||'9')));
  const wait=items.filter((i)=>i.status==='waiting_cfo');
  const openC=byCur(x&&x.open_net_cents);
  const fig=(label,icon,value,sub,href,tone)=>{const a=el('a','card kpi rise'+(tone?' '+tone:''),[el('span','kl',[ic(icon),label]),el('b','num',value),sub?el('span','ks',sub):null]);a.href=href;return a};
  const kpis=el('div','kpis',[
    D&&D.money?fig(cw('k_cash'),'wallet',amt(D,toCents(D.money.net)),D.since?t('cs.dash.net_sub',{date:dday(D.since)}):'','#/transactions',toCents(D.money.net)>=0?'pos':'neg'):null,
    fig(cw('k_open'),'receipt',openC.length?cur(openC[0][0])+' '+cents(openC[0][1]):t('cs.nothing_open'),open.length===1?cw('n_inv_1'):cw('n_inv',{n:open.length}),'#/invoices?f=open'),
    fig(cw('k_wait'),'scan-face',String(wait.length),wait.length?byCur(wait.reduce((o,i)=>{o[i.currency]=(o[i.currency]||0)+toCents(i.total);return o},{})).map(([c,v])=>cur(c)+' '+cents(v)).join(' · '):t('cs.ov.nothing_waits'),'#/invoices?f=waiting_cfo',wait.length?'wait':''),
    fig(cw('k_agents'),'bot',String(agents.length),agents.filter((a)=>a.card).length?cw('policy_agents_n',{n:agents.filter((a)=>a.card).length}):'','#/agents')].filter(Boolean));
  // Profile: what the company is called, where it is, who you are in it, its Airwallex account.
  const aw=m.airwallex;
  const awRow=m.demo?el('span','pill',cw('awx_demo')):aw?el('span','pill'+(aw.status==='active'?' ok':''),[tk('cs.awx.status.'+aw.status,aw.status),aw.account_id?' · '+aw.account_id:'']):el('span','sub',t('cs.awx.none'));
  const profile=el('section','card dcard rise co-prof',[el('div','dh',[el('h2','',cw('profile'))]),dl([[t('cs.name'),name],[cw('slug'),m.tenant.slug,'mono'],[t('cs.inbox'),m.inbox||t('cs.not_routed'),m.inbox?'mono':''],[cw('lang'),m.tenant.language==='nl'?'Nederlands':'English'],
    [cw('role'),m.user&&m.user.role?tk('cs.role.'+m.user.role,m.user.role):m.demo?cw('guest'):null],[cw('awx_acct'),awRow]])]);
  // Where money moved, by rail: one bar each, its amount (the dashboard's own rows; each opens its transactions).
  const rails=(D&&D.rails)||[];const rmax=Math.max(1,...rails.map((r)=>toCents(r.amount)));
  const money=el('section','card dcard rise co-money',[el('div','dh',[el('h2','',cw('money_h')),D?el('p','',cw('money_sub',{cur:cur(D.currency)})):null]),
    rails.length?el('ul','co-bars',rails.slice(0,5).map((r)=>{const f=el('span','sf');f.style.width=Math.max(2,toCents(r.amount)/rmax*100).toFixed(1)+'%';
      const a=el('a','',[el('span','sl',[el('span','',railWords(r.rail)),el('b','num',amt(D,toCents(r.amount)))]),el('span','strk',[f]),el('span','ss',t(r.count===1?'cs.dash.n_payments_1':'cs.dash.n_payments',{n:r.count}))]);
      a.href=TX_RAILS.includes(r.rail)?'#/transactions?rail='+r.rail:'#/transactions';return el('li','',a)})):chartEmpty(t('cs.ch.none'))]);
  cardLink(money,'#/transactions',sw('to_tx'));
  // Limits and approvals: the rule, then each agent card's limits and what it spent this month.
  const withCard=agents.filter((a)=>a.card&&(a.card.per_purchase||a.card.per_month));
  const lims=el('section','card dcard rise co-lims',[el('div','dh',[el('h2','',cw('limits_h')),el('p','',cw('limits_rule'))]),
    withCard.length?el('ul','co-lim',withCard.map((a)=>{const c=a.card,C=cur(c.currency)+' ';const cap=c.per_month?toCents(c.per_month):0,sp=c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null;
      const bar=sp!==null&&cap?(()=>{const b=el('span','strk');const f=el('span','sf'+(sp>=cap?' full':''));f.style.width=Math.min(100,sp/cap*100).toFixed(1)+'%';b.append(f);return b})():null;
      const li=el('a','',[el('span','co-ag',[ic('bot'),el('b','',a.name)]),el('span','sub num',[c.per_purchase?C+amount(c.per_purchase)+' '+cw('per_purchase'):'',c.per_purchase&&c.per_month?' · ':'',c.per_month?C+amount(c.per_month)+' '+cw('per_month'):'']),bar,sp!==null&&cap?el('span','ss num',sw('act_spent',{spent:C+cents(sp),cap:C+cents(cap)})):null]);
      li.href='#/agents?a='+encodeURIComponent(a.id);return el('li','',li)})):el('p','sub',cw('no_limits'))]);
  cardLink(lims,'#/agents',sw('to_agents'));
  // Open payables and recent payments: five each, each a link to its own page.
  const row=(href,who,sub,amtx,cls)=>{const a=el('a','co-row',[av(who),el('span','co-rb',[el('b','',who),el('span','sub num',sub)]),el('b','num'+(cls?' '+cls:''),amtx),ic('chevron-right')]);a.href=href;return a};
  const openList=el('section','card dcard rise co-open',[el('div','dh',[el('h2','',cw('open_h'))]),open.length?el('div','co-rows',open.slice(0,5).map((i)=>row('#/invoices/'+encodeURIComponent(i.id),i.vendor||'',[i.invoice_no||i.id,i.due_date?' · '+sw('due',{day:dday(i.due_date)}):''].join(''),ma(i.currency,i.total)))):el('p','sub',cw('open_none'))]);
  cardLink(openList,'#/invoices?f=open',cw('see_all'));
  const txs=(tx&&tx.items)||[];
  const recent=el('section','card dcard rise co-recent',[el('div','dh',[el('h2','',cw('recent_h'))]),txs.length?el('div','co-rows',txs.slice(0,5).map((r)=>row('#/transactions?from='+String(r.at).slice(0,10)+'&to='+String(r.at).slice(0,10),data('counterparty',r.counterparty||'?'),day(r.at)+' · '+tk('rail.'+r.rail,r.rail_label||r.rail),(r.flow==='in'?'+':'−')+ma(r.currency,r.amount),r.flow==='in'?'pos':''))):el('p','sub',cw('recent_none'))]);
  cardLink(recent,'#/transactions',cw('see_all'));
  // Connected services: what this company has, as the connected tabs and the account know it.
  const svc=[];
  svc.push(el('a','co-svc',[el('span','co-svm',ic('landmark')),el('span','',[el('b','','Airwallex'),el('span','sub',m.demo?cw('awx_demo'):aw?tk('cs.awx.status.'+aw.status,aw.status):t('cs.awx.none'))])]));svc[0].href='#/airwallex';
  if(CONN.claude){const a=el('a','co-svc',[el('span','co-svm',ic('sparkles')),el('span','',[el('b','',cw('claude')+' (MCP)'),el('span','sub',CONN.claude.demo?cw('cl_demo'):CONN.claude.live===1?cw('cl_tokens_1'):cw('cl_tokens',{n:CONN.claude.live}))])]);a.href='#/claude';svc.push(a)}
  if(m.inbox){const a=el('a','co-svc',[el('span','co-svm',ic('mail')),el('span','',[el('b','',t('cs.inbox')),el('span','sub mono',m.inbox)])]);a.href='#/settings';svc.push(a)}
  const conn=el('section','card dcard rise co-conn',[el('div','dh',[el('h2','',cw('conn_h'))]),el('div','co-svcs',svc)]);
  cardLink(conn,'#/connections',cw('conn_manage'));
  const hero=el('div','co-hero',[el('span','co-big',coName(name).charAt(0).toUpperCase()),el('div','',[el('h1','',coName(name)),el('p','lede',cw('co_lede',{name:coName(name)})),
    el('div','co-chips',[m.demo?el('span','pill warn',[ic('flask'),t('cs.demo.chip')]):null,el('span','pill mono',m.tenant.slug),aw&&!m.demo?el('span','pill'+(aw.status==='active'?' ok':''),'Airwallex · '+tk('cs.awx.status.'+aw.status,aw.status)):null].filter(Boolean))])]);
  view().replaceChildren(hero,kpis,el('div','dgrid co-g',[profile,lims]),el('div','dgrid co-g',[money,conn]),el('div','dgrid co-g',[openList,recent]),complianceBox());
  riseIn();
}
// --- Claude (MCP): its own page once connected -------------------------------------------------------------------------
async function claudeView(){
  const m=await me();title(cw('claude'));shell();
  const st=await connState(true);const c=st.claude;
  if(!c)return go('#/connections?at=claude');
  const url=location.origin+'/mcp';
  const copy=(text)=>{const b=btn(t('cs.claude.copy'),'mini','copy');b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.replaceChildren(ic('circle-check'),t('cs.copied'))}catch(e){}};return b};
  const stat=(label,value,tone)=>el('div','card kpi'+(tone?' '+tone:''),[el('span','kl',label),el('b','',value)]);
  const status=el('div','kpis cl-k',[stat(cw('cl_status'),c.demo?cw('cl_demo'):cw('cl_on'),'pos'),c.demo?null:stat(t('cs.claude.tokens'),c.live===1?cw('cl_tokens_1'):cw('cl_tokens',{n:c.live})),
    c.demo?null:stat(cw('cl_last'),c.last?stamp(c.last):cw('cl_never'))].filter(Boolean));
  const list=(icon,cls,keys)=>el('ul','cl-list '+cls,keys.map((k)=>el('li','',[ic(icon),el('span','',cw(k))])));
  const can=el('section','card dcard rise',[el('div','dh',[el('h2','',cw('cl_can'))]),list('circle-check','ok',['cl_can_1','cl_can_2','cl_can_3'])]);
  const cannot=el('section','card dcard rise',[el('div','dh',[el('h2','',cw('cl_cannot'))]),list('ban','no',['cl_cannot_1','cl_cannot_2','cl_cannot_3'])]);
  const addr=el('section','card dcard rise cl-addr',[el('div','dh',[el('h2','',cw('cl_addr'))]),el('div','cl-row',[el('code','cmd',url),copy(url)]),
    c.demo?el('div','cl-row',[el('code','cmd','purser-demo-read-only'),copy('purser-demo-read-only')]):null,el('p','fine',cw('cl_try'))]);
  const setup=el('a','btn',[cw('cl_setup'),ic('arrow-right')]);setup.href='#/connections?at=claude';
  const tokens=!c.demo&&c.items?el('section','card dcard rise',[el('div','dh',[el('h2','',t('cs.claude.tokens'))]),el('div','co-rows',c.items.map((x)=>el('div','co-row',[el('span','av2',ic('key-round')),el('span','co-rb',[el('b','',data('key',x.name)),el('span','sub',(x.can_propose?t('cs.claude.proposes'):t('cs.claude.reads'))+' · '+t('cs.expires')+' '+day(x.expires_at))]),el('span','sub num',x.last_used_at?stamp(x.last_used_at):cw('cl_never'))])))]):null;
  view().replaceChildren(...[head(cw('cl_h'),cw('cl_lede'),[setup]),status,el('div','dgrid co-g',[can,cannot]),addr,tokens,m.demo?el('p','fine',t('cs.claude.demo')):null].filter(Boolean));
  riseIn();
}
// --- Settings' cards (21 Nov): you, the approval policy, notifications, API and MCP access, the danger zone ------------
function youCard(m){
  if(!S)return null;const u=m.user;const guest=!!m.demo;
  return el('div','card panel set-you',[el('h2','',cw('you_h')),el('div','set-who',[el('span','sav',initials(guest?cw('guest'):u&&u.display_name||'?')),el('div','',[el('b','',guest?cw('guest'):u&&u.display_name?coName(u.display_name):'—'),el('span','sub',[u&&u.role&&!guest?tk('cs.role.'+u.role,u.role)+' · ':'',coName(m.tenant.name)])])]),
    dl([[cw('signed_in_with'),m.kind==='session'?(m.signed_in_with&&m.signed_in_with!=='passkey'?m.signed_in_with.charAt(0).toUpperCase()+m.signed_in_with.slice(1):guest?cw('demo_company'):cw('passkey')):m.kind],[cw('ends'),leftWords(S.exp-Date.now())]])])}
async function policyCard(){
  const AG=await api('/v1/agents').catch((e)=>{if(e instanceof Expired)throw e;return null});const n=((AG&&AG.agents)||[]).filter((a)=>a.card&&(a.card.per_purchase||a.card.per_month)).length;
  const a=el('a','btn sm',[cw('policy_see'),ic('arrow-right')]);a.href='#/agents';
  return el('div','card panel set-pol',[el('h2','',cw('policy_h')),el('p','sub',cw('policy_sub')),el('ul','cl-list ok',[el('li','',[ic('scan-face'),el('span','',cw('policy_rules'))]),el('li','',[ic('credit-card'),el('span','',cw('policy_agents')+(n?' · '+cw('policy_agents_n',{n}):''))])]),a])}
async function notifyCard(m){
  if(!m.scopes.includes('admin')||m.demo||m.kind!=='session')return null;
  const r=await api('/v1/alerts').catch((e)=>{if(e instanceof Expired)throw e;return null});const n=r&&(r.items||r.targets)?(r.items||r.targets).length:0;
  const a=el('a','btn sm',[cw('alerts_go'),ic('arrow-right')]);a.href='#/connections?at=alerts';
  return el('div','card panel',[el('h2','',cw('alerts_h')),el('p','sub',cw('alerts_sub')),el('p','',[el('span','pill'+(n?' ok':''),n?cw('alerts_set',{n}):cw('alerts_none'))]),a])}
function accessCard(m){
  const scopes=(m.scopes||[]).map((s)=>tk('cs.scope.'+s,s)).join(', ');
  const cmd=(label,text)=>[label,el('code','mono',text)];
  return el('div','card panel',[el('h2','',cw('access_h')),el('p','sub',cw('access_sub')),dl([cmd(cw('mcp_addr'),location.origin+'/mcp'),cmd(cw('rest_addr'),location.origin+'/v1'),[cw('your_scopes'),scopes||'—']]),
    m.scopes.includes('admin')&&!m.demo?el('p','fine',cw('keys_owner')):null,(()=>{const a=el('a','btn sm',[cw('conn_manage'),ic('arrow-right')]);a.href='#/connections';return a})()])}
function dangerCard(m){
  const out=btn(t('cs.sign_out'),'danger','log-out');out.onclick=()=>$('#out').click();
  return el('div','card panel set-danger',[el('h2','',cw('danger_h')),el('p','sub',m.demo?cw('danger_guest'):cw('danger_sub')),out])}
`;

export const COMPANY_CSS = `
/* The company and the session (cloud/src/consoleCompany.ts, 21 Nov). */
.cosw { position: relative; display: inline-flex; align-items: center; gap: 2px; min-width: 0; flex: 0 1 auto; }
.cosw .co { min-width: 0; }
.co-more { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; }
.co-more:hover, .co-more[aria-expanded="true"] { background: var(--sunken); color: var(--text); }
.co-more .ic svg { width: 16px; height: 16px; }
.co-menu { position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; width: min(300px, calc(100vw - 24px)); padding: 6px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
  box-shadow: 0 2px 4px rgba(16,24,40,.06), 0 16px 40px -12px rgba(16,24,40,.3); display: grid; gap: 2px; white-space: normal; text-align: left; }
.co-menu[hidden] { display: none; }
.co-menu .co-lab { margin: 6px 8px 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.co-menu hr { border: 0; border-top: 1px solid var(--border); margin: 4px 2px; }
.co-it { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: center; width: 100%; padding: 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; color: var(--text); font: inherit; cursor: pointer; }
.co-it:hover, .co-it:focus-visible { background: var(--sunken); outline: none; }
.co-it.cur { background: var(--accent-soft); }
.co-it .co-ic { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; background: var(--sunken); color: var(--muted); }
.co-it .co-ic .av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-weight: 700; font-size: 12px; }
.co-it .co-ic .av.ghost { background: var(--sunken); color: var(--muted); }
.co-it .co-tx { min-width: 0; display: grid; } .co-it .co-tx b { font-size: 13.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-it .co-tx span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; line-height: 1.3; }
.co-fine { margin: 2px 8px 4px; font-size: 11.5px; color: var(--faint); line-height: 1.35; }
@media (max-width: 1023px) { .signed-in .who-am-i .cosw { margin-right: auto; } .signed-in .who-am-i .cosw .co { margin-right: 0; } .co-menu { position: fixed; top: 58px; left: 12px; } }
/* The session block: initials, the person, the countdown. */
#who .sav, .set-who .sav { flex: none; width: 30px; height: 30px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--sunken); color: var(--text); font: 700 11.5px/1 Inter, system-ui, sans-serif; letter-spacing: .02em; }
#who .wtx { min-width: 0; display: grid; gap: 1px; }
#who .wn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; color: var(--text); }
#who .ws { color: var(--faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#who .ws .we { display: inline; } #who .ws .we.soon { color: var(--warn); font-weight: 600; }
/* Test money in the header strip: one quiet badge. */
/* The menu's connected tabs: hidden until the company has the connection. */
nav.apptabs a[hidden] { display: none !important; }
/* A card's heading with no line under it keeps its distance from what follows. */
.dcard .dh:not(:has(p)) { margin-bottom: 12px; }
/* The Company page. */
.co-hero { display: flex; gap: 16px; align-items: center; margin-bottom: 20px; min-width: 0; }
.co-hero > div { min-width: 0; } .co-hero h1 { margin: 0; overflow-wrap: anywhere; } .co-hero .lede { margin: 4px 0 0; color: var(--muted); }
.co-big { flex: none; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; background: var(--accent); color: #fff; font: 700 24px/1 Inter, system-ui, sans-serif; }
.co-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; } .co-chips .pill { display: inline-flex; align-items: center; gap: 5px; }
.co-chips .pill .ic svg { width: 13px; height: 13px; }
#view > .kpis + .dgrid, #view > .dgrid + .dgrid { margin-top: 16px; }
@media (min-width: 980px) { .dgrid.co-g { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.co-prof dl.read { margin: 0; } .co-prof dl.read dd { overflow-wrap: anywhere; }
ul.co-bars, ul.co-lim { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.co-bars a, ul.co-lim a { display: grid; gap: 4px; padding: 8px 10px; margin: 0 -10px; border-radius: 10px; text-decoration: none; color: var(--text); }
ul.co-bars a:hover, ul.co-lim a:hover { background: var(--sunken); }
ul.co-bars .sl { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; min-width: 0; } ul.co-bars .sl span { min-width: 0; overflow-wrap: anywhere; }
ul.co-bars .strk, ul.co-lim .strk { display: block; height: 8px; border-radius: 999px; background: var(--sunken); overflow: hidden; }
ul.co-bars .sf, ul.co-lim .sf { display: block; height: 100%; border-radius: 999px; background: var(--accent); } ul.co-lim .sf.full { background: var(--warn); }
ul.co-bars .ss, ul.co-lim .ss { font-size: 12.5px; color: var(--faint); }
.co-ag { display: inline-flex; align-items: center; gap: 8px; min-width: 0; } .co-ag .ic { color: var(--accent); display: inline-flex; } .co-ag b { overflow-wrap: anywhere; }
.co-rows { display: grid; }
.co-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 16px; gap: 10px; align-items: center; padding: 9px 10px; margin: 0 -10px; border-radius: 10px; text-decoration: none; color: var(--text); }
a.co-row:hover { background: var(--sunken); }
.co-row .co-rb { min-width: 0; display: grid; } .co-row .co-rb b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .co-row .co-rb .sub { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-row > b.num { white-space: nowrap; font-size: 14px; } .co-row > b.pos { color: var(--ok); } .co-row > .ic { color: var(--faint); }
div.co-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
.co-svcs { display: grid; gap: 8px; }
a.co-svc { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; text-decoration: none; color: var(--text); min-width: 0; }
a.co-svc:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
a.co-svc > span:last-child { min-width: 0; display: grid; } a.co-svc .sub { font-size: 12.5px; overflow-wrap: anywhere; }
.co-svm { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
@media (max-width: 640px) { .co-hero { align-items: flex-start; } .co-big { width: 44px; height: 44px; font-size: 19px; border-radius: 12px; } .co-row > b.num { font-size: 13px; } }
/* Claude's page. */
ul.cl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
ul.cl-list li { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; } ul.cl-list li .ic { flex: none; display: inline-flex; margin-top: 1px; }
ul.cl-list.ok li .ic { color: var(--ok); } ul.cl-list.no li .ic { color: var(--bad); }
.cl-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; } .cl-row code.cmd { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; margin: 0; }
#view > .dgrid + .cl-addr, #view > .cl-addr + .dcard { margin-top: 16px; }
.cl-k .kpi b { font-size: 18px; white-space: normal; overflow-wrap: anywhere; }
/* Settings' new cards. */
.set-who { display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; } .set-who > div { display: grid; min-width: 0; } .set-who b { overflow-wrap: anywhere; }
.set-danger { border-color: color-mix(in srgb, var(--bad) 30%, var(--border)); }
.set-danger h2 { color: var(--bad); }
.card.panel .btn.sm { margin-top: 10px; }
`;
