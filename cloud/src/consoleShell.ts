// Purser Cloud's frame and the views that tie it together (22 Nov, the owner: "very unclear and unorganised… make it
// enterprise level, without making it a mess"; on his iPhone the nine pages were a 3×4 grid of words). The pages are
// grouped as a finance team works:
//   Overview
//   Money     Invoices, Transactions, Books
//   Agents    Agents (every agent Purser has, cloud/src/agentRoster.ts), Tokenisation (tokens and the agents' cards)
//   Connected Airwallex, Claude (once connected: cloud/src/consoleCompany.ts), Connections
//   Settings
// A laptop gets a sidebar with the groups (the page's one nav#tabs, so every deep link and check keeps working); a phone
// gets a compact top bar, a bottom tab bar of the five groups and, inside a group, its pages as a segmented control.
// Ask Purser sits in the phone's top bar, so it never covers a page. The views here are the Overview's "needs you" list,
// its payments flow and agent activity, and the Agents page's roster: each built from the API's answers with the
// console's own el() and ic(), text set as text. Its words are its own, in English and Dutch.
//
// The script goes into the console at __UI__ (cloud/src/console.ts), before the view modules that call it.

import { REPO_BLOB, ROSTER } from "./agentRoster.js";

/** The frame's words, English and Dutch. */
export const SHELL_WORDS = {
  en: {
    g_money: "Payments", g_agents: "Agents", g_rails: "Integrations",
    b_overview: "Overview", b_money: "Money", b_agents: "Agents", b_rails: "Connected", b_settings: "Settings",
    sections: "Sections", in_group: "Pages in {group}",
    demo_short: "Demo company · made-up data · test money", demo_leave: "Leave",
    // The Overview
    needs_h: "Needs you", needs_sub: "Approvals wait for the CFO's Face ID on the phone; nothing here pays.",
    due: "due {day}", per_month: "{amt} a month", needs_more: "{n} more", needs_all: "All approvals",
    flow_h: "How invoices flow to payment", flow_sub: "Where each of the {n} invoices is now, from the inbox to the books.",
    fl_received: "Received", fl_review: "Checked, needs a person", fl_faceid: "Waits for Face ID", fl_paid: "Paid", fl_booked: "{n} booked",
    fl_stopped: "Stopped before paying", fl_stopped_sub: "{blocked} blocked · {rejected} rejected · {dups} duplicates", fl_none: "No invoices yet: the flow fills as they arrive.",
    act_h: "Agent activity", act_sub: "What each agent spent against its limit, and the newest decisions with who made them.",
    act_spent: "{spent} of {cap} this month", act_more: "{n} agents in Purser", open: "Open",
    to_tx: "Transactions", to_inv: "Invoices", to_books: "Books", to_agents: "Agents", to_awx: "Airwallex",
    // The Agents page
    team_h: "Every agent in Purser", team_sub: "Each agent the product has, the model its code sets and the limit it is held to. Figures come only from this company's records.",
    st_code: "Not run here", st_switch: "Off by default", k_model: "Model", k_limit: "Limit", k_decisions: "Newest decisions", k_code: "Where it lives in code", k_switch: "Turned on in the runner with {sw}=on",
    code_only: "Code only", no_dec: "No decision in this company's records.", no_dec_switch: "Runs in the company's runner when {sw}=on; this company's records hold no run.",
    open_record: "Open its record", how: "How it works", see: "Watch a negotiation",
    passes_h: "Cards and limits", passes_sub: "The agents with a card: what each spent against the CFO's limit. Tap a card to turn it over.",
    stat_product: "agents in Purser", stat_here: "at work in this company", stat_dec: "decisions on record", stat_models: "Claude models: {names}",
    t_sourcing: "Sourcing", t_payables: "Payables", t_treasury: "Treasury", t_customers: "Customers", t_books: "Books",
  },
  nl: {
    g_money: "Betalingen", g_agents: "Agents", g_rails: "Integraties",
    b_overview: "Overzicht", b_money: "Geld", b_agents: "Agents", b_rails: "Gekoppeld", b_settings: "Instellingen",
    sections: "Onderdelen", in_group: "Pagina's in {group}",
    demo_short: "Demobedrijf · verzonnen gegevens · testgeld", demo_leave: "Verlaten",
    needs_h: "Wacht op jou", needs_sub: "Goedkeuringen wachten op de Face ID van de CFO op de telefoon; hier wordt niets betaald.",
    due: "vervalt {day}", per_month: "{amt} per maand", needs_more: "nog {n}", needs_all: "Alle goedkeuringen",
    flow_h: "Van factuur naar betaling", flow_sub: "Waar elk van de {n} facturen nu staat, van de inbox tot de boeken.",
    fl_received: "Ontvangen", fl_review: "Gecontroleerd, wacht op iemand", fl_faceid: "Wacht op Face ID", fl_paid: "Betaald", fl_booked: "{n} geboekt",
    fl_stopped: "Gestopt voor betaling", fl_stopped_sub: "{blocked} geblokkeerd · {rejected} afgewezen · {dups} dubbel", fl_none: "Nog geen facturen: de stroom vult zich zodra ze binnenkomen.",
    act_h: "Wat de agents doen", act_sub: "Wat elke agent uitgaf tegen zijn limiet, en de nieuwste beslissingen met wie ze nam.",
    act_spent: "{spent} van {cap} deze maand", act_more: "{n} agents in Purser", open: "Openen",
    to_tx: "Transacties", to_inv: "Facturen", to_books: "Boeken", to_agents: "Agents", to_awx: "Airwallex",
    team_h: "Elke agent in Purser", team_sub: "Elke agent die het product heeft, het model dat de code instelt en de limiet waaraan hij gehouden wordt. Bedragen komen alleen uit de gegevens van dit bedrijf.",
    st_code: "Hier niet gedraaid", st_switch: "Standaard uit", k_model: "Model", k_limit: "Limiet", k_decisions: "Nieuwste beslissingen", k_code: "Waar hij in de code staat", k_switch: "Aan in de runner met {sw}=on",
    code_only: "Alleen code", no_dec: "Geen beslissing in de gegevens van dit bedrijf.", no_dec_switch: "Draait in de runner van het bedrijf met {sw}=on; de gegevens van dit bedrijf bevatten geen run.",
    open_record: "Open zijn dossier", how: "Hoe hij werkt", see: "Bekijk een onderhandeling",
    passes_h: "Kaarten en limieten", passes_sub: "De agents met een kaart: wat elk uitgaf tegen de limiet van de CFO. Tik op een kaart om hem om te draaien.",
    stat_product: "agents in Purser", stat_here: "aan het werk in dit bedrijf", stat_dec: "beslissingen vastgelegd", stat_models: "Claude-modellen: {names}",
    t_sourcing: "Inkoop", t_payables: "Crediteuren", t_treasury: "Treasury", t_customers: "Klanten", t_books: "Boeken",
  },
} as const;

/** The pages in their groups, in the order of the menu: [group, its pages, the group's icon]. */
export const NAV_GROUPS: readonly (readonly [string, readonly string[], string])[] = [
  ["overview", ["overview"], "layout-dashboard"],
  ["money", ["invoices", "transactions", "books"], "wallet"],
  ["agents", ["agents", "tokenisation"], "bot"],
  ["rails", ["airwallex", "claude", "connections"], "link-2"],
  ["settings", ["settings"], "settings-2"],
];

/** Each page's icon in the menu. */
export const TAB_ICONS: Readonly<Record<string, string>> = {
  overview: "layout-dashboard", invoices: "receipt", transactions: "arrow-left-right", books: "file-check", agents: "bot", tokenisation: "credit-card",
  airwallex: "landmark", claude: "sparkles", connections: "link-2", settings: "settings-2",
};

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export const SHELL_JS = String.raw`
// --- The frame: sidebar, bottom tabs, a group's pages (22 Nov) ---------------------------------------------------------
const SH_W=` + json(SHELL_WORDS) + String.raw`;
function sw(k,v){const W=SH_W[NL?'nl':'en'];let s=W[k]??SH_W.en[k]??k;for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
const NAV_GROUPS=` + json(NAV_GROUPS) + String.raw`;
const TAB_IC=` + json(TAB_ICONS) + String.raw`;
// The menu's words were set from the catalogue at the first paint; each page gets its icon, each group its name.
for(const a of document.querySelectorAll('#tabs a[data-tab]'))a.prepend(ic(TAB_IC[a.dataset.tab]||'circle-dot'));
for(const g of document.querySelectorAll('#tabs [data-sg]'))g.textContent=sw('g_'+g.dataset.sg);
for(const a of document.querySelectorAll('#btabs a[data-group]')){const l=a.querySelector('.bl');if(l)l.textContent=sw('b_'+a.dataset.group)}
{const b=$('#btabs');if(b)b.setAttribute('aria-label',sw('sections'));const s=$('#demo .dr-short');if(s)s.textContent=sw('demo_short');const o=$('#demo-out .lv');if(o)o.textContent=sw('demo_leave')}
const groupOf=(tab)=>NAV_GROUPS.find((g)=>g[1].includes(tab))||(tab==='archive'?NAV_GROUPS[1]:null);
// The page a group opened last, so its tab goes back there.
const LAST_IN={};
function navSync(){
  const tab=(location.hash.split('/')[1]||'').split('?')[0];const g=S?groupOf(tab):null;
  if(g&&g[1].includes(tab))LAST_IN[g[0]]=tab;
  for(const a of document.querySelectorAll('#btabs a[data-group]')){const k=a.dataset.group;const grp=NAV_GROUPS.find((x)=>x[0]===k);a.href='#/'+(LAST_IN[k]||grp[1][0]);
    if(g&&g[0]===k)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
  // A group's pages, side by side under the top bar on a phone (a laptop has them in the sidebar).
  // A connected tab the company does not have yet (cloud/src/consoleCompany.ts) is left out.
  const sn=$('#subnav');if(sn){const pages=(g?g[1]:[]).filter((k)=>{const a=document.querySelector('#tabs a[data-tab='+k+']');return a&&!a.hidden});
    if(pages.length>1){const want=pages.join(',')+'|'+tab;if(sn.dataset.k!==want){sn.dataset.k=want;sn.setAttribute('aria-label',sw('in_group',{group:sw('b_'+g[0])}));
      sn.replaceChildren(...pages.map((k)=>{const src=document.querySelector('#tabs a[data-tab='+k+']');const a=el('a','',[ic(TAB_IC[k]),el('span','',src?src.textContent:k)]);a.href='#/'+k;if(k===tab)a.setAttribute('aria-current','page');return a}))}
      sn.hidden=false}else{sn.hidden=true;sn.dataset.k=''}}
  placeAsk();
}
// Ask Purser: floating on a laptop; in the top bar on a phone, where it covers nothing.
const PHONE=matchMedia('(max-width: 1023px)');
function placeAsk(){const f=$('#pask-fab'),slot=$('#ask-slot');if(!f||!slot)return;
  const inBar=PHONE.matches&&document.body.classList.contains('signed-in');
  if(inBar&&f.parentElement!==slot)slot.append(f);else if(!inBar&&f.parentElement===slot)document.body.append(f)}
PHONE.addEventListener('change',placeAsk);setTimeout(placeAsk,0);
// The group a page belongs to, for its header's eyebrow.
function groupWords(){const tab=(location.hash.split('/')[1]||'').split('?')[0];const g=groupOf(tab);return g&&g[1].length>1?sw('g_'+g[0]):''}
// Rise in on the next frame; reduced motion shows everything at once (CSS).
const riseIn=(root)=>requestAnimationFrame(()=>{for(const n of (root||view()).querySelectorAll('.rise'))n.classList.add('in')});
// A card's link to the page its figures come from, in its header.
function cardLink(card,href,label){const a=el('a','dlink',[label,ic('chevron-right')]);a.href=href;const h=card.querySelector('.dh');if(h){h.classList.add('withlink');h.append(a)}return card}

// --- The Overview: what needs you, the payments flow, the agents at work ------------------------------------------------
// What needs you: the approvals that wait for the CFO's Face ID, each a link to its invoice, and the way to review them.
function needsYou(wait){
  if(!wait.length)return null;
  const rows=wait.slice(0,4).map((i)=>{const a=el('a','ny-row',[el('span','ny-b',[el('b','',i.vendor||''),el('span','sub num',[i.invoice_no||i.id,i.due_date?' · '+sw('due',{day:dday(i.due_date)}):''])]),el('b','num ny-amt',ma(i.currency,i.total)),ic('chevron-right')]);a.href='#/invoices/'+encodeURIComponent(i.id);return a});
  const go=el('a','btn primary ny-go',[t('cs.ov.review'),ic('chevron-right')]);go.href='#/invoices?f=waiting_cfo';
  const all=wait.length>4?(()=>{const x=el('a','ny-all',[sw('needs_more',{n:wait.length-4}),ic('chevron-right')]);x.href='#/invoices?f=waiting_cfo';return x})():null;
  return el('section','card nyou rise',[el('div','ny-h',[el('span','ny-ic',ic('scan-face')),el('div','ny-t',[el('span','ny-eb',[sw('needs_h'),el('span','ny-n num',String(wait.length))]),el('h2','',t(wait.length===1?'cs.next.faceid_1':'cs.next.faceid_n',{n:wait.length})),el('p','',sw('needs_sub'))]),go]),el('div','ny-list',rows),all])}
function payFlow(items,booked,dups,cur0){
  const n=items.length;if(!n)return el('section','card dcard rise pflow-c',[el('div','dh',[el('h2','',sw('flow_h'))]),chartEmpty(sw('fl_none'))]);
  const sum=(xs)=>{const per={};for(const i of xs)per[i.currency]=(per[i.currency]||0)+toCents(i.total);const e=Object.entries(per).sort((a,b)=>(a[0]===cur0?-1:b[0]===cur0?1:b[1]-a[1]));return e.length?e.map(([c,v])=>cur(c)+' '+cents(v)).join(' · '):'—'};
  const is=(ss)=>items.filter((i)=>ss.includes(i.status));
  const known=['waiting_cfo','paid','blocked','rejected'];const review=items.filter((i)=>!known.includes(i.status));
  const paid=is(['paid']),nb=paid.filter((i)=>booked[i.id]&&booked[i.id].length).length;
  const stage=(k,icon,label,xs,href,extra)=>{const a=el('a','pf-st pf-'+k+(xs.length?'':' zero'),[el('span','pf-dot',ic(icon)),el('b','pf-n num',String(xs.length)),el('span','pf-l',label),el('span','pf-a num',xs.length?sum(xs):'—'),extra||null]);a.href=href;return el('li','',a)};
  const ol=el('ol','pflow',[stage('in','inbox',sw('fl_received'),items,'#/invoices'),stage('rv','triangle-alert',sw('fl_review'),review,'#/invoices?f=act'),
    stage('fid','scan-face',sw('fl_faceid'),is(['waiting_cfo']),'#/invoices?f=waiting_cfo'),stage('pd','circle-check',sw('fl_paid'),paid,'#/invoices?f=paid',nb?el('span','pf-x',[ic('file-check'),sw('fl_booked',{n:nb})]):null)]);
  const stopped=is(['blocked','rejected']);
  const off=el('a','pf-off',[ic('octagon-x'),el('span','',[el('b','',sw('fl_stopped')+' '),el('span','num',String(stopped.length+dups))]),el('span','sub',sw('fl_stopped_sub',{blocked:is(['blocked']).length,rejected:is(['rejected']).length,dups}))]);off.href='#/invoices?f=blocked';
  return cardLink(el('section','card dcard rise pflow-c',[el('div','dh',[el('h2','',sw('flow_h')),el('p','',sw('flow_sub',{n}))]),ol,off]),'#/invoices',sw('to_inv'))}
// One line per agent the records name: spent against its monthly limit, its newest decision, a link to its record.
function agentStrip(agents){
  if(!agents||!agents.length)return null;
  const rows=agents.map((a)=>{const c=a.card;const spent=c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null,cap=c&&c.per_month?toCents(c.per_month):0;
    const C=c?cur(c.currency)+' ':'';const bar=el('span','as-bar'+(spent!==null&&spent>=cap?' full':''));const f=el('span','');f.style.width=(spent!==null&&cap>0?Math.min(100,spent/cap*100):0).toFixed(1)+'%';bar.append(f);
    const d=(a.decisions||[])[0];const o=d?(OUTCOME[d.outcome]||OUTCOME.note):null;
    const r=el('a','as-row',[el('span','as-av h'+passHue(a),ic('bot')),el('span','as-b',[el('b','',a.name),spent!==null?el('span','sub num',sw('act_spent',{spent:C+cents(spent),cap:C+cents(cap)})):el('span','sub',a.role||'')]),
      spent!==null?bar:el('span',''),d?el('span','as-d',[el('span','obadge '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[d.outcome]?d.outcome:'note'))]),el('span','as-dt',d.text.replace(/\s*\(code's fallback, no model\)$/,''))]):el('span',''),ic('chevron-right')]);
    r.href='#/agents?a='+encodeURIComponent(a.id);return r});
  const more=el('a','as-more',[sw('act_more',{n:ROSTER.length}),ic('chevron-right')]);more.href='#/agents';
  return el('div','astrip',[...rows,more])}

// --- The Agents page: every agent in Purser ----------------------------------------------------------------------------
const ROSTER=` + json(ROSTER) + String.raw`;
const REPO_BLOB=` + json(REPO_BLOB) + String.raw`;
const TEAM_IC={sourcing:'link-2',payables:'receipt',treasury:'landmark',customers:'users',books:'file-check'};
function rosterCard(r,rec){
  const on=!!rec;const st=on?el('span','rs-st '+String(rec.status).replace(/[^a-z]/g,''),[el('i',''),tk('cs.agents.status.'+rec.status,rec.status)]):el('span','rs-st off',[el('i',''),r.switch?sw('st_switch'):sw('st_code')]);
  const c=on&&rec.card;const C=c?cur(c.currency)+' ':'';
  const lim=c&&(c.per_purchase||c.per_month)?[c.per_purchase?t('cs.wl.per',{amt:C+cents(toCents(c.per_purchase))}):null,c.per_month?sw('per_month',{amt:C+cents(toCents(c.per_month))}):null].filter(Boolean).join(' · '):r.limit;
  const spent=c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null,cap=c&&c.per_month?toCents(c.per_month):0;
  let meter=null;if(spent!==null){meter=el('span','as-bar'+(spent>=cap?' full':''));const f=el('span','');f.style.width=(cap>0?Math.min(100,spent/cap*100):0).toFixed(1)+'%';meter.append(f)}
  const decs=on?(rec.decisions||[]).slice(0,2):[];
  const dec=decs.length?el('ul','rs-dec',decs.map((d)=>{const o=OUTCOME[d.outcome]||OUTCOME.note;return el('li','',[el('span','obadge '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[d.outcome]?d.outcome:'note'))]),el('span','rs-dt',d.text.replace(/\s*\(code's fallback, no model\)$/,'')),el('time','num',dday(d.at))])})):
    el('p','rs-none',r.switch&&!on?sw('no_dec_switch',{sw:r.switch}):sw('no_dec'));
  const how=el('details','rs-how',[el('summary','',[sw('how'),ic('chevron-down')]),el('div','rs-hb',[el('p','',r.model_note),r.switch?el('p','sub',sw('k_switch',{sw:r.switch})):null,
    el('h4','',sw('k_code')),el('ul','rs-code',r.code.map((p)=>el('li','',[(()=>{const a=el('a','mono',p);a.href=REPO_BLOB+p;a.target='_blank';a.rel='noopener';return a})()])))])]);
  const acts=[];
  if(on){const a=el('a','btn sm',[sw('open_record'),ic('arrow-right')]);a.href='#/agents?a='+encodeURIComponent(r.id);acts.push(a)}
  if(r.see){const a=el('a','btn sm ghost2',[ic('play'),r.see.label==='Watch a negotiation'?sw('see'):r.see.label]);a.href=r.see.href;acts.push(a)}
  const card=el('article','card rs rise t-'+r.team+(on?' on':''),[
    el('div','rs-h',[el('span','rs-av',ic(on?'bot':TEAM_IC[r.team]||'bot')),el('div','rs-who',[el('b','',r.name),el('span','rs-role',r.role)]),st]),
    el('p','rs-job',r.job),
    el('dl','rs-facts',[el('dt','',sw('k_model')),el('dd','',r.model?el('span','mono',r.model):el('span','sub',sw('code_only'))),el('dt','',sw('k_limit')),el('dd','',[el('span','',lim),meter])]),
    el('div','rs-dw',[el('h4','',sw('k_decisions')),dec]),
    el('div','rs-f',[acts.length?el('div','rs-acts',acts):null,how])]);
  card.id='roster-'+r.id;return card}
function rosterSection(recs,feedTotal){
  const byId=new Map((recs||[]).map((a)=>[a.id,a]));
  const here=ROSTER.filter((r)=>byId.has(r.id)).length;
  // An agent the records name that the roster does not know is shown too, as its records have it.
  const extra=(recs||[]).filter((a)=>!ROSTER.some((r)=>r.id===a.id)).map((a)=>({id:a.id,name:a.name,team:'payables',role:a.role||'',job:a.job||'',model:(a.models||[])[0]||null,model_note:'',limit:'',switch:null,code:[]}));
  const all=[...ROSTER,...extra];
  const stat=(n,label)=>el('div','rs-stat',[el('b','num',String(n)),el('span','',label)]);
  return el('section','roster',[el('div','sec-h',[el('h2','',sw('team_h')),el('p','sub',sw('team_sub'))]),
    el('div','rs-stats rise',[stat(all.length,sw('stat_product')),stat(here+extra.length,sw('stat_here')),feedTotal!==null?stat(feedTotal,sw('stat_dec')):null,(()=>{const ms=[...new Set(all.map((r)=>r.model).filter(Boolean))].sort();return stat(ms.length,sw('stat_models',{names:ms.map((x)=>x.replace(/^claude-([a-z]+)-.*$/,(_,n)=>n.charAt(0).toUpperCase()+n.slice(1))).join(', ')}))})()]),
    el('div','rs-grid',all.map((r)=>rosterCard(r,byId.get(r.id))))])}
// A link to an agent's record (#/agents?a=id) opens its details and scrolls to it, once drawn.
function openAgentFromQuery(q){const id=q&&q.get&&q.get('a');if(!id)return;
  const sec=[...view().querySelectorAll('.wagent')].find((s)=>{const p=s.querySelector('.wdetail');return p&&p.id==='agent-'+id.replace(/[^a-z0-9]+/gi,'-')+'-details'})||$('#roster-'+CSS.escape(id));
  if(!sec)return;const b=sec.querySelector('button.wmore');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();
  requestAnimationFrame(()=>sec.scrollIntoView({block:'start',behavior:RM()?'auto':'smooth'}))}
`;

export const SHELL_CSS = `
/* --- The frame (cloud/src/consoleShell.ts, 22 Nov) ------------------------------------------------------------------- */
:root { --side: 248px; --hdr: 65px; --tabbar: 60px; }
.abrand, .btabs, #ask-slot { display: none; }
#subnav[hidden] { display: none; }
.apptabs .ng { display: none; }
/* A laptop: the pages in a sidebar under the site's header, grouped; the company on top, the person and test money below. */
@media (min-width: 1024px) {
  .signed-in .appbar { position: fixed; z-index: 25; top: var(--hdr); left: 0; bottom: 0; width: var(--side); border-right: 1px solid var(--border); border-bottom: 0; background: var(--surface); overflow-y: auto; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .signed-in .appbar .wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto 1fr auto; align-items: center; column-gap: 0; min-height: 100%; height: auto; max-width: none; margin: 0; padding: 14px 12px 12px; }
  .signed-in .appbar .who-am-i { display: contents; }
  /* 21 Nov: the company block is the switcher: its name opens the Company page, the chevron the other companies. */
  .signed-in .appbar .cosw { order: 1; grid-column: 1 / -1; display: flex; align-items: stretch; gap: 0; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); }
  .signed-in .appbar .cosw:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .signed-in .appbar .co-more { width: 32px; height: auto; border-radius: 0 9px 9px 0; border-left: 1px solid var(--border); }
  .signed-in .appbar .co-menu { left: 0; width: calc(var(--side) - 24px); }
  .signed-in .appbar #co { flex: 1 1 auto; display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 10px; row-gap: 1px; align-items: center; margin: 0; padding: 9px 10px; border-radius: 9px 0 0 9px; border: 0; background: transparent; max-width: none; text-decoration: none; }
  .signed-in .appbar #co .av { grid-row: 1 / span 2; width: 28px; height: 28px; }
  .signed-in .appbar #co .cn { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .signed-in .appbar #co .cn .cx { display: none; }
  .signed-in .appbar #co .aw { grid-column: 2; justify-self: start; margin: 0; padding: 0; border: 0; background: none; font-size: 12px; }
  .signed-in .appbar #co .aw .aww { display: inline; }
  .signed-in .appbar #co:hover { background: var(--sunken); }
  .signed-in .appbar nav.apptabs { order: 2; grid-column: 1 / -1; display: flex; flex-direction: column; gap: 1px; margin: 14px 0 0; padding: 0; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .signed-in .appbar nav.apptabs a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; font-size: 14px; font-weight: 600; color: var(--muted); box-shadow: none; transition: background .15s, color .15s; }
  .signed-in .appbar nav.apptabs a .ic { display: inline-flex; color: var(--faint); transition: color .15s; }
  .signed-in .appbar nav.apptabs a:hover { background: var(--sunken); color: var(--text); }
  .signed-in .appbar nav.apptabs a[aria-current="page"] { background: var(--accent-soft); color: var(--accent); box-shadow: none; border-radius: 8px; }
  .signed-in .appbar nav.apptabs a[aria-current="page"] .ic { color: var(--accent); }
  .signed-in .apptabs .ng { display: block; margin: 16px 10px 4px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--faint); }
  .signed-in .apptabs .ng.sep { height: 1px; margin: 12px 10px; background: var(--border); }
  .signed-in .appbar .spacer { order: 3; grid-column: 1 / -1; align-self: stretch; min-height: 24px; }
  /* 21 Nov (the owner: the test-money pill and "Guest (demo) · ends in 8 min" looked buggy): one session block at the
     foot, the person, a quiet countdown and sign out; test money sits once in the header strip (placeTest). */
  .signed-in .appbar .awx-app { display: none; }
  .signed-in .appbar #who { order: 6; grid-column: 1; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px 4px 2px 6px; border-top: 1px solid var(--border); font-size: 13px; max-width: none; white-space: normal; }
  .signed-in .appbar #who:empty { display: none; }
  .signed-in .appbar #out { order: 7; grid-column: 2; align-self: stretch; display: inline-grid; place-items: center; width: 36px; margin-top: 0; padding: 12px 0 2px; border-top: 1px solid var(--border); border-radius: 0; background: none; }
  .signed-in .appbar #out:hover { color: var(--bad); background: none; }
  .signed-in main, .signed-in .demo-ribbon, .signed-in #foot, .signed-in .foot-awx { margin-left: var(--side); }
  .signed-in #foot, .signed-in .foot-awx { max-width: none; }
  .signed-in main > .wrap { max-width: 1240px; }
}
/* A phone or a narrow window: a compact top bar (the mark, the company, Ask, sign out, test money), the five groups at the bottom. */
@media (max-width: 1023px) {
  .signed-in header.top { display: none; }
  .signed-in .appbar { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--surface) 90%, transparent); backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); }
  .signed-in .appbar .wrap { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; height: 54px; min-height: 54px; padding-top: 0; padding-left: 16px; padding-right: 12px; }
  .signed-in .appbar nav.apptabs, .signed-in .appbar .awx-app, .signed-in .appbar .spacer { display: none; }
  .signed-in .abrand { display: inline-flex; flex: none; align-items: center; text-decoration: none; color: inherit; }
  .abrand .mk { width: 30px; height: 30px; border-radius: 9px; background: var(--text); color: var(--bg); display: grid; place-items: center; }
  .signed-in .who-am-i { flex: 1 1 auto; min-width: 0; justify-content: flex-start; gap: 2px; }
  .signed-in .who-am-i #who { display: none; }
  .signed-in .who-am-i #co { min-width: 0; margin-right: auto; }
  .signed-in #ask-slot { display: inline-flex; flex: none; }
  .signed-in .appbar .test { margin-left: 2px; padding: 8px; }
  .appbar #pask-fab { position: static; min-height: 36px; height: 36px; width: 36px; padding: 0; justify-content: center; border-radius: 10px; border: 0; box-shadow: none; background: transparent; color: var(--accent); transform: none; }
  .appbar #pask-fab svg { width: 32px; height: 32px; }
  .appbar #pask-fab:hover { transform: none; box-shadow: none; }
  .appbar #pask-fab .pask-t { display: none; }
  .signed-in .btabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; height: calc(var(--tabbar) + env(safe-area-inset-bottom)); padding: 0 4px env(safe-area-inset-bottom);
    background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: saturate(1.4) blur(16px); -webkit-backdrop-filter: saturate(1.4) blur(16px); border-top: 1px solid var(--border); }
  .btabs a { display: grid; justify-items: center; align-content: center; gap: 3px; min-height: 48px; text-decoration: none; color: var(--faint); font-size: 11px; font-weight: 650; letter-spacing: .01em; border-radius: 12px; -webkit-tap-highlight-color: transparent; }
  .btabs a .i { width: 22px; height: 22px; }
  .btabs a[aria-current="page"] { color: var(--accent); }
  .btabs a[aria-current="page"] .i { stroke-width: 2.3; }
  .signed-in { padding-bottom: calc(var(--tabbar) + env(safe-area-inset-bottom)); }
  .signed-in main { padding-top: 14px; }
  .subnav-wrap { margin-bottom: 0; }
  .signed-in #subnav { display: flex; gap: 3px; padding: 3px; margin: 0 0 18px; border-radius: 12px; background: var(--sunken); }
  #subnav a { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; border-radius: 9px; text-decoration: none; color: var(--muted); font-size: 13.5px; font-weight: 650; white-space: nowrap; }
  #subnav a span { overflow: hidden; text-overflow: ellipsis; }
  #subnav a[aria-current="page"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(16,24,40,.08), 0 1px 1px rgba(16,24,40,.04); }
  #subnav a .ic { display: inline-flex; }
  @media (max-width: 430px) { #subnav a .ic { display: none; } }
}
@media (min-width: 1024px) { #subnav { display: none !important; } }
.subnav-wrap:has(#subnav[hidden]) { display: none; }
/* The demo company: one quiet line under the bar, still saying what it is. */
.demo-ribbon { background: transparent; border: 0; color: var(--warn); font-size: 12.5px; }
.demo-ribbon .wrap { display: block; min-height: 0; padding-top: 14px; padding-bottom: 0; }
.demo-ribbon .dr { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin: 0; padding: 5px 6px 5px 11px; border-radius: 999px; background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 22%, transparent); line-height: 1.35; }
.demo-ribbon .dr .i { width: 14px; height: 14px; flex: none; }
.demo-ribbon span { flex: initial; }
.demo-ribbon .dr-short { display: none; }
.demo-ribbon a { min-height: 0; padding: 3px 10px; border-radius: 999px; background: color-mix(in srgb, var(--warn) 12%, transparent); text-decoration: none; font-weight: 650; }
.demo-ribbon a:hover { background: color-mix(in srgb, var(--warn) 20%, transparent); }
.demo-ribbon a .lv { display: none; }
@media (max-width: 760px) { .demo-ribbon .dr-full { display: none; } .demo-ribbon .dr-short { display: inline; } .demo-ribbon a .lw { display: none; } .demo-ribbon a .lv { display: inline; } .demo-ribbon .wrap { padding-top: 12px; } .demo-ribbon .dr { font-size: 12px; gap: 6px; padding-left: 10px; } .demo-ribbon .dr > .i { display: none; } .signed-in main { padding-top: 12px; } }
/* Page headers: one shape on every page, the group above the title. */
#view > .head { align-items: flex-end; gap: 12px 20px; margin-bottom: 22px; }
#view > .head .eyebrow { display: block; margin: 0 0 4px; font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
#view > .head h1 { margin: 0; }
#view > .head .lede { margin: 6px 0 0; max-width: 72ch; color: var(--muted); }
@media (max-width: 640px) { #view h1 { font-size: 24px; } #view > .head { margin-bottom: 16px; } }
/* Cards, tables and empty states: one language. */
.card { border-radius: 14px; }
.card.list, .card.panel { overflow: hidden; }
.empty { padding: 32px 20px; text-align: center; color: var(--muted); display: grid; gap: 4px; justify-items: center; }
.empty b { color: var(--text); font-size: 15px; }
.dcard .dh.withlink { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: start; }
.dcard .dh.withlink > :not(.dlink) { grid-column: 1; }
.dcard .dh .dlink { grid-column: 2; grid-row: 1; display: inline-flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 650; color: var(--accent); text-decoration: none; white-space: nowrap; padding: 2px 0; }
.dcard .dh .dlink:hover { text-decoration: underline; }
.dcard .dh .dlink .ic svg { width: 14px; height: 14px; }
a.card.kpi { text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s, transform .15s; }
a.card.kpi:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 8px 20px -12px rgba(16,24,40,.25); }
/* Needs you: the approvals that wait, each a link to its invoice. */
.nyou { margin-bottom: 16px; padding: 18px 20px 8px; border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); background: linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 55%, var(--surface)), var(--surface) 70%); }
.ny-h { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 14px; align-items: center; margin-bottom: 14px; }
.ny-ic { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: var(--accent); color: #fff; box-shadow: 0 6px 16px -8px var(--accent); }
.ny-ic svg { width: 22px; height: 22px; }
.ny-eb { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
.ny-t h2 { margin: 2px 0 0; font-size: 18px; letter-spacing: -.01em; }
.ny-t p { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
.ny-n { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11.5px; font-weight: 700; letter-spacing: 0; }
.btn.ny-go { text-decoration: none; gap: 4px; }
.ny-list { display: grid; border-top: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border)); }
a.ny-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 12px; align-items: center; padding: 11px 4px; text-decoration: none; color: inherit; border-radius: 8px; }
a.ny-row + a.ny-row { border-top: 1px solid var(--border); }
a.ny-row:hover { background: color-mix(in srgb, var(--accent-soft) 55%, transparent); }
.ny-b { display: grid; min-width: 0; } .ny-b b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ny-b .sub { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ny-amt { font-size: 15px; }
@media (max-width: 640px) { .ny-h { grid-template-columns: 44px minmax(0, 1fr); } .ny-ic { width: 44px; height: 44px; } .btn.ny-go { grid-column: 1 / -1; justify-content: center; height: 46px; } .ny-t h2 { font-size: 17px; } }
a.ny-all { display: inline-flex; align-items: center; gap: 2px; margin-top: 10px; font-size: 13px; font-weight: 650; color: var(--accent); text-decoration: none; }
/* The payments flow: four stages joined by a line that carries a dot from the inbox to paid; the stopped ones apart. */
ol.pflow { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; position: relative; counter-reset: none; }
ol.pflow > li { position: relative; min-width: 0; }
ol.pflow > li:not(:last-child)::before { content: ""; position: absolute; top: 21px; left: 54px; right: -8px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 40%, var(--border)), var(--border)); }
ol.pflow > li:not(:last-child)::after { content: ""; position: absolute; top: 18px; left: 54px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); opacity: 0; }
a.pf-st { display: grid; gap: 2px; text-decoration: none; color: inherit; padding: 0 0 4px; border-radius: 12px; }
a.pf-st:hover .pf-l { color: var(--accent); }
.pf-dot { width: 44px; height: 44px; margin-bottom: 10px; border-radius: 14px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); position: relative; z-index: 1; box-shadow: 0 0 0 4px var(--surface); }
.pf-fid .pf-dot { background: var(--accent); color: #fff; } .pf-pd .pf-dot { background: var(--ok-soft); color: var(--ok); } .pf-rv .pf-dot { background: var(--warn-soft); color: var(--warn); } .pf-in .pf-dot { background: var(--accent-soft); color: var(--accent); }
.pf-st.zero .pf-dot { background: var(--sunken); color: var(--faint); }
.pf-n { font-size: 26px; line-height: 1.1; font-weight: 700; letter-spacing: -.02em; }
.pf-l { font-size: 13px; font-weight: 600; color: var(--muted); line-height: 1.3; }
.pf-a { margin-top: 4px; font-size: 13px; color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
.pf-x { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 12px; color: var(--ok); font-weight: 600; } .pf-x .ic svg { width: 13px; height: 13px; }
a.pf-off { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 16px; padding: 10px 12px; border-radius: 10px; background: var(--sunken); color: var(--muted); font-size: 13px; text-decoration: none; }
a.pf-off b { color: var(--text); } a.pf-off .ic { color: var(--bad); display: inline-flex; } a.pf-off:hover { color: var(--text); }
@media (prefers-reduced-motion: no-preference) {
  .rise.in ol.pflow > li:not(:last-child)::after { animation: pfdot 3s cubic-bezier(.45, 0, .25, 1) infinite; }
  .rise.in ol.pflow > li:nth-child(2)::after { animation-delay: 1s; } .rise.in ol.pflow > li:nth-child(3)::after { animation-delay: 2s; }
  @keyframes pfdot { 0% { left: 54px; opacity: 0; } 15% { opacity: .9; } 80% { opacity: .9; } 100% { left: calc(100% - 4px); opacity: 0; } }
  .rise .pf-dot { transform: scale(.85); opacity: .4; transition: transform .45s cubic-bezier(.2, .8, .2, 1), opacity .45s; }
  .rise.in .pf-dot { transform: none; opacity: 1; }
  .rise.in li:nth-child(2) .pf-dot { transition-delay: .08s; } .rise.in li:nth-child(3) .pf-dot { transition-delay: .16s; } .rise.in li:nth-child(4) .pf-dot { transition-delay: .24s; }
}
@media (max-width: 760px) {
  ol.pflow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); row-gap: 18px; }
  ol.pflow > li::before, ol.pflow > li::after { display: none; }
  .pf-n { font-size: 21px; }
}
/* The agents at work, on the Overview. */
.astrip { display: grid; margin: 0 0 14px; border-top: 1px solid var(--border); }
a.as-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) minmax(80px, 160px) 16px; gap: 4px 12px; align-items: center; padding: 11px 2px; border-bottom: 1px solid var(--border); text-decoration: none; color: inherit; }
a.as-row > .as-av { grid-row: 1 / span 2; align-self: start; } a.as-row > .as-d { grid-column: 2 / 4; grid-row: 2; } a.as-row > .ic { grid-column: 4; grid-row: 1 / span 2; }
a.as-row:hover { background: color-mix(in srgb, var(--accent-soft) 45%, transparent); }
.as-av, .rs-av { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff; background: linear-gradient(140deg, #312e81, #4f46e5); }
.as-av.h1 { background: linear-gradient(140deg, #064e3b, #0e9488); } .as-av.h2 { background: linear-gradient(140deg, #0b1b45, #2563eb); } .as-av.h3 { background: linear-gradient(140deg, #7c2d12, #d97706); } .as-av.h4 { background: linear-gradient(140deg, #701a3d, #db2777); } .as-av.h5 { background: linear-gradient(140deg, #111827, #4b5563); }
.as-b { display: grid; min-width: 0; } .as-b b { font-size: 14px; } .as-b .sub { font-size: 12.5px; }
.as-bar { display: block; height: 6px; border-radius: 999px; background: var(--sunken); overflow: hidden; }
.as-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--accent); transform-origin: left center; }
.as-bar.full > span { background: var(--bad); }
.as-d { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.as-dt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
a.as-more { display: inline-flex; align-items: center; gap: 2px; padding-top: 10px; font-size: 13px; font-weight: 650; color: var(--accent); text-decoration: none; }
@media (prefers-reduced-motion: no-preference) { .rise .as-bar > span { transform: scaleX(0); transition: transform .6s cubic-bezier(.2, .7, .2, 1) .15s; } .rise.in .as-bar > span { transform: scaleX(1); } }
@media (max-width: 760px) { a.as-row { grid-template-columns: 34px minmax(0, 1fr) 16px; } a.as-row > .as-bar { grid-column: 2; grid-row: 3; } a.as-row > .as-d { grid-column: 2; grid-row: 2; } a.as-row > .ic { grid-column: 3; grid-row: 1 / span 3; } a.as-row > .as-av { grid-row: 1 / span 3; } }
/* The Agents page: the roster. */
.roster { margin: 0 0 30px; }
@media (max-width: 640px) { .roster .sec-h p { display: none; } }
.sec-h { margin: 4px 0 14px; } .sec-h h2 { margin: 0; font-size: 19px; letter-spacing: -.01em; } .sec-h p { margin: 4px 0 0; max-width: 80ch; }
.rs-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 0 0 16px; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--border); }
.rs-stat { display: grid; gap: 2px; padding: 14px 16px; background: var(--surface); } .rs-stat b { font-size: 22px; font-weight: 700; letter-spacing: -.02em; } .rs-stat span { font-size: 12.5px; color: var(--muted); }
@media (max-width: 760px) { .rs-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.rs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; }
article.rs { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; min-width: 0; scroll-margin-top: 90px; }
article.rs:not(.on) { background: color-mix(in srgb, var(--sunken) 35%, var(--surface)); }
.rs-h { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.rs-who { display: grid; min-width: 0; } .rs-who b { font-size: 15px; letter-spacing: -.01em; } .rs-role { font-size: 12.5px; color: var(--muted); }
.t-payables .rs-av { background: linear-gradient(140deg, #7c2d12, #d97706); } .t-treasury .rs-av { background: linear-gradient(140deg, #0b1b45, #2563eb); } .t-customers .rs-av { background: linear-gradient(140deg, #064e3b, #0e9488); } .t-books .rs-av { background: linear-gradient(140deg, #111827, #4b5563); }
article.rs:not(.on) .rs-av { filter: saturate(.55); }
.rs-st { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 650; white-space: nowrap; background: var(--ok-soft); color: var(--ok); }
.rs-st i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.rs-st.off { background: var(--sunken); color: var(--muted); } .rs-st.paused, .rs-st.revoked { background: var(--bad-soft); color: var(--bad); }
@media (prefers-reduced-motion: no-preference) { article.rs.on .rs-st i { animation: rspulse 2.4s ease-in-out infinite; } @keyframes rspulse { 50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 20%, transparent); } } }
.rs-job { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text); }
@media (max-width: 640px) { .rs-job { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; } }
dl.rs-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 13px; }
dl.rs-facts dt { color: var(--muted); font-weight: 600; } dl.rs-facts dd { margin: 0; display: grid; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.rs-dw h4, .rs-hb h4 { margin: 0 0 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
ul.rs-dec { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.rs-dec li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: start; font-size: 13px; }
.rs-dt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; padding-top: 2px; } ul.rs-dec time { padding-top: 3px; white-space: nowrap; } ul.rs-dec time { color: var(--faint); font-size: 12px; }
.rs-none { margin: 0; font-size: 13px; color: var(--faint); }
.rs-f { margin-top: auto; display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
.rs-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.btn.sm { height: 34px; padding: 0 12px; font-size: 13px; gap: 6px; text-decoration: none; }
.btn.sm.ghost2 { background: transparent; }
details.rs-how summary { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; list-style: none; font-size: 13px; font-weight: 650; color: var(--accent); }
details.rs-how summary::-webkit-details-marker { display: none; }
details.rs-how summary .ic { transition: transform .2s; } details.rs-how[open] summary .ic { transform: rotate(180deg); }
.rs-hb { display: grid; gap: 8px; margin-top: 8px; font-size: 13px; } .rs-hb p { margin: 0; }
ul.rs-code { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; } ul.rs-code a { font-size: 12.5px; color: var(--accent); overflow-wrap: anywhere; }
.agents-passes-h { margin-top: 8px; }
/* The passes stand at their own height: a card with its payment token below does not stretch the one beside it. */
.agents.wallet { align-items: start; }
.wagent:not(.open) button.wpass { flex: none; }
`;
