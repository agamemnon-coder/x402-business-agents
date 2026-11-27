// Purser Cloud's frame and the views that tie it together (22 Nov, the owner: "very unclear and unorganised… make it
// enterprise level, without making it a mess"; on his iPhone the nine pages were a 3×4 grid of words). The pages are
// grouped as a finance team works:
//   Overview
//   Money     Invoices, Receivables, Cash & FX, Transactions, Books
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
    g_money: "Payments", g_agents: "Agents", g_rails: "Integrations", b_overview: "Overview", b_money: "Money",
    b_agents: "Agents", b_rails: "Connected", b_settings: "Settings", sections: "Sections", pages: "Pages", crumbs: "Breadcrumb", in_group: "Pages in {group}",
    demo_short: "Demo company · made-up data · test money", demo_leave: "Leave", due: "due {day}",
    per_month: "{amt} a month", flow_h: "How invoices flow to payment",
    flow_sub: "Where each of the {n} invoices is now, from the inbox to the books.", fl_received: "Received",
    fl_review: "Checked, needs a person", fl_faceid: "Waits for Face ID", fl_paid: "Paid", fl_booked: "{n} booked",
    fl_stopped: "Stopped before paying", fl_stopped_sub: "{blocked} blocked · {rejected} rejected · {dups} duplicates", fl_stopped_sub1: "{blocked} blocked · {rejected} rejected · {dups} duplicate",
    fl_none: "No invoices yet: the flow fills as they arrive.", act_spent: "{spent} of {cap} this month",
    act_more: "{n} agents in Purser", open: "Open", to_tx: "Transactions", to_inv: "Invoices", to_agents: "Agents",
    st_code: "Not run here", st_switch: "Off by default", code_only: "Code only", how: "How it works",
    see: "Watch a negotiation", k_search: "Search", k_ph: "Jump to a page", k_none: "No page matches",
    sb_min: "Collapse the sidebar", sb_max: "Expand the sidebar", as_of: "{name} · figures as of {day}",
    k_cash: "Cash position", k_wait: "Invoices waiting for the CFO", k_paid: "Paid this month",
    k_paid_sub: "{n} invoices · {prev} in {month}", k_spend: "Agent spend vs limits",
    k_spend_sub: "of {cap} monthly limits · {n} cards", k_spend_none: "No agent card in the records",
    ag_h: "Agent status", ag_sub: "Each card's spend against its monthly limit, and the agent's newest decision.",
    rails_h: "Connected rails", live: "Live", net_h: "Connected", net_sub: "Amsterdam · the demo company", net_to: "Open Connections",
  },
  nl: {
    g_money: "Betalingen", g_agents: "Agents", g_rails: "Integraties", b_overview: "Overzicht", b_money: "Geld",
    b_agents: "Agents", b_rails: "Gekoppeld", b_settings: "Instellingen", sections: "Onderdelen", pages: "Pagina's", crumbs: "Kruimelpad",
    in_group: "Pagina's in {group}", demo_short: "Demobedrijf · verzonnen gegevens · testgeld", demo_leave: "Verlaten",
    due: "vervalt {day}", per_month: "{amt} per maand", flow_h: "Van factuur naar betaling",
    flow_sub: "Waar elk van de {n} facturen nu staat, van de inbox tot de boeken.", fl_received: "Ontvangen",
    fl_review: "Gecontroleerd, wacht op iemand", fl_faceid: "Wacht op Face ID", fl_paid: "Betaald",
    fl_booked: "{n} geboekt", fl_stopped: "Gestopt voor betaling",
    fl_stopped_sub: "{blocked} geblokkeerd · {rejected} afgewezen · {dups} dubbel", fl_stopped_sub1: "{blocked} geblokkeerd · {rejected} afgewezen · {dups} dubbel",
    fl_none: "Nog geen facturen: de stroom vult zich zodra ze binnenkomen.", act_spent: "{spent} van {cap} deze maand",
    act_more: "{n} agents in Purser", open: "Openen", to_tx: "Transacties", to_inv: "Facturen", to_agents: "Agents",
    st_code: "Hier niet gedraaid", st_switch: "Standaard uit", code_only: "Alleen code", how: "Hoe hij werkt",
    see: "Bekijk een onderhandeling", k_search: "Zoeken", k_ph: "Ga naar een pagina", k_none: "Geen pagina gevonden",
    sb_min: "Zijbalk inklappen", sb_max: "Zijbalk uitklappen", as_of: "{name} · cijfers per {day}", k_cash: "Kaspositie",
    k_wait: "Facturen voor de CFO", k_paid: "Betaald deze maand", k_paid_sub: "{n} facturen · {prev} in {month}",
    k_spend: "Uitgaven agents vs limieten", k_spend_sub: "van {cap} maandlimiet · {n} kaarten",
    k_spend_none: "Geen agentkaart in de gegevens", ag_h: "Status van de agents",
    ag_sub: "Wat elke kaart uitgaf tegen zijn maandlimiet, en de nieuwste beslissing van de agent.",
    rails_h: "Gekoppelde rails", live: "Live", net_h: "Gekoppeld", net_sub: "Amsterdam · het demobedrijf", net_to: "Open Koppelingen",
  },
} as const;

/** The pages in their groups, in the order of the menu: [group, its pages, the group's icon]. */
export const NAV_GROUPS: readonly (readonly [string, readonly string[], string])[] = [
  ["overview", ["overview"], "layout-dashboard"],
  ["money", ["invoices", "receivables", "cash", "transactions", "books"], "wallet"],
  ["agents", ["agents", "tokenisation"], "bot"],
  ["rails", ["airwallex", "claude", "connections"], "link-2"],
  ["settings", ["settings"], "settings-2"],
];

/** Each page's icon in the menu. */
export const TAB_ICONS: Readonly<Record<string, string>> = {
  overview: "layout-dashboard", invoices: "receipt", receivables: "arrow-down-left", cash: "coins", transactions: "arrow-left-right", books: "file-check", agents: "bot", tokenisation: "credit-card",
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
{const b=$('#btabs');if(b)b.setAttribute('aria-label',sw('sections'));for(const [id,k] of [['#tabs','pages'],['#crumbs','crumbs']]){const n=$(id);if(n)n.setAttribute('aria-label',sw(k))}const s=$('#demo .dr-short');if(s)s.textContent=sw('demo_short');const o=$('#demo-out .lv');if(o)o.textContent=sw('demo_leave')}
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
      sn.hidden=false;const on=sn.querySelector('a[aria-current]');if(on&&sn.scrollWidth>sn.clientWidth)sn.scrollLeft=Math.max(0,on.offsetLeft-(sn.clientWidth-on.offsetWidth)/2)}else{sn.hidden=true;sn.dataset.k=''}}
  // The top bar: the group, the page and, on a record's own page, its id.
  const cr=$('#crumbs');if(cr){const src=/^[a-z]+$/.test(tab)?document.querySelector('#tabs a[data-tab='+tab+']'):null,sub=decodeURIComponent((location.hash.split('/')[2]||'').split('?')[0]);
    const name=src?src.textContent:(document.title.split(' · ')[1]||''),parts=g&&g[1].length>1&&sw('g_'+g[0])!==name?[el('span','',sw('g_'+g[0]))]:[];
    if(sub&&src){const a=el('a','',name);a.href='#/'+tab;parts.push(a,el('b','',sub))}else parts.push(el('b','',name));
    cr.replaceChildren(...parts.flatMap((p,i)=>i?[el('span','cs','/'),p]:[p]))}
  placeAsk();
}
// Search (⌘K or Ctrl+K): jump to any page the menu has, by its name or its group's; arrows and Enter, Escape closes.
function palette(){
  let d=$('#kdlg');
  if(!d){const inp=el('input','field');inp.autocomplete='off';inp.placeholder=sw('k_ph');inp.setAttribute('aria-label',sw('k_search'));const ul=el('ul','kr');
    d=el('dialog','kdlg',[el('div','kq',[ic('search'),inp]),ul]);d.id='kdlg';d.setAttribute('aria-label',sw('k_search'));document.body.append(d);
    d._draw=()=>{const q=inp.value.trim().toLowerCase();const its=[...document.querySelectorAll('#tabs a[data-tab]:not([hidden])')].map((a)=>[a,groupOf(a.dataset.tab)]).filter(([a,g])=>!q||(a.textContent+' '+(g&&g[1].length>1?sw('g_'+g[0]):'')).toLowerCase().includes(q));
      ul.replaceChildren(...(its.length?its.map(([a,g],i)=>{const x=el('a',i?'':'on',[ic(TAB_IC[a.dataset.tab]||'circle-dot'),el('span','',a.textContent),g&&g[1].length>1?el('small','',sw('g_'+g[0])):null]);x.href=a.getAttribute('href');x.onclick=()=>d.close();return el('li','',x)}):[el('li','kn',sw('k_none'))]))};
    inp.oninput=d._draw;
    inp.onkeydown=(e)=>{const as=[...ul.querySelectorAll('a')];let i=as.findIndex((a)=>a.classList.contains('on'));
      if((e.key==='ArrowDown'||e.key==='ArrowUp')&&as.length){e.preventDefault();if(as[i])as[i].classList.remove('on');i=(i+(e.key==='ArrowDown'?1:-1)+as.length)%as.length;as[i].classList.add('on');as[i].scrollIntoView({block:'nearest'})}
      else if(e.key==='Enter'&&as[i]){e.preventDefault();d.close();location.hash=as[i].getAttribute('href')}};
    d.onclick=(e)=>{if(e.target===d)d.close()}}
  const inp=d.querySelector('input');inp.value='';d._draw();d.showModal();inp.focus()}
addEventListener('keydown',(e)=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='k'&&document.body.classList.contains('signed-in')){e.preventDefault();const d=$('#kdlg');if(d&&d.open)d.close();else palette()}});
{const k=$('#kbtn');if(k){k.querySelector('.kt').textContent=sw('k_search');k.onclick=()=>palette();if(!/Mac|iP/.test(navigator.platform||''))k.querySelector('kbd').textContent='Ctrl K'}}
// The sidebar collapses to its icons (each named in its title); the choice is kept in this browser.
function sbSet(min){document.documentElement.classList.toggle('sbmin',min);const b=$('#sbx');if(b){b.setAttribute('aria-pressed',String(min));b.setAttribute('aria-label',sw(min?'sb_max':'sb_min'));b.title=sw(min?'sb_max':'sb_min')}try{localStorage.setItem('purser.cloud.sb',min?'1':'')}catch(e){}}
{const b=$('#sbx');if(b)b.onclick=()=>sbSet(!document.documentElement.classList.contains('sbmin'));let v=false;try{v=localStorage.getItem('purser.cloud.sb')==='1'}catch(e){}sbSet(v);
  for(const a of document.querySelectorAll('#tabs a[data-tab]'))a.title=a.textContent}
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
  const off=el('a','pf-off',[ic('octagon-x'),el('span','',[el('b','',sw('fl_stopped')+' '),el('span','num',String(stopped.length+dups))]),el('span','sub',sw(dups===1?'fl_stopped_sub1':'fl_stopped_sub',{blocked:is(['blocked']).length,rejected:is(['rejected']).length,dups}))]);off.href='#/invoices?f=blocked';
  return cardLink(el('section','card dcard rise pflow-c',[el('div','dh',[el('h2','',sw('flow_h')),el('p','',sw('flow_sub',{n}))]),ol,off]),'#/invoices',sw('to_inv'))}
// One line per agent the records name: spent against its monthly limit, its newest decision, a link to its record.
function agentStrip(agents){
  if(!agents||!agents.length)return null;
  const rows=agents.map((a)=>{const c=a.card;const spent=c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null,cap=c&&c.per_month?toCents(c.per_month):0;
    const C=c?cur(c.currency)+' ':'';const bar=el('span','as-bar'+(spent!==null&&spent>=cap?' full':''));const f=el('span','');f.style.width=(spent!==null&&cap>0?Math.min(100,spent/cap*100):0).toFixed(1)+'%';bar.append(f);
    const d=(a.decisions||[])[0];const o=d?(OUTCOME[d.outcome]||OUTCOME.note):null;
    const r=el('a','as-row g'+passHue(a),[el('span','as-av h'+passHue(a),ic('bot')),el('span','as-b',[el('b','',a.name),spent!==null?el('span','sub num',sw('act_spent',{spent:C+cents(spent),cap:C+cents(cap)})):el('span','sub',a.role||'')]),
      spent!==null?bar:el('span',''),d?el('span','as-d',[el('span','obadge '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[d.outcome]?d.outcome:'note'))]),el('span','as-dt',d.text.replace(/\s*\(code's fallback, no model\)$/,''))]):el('span',''),ic('chevron-right')]);
    r.href='#/agents?a='+encodeURIComponent(a.id);return r});
  const more=el('a','as-more',[sw('act_more',{n:ROSTER.length}),ic('chevron-right')]);more.href='#/agents';
  return el('div','astrip',[...rows,more])}

// --- The Agents page: every agent in Purser ----------------------------------------------------------------------------
// In Dutch, the roster's words as cloud/src/consoleNl.ts has them (its ids, models, switches and paths stay).
const ROSTER=nxAll(` + json(ROSTER) + String.raw`);
const REPO_BLOB=` + json(REPO_BLOB) + String.raw`;
const TEAM_IC={sourcing:'link-2',payables:'receipt',treasury:'landmark',customers:'users',books:'file-check'};
// A link to an agent's record (#/agents?a=id) opens its details and scrolls to it, once drawn.
function openAgentFromQuery(q){const id=q&&q.get&&q.get('a');if(!id)return;
  const sec=[...view().querySelectorAll('.wagent')].find((s)=>{const p=s.querySelector('.wdetail');return p&&p.id==='agent-'+id.replace(/[^a-z0-9]+/gi,'-')+'-details'})||$('#roster-'+CSS.escape(id));
  if(!sec)return;const b=sec.querySelector('button.wmore');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();
  requestAnimationFrame(()=>sec.scrollIntoView({block:'start',behavior:RM()?'auto':'smooth'}))}
`;

export const SHELL_CSS = `
:root { --side: 248px; --hdr: 65px; --tabbar: 60px; }
.abrand, .btabs, #ask-slot { display: none; }
#subnav[hidden] { display: none; }
.apptabs .ng { display: none; }
.signed-in { --line: color-mix(in srgb, var(--border) 80%, transparent); --hover: color-mix(in srgb, var(--text) 5%, transparent); --top: 0px; }
.ctop, .abn, .sbx, .crumbs, .kbtn, .signed-in #testchip { display: none; }
.signed-in #view { font-size: 14px; }
@media (min-width: 1024px) {
  .signed-in { --hdr: 0px; --top: 53px; }
  .sbmin .signed-in { --side: 64px; }
  .signed-in header.top { display: none; }
  .signed-in .appbar { position: fixed; z-index: 25; top: 0; left: 0; bottom: 0; width: var(--side); border: 0; border-right: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 45%, var(--bg)); overflow-y: auto; overflow-x: hidden; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .signed-in .appbar .wrap { display: grid; gap: 0; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto auto 1fr auto; align-items: center; min-height: 100%; height: auto; max-width: none; margin: 0; padding: 12px 10px; }
  .signed-in .abrand { order: 0; display: inline-flex; align-items: center; gap: 9px; height: 32px; padding: 0 6px; text-decoration: none; color: var(--text); font-size: 14px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; }
  .abrand .mk { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; flex: none; }
  .abrand .mk .i { width: 14px; height: 14px; }
  .signed-in .abn { display: inline; } .abn span { color: var(--faint); font-weight: 600; }
  .signed-in .sbx { order: 0; display: inline-grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: var(--faint); cursor: pointer; }
  .sbx:hover { color: var(--text); background: var(--hover); }
  .signed-in .appbar .who-am-i { display: contents; }
  .signed-in .appbar .cosw { order: 1; grid-column: 1 / -1; display: flex; align-items: stretch; margin-top: 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); }
  .signed-in .appbar .cosw:hover { border-color: color-mix(in srgb, var(--text) 18%, var(--line)); }
  .signed-in .appbar .co-more { width: 28px; height: auto; border-radius: 0 7px 7px 0; border-left: 1px solid var(--line); }
  .signed-in .appbar .co-menu { left: 0; width: calc(var(--side) - 24px); }
  .signed-in .appbar #co { flex: 1 1 auto; display: grid; grid-template-columns: 26px minmax(0, 1fr); column-gap: 9px; align-items: center; margin: 0; padding: 7px 8px; border-radius: 7px 0 0 7px; border: 0; background: transparent; max-width: none; font-size: 13px; }
  .signed-in .appbar #co .av { grid-row: 1 / span 2; width: 26px; height: 26px; border-radius: 6px; font-size: 12px; }
  .signed-in .appbar #co .cn { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .signed-in .appbar #co .cn .cx { display: none; }
  .signed-in .appbar #co .aw { grid-column: 2; justify-self: start; margin: 0; padding: 0; border: 0; background: none; font-size: 11.5px; font-weight: 550; min-width: 0; overflow: hidden; }
  .signed-in .appbar #co .aw .aww { display: inline; overflow: hidden; text-overflow: ellipsis; }
  .signed-in .appbar #co:hover { background: var(--hover); }
  .signed-in .appbar nav.apptabs { order: 2; grid-column: 1 / -1; display: flex; flex-direction: column; gap: 1px; margin: 14px 0 0; padding: 0; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .signed-in .appbar nav.apptabs a { position: relative; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 8px; border-radius: 6px; font-size: 13.5px; font-weight: 550; color: var(--muted); background: none; box-shadow: none; white-space: nowrap; transition: background .12s, color .12s; }
  .signed-in .appbar nav.apptabs a .ic { display: inline-flex; color: var(--faint); }
  .signed-in .appbar nav.apptabs a:hover { background: var(--hover); color: var(--text); }
  .signed-in .appbar nav.apptabs a[aria-current="page"] { background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--text); box-shadow: none; }
  .signed-in .appbar nav.apptabs a[aria-current="page"] .ic { color: var(--accent); }
  .signed-in .apptabs .ng { display: block; margin: 16px 8px 4px; font: 600 11px/1.2 Inter, system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); white-space: nowrap; overflow: hidden; }
  .signed-in .apptabs .ng.sep { height: 1px; margin: 10px 8px; background: var(--line); }
  .signed-in .appbar .spacer { order: 3; grid-column: 1 / -1; align-self: stretch; min-height: 24px; }
  .signed-in .appbar .awx-app { display: none; }
  .signed-in .appbar #who { order: 6; grid-column: 1; display: flex; align-items: center; gap: 9px; min-width: 0; padding: 10px 2px 0 4px; border-top: 1px solid var(--line); font-size: 13px; max-width: none; white-space: normal; }
  .signed-in .appbar #who .sav { width: 26px; height: 26px; }
  .signed-in .appbar #who:empty { display: none; }
  .signed-in .appbar #out { order: 7; grid-column: 2; align-self: stretch; display: inline-grid; place-items: center; width: 32px; padding: 10px 0 0; border-top: 1px solid var(--line); border-radius: 0; background: none; }
  .signed-in .appbar #out:hover { color: var(--bad); background: none; }
  .signed-in main, .signed-in .stopbar, .signed-in #foot, .signed-in .foot-awx { margin-left: var(--side); }
  .signed-in #foot, .signed-in .foot-awx { max-width: none; }
  .signed-in main { padding-top: 0; }
  .signed-in main > .wrap { max-width: 1320px; } .signed-in #view { padding-top: 24px; } .subnav-wrap { display: none; }
  .signed-in .ctop { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 16px; height: var(--top); padding: 0 var(--gut); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: saturate(1.4) blur(12px); -webkit-backdrop-filter: saturate(1.4) blur(12px); }
  .crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; font-size: 13px; color: var(--muted); white-space: nowrap; }
  .crumbs a { color: var(--muted); text-decoration: none; } .crumbs a:hover { color: var(--text); }
  .crumbs .cs { color: var(--faint); opacity: .7; }
  .crumbs b { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .signed-in .kbtn { display: inline-flex; align-items: center; gap: 8px; flex: none; height: 30px; padding: 0 6px 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--faint); font: 500 13px/1 Inter, system-ui, sans-serif; cursor: pointer; }
  .kbtn .kt { min-width: 96px; text-align: left; }
  .kbtn:hover { color: var(--muted); border-color: color-mix(in srgb, var(--text) 18%, var(--line)); }
  .kbtn kbd { font: 600 11px/1 Inter, system-ui, sans-serif; padding: 3px 5px; border-radius: 4px; background: var(--sunken); color: var(--muted); }
  .sbmin .appbar .wrap { padding-inline: 8px; grid-template-columns: minmax(0, 1fr); }
  .sbmin .abn, .sbmin .apptabs .ng:not(.sep), .sbmin .appbar #co .cn, .sbmin .appbar #co .aw, .sbmin .appbar .co-more, .sbmin .appbar #who .wtx, .sbmin #tabs a[data-n]::after { display: none; }
  .sbmin .abrand { justify-content: center; padding: 0; } .sbmin .sbx { order: 8; justify-self: center; margin-top: 8px; }
  .sbmin .appbar nav.apptabs a { justify-content: center; padding: 0; font-size: 0; gap: 0; }
  .sbmin .appbar #co { grid-template-columns: 26px; justify-content: center; padding: 7px 0; border-radius: 7px; }
  .sbmin .appbar #who, .sbmin .appbar #out { grid-column: 1; justify-content: center; padding-left: 0; padding-right: 0; }
  .sbmin .appbar #out { border-top: 0; width: auto; }
  .sbmin #tabs a[data-on]::after { position: absolute; top: 6px; right: 10px; margin: 0; width: 6px; height: 6px; }
}
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
  .appbar #pask-fab { position: static; min-height: 36px; height: 36px; width: 36px; padding: 0; justify-content: center; border-radius: 10px; border: 0; box-shadow: none; background: transparent; color: var(--accent); transform: none; }
  .appbar #pask-fab svg { width: 32px; height: 32px; }
  .appbar #pask-fab:hover { transform: none; box-shadow: none; }
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
  /* v1.5.1: Money has five pages; on a narrow phone they keep their whole names and the control scrolls within itself. */
  .signed-in #subnav { position: relative; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
  .signed-in #subnav::-webkit-scrollbar { display: none; }
  #subnav a { flex: 1 0 auto; padding: 8px 10px; }
}
@media (min-width: 1024px) { #subnav { display: none !important; } }
.subnav-wrap:has(#subnav[hidden]) { display: none; }
dialog.kdlg { width: min(560px, calc(100vw - 32px)); margin: 12vh auto auto; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); box-shadow: 0 24px 64px -16px rgba(0,0,0,.45); }
dialog.kdlg::backdrop { background: rgba(8,10,18,.45); }
.kq { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--line); color: var(--faint); }
.kq .field, .kq .field:focus-visible { border: 0; background: none; padding: 14px 0; font-size: 15px; outline: none; box-shadow: none; }
ul.kr { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
ul.kr a { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border-radius: 7px; color: var(--text); text-decoration: none; font-size: 13.5px; }
ul.kr a .ic { color: var(--faint); display: inline-flex; } ul.kr small { margin-left: auto; color: var(--faint); font-size: 12px; }
ul.kr a.on, ul.kr a:hover { background: var(--hover); } ul.kr a.on .ic { color: var(--accent); }
.kn { padding: 12px 10px; color: var(--muted); font-size: 13.5px; }
.demo-ribbon { flex: none; color: var(--faint); font-size: 12px; }
.demo-ribbon .dr { display: inline-flex; align-items: center; gap: 6px; margin: 0; line-height: 1.35; }
.demo-ribbon .dr .i { width: 13px; height: 13px; flex: none; }
.demo-ribbon .dr-full, .demo-ribbon a .lw { display: none; }
.demo-ribbon a { margin-left: 4px; color: var(--muted); font-weight: 600; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--muted) 40%, transparent); text-underline-offset: 3px; }
.demo-ribbon a:hover { color: var(--text); }
@media (max-width: 1023px) { .signed-in .ctop:has(#demo:not([hidden])) { display: block; padding: 10px 16px 0; } .signed-in main { padding-top: 12px; } }
#view > .head { align-items: flex-end; gap: 12px 20px; margin-bottom: 20px; }
#view > .head .eyebrow { display: block; margin: 0 0 4px; font: 600 11.5px/1.2 Inter, system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
@media (min-width: 1024px) { #view > .head .eyebrow { display: none; } }
.signed-in #view h1 { margin: 0; font-size: 24px; font-weight: 680; letter-spacing: -.022em; line-height: 1.2; }
#view > .head .lede { margin: 4px 0 0; max-width: 80ch; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
@media (max-width: 640px) { .signed-in #view h1 { font-size: 22px; } #view > .head { margin-bottom: 16px; } }
.card.list, .card.panel { overflow: clip; }
.signed-in :focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent); outline-offset: 2px; }
.signed-in .btn { height: 34px; padding: 0 14px; border-radius: 8px; font-size: 13.5px; font-weight: 600; box-shadow: none; }
.signed-in .btn.primary { background: color-mix(in srgb, var(--accent-ink) 88%, #000); border-color: transparent; color: #fff; }
.signed-in .btn.primary:hover { filter: brightness(1.08); }
.signed-in .field, .signed-in select.field { padding: 7px 10px; border-radius: 8px; font-size: 13.5px; border-color: var(--line); }
.signed-in .form-row { align-items: end; } .signed-in .form-row label { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.signed-in .form-row .field { height: 34px; padding-top: 0; padding-bottom: 0; }
.signed-in .trow .what b, .signed-in .row .sup b { font-weight: 600; }
.signed-in .bar { gap: 6px; margin-bottom: 12px; }
.signed-in .chip { height: 28px; padding: 0 10px; border-radius: 7px; border-color: var(--line); font-size: 13px; font-weight: 550; }
.signed-in .chip b { color: var(--faint); font-weight: 600; }
.signed-in .chip[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--text); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.signed-in .chip[aria-pressed="true"] b { color: var(--accent); }
.signed-in .row, .signed-in .trow { gap: 12px; padding: 9px 16px; min-height: 52px; border-top-color: var(--line); font-size: 13.5px; transition: background .12s; }
.signed-in .row.th, .signed-in .trow.th { position: sticky; top: var(--top); z-index: 3; min-height: 0; padding-top: 8px; padding-bottom: 8px; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; color: var(--faint); background: color-mix(in srgb, var(--sunken) 70%, var(--surface)); border-bottom: 1px solid var(--line); }
.signed-in a.row:hover, .signed-in button.trow:hover { background: var(--hover); }
.signed-in .row .sup, .signed-in .trow .what { font-weight: 600; }
.signed-in .row .amt, .signed-in .trow .amt { font-weight: 600; font-variant-numeric: tabular-nums; }
.signed-in .row .sub, .signed-in .trow .sub { font-size: 12px; }
.signed-in .av2 { width: 26px; height: 26px; border-radius: 7px; font-size: 10.5px; }
.signed-in .st { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.35; }
.signed-in .table { font-size: 13.5px; }
.signed-in .table th { padding: 8px 14px; font-size: 11.5px; font-weight: 600; color: var(--faint); background: color-mix(in srgb, var(--sunken) 70%, var(--surface)); border-bottom: 1px solid var(--line); }
.signed-in .table td { padding: 9px 14px; border-top-color: var(--line); }
.signed-in .table tbody tr:hover td { background: var(--hover); }
.signed-in .table td.r, .signed-in .table th.r, .signed-in .num { font-variant-numeric: tabular-nums; }
.signed-in .pill { padding: 2px 8px; font-size: 12px; font-weight: 600; }
.signed-in .tiles { gap: 12px; }
.signed-in .tile { padding: 14px 16px; }
.signed-in .tile .l { font-size: 12px; font-weight: 600; letter-spacing: .03em; color: var(--muted); }
.signed-in .tile .v { font-size: clamp(18px, 1.6vw, 22px); font-weight: 680; }
.signed-in .tile .x { font-size: 12px; line-height: 1.45; color: var(--faint); }
.signed-in .dcard { padding: 18px 20px; }
.signed-in .dcard .dh { margin-bottom: 14px; } .signed-in .dcard .dh p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.signed-in .panel h2 { font-size: 15px; font-weight: 650; }
.signed-in dl.read { gap: 0; font-size: 13.5px; }
.signed-in dl.read dt, .signed-in dl.read dd { padding: 8px 0; border-top: 1px solid var(--line); }
.signed-in dl.read dt:first-of-type, .signed-in dl.read dt:first-of-type + dd { border-top: 0; }
.signed-in dl.read dt { color: var(--muted); font-size: 12.5px; }
.signed-in #foot { font-size: 12px; border-top-color: var(--line); } .signed-in .foot-awx { padding-bottom: 20px; }
.signed-in .dhead .money .big { font-size: 28px; font-weight: 680; letter-spacing: -.025em; } .signed-in .drawer .big { font-size: 26px; font-weight: 680; }
.signed-in .note-ok, .signed-in .note-bad, .signed-in .note-info { border-radius: 8px; font-size: 13px; font-weight: 500; }
.empty { padding: 32px 20px; text-align: center; color: var(--muted); display: grid; gap: 4px; justify-items: center; }
.empty b { color: var(--text); font-size: 15px; }
.dcard .dh.withlink { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: start; }
.dcard .dh.withlink > :not(.dlink) { grid-column: 1; }
.dcard .dh .dlink { grid-column: 2; grid-row: 1; display: inline-flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 650; color: var(--accent); text-decoration: none; white-space: nowrap; padding: 2px 0; }
.dcard .dh .dlink:hover { text-decoration: underline; }
.dcard .dh .dlink .ic svg { width: 14px; height: 14px; }
a.card.kpi { text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s, transform .15s; }
a.card.kpi:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 8px 20px -12px rgba(16,24,40,.25); }
@media (max-width: 640px) { .ny-h { grid-template-columns: 44px minmax(0, 1fr); } .ny-ic { width: 44px; height: 44px; } .btn.ny-go { grid-column: 1 / -1; justify-content: center; height: 46px; } .ny-t h2 { font-size: 17px; } }
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
.astrip { display: grid; margin: 0 0 14px; border-top: 1px solid var(--border); }
a.as-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) minmax(80px, 160px) 16px; gap: 4px 12px; align-items: center; padding: 11px 2px; border-bottom: 1px solid var(--border); text-decoration: none; color: inherit; }
a.as-row > .as-av { grid-row: 1 / span 2; align-self: start; } a.as-row > .as-d { grid-column: 2 / 4; grid-row: 2; } a.as-row > .ic { grid-column: 4; grid-row: 1 / span 2; }
a.as-row:hover { background: color-mix(in srgb, var(--accent-soft) 45%, transparent); }
.as-av { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff; background: linear-gradient(140deg, #312e81, #4f46e5); }
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
@media (max-width: 640px) { .roster .sec-h p { display: none; } }
@media (max-width: 760px) { .rs-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.rs-h { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
@media (prefers-reduced-motion: no-preference) { article.rs.on .rs-st i { animation: rspulse 2.4s ease-in-out infinite; } @keyframes rspulse { 50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 20%, transparent); } } }
@media (max-width: 640px) { .rs-job { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; } }
.rs-hb h4 { margin: 0 0 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.btn.sm { height: 34px; padding: 0 12px; font-size: 13px; gap: 6px; text-decoration: none; }
.btn.sm.ghost2 { background: transparent; }
details.rs-how summary { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; list-style: none; font-size: 13px; font-weight: 650; color: var(--accent); }
details.rs-how summary::-webkit-details-marker { display: none; }
details.rs-how summary .ic { transition: transform .2s; } details.rs-how[open] summary .ic { transform: rotate(180deg); }
.rs-hb { display: grid; gap: 8px; margin-top: 8px; font-size: 13px; } .rs-hb p { margin: 0; }
ul.rs-code { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; } ul.rs-code a { font-size: 12.5px; color: var(--accent); overflow-wrap: anywhere; }
.agents.wallet { align-items: start; }
.wagent:not(.open) button.wpass { flex: none; }
`;
