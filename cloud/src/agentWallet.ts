// Purser Cloud's Agents tab as a wallet of cards (23 Nov, the owner: "way too sophisticated, too much text; give it logos
// instead of pictograms and more visuals and animations; also cards that you can connect with your phone, and the designs
// like the one I was going to have in Apple Wallet, and give different ones to each, and also customizable for companies").
//
// The page: a line of figures, a ticker of the newest decisions, then one payment card per agent (every agent Purser has,
// cloud/src/agentRoster.ts; those at work in this company first), each in its own design (cloud/src/agentCardArt.ts):
// the company's mark, the agent, its status, the card's last four only, spent against its monthly limit, and real marks
// for Claude (its model), Alta (an on-chain mandate), Visa and Airwallex. One line under each card. Everything else is
// one tap away in a drawer: what it does, its model, its limits and live sandbox card, what it may and may not do, its
// decisions, what it learns, its payment token and where it lives in code. The Sourcing agent's negotiation has its own
// band, from the recorded negotiation when the deployment serves it.
//
// "Add to phone": Apple Wallet when the owner configured the pass certificate (cloud/src/walletPass.ts), otherwise said
// plainly as waiting for it; and always a QR code to a read-only view of the card on the phone (cloud/src/agentPhoneCard.ts).
// "Card design": the company's colour, initials or a small logo, and a designed preset per agent; saved for the company
// by an owner or admin, else kept in this browser and labelled so. Design only: nothing here changes a limit, a card or a
// payment; the live card's actions stay in its own panel (cloud/src/consoleUi.ts liveCardPanel), each signed with Face ID.
//
// Motion: a card tilts and shines under the pointer, meters fill once drawn, the ticker turns every few seconds (with a
// pause button); none of it with prefers-reduced-motion. Every value is set as text; images only from data URLs.
//
// The script goes into the console at __UI__ (cloud/src/console.ts), after cloud/src/consoleShell.ts (ROSTER, REPO_BLOB,
// sw) and cloud/src/consoleUi.ts, and uses their el, ic, btn, t, tk, cur, cents, toCents, day, dday, MONTHS, OUTCOME, RM,
// NL, api, Expired and BRAND_LOGOS (cloud/src/connectionsView.ts).

import { ALTA_AGENTS, CARD_ART_CSS, CARD_PRESETS, DEFAULT_STYLE, FEATHER_D, LOGO_MAX, PRESET_NAMES, RELIEF } from "./agentCardArt.js";
import { AUTHORITY_JS } from "./authorityView.js";

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export const WALLET_JS = AUTHORITY_JS + String.raw`
// --- Agents as cards (23 Nov) -----------------------------------------------------------------------------------------
const CARD_PRESETS=` + json(CARD_PRESETS) + String.raw`;
const PRESET_NAMES=` + json(PRESET_NAMES) + String.raw`;
const DEFAULT_STYLE=` + json(DEFAULT_STYLE) + String.raw`;
const ALTA_AGENTS=` + json(ALTA_AGENTS) + String.raw`;
const LOGO_MAX=` + json(LOGO_MAX) + String.raw`;
const RELIEF=` + json(RELIEF) + String.raw`;
const CARD_FONT='Inter,Helvetica Neue,Arial,sans-serif';
const DK_W={en:{
  lede:'Every agent has its own card, limits and Claude model. Tap a card for its record.',
  n_agents:'agents',n_here:'at work here',n_dec:'decisions on record',
  tick:'Newest decisions',pause:'Pause',play:'Play',
  details:'Details',phone:'Add to phone',nego:'Watch a negotiation',
  no_card:'No card of its own',code_only:'Code only',spent:'{spent}',of:'of {cap} this month',simulated:'Simulated',sim_card:'Simulated card · test money',sbx_card:'Sandbox card · test money',issuer_h:'Issuer',issuer:'Airwallex (sandbox)',alta_h:'On chain',alta:'An Alta (formerly Metal) mandate',
  close:'Close',job_h:'What it does',model_h:'Model',ran:'This company\'s records show it run with {m}',limit_h:'Limit',code_h:'Where it lives in code',sw:'Turned on in the runner with {sw}=on',
  phone_h:'{name} on your phone',wal_btn:'Add to Apple Wallet',wal_busy:'Making the pass…',wal_fail:'The pass could not be made: {why}',
  wal_wait:'Apple Wallet: waiting for the pass certificate',wal_nocard:'Apple Wallet: only for an agent with a card',
  qr_h:'Scan to open this card on your phone',qr_sub:'A read-only view in the same design: what it spent, its limits, its status. It cannot pay or change anything. Works until {d}.',
  qr_busy:'Making the link…',qr_fail:'The link could not be made: {why}',copy:'Copy link',copied:'Copied',logo_local:'Your uploaded logo stays in this browser; the phone shows your initials, or Purser\'s mark.',
  design:'Card design',design_sub:'Your company\'s look on every agent\'s card. Design only: no limit, card or payment changes.',
  d_color:'Company colour',d_color_all:'Use it on every card',d_mark:'Mark on the cards',d_initials:'Initials',d_logo:'Logo',d_upload:'Upload a logo (PNG, JPEG or WebP)',d_remove:'Remove the logo',
  d_logo_big:'That image is too large even after resizing; try a simpler one.',d_logo_bad:'That file is not an image this page can read.',
  d_styles:'Each agent\'s design',d_save:'Save for the company',d_saving:'Saving…',d_saved:'Saved for everyone in the company.',d_save_fail:'Not saved: {why}',
  d_guest:'Kept in this browser only: the demo company is shared, so a guest\'s design is not saved.',d_reader:'A preview in this browser: an owner or admin saves the design for the company.',
  d_reset:'Back to Purser\'s designs',d_done:'Done',
  nego_h:'The Sourcing agent negotiates',nego_sub:'With a supplier\'s agent, turn by turn, inside the CFO\'s rails in code. The CFO signs the deal.',
  nego_rec:'Recorded negotiation: written in advance, not a live model call; the rails\' answers are computed.',n_inv:'Invoice',n_agreed:'Agreed',n_refused:'refused by the rails',n_you:'Sourcing',n_sup:'Supplier (simulated)',
  sandbox:'Agents\' cards in the Airwallex sandbox (live run)'},
nl:{
  lede:'Elke agent heeft een eigen kaart, limieten en Claude-model. Tik op een kaart voor zijn dossier.',
  n_agents:'agents',n_here:'aan het werk hier',n_dec:'beslissingen vastgelegd',
  tick:'Nieuwste beslissingen',pause:'Pauze',play:'Afspelen',
  details:'Details',phone:'Op je telefoon',nego:'Bekijk een onderhandeling',
  no_card:'Geen eigen kaart',code_only:'Alleen code',spent:'{spent}',of:'van {cap} deze maand',simulated:'Gesimuleerd',sim_card:'Gesimuleerde kaart · testgeld',sbx_card:'Sandboxkaart · testgeld',issuer_h:'Uitgever',issuer:'Airwallex (sandbox)',alta_h:'Op de chain',alta:'Een Alta-mandaat (voorheen Metal)',
  close:'Sluiten',job_h:'Wat hij doet',model_h:'Model',ran:'De gegevens van dit bedrijf tonen hem met {m}',limit_h:'Limiet',code_h:'Waar hij in de code staat',sw:'Aan in de runner met {sw}=on',
  phone_h:'{name} op je telefoon',wal_btn:'Toevoegen aan Apple Wallet',wal_busy:'Pas wordt gemaakt…',wal_fail:'De pas kon niet worden gemaakt: {why}',
  wal_wait:'Apple Wallet: wacht op het pascertificaat',wal_nocard:'Apple Wallet: alleen voor een agent met een kaart',
  qr_h:'Scan om deze kaart op je telefoon te openen',qr_sub:'Een alleen-lezen weergave in hetzelfde ontwerp: wat hij uitgaf, zijn limieten, zijn status. Hij kan niets betalen of wijzigen. Werkt tot {d}.',
  qr_busy:'Link wordt gemaakt…',qr_fail:'De link kon niet worden gemaakt: {why}',copy:'Link kopiëren',copied:'Gekopieerd',logo_local:'Je geüploade logo blijft in deze browser; de telefoon toont je initialen, of het merk van Purser.',
  design:'Kaartontwerp',design_sub:'De uitstraling van je bedrijf op de kaart van elke agent. Alleen ontwerp: geen limiet, kaart of betaling verandert.',
  d_color:'Bedrijfskleur',d_color_all:'Gebruik hem op elke kaart',d_mark:'Merk op de kaarten',d_initials:'Initialen',d_logo:'Logo',d_upload:'Upload een logo (PNG, JPEG of WebP)',d_remove:'Logo verwijderen',
  d_logo_big:'Die afbeelding is ook verkleind te groot; probeer een eenvoudigere.',d_logo_bad:'Dat bestand is geen afbeelding die deze pagina kan lezen.',
  d_styles:'Het ontwerp per agent',d_save:'Opslaan voor het bedrijf',d_saving:'Opslaan…',d_saved:'Opgeslagen voor iedereen in het bedrijf.',d_save_fail:'Niet opgeslagen: {why}',
  d_guest:'Alleen in deze browser bewaard: het demobedrijf is gedeeld, dus het ontwerp van een gast wordt niet opgeslagen.',d_reader:'Een voorbeeld in deze browser: een eigenaar of beheerder slaat het ontwerp op voor het bedrijf.',
  d_reset:'Terug naar de ontwerpen van Purser',d_done:'Klaar',
  nego_h:'De inkoopagent onderhandelt',nego_sub:'Met de agent van een leverancier, beurt voor beurt, binnen de rails van de CFO in code. De CFO tekent de deal.',
  nego_rec:'Opgenomen onderhandeling: vooraf geschreven, geen live modelaanroep; de antwoorden van de rails worden berekend.',n_inv:'Factuur',n_agreed:'Akkoord',n_refused:'geweigerd door de rails',n_you:'Inkoop',n_sup:'Leverancier (gesimuleerd)',
  sandbox:'Kaarten van de agents in de Airwallex-sandbox (live run)'}};
function dw(k,v){const W=DK_W[NL?'nl':'en'];let s=W[k]!==undefined?W[k]:DK_W.en[k];s=String(s===undefined?k:s);for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
// The Overview's agent strip keeps a colour per agent (cloud/src/consoleShell.ts agentStrip).
const PASS_HUE={sourcing:0,support:1,treasury:2};
function passHue(a){const k=String(a.id||a.name||'').toLowerCase();if(k in PASS_HUE)return PASS_HUE[k];let h=0;for(const ch of k)h=(h*31+ch.charCodeAt(0))>>>0;return 3+h%3}
const dkImg=(src,alt,cls)=>{const i=el('img',cls||'');i.src=src;i.alt=alt;i.decoding='async';return i};
const dkLogo=(k)=>BRAND_LOGOS[k]?BRAND_LOGOS[k].uri:null;
const modelShort=(m)=>String(m).replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/,(_,n,a,b)=>n.charAt(0).toUpperCase()+n.slice(1)+' '+a+'.'+b);
// A few line icons the console's set lacks, drawn as DOM (never markup from data).
const DK_IC={phone:['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z','M12 18h.01'],palette:['M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 14.4 21 9.7 9.7 0 0 1 12 22z','M7.5 10.5h.01','M10.5 7h.01','M15 7.5h.01'],
  nfc:['M8.5 7.5a6 6 0 0 1 0 9','M12 5a9.5 9.5 0 0 1 0 14','M15.5 2.5a13 13 0 0 1 0 19'],pause:['M8 5v14','M16 5v14'],upload:['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4','M17 8l-5-5-5 5','M12 3v12'],feather:` + json(FEATHER_D) + String.raw`};
function dkIc(name,cls){const NS='http://www.w3.org/2000/svg';const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');if(cls)s.setAttribute('class',cls);
  for(const d of DK_IC[name]||[]){const p=document.createElementNS(NS,'path');p.setAttribute('d',d);s.append(p)}const w=el('span','ic');w.append(s);return w}

// --- The company's design: the company's own (saved), or this browser's ----------------------------------------------
let DESIGN={v:1,color:null,initials:null,logo:null,styles:{}};let DESIGN_MODE='guest';
const designKey=()=>'purser.card-design.'+(ME&&ME.tenant?ME.tenant.id:'');
// This browser's copy is read as untrusted as the server reads a request (cloud/src/agentCardArt.ts cleanDesign).
function cleanLocal(j){if(!j||typeof j!=='object')return null;const st={};for(const [k,v] of Object.entries(j.styles&&typeof j.styles==='object'?j.styles:{}))if(/^[a-z0-9_]{1,40}$/.test(k)&&CARD_PRESETS.includes(v))st[k]=v;
  return {v:1,color:typeof j.color==='string'&&/^#[0-9a-f]{6}$/i.test(j.color)?j.color:null,initials:typeof j.initials==='string'&&/^[A-Z0-9]{1,3}$/.test(j.initials)?j.initials:null,
    logo:typeof j.logo==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(j.logo)&&j.logo.length<LOGO_MAX*1.4?j.logo:null,styles:st}}
function localDesign(){try{return cleanLocal(JSON.parse(localStorage.getItem(designKey())||'null'))}catch(e){return null}}
function keepLocal(){try{localStorage.setItem(designKey(),JSON.stringify(DESIGN))}catch(e){}}
async function loadDesign(){
  const r=await api('/v1/card-design').catch((e)=>{if(e instanceof Expired)throw e;return null});
  DESIGN_MODE=r&&r.can_save?'company':ME&&ME.demo?'guest':'reader';
  const d=DESIGN_MODE==='company'?r.design:(localDesign()||(r&&r.design)||null);
  DESIGN=Object.assign({v:1,color:null,initials:null,logo:null,styles:{}},d||{});DESIGN.styles=Object.assign({},DESIGN.styles||{})}
const styleOf=(id)=>DESIGN.styles[id]||DEFAULT_STYLE[id]||'graphite';
const companyName=()=>ME&&ME.tenant?String(ME.tenant.name||''):'';
// The company's mark until it sets its own: its name's first letter, as the console's company chip shows it.
function initialsOf(name){const m=/[A-Za-z0-9]/.exec(name);return (m?m[0]:'P').toUpperCase()}

// --- One card's face -------------------------------------------------------------------------------------------------
// x: {id,name,status,statusText,last4,currency,spent,cap,model,demo,frozen}
function cardFace(x){
  const preset=styleOf(x.id);
  const face=el('div','acard p-'+preset+(x.last4?'':' bare')+(x.frozen?' frozen':'')+(x.status==='off'?' dim':''));
  if(DESIGN.color)face.style.setProperty('--brand',DESIGN.color);
  // 27 Nov (Obsidian, cloud/src/agentCardArt.ts cardSvg: the same art the phone's page draws as markup): a few <use> of
  // the page's shared shapes (#pc-defs), the agent's relief, the medallion with Purser's quill (or the company's own
  // initials or logo), the chip, the words; the status, the month and the honesty label under the card (cardMeta).
  const rel=RELIEF[x.id]||'lines';
  const mark=DESIGN.logo?pcEl('image',{class:'ac-mark',href:DESIGN.logo,x:182,y:88,width:64,height:80,preserveAspectRatio:'xMidYMid meet','clip-path':'url(#pc-mo)'})
    :DESIGN.initials?pcEl('text',{class:'ac-mark',x:214,y:136,'text-anchor':'middle','font-family':CARD_FONT,'font-weight':600,'font-size':22,'letter-spacing':2,fill:'url(#pc-ch)'},DESIGN.initials)
    :pcEl('use',{class:'ac-pf',href:'#pc-quill'});
  const art=pcEl('svg',{class:'ac-art',viewBox:'0 0 428 270','aria-hidden':'true',focusable:'false'},[pcEl('use',{href:'#pc-ground'}),
    pcEl('g',{mask:'url(#pc-fade)'},[pcEl('use',{href:'#pc-rel-'+rel,opacity:.2}),pcEl('g',{mask:'url(#pc-band)'},pcEl('use',{href:'#pc-rel-'+rel,opacity:.75}))]),
    pcEl('use',{href:'#pc-medal'}),mark,pcEl('use',{href:'#pc-frame'}),pcEl('use',{href:'#pc-word'}),x.last4?pcEl('use',{href:'#pc-chip',x:34,y:110}):null,
    x.last4?pcEl('text',{class:'ac-num',x:34,y:212,'font-family':CARD_FONT,'font-weight':500,'font-size':13,'letter-spacing':2.4,fill:'url(#pc-pw)'},'•••• '+x.last4)
      :pcEl('text',{class:'ac-num none',x:34,y:212,'font-family':CARD_FONT,'font-weight':500,'font-size':11,'letter-spacing':.4,fill:'#8e929b'},dw('no_card')),
    pcEl('text',{class:'ac-name',x:34,y:233,'font-family':CARD_FONT,'font-weight':600,'font-size':7.6,'letter-spacing':2,fill:'url(#pc-pw)'},String(x.name).toUpperCase()),
    x.last4?pcEl('text',{class:'ac-net txt',x:394,y:234,'text-anchor':'end',transform:'skewX(-10)','transform-origin':'394 234','font-family':'Arial Black,'+CARD_FONT,'font-weight':900,'font-size':17,'letter-spacing':.6,fill:'url(#pc-vs)'},'VISA'):null,
    pcEl('use',{href:'#pc-sheen'})]);
  face.append(art,el('span','ac-shine'));
  const C=x.currency?cur(x.currency)+' ':'';
  face.setAttribute('role','img');
  face.setAttribute('aria-label',[x.name,x.last4?'•••• '+x.last4:dw('no_card'),x.statusText,x.spent!==null&&x.cap>0?C+cents(x.spent)+' '+dw('of',{cap:C+cents(x.cap)}):null,x.last4?honestOf(x):null].filter(Boolean).join(', '));
  return face}
// An SVG element with its attributes and children (text as text nodes, never markup).
function pcEl(tag,attrs,kids){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const k in attrs)e.setAttribute(k,String(attrs[k]));for(const c of [].concat(kids??[])){if(c===null||c===undefined||c===false)continue;e.append(typeof c==='string'?document.createTextNode(c):c)}return e}
// The honesty label of a card (everything simulated is labelled): the demo's simulated card, or the Airwallex sandbox's.
const honestOf=(x)=>x.demo?dw('sim_card'):dw('sbx_card');
// Under the card, in small muted words: its status and honesty label, then what it spent of its month's limit on a thin meter.
function cardMeta(x,tail){
  const C=x.currency?cur(x.currency)+' ':'';
  const st=el('p','dk-st',[el('i','dk-dot '+x.status),el('span','',x.statusText),x.last4?el('span','dk-hon',honestOf(x)):null,tail||null].filter(Boolean));
  if(!(x.spent!==null&&x.cap>0))return el('div','dk-meta',st);
  const bar=el('span','ac-bar'+(x.spent>=x.cap?' full':''));const f=el('span','');bar.append(f);f.dataset.w=Math.min(100,x.spent/x.cap*100).toFixed(1);
  // The same share as a ring in the agent's own colour (consoleColor.ts): what the card spent of its month's limit.
  const pct=Math.min(100,x.spent/x.cap*100),ring=el('span','dk-ring'+(x.spent>=x.cap?' full':''),[el('b','num',Math.round(pct)+'%')]);ring.style.setProperty('--p',pct.toFixed(1));ring.setAttribute('aria-hidden','true');
  return el('div','dk-meta g'+passHue(x),[st,el('div','dk-mw',[ring,el('p','dk-mt',[el('span','',[el('b','num',C+cents(x.spent)),' '+dw('of',{cap:C+cents(x.cap)})]),bar])])])}
// Meters fill once drawn (at once with reduced motion).
function fillMeters(root){const go=()=>{for(const f of root.querySelectorAll('.ac-bar > span[data-w]'))f.style.width=f.dataset.w+'%'};if(RM())go();else requestAnimationFrame(()=>requestAnimationFrame(go))}
// Tilt and shine under a mouse pointer; nothing with reduced motion or a touch.
function tilt(host,face){
  host.addEventListener('pointermove',(e)=>{if(RM()||e.pointerType!=='mouse')return;const r=host.getBoundingClientRect();const px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;
    face.style.setProperty('--ry',((px-.5)*10).toFixed(2)+'deg');face.style.setProperty('--rx',((.5-py)*8).toFixed(2)+'deg');face.style.setProperty('--mx',(px*100).toFixed(1)+'%');face.style.setProperty('--my',(py*100).toFixed(1)+'%')});
  host.addEventListener('pointerleave',()=>{for(const k of ['--rx','--ry','--mx','--my'])face.style.removeProperty(k)})}

// --- The deck's model: one entry per agent, from the roster and the company's records --------------------------------
function deckAgents(recs,CV,demo){
  const byId=new Map((recs||[]).map((a)=>[a.id,a]));
  const extra=(recs||[]).filter((a)=>!ROSTER.some((r)=>r.id===a.id)).map((a)=>({id:a.id,name:a.name,team:'payables',role:a.role||'',job:a.job||'',model:(a.models||[])[0]||null,model_note:'',limit:'',switch:null,code:[]}));
  const all=[...ROSTER,...extra].map((r)=>{const rec=byId.get(r.id)||null;const live=CV&&(CV.agents||[]).find((x)=>x.agent===r.id)||null;
    const c=rec&&rec.card,lc=live&&live.card;
    // An agent the records do not name yet may still hold a live sandbox card (its panel is in the drawer).
    const status=rec?String(rec.status).replace(/[^a-z]/g,''):lc?(lc.status==='ACTIVE'?'active':'paused'):'off';
    const statusText=rec?tk('cs.agents.status.'+rec.status,rec.status):lc?(lc.status==='ACTIVE'?t('cs.cards.active'):t('cs.cards.frozen')):(r.switch?sw('st_switch'):sw('st_code'));
    const spent=c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null;
    return {r,rec,live,face:{id:r.id,name:rec?rec.name:r.name,status,statusText,last4:(lc&&lc.last4)||(c&&c.last4)||null,currency:c?c.currency:null,spent,cap:c&&c.per_month?toCents(c.per_month):0,
      // The model its code sets (the roster, held to the code by a test); the drawer adds what the records show ran.
      model:r.model||(rec&&rec.models&&rec.models[0])||null,ran:rec&&rec.models||[],demo,role:r.role||'',frozen:lc?lc.status!=='ACTIVE':status!=='active'&&!!rec},at:!!(rec||live)}});
  // Those at work in this company first, each group in the roster's order.
  return [...all.filter((x)=>x.at),...all.filter((x)=>!x.at)]}

// --- The page's parts --------------------------------------------------------------------------------------------------
let TICK_TIMER=null;
function deckStats(items,feedTotal){
  const models=[...new Set(items.map((x)=>x.face.model).filter(Boolean))].sort();
  const stat=(n,label)=>el('div','dk-stat',[el('b','num',String(n)),el('span','',label)]);
  return el('div','dk-stats',[stat(items.length,dw('n_agents')),stat(items.filter((x)=>x.at).length,dw('n_here')),feedTotal!==null&&feedTotal!==undefined?stat(feedTotal,dw('n_dec')):null,
    el('div','dk-models',[dkLogo('claude')?dkImg(dkLogo('claude'),'Claude'):null,el('span','',models.map((m)=>modelShort(m).split(' ')[0]).filter((v,i,a)=>a.indexOf(v)===i).join(' · '))])])}
function ticker(items){
  if(TICK_TIMER){clearInterval(TICK_TIMER);TICK_TIMER=null}
  const all=[];for(const x of items)if(x.rec)for(const d of (x.rec.decisions||[]).slice(0,3))all.push({x,d});
  all.sort((a,b)=>String(b.d.at).localeCompare(String(a.d.at)));const list=all.slice(0,8);
  if(!list.length)return null;
  const line=(it)=>{const o=OUTCOME[it.d.outcome]||OUTCOME.note;return el('div','dk-tl',[el('span','dk-sw p-'+styleOf(it.x.r.id)),el('b','',it.x.face.name),el('span','obadge '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[it.d.outcome]?it.d.outcome:'note'))]),el('span','dk-tt',it.d.text.replace(/\s*\(code's fallback, no model\)$/,'')),el('time','num',dday(it.d.at))])};
  const view0=el('div','dk-tv',line(list[0]));
  let k=0,paused=RM();
  const pb=el('button','dk-tp');pb.type='button';
  const setPb=()=>{pb.replaceChildren(paused?ic('play'):dkIc('pause'));pb.setAttribute('aria-label',paused?dw('play'):dw('pause'));pb.setAttribute('aria-pressed',String(paused))};setPb();
  pb.onclick=()=>{paused=!paused;setPb()};
  const box=el('section','card dk-tick'+(ME&&ME.demo?' demo':''),[el('span','dk-th',[el('i',''),dw('tick')]),view0,list.length>1?pb:null]);box.setAttribute('aria-label',dw('tick'));
  if(list.length>1)TICK_TIMER=setInterval(()=>{if(!box.isConnected){clearInterval(TICK_TIMER);TICK_TIMER=null;return}if(paused||document.hidden||box.matches(':hover,:focus-within'))return;
    k=(k+1)%list.length;const n=line(list[k]);n.classList.add('in');view0.replaceChildren(n)},4200);
  return box}
// The Sourcing agent's negotiation: the recorded one's turns when the deployment serves them; its page either way.
function negoBand(){
  const go=el('a','btn primary',[ic('play'),dw('nego')]);go.href='/try/negotiate';
  const steps=el('ol','dk-nsteps');steps.hidden=true;
  const band=el('section','card dk-nego',[el('div','dk-nh',[el('div','dk-nav',[el('span','dk-sw p-'+styleOf('sourcing')),el('span','dk-sw sup')]),el('div','',[el('h2','',dw('nego_h')),el('p','sub',dw('nego_sub'))]),go]),steps]);
  api('/v1/negotiation/recorded').then((n)=>{if(!n||!Array.isArray(n.turns)||!n.turns.length||!band.isConnected)return;
    const C=cur(n.currency)+' ',amt=(a)=>C+cents(toCents(a));
    const inv=el('li','dk-ns inv',[el('span','dk-nw',dw('n_inv')),el('b','num',amt(n.amount)),el('span','dk-nd',n.supplier)]);
    const turns=n.turns.map((tn,i)=>{const deal=tn.accept&&tn.ok;const li=el('li','dk-ns '+(tn.who==='sourcing'?'us':'them')+(tn.ok?'':' bad')+(deal?' deal':''),[
      el('span','dk-nw',tn.who==='sourcing'?dw('n_you'):dw('n_sup')),el('b','num',deal?dw('n_agreed')+' · '+amt(tn.amount):amt(tn.amount)),
      tn.ok?el('span','dk-nd','−'+tn.discount_pct):el('span','dk-nr',[ic('ban'),dw('n_refused')]),tn.refused?el('span','dk-nd dk-nwhy',tn.refused):null]);li.style.setProperty('--i',String(i+1));return li});
    steps.replaceChildren(inv,...turns);steps.hidden=false;band.append(el('p','fine',[ic('info'),' '+n.label+'.']));
    requestAnimationFrame(()=>band.classList.add('play'))}).catch((e)=>{if(e instanceof Expired)throw e});
  return band}

// --- The drawer: everything about one agent --------------------------------------------------------------------------
function dialog(cls,labelText,kids){
  const d=el('dialog','dk-dlg '+cls);d.setAttribute('aria-label',labelText);
  const x=btn('', 'dk-x','x');x.setAttribute('aria-label',dw('close'));x.onclick=()=>d.close();
  d.append(el('div','dk-dh',[el('h2','',labelText),x]),el('div','dk-db',kids));
  d.addEventListener('click',(e)=>{if(e.target===d)d.close()});
  d.addEventListener('close',()=>d.remove());
  document.body.append(d);d.showModal();return d}
function codeBlock(r){
  if(!r.code||!r.code.length)return null;
  return el('details','rs-how dk-code',[el('summary','',[dw('code_h'),ic('chevron-down')]),el('div','rs-hb',[r.switch?el('p','sub',dw('sw',{sw:r.switch})):null,
    el('ul','rs-code',r.code.map((p)=>el('li','',[(()=>{const a=el('a','mono',p);a.href=REPO_BLOB+p;a.target='_blank';a.rel='noopener';return a})()])))])])}
function openDrawer(x,ctx){
  const r=x.r,rec=x.rec;
  const face=cardFace(x.face);
  const acts=el('div','dk-acts',[rec?phoneBtn(x,ctx):null,r.see?(()=>{const a=el('a','btn ghost2',[ic('play'),r.see.label==='Watch a negotiation'?dw('nego'):r.see.label]);a.href=r.see.href;return a})():null]);
  const facts=el('dl','dk-facts',[el('dt','',dw('model_h')),el('dd','',[r.model||x.face.model?el('span','dk-mod',[dkLogo('claude')?dkImg(dkLogo('claude'),'Claude'):null,el('span','mono',x.face.model)]):el('span','sub',dw('code_only')),r.model_note?el('span','sub',r.model_note):null,
      x.face.ran.some((m)=>m!==x.face.model)?el('span','sub',dw('ran',{m:x.face.ran.join(', ')})):null]),
    x.face.last4?el('dt','',dw('issuer_h')):null,x.face.last4?el('dd','',el('span','dk-mod',[dkLogo('airwallex')?dkImg(dkLogo('airwallex'),'Airwallex'):null,el('span','',dw('issuer'))])):null,
    ALTA_AGENTS.includes(r.id)?el('dt','',dw('alta_h')):null,ALTA_AGENTS.includes(r.id)?el('dd','',el('span','dk-mod',[dkLogo('alta')?dkImg(dkLogo('alta'),nx('Alta (formerly Metal)')):null,el('span','',dw('alta'))])):null,
    r.limit&&!(rec&&rec.card)?el('dt','',dw('limit_h')):null,r.limit&&!(rec&&rec.card)?el('dd','',r.limit):null]);
  const blocks=rec?agentRecord(rec,ctx.demo,x.live,ctx.CV):x.live&&ctx.CV?[liveCardPanel(x.live,ctx.CV)]:[];
  const tok=rec&&ctx.P?partnerTokenBlock(ctx.P,rec.id):null;
  const d=dialog('dk-drawer',x.face.name,[el('div','dk-top',[el('div','dk-cw',[face,cardMeta(x.face)]),el('div','dk-tx',[el('p','dk-role',r.role),el('p','',r.job),acts])]),facts,...blocks,tok,codeBlock(r)]);
  tilt(d.querySelector('.dk-cw'),face);fillMeters(d);
  return d}

// --- Add to phone: Apple Wallet when the certificate is set, and always the QR to a read-only view --------------------
function phoneBtn(x,ctx){const b=btn(dw('phone'),'','');b.prepend(dkIc('phone'));b.onclick=()=>openPhone(x,ctx);return b}
function openPhone(x,ctx){
  const out=el('p','sub');out.setAttribute('aria-live','polite');
  const hasCard=!!(x.rec&&x.rec.card);
  let wal;
  if(hasCard&&ctx.P&&ctx.P.wallet_pass&&ctx.P.wallet_pass.available){wal=btn(dw('wal_btn'),'dk-wal','wallet');
    wal.onclick=async()=>{wal.disabled=true;out.textContent=dw('wal_busy');try{const r=await api('/v1/agents/'+encodeURIComponent(x.r.id)+'/wallet-pass/link',{method:'POST'});out.textContent='';location.href=r.url}
      catch(e){if(e instanceof Expired)return;out.textContent=dw('wal_fail',{why:e.message})}finally{wal.disabled=false}}}
  else{wal=btn(hasCard?dw('wal_wait'):dw('wal_nocard'),'dk-wal off','wallet');wal.disabled=true;wal.setAttribute('aria-disabled','true')}
  const qr=el('div','dk-qr',el('span','sub',dw('qr_busy')));
  const d=dialog('dk-phone',dw('phone_h',{name:x.face.name}),[el('div','dk-pc',[cardFace(x.face),cardMeta(x.face)]),wal,out,el('h3','',dw('qr_h')),qr]);
  fillMeters(d);
  const styles={};styles[x.r.id]=styleOf(x.r.id);
  api('/v1/agents/'+encodeURIComponent(x.r.id)+'/phone-card/link',{method:'POST',body:{design:{styles,color:DESIGN.color,initials:DESIGN.initials}}}).then((r)=>{
    const q=el('img','dk-qri');q.alt=dw('qr_h');q.width=200;q.height=200;q.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(r.qr_svg);
    const copy=btn(dw('copy'),'mini','copy');copy.onclick=async()=>{try{await navigator.clipboard.writeText(r.url);copy.replaceChildren(ic('circle-check'),dw('copied'))}catch(e){}};
    const open=el('a','mini ext',[ic('external-link')]);open.href=r.url;open.target='_blank';open.rel='noopener noreferrer';open.setAttribute('aria-label',dw('phone_h',{name:x.face.name}));
    qr.replaceChildren(q,el('div','dk-qt',[el('p','sub',dw('qr_sub',{d:day(r.expires_at)})),DESIGN.logo&&DESIGN_MODE!=='company'?el('p','fine',dw('logo_local')):null,el('div','dk-qa',[copy,open])]))})
    .catch((e)=>{if(e instanceof Expired)return;qr.replaceChildren(el('p','sub',dw('qr_fail',{why:e.message})))});
  return d}

// --- Card design: colour, mark, a preset per agent ---------------------------------------------------------------------
let DECK_REDRAW=null;
function designNote(){return DESIGN_MODE==='company'?null:el('p','fine dk-dn',[ic('info'),' '+dw(DESIGN_MODE==='guest'?'d_guest':'d_reader')])}
function shrinkLogo(file){return new Promise((res,rej)=>{if(!/^image\/(png|jpeg|webp)$/.test(file.type)){rej(new Error(dw('d_logo_bad')));return}
  const rd=new FileReader();rd.onerror=()=>rej(new Error(dw('d_logo_bad')));rd.onload=()=>{const im=new Image();im.onerror=()=>rej(new Error(dw('d_logo_bad')));im.onload=()=>{
    const s=Math.min(1,128/Math.max(im.width,im.height));const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(im.width*s));cv.height=Math.max(1,Math.round(im.height*s));
    const g=cv.getContext('2d');g.drawImage(im,0,0,cv.width,cv.height);const u=cv.toDataURL('image/png');if(u.length*3/4>LOGO_MAX){rej(new Error(dw('d_logo_big')));return}res(u)};im.src=String(rd.result)};rd.readAsDataURL(file)})}
function openDesign(items){
  const msg=el('p','sub');msg.setAttribute('aria-live','polite');
  const changed=()=>{if(DESIGN_MODE!=='company')keepLocal();if(DECK_REDRAW)DECK_REDRAW();preview()};
  // Colour
  const col=el('input','dk-col');col.type='color';col.value=DESIGN.color||'#4382e8';col.setAttribute('aria-label',dw('d_color'));
  col.oninput=()=>{DESIGN.color=col.value.toLowerCase();changed()};
  const all=btn(dw('d_color_all'),'mini','');all.onclick=()=>{DESIGN.color=col.value.toLowerCase();for(const x of items)DESIGN.styles[x.r.id]='brand';changed();drawStyles()};
  // Mark: initials or a logo
  const ini=el('input','field dk-ini');ini.maxLength=3;ini.value=DESIGN.initials||'';ini.placeholder=initialsOf(companyName());ini.setAttribute('aria-label',dw('d_initials'));ini.autocapitalize='characters';
  ini.oninput=()=>{const v=ini.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3);ini.value=v;DESIGN.initials=v||null;changed()};
  const file=el('input','dk-file');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('aria-label',dw('d_upload'));
  file.onchange=async()=>{const f=file.files&&file.files[0];if(!f)return;try{DESIGN.logo=await shrinkLogo(f);msg.textContent='';changed();drawMark()}catch(e){msg.textContent=e.message}file.value=''};
  const up=el('label','btn mini dk-up',[dkIc('upload'),dw('d_upload'),file]);
  const rm=btn(dw('d_remove'),'mini','x');rm.onclick=()=>{DESIGN.logo=null;changed();drawMark()};
  const markRow=el('div','dk-mrow');const drawMark=()=>markRow.replaceChildren(...[el('label','dk-lab',[dw('d_initials'),ini]),up,DESIGN.logo?rm:null].filter(Boolean));drawMark();
  // A preset per agent
  const styles=el('div','dk-styles');
  const drawStyles=()=>styles.replaceChildren(...items.map((x)=>{const g=el('div','dk-srow',[el('span','dk-sn',x.face.name)]);const opts=el('div','dk-sopts');opts.setAttribute('role','radiogroup');opts.setAttribute('aria-label',x.face.name);
    for(const p of CARD_PRESETS){const b=el('button','dk-sw p-'+p+(styleOf(x.r.id)===p?' on':''));b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(styleOf(x.r.id)===p));b.setAttribute('aria-label',PRESET_NAMES[p][NL?'nl':'en']);b.title=PRESET_NAMES[p][NL?'nl':'en'];
      if(p==='brand'&&DESIGN.color)b.style.setProperty('--brand',DESIGN.color);
      b.onclick=()=>{DESIGN.styles[x.r.id]=p;changed();drawStyles();const n=styles.querySelector('[data-a="'+x.r.id+'"] .dk-sw.on');if(n)n.focus()};opts.append(b)}
    g.dataset.a=x.r.id;g.append(opts);return g}));drawStyles();
  const pv=el('div','dk-pv');const preview=()=>{const x=items[0];if(x)pv.replaceChildren(cardFace(x.face));fillMeters(pv)};preview();
  const reset=btn(dw('d_reset'),'ghost2','');reset.onclick=()=>{DESIGN={v:1,color:null,initials:null,logo:null,styles:{}};col.value='#4382e8';ini.value='';changed();drawMark();drawStyles()};
  const save=DESIGN_MODE==='company'?btn(dw('d_save'),'primary','check'):null;
  if(save)save.onclick=async()=>{save.disabled=true;msg.textContent=dw('d_saving');try{const r=await api('/v1/card-design',{method:'POST',body:DESIGN});DESIGN=Object.assign(DESIGN,r.design);msg.textContent=dw('d_saved')}catch(e){if(e instanceof Expired)return;msg.textContent=dw('d_save_fail',{why:e.message})}finally{save.disabled=false}};
  const done=btn(dw('d_done'),save?'':'primary','');
  const d=dialog('dk-design',dw('design'),[el('p','sub',dw('design_sub')),designNote(),pv,
    el('div','dk-row',[el('span','dk-lab',dw('d_color')),col,all]),el('div','dk-row',[el('span','dk-lab',dw('d_mark')),markRow]),
    el('h3','',dw('d_styles')),styles,el('div','dk-foot',[reset,el('span',''),save,done]),msg]);
  done.onclick=()=>d.close();
  return d}

// --- The page ------------------------------------------------------------------------------------------------------------
// A dialog never outlives its page: closed when the page redraws (a card action) or the route changes.
const closeDialogs=()=>{for(const d of document.querySelectorAll('dialog.dk-dlg'))d.open?d.close():d.remove()};
addEventListener('hashchange',closeDialogs);
async function agentDeck(recs,ctx){
  closeDialogs();
  await loadDesign();
  const items=deckAgents(recs,ctx.CV,ctx.demo);
  const grid=el('div','dk-grid');
  const draw=()=>{grid.replaceChildren(...items.map((x)=>{
    const face=cardFace(x.face);const open=el('button','dk-face',face);open.type='button';open.setAttribute('aria-label',x.face.name+': '+dw('details'));open.setAttribute('aria-haspopup','dialog');
    open.onclick=()=>openDrawer(x,ctx);tilt(open,face);
    // Details, at the end of the status line under the card, opens the drawer too (a link to #/agents?a=id clicks it: openAgentFromQuery).
    const more=el('button','dk-line wmore',[el('span','',dw('details')),ic('chevron-right')]);more.type='button';more.setAttribute('aria-label',x.face.name+': '+dw('details'));more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-expanded','false');more.onclick=()=>openDrawer(x,ctx);
    // The negotiation has its own band below the cards, and a button in the Sourcing agent's drawer.
    const acts=[x.rec?(()=>{const b=phoneBtn(x,ctx);b.classList.add('mini');return b})():null].filter(Boolean);
    const it=el('article','dk-item'+(x.at?' on':''),[open,cardMeta(x.face,more),acts.length?el('div','dk-acts',acts):null,authorityOf(x.r.id)]);it.id='roster-'+x.r.id;return it}));fillMeters(grid)};
  draw();DECK_REDRAW=draw;
  const designBtn=btn(dw('design'),'','');designBtn.prepend(dkIc('palette'));designBtn.onclick=()=>openDesign(items);
  return {items,grid,designBtn}}
`;

export const WALLET_CSS = CARD_ART_CSS + `
/* Agents as cards (cloud/src/agentWallet.ts). */
.dk-stats { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: baseline; margin: 6px 0 14px; }
.dk-stat { display: inline-flex; align-items: baseline; gap: 6px; } .dk-stat b { font-size: 22px; letter-spacing: -.02em; } .dk-stat span { color: var(--muted); font-size: 13.5px; }
.dk-models { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 6px; border-radius: 999px; background: var(--sunken); font-size: 13px; font-weight: 600; align-self: center; }
.dk-models img { width: 18px; height: 18px; display: block; }
.dk-tick { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; margin-bottom: 16px; overflow: hidden; }
.dk-th { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.dk-th i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok, #067647); box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok, #067647) 50%, transparent); animation: dk-ping 2s infinite; }
.dk-tick.demo .dk-th i { animation: none; box-shadow: none; background: var(--muted); }
@keyframes dk-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok, #067647) 45%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
.dk-tv { min-width: 0; overflow: hidden; }
.dk-tl { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13.5px; white-space: nowrap; }
.dk-tl.in { animation: dk-in .45s cubic-bezier(.2,.75,.2,1); }
@keyframes dk-in { from { transform: translateY(70%); opacity: 0; } to { transform: none; opacity: 1; } }
.dk-tl > b { flex: none; } .dk-tl .obadge { flex: none; } .dk-tt { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); } .dk-tl time { flex: none; margin-left: auto; color: var(--faint, var(--muted)); font-size: 12.5px; }
.dk-sw { display: inline-block; flex: none; width: 22px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.dk-sw.sup { background: linear-gradient(135deg, #e5e7eb, #9ca3af); }
.dk-tp { width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.dk-tp .ic svg { width: 14px; height: 14px; }
.dk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 292px), 1fr)); gap: 22px 18px; margin-top: 4px; }
.dk-item { display: grid; gap: 8px; align-content: start; min-width: 0; animation: dk-rise .5s cubic-bezier(.2,.75,.2,1) both; }
.dk-item:nth-child(2) { animation-delay: .05s; } .dk-item:nth-child(3) { animation-delay: .1s; } .dk-item:nth-child(4) { animation-delay: .15s; } .dk-item:nth-child(n+5) { animation-delay: .2s; }
@keyframes dk-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
button.dk-face { appearance: none; -webkit-appearance: none; display: block; width: 100%; padding: 0; margin: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; border-radius: 16px; -webkit-tap-highlight-color: transparent; }
button.dk-face:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
button.dk-face:hover .acard { box-shadow: 0 1px 2px rgba(2,6,23,.3), 0 22px 36px -16px rgba(2,8,30,.65); }
/* Under the card (26 Nov, the owner): small muted words, its status and honesty label, then its month on a thin meter. */
.dk-meta { display: grid; gap: 6px; margin: 2px 2px 0; min-width: 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
.dk-meta p { margin: 0; min-width: 0; }
.dk-st { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; }
.dk-st .dk-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint, #94a3b8); }
.dk-st .dk-dot.active { background: var(--ok, #16a34a); } .dk-st .dk-dot.paused, .dk-st .dk-dot.revoked { background: var(--bad, #dc2626); }
.dk-st > span:not(.dk-hon) { color: var(--text); font-weight: 550; }
.dk-st .dk-hon { color: var(--faint, var(--muted)); } .dk-st .dk-hon::before { content: "·"; margin-right: 8px; color: var(--faint, var(--muted)); }
.dk-st .dk-line { margin-left: auto; min-height: 24px; padding: 0 2px; font-size: 12.5px; }
.dk-mt { display: grid; gap: 5px; font-variant-numeric: tabular-nums; } .dk-mt b { font-weight: 600; color: var(--text); }
.dk-meta .ac-bar { display: block; height: 2px; border-radius: 999px; background: color-mix(in srgb, var(--text) 10%, transparent); overflow: hidden; }
.dk-meta .ac-bar > span { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #a97b25, #d9b768); transition: width 1.1s cubic-bezier(.2,.75,.2,1); }
.dk-meta .ac-bar.full > span { background: var(--bad, #dc2626); }
@media (prefers-reduced-motion: reduce) { .dk-meta .ac-bar > span { transition: none; } }
.dk-line { appearance: none; border: 0; background: none; font: inherit; cursor: pointer; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 2px 4px; margin: 0; font-size: 13.5px; color: var(--muted); text-align: left; border-radius: 6px; min-height: 28px; }
.dk-line > span:first-child { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .dk-line .ic svg { width: 14px; height: 14px; } .dk-line:hover { color: var(--text); }
.dk-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 2px; }
.dk-acts .btn { gap: 5px; } .dk-acts .btn .ic svg { width: 14px; height: 14px; }
.dk-item:not(.on) .dk-line { color: var(--faint, var(--muted)); }
.dk-nego { margin-top: 18px; display: grid; gap: 12px; padding: 16px 18px; }
.dk-nh { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; }
.dk-nh h2 { margin: 0; font-size: 17px; } .dk-nh p { margin: 2px 0 0; }
.dk-nav { display: grid; grid-template-columns: 1fr; gap: 3px; } .dk-nav .dk-sw { width: 30px; height: 19px; }
.dk-nsteps { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
.dk-ns { flex: 1 0 150px; display: grid; gap: 2px; padding: 9px 11px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); font-size: 13px; opacity: 1; position: relative; }
.dk-nego.play .dk-ns { animation: dk-rise .45s cubic-bezier(.2,.75,.2,1) both; animation-delay: calc(var(--i, 0) * .35s); }
.dk-ns.us { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); } .dk-ns.them { background: var(--sunken); }
.dk-ns.bad { border-color: var(--bad, #b42318); background: var(--bad-soft, #fef3f2); }
.dk-nd { font-size: 12px; color: var(--muted); } .dk-nwhy { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; } .dk-ns.deal { border-color: var(--ok, #067647); background: var(--ok-soft, #ecfdf3); }
.dk-nw { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.dk-nr { display: inline-flex; gap: 4px; align-items: center; font-size: 11.5px; color: var(--bad, #b42318); } .dk-nr .ic svg { width: 12px; height: 12px; }
.dk-nego .fine { margin: 0; }
.dk-sandbox { margin-top: 18px; } .dk-sandbox > summary { cursor: pointer; font-weight: 650; padding: 10px 0; color: var(--muted); }
/* The dialogs: a drawer from the side on a laptop, a sheet from the bottom on a phone. */
dialog.dk-dlg { padding: 0; border: 0; border-radius: 18px; background: var(--surface); color: var(--text); width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px); box-shadow: 0 24px 60px -12px rgba(16,24,40,.45); overflow: hidden; }
dialog.dk-dlg[open] { display: grid; grid-template-rows: auto minmax(0, 1fr); animation: dk-pop .28s cubic-bezier(.2,.75,.2,1); }
dialog.dk-dlg::backdrop { background: rgba(10,14,25,.45); backdrop-filter: blur(2px); }
dialog.dk-drawer { margin: 12px 12px 12px auto; height: calc(100vh - 24px); width: min(620px, calc(100vw - 24px)); }
dialog.dk-drawer[open] { animation: dk-slide .32s cubic-bezier(.2,.75,.2,1); }
@keyframes dk-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes dk-slide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
.dk-dh { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 10px 20px; border-bottom: 1px solid var(--border); }
.dk-dh h2 { margin: 0; font-size: 18px; min-width: 0; overflow-wrap: anywhere; }
.btn.dk-x { width: 36px; height: 36px; padding: 0; justify-content: center; flex: none; }
.dk-db { overflow: auto; padding: 16px 20px 22px; display: grid; gap: 16px; align-content: start; overscroll-behavior: contain; }
.dk-db > * { min-width: 0; } .dk-db > p { margin: 0; }
.dk-top { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
.dk-top .dk-tx { display: grid; gap: 8px; } .dk-top p { margin: 0; } .dk-role { font-weight: 650; }
.dk-facts { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 8px 12px; margin: 0; padding-top: 12px; border-top: 1px solid var(--border); }
.dk-facts dt { color: var(--muted); font-size: 13px; font-weight: 600; } .dk-facts dd { margin: 0; display: grid; gap: 3px; }
.dk-mod { display: inline-flex; align-items: center; gap: 6px; } .dk-mod img { width: 16px; height: 16px; }
.dk-db .lims, .dk-db .rules, .dk-db .adec, .dk-db .alearn, .dk-db .lcard, .dk-db .adet { padding-top: 12px; border-top: 1px solid var(--border); }
.dk-db .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.dk-phone .dk-pc { max-width: 340px; width: 100%; justify-self: center; }
.btn.dk-wal { justify-content: center; background: #000; color: #fff; border-color: #000; height: 44px; }
.btn.dk-wal.off { background: transparent; color: var(--muted); border-style: dashed; border-color: var(--border); opacity: 1; cursor: not-allowed; height: auto; min-height: 44px; white-space: normal; }
.dk-phone h3 { margin: 4px 0 0; font-size: 15px; }
.dk-qr { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 14px; align-items: center; }
img.dk-qri { width: 200px; height: 200px; border-radius: 12px; background: #fff; padding: 6px; box-sizing: border-box; border: 1px solid var(--border); }
.dk-qt { display: grid; gap: 8px; } .dk-qt p { margin: 0; } .dk-qa { display: flex; gap: 8px; flex-wrap: wrap; }
.dk-design .dk-pv { max-width: 300px; }
.dk-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.dk-row > .dk-mrow { grid-column: 2 / -1; }
.dk-lab { font-size: 13px; font-weight: 600; color: var(--muted); display: inline-flex; gap: 8px; align-items: center; }
input.dk-col { width: 52px; height: 36px; padding: 2px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.dk-mrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
input.dk-ini { width: 72px; text-transform: uppercase; }
label.dk-up { position: relative; cursor: pointer; display: inline-flex; gap: 5px; align-items: center; } label.dk-up .ic svg { width: 14px; height: 14px; }
input.dk-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
label.dk-up:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }
.dk-design h3 { margin: 4px 0 0; font-size: 15px; }
.dk-styles { display: grid; gap: 8px; }
.dk-srow { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; align-items: center; }
.dk-sn { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dk-sopts { display: flex; flex-wrap: wrap; gap: 6px 5px; }
button.dk-sw { width: 28px; height: 19px; border-radius: 5px; border: 0; cursor: pointer; padding: 0; }
button.dk-sw.on { outline: 2px solid var(--text); outline-offset: 2px; }
button.dk-sw:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.dk-sw.p-aurora, .dk-sw.p-lagoon, .dk-sw.p-midnight, .dk-sw.p-ember, .dk-sw.p-graphite, .dk-sw.p-rose, .dk-sw.p-citrus, .dk-sw.p-sky, .dk-sw.p-bullion, .dk-sw.p-brand { --brand: #4382e8; }
/* 21 Nov (Max): one family of navy metal cards; a swatch is the agent's accent on it, at the card's edge. */
.dk-sw[class*=" p-"] { background: linear-gradient(90deg, var(--acc, #e9c46a) 0 4px, transparent 4px), radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, var(--acc, #e9c46a) 35%, transparent), transparent 70%), linear-gradient(140deg, #13265a, #060d24); box-shadow: inset 0 0 0 1px rgba(233,196,106,.6); }
.dk-sw.p-aurora { --acc: #89b5fc; } .dk-sw.p-lagoon { --acc: #2dd4bf; } .dk-sw.p-midnight { --acc: #60a5fa; } .dk-sw.p-ember { --acc: #fb923c; } .dk-sw.p-graphite { --acc: #cbd5e1; }
.dk-sw.p-rose { --acc: #fb7185; } .dk-sw.p-citrus { --acc: #a3e635; } .dk-sw.p-sky { --acc: #38bdf8; } .dk-sw.p-bullion { --acc: #e9c46a; }
.dk-sw.p-brand { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, #000), var(--brand)); }
.dk-foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border); } .dk-foot > span { flex: 1; }
.dk-dn { margin: 0; display: flex; gap: 6px; align-items: flex-start; }
@media (max-width: 640px) {
  dialog.dk-dlg, dialog.dk-drawer { margin: auto 0 0; width: 100vw; max-width: 100vw; height: auto; max-height: 92vh; border-radius: 18px 18px 0 0; }
  dialog.dk-dlg[open], dialog.dk-drawer[open] { animation: dk-up .3s cubic-bezier(.2,.75,.2,1); }
  .dk-db { padding: 14px 16px 20px; } .dk-top { grid-template-columns: minmax(0, 1fr); } .dk-top .dk-cw { max-width: 320px; }
  .dk-db .rules { grid-template-columns: minmax(0, 1fr); }
  .dk-qr { grid-template-columns: minmax(0, 1fr); justify-items: center; } .dk-qt { justify-items: center; text-align: center; }
  .dk-row { grid-template-columns: minmax(0, 1fr) auto; } .dk-row > .dk-lab { grid-column: 1 / -1; } .dk-row > .dk-mrow { grid-column: 1 / -1; }
  .dk-srow { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .dk-nh { grid-template-columns: minmax(0, 1fr); } .dk-nav { display: none; } .dk-nh .btn { justify-self: start; }
  .dk-tick { grid-template-columns: minmax(0, 1fr) auto; } .dk-th { grid-column: 1 / -1; } .dk-tl .obadge { display: none; } .dk-tl time { display: none; }
  .dk-facts { grid-template-columns: minmax(0, 1fr); gap: 2px; } .dk-facts dd { margin-bottom: 8px; }
}
@keyframes dk-up { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dk-item, .dk-tl.in, .dk-nego.play .dk-ns, dialog.dk-dlg[open], dialog.dk-drawer[open] { animation: none; }
  .dk-th i { animation: none; }
}
@media print { .dk-acts, .dk-tick, .dk-tp { display: none; } }
`;
