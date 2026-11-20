// Purser Cloud's Agents tab as a wallet (21 Nov, the owner: "each agent as an Apple-Wallet-style card"). One pass per
// agent: a rounded card in the agent's own gradient with its name, its job, what it spent this month against the CFO's
// monthly limit, its per-purchase limit, its Airwallex card (last four only) and the card's state. Tap the pass and it
// turns over: the agent's mandate (what it may and may not do) and its newest decision. "Details" opens the full record
// below it (limits, the live sandbox card and its signed actions, every decision, what it learns, the technical record),
// and the opened agent takes the whole row. Visual only: nothing here is a pass file, and nothing here acts; the live
// card's actions stay in its own panel (cloud/src/consoleUi.ts liveCardPanel), each signed with the owner's passkey.
// Pure CSS and DOM: the turn is a 3D rotation that prefers-reduced-motion replaces with a plain swap; on a phone the
// passes stack.
//
// Room for more (another view module adds T:0 bookings and tokenisation to each agent): push a function onto PASS_ROWS,
// (a, ctx) => ({icon, label, value}) or null, for a row on the pass's back; or onto AGENT_BLOCKS, (a, ctx) => Node or
// null, for a block in the agent's details. ctx is {demo, live, CV}: the demo flag, the agent's live card row (GET
// /v1/cards) and that answer. A function that throws is left out; the pass still draws.
//
// The script goes into the console at __UI__ (cloud/src/console.ts), after cloud/src/consoleUi.ts (agentCard calls
// walletAgent) and uses its el, ic, btn, t, tk, cur, cents, toCents, day, MONTHS, OUTCOME, BRAND_LOGOS and RM.

export const WALLET_JS = String.raw`
// --- Agents as passes (21 Nov) ----------------------------------------------------------------------------------------
const PASS_ROWS=[];
const AGENT_BLOCKS=[];
// The agents opened in this tab, kept across a redraw (a card action redraws the page).
const OPEN_AGENTS=new Set();
// Each agent its own gradient: the three of the runner by name, any other by a hash of its id.
const PASS_HUE={sourcing:0,support:1,treasury:2};
function passHue(a){const k=String(a.id||a.name||'').toLowerCase();if(k in PASS_HUE)return PASS_HUE[k];let h=0;for(const ch of k)h=(h*31+ch.charCodeAt(0))>>>0;return 3+h%3}
const passRow=(icon,label,value)=>el('div','wp-row',[ic(icon),el('span','wp-rl',label),el('b','wp-rv num',value)]);
const safely=(f,a,ctx)=>{try{return f(a,ctx)}catch(e){return null}};
// The pass: front (who, spent against the limit, the card) and back (the mandate, the newest decision, extra rows).
function agentPass(a,ctx){
  const c=a.card,lc=ctx.live&&ctx.live.card;
  const frozen=lc?lc.status!=='ACTIVE':a.status!=='active';
  const cardState=lc?(lc.status==='ACTIVE'?t('cs.cards.active'):lc.status==='INACTIVE'?t('cs.cards.frozen'):lc.status.charAt(0)+lc.status.slice(1).toLowerCase())
    :a.status==='active'?t('cs.wl.card_active'):t(a.status==='revoked'?'cs.agents.card_status.closed':'cs.agents.card_status.frozen');
  const last4=lc&&lc.last4?lc.last4:c&&c.last4?c.last4:null;
  const C=c?cur(c.currency)+' ':'';
  const spent=c&&c.per_month&&c.spent_month!==null&&c.spent_month!==undefined?toCents(c.spent_month):null,cap=c&&c.per_month?toCents(c.per_month):0;
  const mon=c&&c.month?MONTHS[Number(c.month.slice(5,7))-1]+' '+c.month.slice(0,4):'';
  const st=el('span','wp-st '+String(a.status).replace(/[^a-z]/g,''),[el('i',''),tk('cs.agents.status.'+a.status,a.status)]);
  const who=el('div','wp-top',[el('span','wp-av',ic('bot')),el('div','wp-who',[el('b','wp-name',a.name),el('span','wp-job',a.job||'')]),st]);
  let money;
  if(spent!==null){const bar=el('span','wp-bar'+(spent>=cap?' full':''));const f=el('span','');f.style.width=(cap>0?Math.min(100,spent/cap*100):0).toFixed(1)+'%';bar.append(f);
    bar.setAttribute('role','img');bar.setAttribute('aria-label',t('cs.agents.spent_of',{spent:C+cents(spent),cap:C+cents(cap),month:mon}));
    money=el('div','wp-money',[el('span','wp-lab',t('cs.wl.spent',{month:mon})),el('div','wp-fig',[el('b','num',C+cents(spent)),el('span','num',' '+t('cs.wl.of',{cap:C+cents(cap)}))]),bar]);
  }else money=el('div','wp-money',[el('span','wp-lab',t('cs.wl.no_limit')),el('div','wp-fig',[el('b','',c?t('cs.wl.limits_only'):t('cs.agents.no_card'))])]);
  const per=c&&c.per_purchase?el('div','wp-chips',[el('span','wp-chip',t('cs.wl.per',{amt:C+cents(toCents(c.per_purchase))})),...(c.pays_for?c.pays_for.split(/,\s*/).slice(0,2).map((w)=>el('span','wp-chip soft',w)):[])]):null;
  const visa=BRAND_LOGOS['visa-white'];const brand=(lc&&lc.brand)||(c&&c.brand)||null;
  const foot=el('div','wp-foot',[el('div','wp-card',[el('span','wp-awx','Airwallex'),el('span','wp-num num',last4?'•••• '+last4:t('cs.wl.no_card_yet'))]),
    el('div','wp-state',[el('span','wp-cs'+(frozen?' off':''),[el('i',''),cardState]),(!brand||/visa/i.test(brand))&&visa&&last4?(()=>{const i=el('img','wp-visa');i.src=visa.uri;i.alt='Visa';return i})():brand?el('span','wp-brand',brand):null])]);
  const front=el('div','wp-face wp-front',[who,money,per,ctx.demo&&c?el('span','wp-demo',[ic('flask'),t('cs.wl.demo')]):null,foot]);
  // The back: what the CFO allowed and did not, the newest decision, and any rows another view adds.
  const may=a.may||[],not=a.may_not||[];
  const d=(a.decisions||[])[0];const o=d?(OUTCOME[d.outcome]||OUTCOME.note):null;
  const rows=PASS_ROWS.map((f)=>safely(f,a,ctx)).filter(Boolean).map((r)=>r instanceof Node?r:passRow(r.icon||'circle-dot',r.label,r.value));
  const back=el('div','wp-face wp-back',[
    el('div','wp-bh',[el('b','',t('cs.wl.mandate')),el('span','wp-name sm',a.name)]),
    el('div','wp-mand',[el('ul','wp-can',[...may.slice(0,3).map((x)=>el('li','',[ic('circle-check'),el('span','',x)])),may.length>3?el('li','more',t('cs.wl.n_more',{n:may.length-3})):null]),
      el('ul','wp-cannot',[...not.slice(0,2).map((x)=>el('li','',[ic('ban'),el('span','',x)])),not.length>2?el('li','more',t('cs.wl.n_more',{n:not.length-2})):null])]),
    ...rows,
    el('div','wp-last',[el('span','wp-lab',t('cs.wl.latest')),d?el('div','wp-dec',[el('span','wp-ob '+o[1],[ic(o[0]),t('cs.agents.out.'+(OUTCOME[d.outcome]?d.outcome:'note'))]),el('span','wp-dt',d.text.replace(/\s*\(code's fallback, no model\)$/,'')),el('time','num',day(d.at))]):el('span','wp-dt',t('cs.agents.no_decisions'))])]);
  back.setAttribute('aria-hidden','true');
  const pass=el('button','wpass h'+passHue(a)+(frozen?' frozen':''),[el('span','wp-inner',[front,back])]);pass.type='button';
  pass.setAttribute('aria-pressed','false');pass.setAttribute('aria-label',t('cs.wl.turn',{name:a.name}));
  pass.onclick=()=>{const on=!pass.classList.contains('flipped');pass.classList.toggle('flipped',on);pass.setAttribute('aria-pressed',String(on));front.setAttribute('aria-hidden',String(on));back.setAttribute('aria-hidden',String(!on))};
  return pass}
// One agent: its pass, a Details button, and the full record below (hidden until opened).
function walletAgent(a,demo,live,CV,details){
  const ctx={demo,live,CV};const key=String(a.id||a.name);
  const panel=el('div','wdetail',[...details.filter(Boolean),...AGENT_BLOCKS.map((f)=>safely(f,a,ctx)).filter(Boolean)]);panel.id='agent-'+key.replace(/[^a-z0-9]+/gi,'-')+'-details';
  const open=OPEN_AGENTS.has(key)||!!(cardMsg&&cardMsg.agent===a.id);if(open)OPEN_AGENTS.add(key);
  panel.hidden=!open;
  const sec=el('section','card agent wagent rise'+(open?' open':''),[el('h2','wvh',a.name)]);
  const more=btn(open?t('cs.wl.less'):t('cs.wl.more'),'wmore','chevron-down');more.setAttribute('aria-expanded',String(open));more.setAttribute('aria-controls',panel.id);
  more.onclick=()=>{const o=panel.hidden;panel.hidden=!o;sec.classList.toggle('open',o);more.setAttribute('aria-expanded',String(o));more.replaceChildren(ic('chevron-down'),o?t('cs.wl.less'):t('cs.wl.more'));
    if(o)OPEN_AGENTS.add(key);else OPEN_AGENTS.delete(key);sec.scrollIntoView({block:'nearest',behavior:RM()?'auto':'smooth'})};
  sec.append(el('div','wside',[agentPass(a,{demo,live,CV}),el('div','wbar',[el('span','wtap',[ic('arrow-right'),t('cs.wl.tap')]),more])]),panel);
  return sec}
`;

export const WALLET_CSS = `
/* Agents as passes (cloud/src/agentWallet.ts). */
.agents.wallet { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 16px; align-items: stretch; }
/* Closed, the passes of a row stand equally tall (the tallest face sets it). */
.wagent:not(.open) { display: flex; flex-direction: column; }
.wagent:not(.open) .wside { flex: 1; display: flex; flex-direction: column; }
.wagent:not(.open) button.wpass { flex: 1; display: grid; }
.card.agent.wagent { padding: 12px; display: grid; gap: 0; border-radius: 22px; }
.card.agent.wagent:not(.open) { padding: 0; background: transparent; border-color: transparent; box-shadow: none; }
.wagent .wside { display: grid; gap: 8px; min-width: 0; }
.wagent .wbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; }
.wagent .wtap { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--faint); }
.wagent .wtap .ic svg { width: 13px; height: 13px; transform: rotate(-90deg); }
.wagent .btn.wmore { height: 32px; padding: 0 12px; font-size: 13px; background: var(--sunken); border-color: transparent; color: var(--text); }
.wagent .btn.wmore .ic { transition: transform .2s; }
.wagent.open .btn.wmore .ic { transform: rotate(180deg); }
.wagent.open { grid-column: 1 / -1; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr); gap: 22px; padding: 16px; align-items: start; }
.wagent.open .wside { position: sticky; top: 132px; }
.wagent .wdetail { display: grid; gap: 16px; min-width: 0; }
.wagent .wdetail[hidden] { display: none; }
.wagent .wvh { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wagent .wdetail > :first-child { border-top: 0; padding-top: 0; }
.wagent .wdetail .lims { padding-bottom: 4px; }
@media (max-width: 900px) { .wagent.open { grid-template-columns: minmax(0, 1fr); } .wagent.open .wside { position: static; max-width: 420px; } }
/* No agent yet: what brings one, and where to start. */
.card.wempty { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 18px 20px; margin-top: 14px; border-style: dashed; }
.wempty-ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.card.wempty p { margin: 2px 0 0; }
@media (max-width: 640px) { .card.wempty { grid-template-columns: 44px minmax(0, 1fr); } .card.wempty .btn { grid-column: 1 / -1; justify-self: start; } }
/* The pass: a button that turns over. */
button.wpass { appearance: none; -webkit-appearance: none; display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none; color: #fff; font: inherit; text-align: left; cursor: pointer; perspective: 1400px; border-radius: 18px; -webkit-tap-highlight-color: transparent; }
button.wpass:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.wp-inner { display: grid; transform-style: preserve-3d; transition: transform .6s cubic-bezier(.2, .75, .2, 1); }
button.wpass.flipped .wp-inner { transform: rotateY(180deg); }
button.wpass:hover .wp-face { box-shadow: 0 1px 2px rgba(16,24,40,.14), 0 18px 34px -14px rgba(16,24,40,.55); }
.wp-face { grid-area: 1 / 1; position: relative; overflow: hidden; min-height: 232px; border-radius: 18px; padding: 16px 18px 15px; display: flex; flex-direction: column; gap: 10px;
  backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 1px 2px rgba(16,24,40,.12), 0 12px 28px -14px rgba(16,24,40,.5); transition: box-shadow .2s; }
.wp-face::before { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,.22), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.06), transparent 40%); pointer-events: none; }
.wp-face > * { position: relative; }
.wp-face.wp-back { transform: rotateY(180deg); }
.wpass.h0 .wp-face { background: linear-gradient(140deg, #312e81 0%, #4f46e5 52%, #7c3aed 100%); }
.wpass.h1 .wp-face { background: linear-gradient(140deg, #064e3b 0%, #0f766e 55%, #0e9488 100%); }
.wpass.h2 .wp-face { background: linear-gradient(140deg, #0b1b45 0%, #1e3a8a 50%, #2563eb 100%); }
.wpass.h3 .wp-face { background: linear-gradient(140deg, #7c2d12 0%, #c2410c 55%, #d97706 100%); }
.wpass.h4 .wp-face { background: linear-gradient(140deg, #701a3d 0%, #be185d 55%, #db2777 100%); }
.wpass.h5 .wp-face { background: linear-gradient(140deg, #111827 0%, #374151 55%, #4b5563 100%); }
.wpass.frozen .wp-face { filter: grayscale(.75) brightness(.92); }
.wp-top { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.wp-av { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(255,255,255,.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
.wp-who { display: grid; min-width: 0; }
.wp-name { font-size: 16px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; } .wp-name.sm { font-size: 12.5px; font-weight: 600; opacity: .8; }
.wp-job { font-size: 12px; line-height: 1.3; min-height: 2.6em; opacity: .82; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wp-st { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 650; background: rgba(255,255,255,.16); white-space: nowrap; }
.wp-st i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,.25); }
.wp-st.paused i, .wp-st.revoked i { background: #fca5a5; box-shadow: none; }
.wp-money { display: grid; gap: 4px; margin-top: 2px; }
.wp-lab { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; opacity: .78; }
.wp-fig { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; } .wp-fig b { font-size: 24px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; } .wp-fig span { font-size: 13px; opacity: .8; }
.wp-bar { display: block; height: 6px; border-radius: 999px; background: rgba(255,255,255,.22); overflow: hidden; margin-top: 4px; }
.wp-bar > span { display: block; height: 100%; border-radius: 999px; background: #fff; }
.wp-bar.full > span { background: #fecaca; }
.wp-chips { display: flex; flex-wrap: nowrap; gap: 6px; min-width: 0; overflow: hidden; }
.wp-chip { font-size: 11.5px; font-weight: 650; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.2); white-space: nowrap; }
.wp-chip.soft { background: rgba(255,255,255,.1); font-weight: 550; min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
.wp-demo { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; opacity: .8; } .wp-demo svg { width: 12px; height: 12px; }
.wp-foot { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.18); }
.wp-card { display: grid; gap: 1px; } .wp-awx { font-size: 11px; font-weight: 700; letter-spacing: .04em; opacity: .8; }
.wp-num { font-size: 16px; font-weight: 650; letter-spacing: .08em; }
.wp-state { display: flex; align-items: center; gap: 10px; }
.wp-cs { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 650; opacity: .92; } .wp-cs i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; } .wp-cs.off i { background: #cbd5e1; }
img.wp-visa { display: block; width: 34px; height: 34px; margin: -10px -2px -10px 0; }
.wp-brand { font-weight: 800; font-style: italic; font-size: 14px; }
.wp-bh { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; } .wp-bh > b { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .85; }
.wp-mand { display: grid; gap: 6px; }
.wp-mand ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.wp-mand li { display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 6px; font-size: 12.5px; line-height: 1.35; }
.wp-mand li > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .wp-mand li svg { width: 14px; height: 14px; margin-top: 1px; }
.wp-mand .wp-can svg { color: #86efac; } .wp-mand .wp-cannot svg { color: #fca5a5; } .wp-mand li.more { display: block; padding-left: 21px; opacity: .75; font-size: 12px; }
.wp-row { display: grid; grid-template-columns: 15px minmax(0, 1fr) auto; gap: 6px; align-items: center; font-size: 12.5px; } .wp-row svg { width: 14px; height: 14px; } .wp-rv { font-weight: 650; }
.wp-last { margin-top: auto; padding-top: 9px; border-top: 1px solid rgba(255,255,255,.18); display: grid; gap: 4px; }
.wp-dec { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 8px; align-items: center; font-size: 12.5px; }
.wp-dec time { grid-column: 2; font-size: 11.5px; opacity: .75; }
.wp-dt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; }
.wp-ob { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,.18); white-space: nowrap; } .wp-ob svg { width: 12px; height: 12px; }
@media (max-width: 640px) { .card.agent.wagent { padding: 10px; border-radius: 20px; } .wagent.open { padding: 12px; gap: 14px; } .wp-face { min-height: 220px; padding: 15px 16px 14px; } .wp-fig b { font-size: 22px; } }
@media (prefers-reduced-motion: reduce) {
  .wp-inner, .wp-face, .wagent .btn.wmore .ic { transition: none; }
  button.wpass.flipped .wp-inner { transform: none; }
  .wp-face.wp-back { transform: none; visibility: hidden; }
  button.wpass.flipped .wp-face.wp-back { visibility: visible; } button.wpass.flipped .wp-face.wp-front { visibility: hidden; }
}
@media print { button.wpass .wp-face { box-shadow: none; } .wagent .wbar { display: none; } .wagent .wdetail[hidden] { display: grid; } }
`;
