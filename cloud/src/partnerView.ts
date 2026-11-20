// The console's view of T:0 at every payment and the agents' payment tokens (21 Nov), as plain browser script the console
// carries as it is (cloud/src/console.ts puts it in at __UI__). Two hooks only, so the pages around it can change freely:
//   partnerAgents(cards, agents)  after the Agents page drew its cards: each agent card gets its payment token (id and
//                                  last four, mandate, status, uses and refusals, each payment's T:0 reference) and, only
//                                  when the owner configured passes, an "Add to Apple Wallet" button;
//   partnerBooks(view)             after the Books page drew: a "Booked in T:0" card with every payment's T:0 entry and
//                                  the reconcile check of T:0 against the rails.
// Every figure is GET /v1/partner-rails's (cloud/src/partnerRails.ts), whose label says whose records they are. It builds
// elements only through el() and sets text as text; its words are its own, in English and Dutch.

export const PARTNER_VIEW_JS = String.raw`
// --- T:0 at every payment, and the agents' tokens --------------------------------------------------------------------
const PR_W={en:{
  tok_h:'Payment token',tok_sub:'The agent pays with this token, never with its card number. It works only within the mandate below, made from your limits; revoking the agent revokes it.',
  tok_none:'No payment token.',active:'Active',revoked:'Revoked',bound:'Bound to card',mandate:'Mandate',a_purchase:'a purchase',a_month:'a month',mcc:'merchant category',until:'until',
  mhash:'Mandate hash',uses:'Uses and refusals',used:'Paid',refused:'Refused',t0ref:'T:0',none_yet:'None yet.',
  booked_h:'Booked in T:0',booked_sub:'Each payment is booked in T:0 the moment it settles: its GL account, cost centre, the agent who paid and the hash of the terms it paid under, with its T:0 reference.',
  pay:'Payment',rail:'Rail',amt:'Amount',glcc:'GL · cost centre',agent:'Agent',terms:'Terms hash',t0:'T:0 entry',after:'Booked after settling',
  recon_h:'Reconcile: T:0 against the rails',recon_ok:'T:0 and every rail agree',recon_bad:'T:0 and the rails disagree',recon_none:'No reconcile check yet.',recon_at:'read back {at}',
  t0holds:'T:0 holds',railholds:'The rail holds',agrees:'agrees',differs:'differs',
  misuse_h:'Card number without the token',record:'Run record',story:'What ran',
  wallet:'Add to Apple Wallet',wallet_busy:'Making the pass…',wallet_fail:'The pass could not be made: {why}',
  rails:{airwallex_card:'Visa card (Airwallex Issuing)',airwallex_transfer:'Airwallex transfer',metal:'Alta testnet',airwallex_airi:'Visa via Airi'}},
nl:{
  tok_h:'Betaaltoken',tok_sub:'De agent betaalt met dit token, nooit met het kaartnummer. Het werkt alleen binnen het mandaat hieronder, gemaakt uit jouw limieten; trek je de agent in, dan vervalt het.',
  tok_none:'Geen betaaltoken.',active:'Actief',revoked:'Ingetrokken',bound:'Gebonden aan kaart',mandate:'Mandaat',a_purchase:'per aankoop',a_month:'per maand',mcc:'merchantcategorie',until:'tot',
  mhash:'Hash van het mandaat',uses:'Betalingen en weigeringen',used:'Betaald',refused:'Geweigerd',t0ref:'T:0',none_yet:'Nog geen.',
  booked_h:'Geboekt in T:0',booked_sub:'Elke betaling staat in T:0 zodra ze is afgerond: grootboekrekening, kostenplaats, de agent die betaalde en de hash van de voorwaarden, met de T:0-referentie.',
  pay:'Betaling',rail:'Rail',amt:'Bedrag',glcc:'Grootboek · kostenplaats',agent:'Agent',terms:'Hash voorwaarden',t0:'T:0-boeking',after:'Geboekt na afronding',
  recon_h:'Aansluiting: T:0 tegen de rails',recon_ok:'T:0 en elke rail komen overeen',recon_bad:'T:0 en de rails wijken af',recon_none:'Nog geen aansluiting.',recon_at:'teruggelezen {at}',
  t0holds:'In T:0',railholds:'Op de rail',agrees:'klopt',differs:'wijkt af',
  misuse_h:'Kaartnummer zonder token',record:'Runverslag',story:'Wat er draaide',
  wallet:'Toevoegen aan Apple Wallet',wallet_busy:'Pas wordt gemaakt…',wallet_fail:'De pas kon niet worden gemaakt: {why}',
  rails:{airwallex_card:'Visa-kaart (Airwallex Issuing)',airwallex_transfer:'Airwallex-overboeking',metal:'Alta testnet',airwallex_airi:'Visa via Airi'}}};
function pw(k,v){const W=PR_W[NL?'nl':'en'];let s=W[k]||PR_W.en[k]||k;for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
const prRail=(r)=>(PR_W[NL?'nl':'en'].rails[r])||r;
const prShort=(h)=>h?String(h).slice(0,12)+'…':'—';
let PR_CACHE=null;
async function partnerData(){if(PR_CACHE)return PR_CACHE;PR_CACHE=api('/v1/partner-rails').catch((e)=>{PR_CACHE=null;if(e instanceof Expired)throw e;return null});return PR_CACHE}
function prLabel(P){return el('span','rlabel',P.label)}
function prLinks(P){return P.record?el('p','links',[ext(P.record,pw('record')),' ',ext(P.story,pw('story'))]):null}
// One agent's token, as a block on its card.
function partnerTokenBlock(P,agentId){
  const toks=(P.tokens||[]).filter((x)=>x.agent===agentId);
  const pays=(P.t0&&P.t0.bookings||[]).filter((b)=>b.agent===agentId);
  if(!toks.length&&!pays.length)return null;
  const kids=[el('div','th',[el('h3','',[ic('key-round'),' '+pw('tok_h')]),prLabel(P)])];
  for(const x of toks){
    const on=x.status==='active';
    kids.push(el('p','sub',pw('tok_sub')),el('div','prtok'+(on?'':' off'),[
      el('div','prtk',[el('code','mono',x.token_id+' ··'+x.token_last4),el('span','ast '+(on?'active':'revoked'),[ic(on?'circle-check':'ban'),' '+pw(on?'active':'revoked')])]),
      el('p','',pw('bound')+' •••• '+x.card_last4+' · '+pw('mandate')+': '+cur(x.currency)+' '+(x.per_purchase||'—')+' '+pw('a_purchase')+', '+(x.per_month||'—')+' '+pw('a_month')+(x.mccs.length?', '+pw('mcc')+' '+x.mccs.join(', '):'')+(x.expires_at?', '+pw('until')+' '+day(x.expires_at):'')),
      el('p','fine mono',pw('mhash')+' '+prShort(x.mandate_sha256)),
      x.events.length?el('ul','outs prev',x.events.map((e)=>el('li','',[el('span','obadge '+(e.kind==='used'?'ok':'bad'),[ic(e.kind==='used'?'circle-check':'ban'),pw(e.kind)]),el('span','otext',[[e.merchant,e.amount?cur(x.currency)+' '+e.amount:null].filter(Boolean).join(' · ')||'',e.kind==='refused'?el('small','sub',' '+e.outcome):null,e.t0_id?el('small','sub mono',' · '+pw('t0ref')+' '+e.t0_id):null])]))):el('p','sub',pw('none_yet'))]));
  }
  // Payments of this agent's that no token paid (a transfer, Alta): each with its T:0 reference.
  const other=pays.filter((b)=>!toks.some((x)=>x.events.some((e)=>e.t0_id===b.t0_id)));
  if(other.length)kids.push(el('ul','outs prev',other.map((b)=>el('li','',[el('span','obadge ok',[ic('landmark'),prRail(b.rail)]),el('span','otext',[cur(b.currency)+' '+b.amount+(b.counterparty?' · '+b.counterparty:''),el('small','sub mono',' · '+pw('t0ref')+' '+b.t0_id+' · GL '+b.gl_account+(b.cost_centre?' '+b.cost_centre:''))])]))));
  kids.push(prLinks(P));
  return el('div','lcard prblock',kids.filter(Boolean));
}
// The Wallet button: only when the owner configured passes, and only for an agent with a card.
function partnerWalletBtn(P,a){
  if(!P.wallet_pass||!P.wallet_pass.available||!a.card)return null;
  const out=el('span','sub');const b=btn(pw('wallet'),'','wallet');
  b.onclick=async()=>{b.disabled=true;out.textContent=pw('wallet_busy');
    try{const r=await api('/v1/agents/'+encodeURIComponent(a.id)+'/wallet-pass/link',{method:'POST'});out.textContent='';location.href=r.url}
    catch(e){if(e instanceof Expired)return;out.textContent=pw('wallet_fail',{why:e.message})}finally{b.disabled=false}};
  return el('div','cbar prwallet',[b,out]);
}
// The hook on the Agents page: its cards in the order of its agents.
async function partnerAgents(cards,agents){
  const P=await partnerData();if(!P)return;
  (agents||[]).forEach((a,i)=>{const c=cards[i];if(!c)return;const blk=partnerTokenBlock(P,a.id),w=partnerWalletBtn(P,a);if(blk)c.append(blk);if(w)c.append(w)});
}
// The hook on the Books page: the "Booked in T:0" card, after the page's own cards.
async function partnerBooks(host){
  const P=await partnerData();if(!P||!host.isConnected)return;
  const B=(P.t0&&P.t0.bookings)||[];if(!B.length)return;
  // One block per payment (not a wide table: the T:0 reference must be in view on a phone too).
  const kv=(k,v,cls)=>el('span','prkv',[el('small','',k),el('b',cls||'',v)]);
  const tbl=el('ul','plain prpays',B.map((b)=>el('li','',[
    el('div','prph',[el('span','',b.what||b.counterparty||b.payment_id),el('b','num',cur(b.currency)+' '+b.amount)]),
    el('div','prkvs',[kv(pw('t0'),b.t0_id,'mono'),kv(pw('rail'),prRail(b.rail)),kv(pw('glcc'),b.gl_account+(b.cost_centre?' · '+b.cost_centre:''),'mono'),kv(pw('agent'),b.agent||'—'),
      kv(pw('terms'),prShort(b.terms_sha256),'mono'),kv(pw('after'),b.ms_after_settled===null||b.ms_after_settled===undefined?'—':(b.ms_after_settled/1000).toFixed(1)+' s','num')])])));
  const R=P.t0.reconcile;
  const recon=R?el('div','prrec',[el('h3','',[ic(R.ok?'circle-check':'triangle-alert'),' '+pw('recon_h')]),el('p','says',(R.ok?pw('recon_ok'):pw('recon_bad'))+' · '+pw('recon_at',{at:stamp(R.at)})),
    el('ul','plain prrl',R.rows.map((x)=>el('li','prrli',[ic(x.ok?'circle-check':'triangle-alert'),el('span','',x.payment_id+' · '+prRail(x.rail)+' · '+pw('t0holds')+' '+(x.t0||'—')+' · '+pw('railholds')+' '+(x.rail_read||'—')+' · '+(x.ok?pw('agrees'):pw('differs')+' ('+x.failed.join(', ')+')'))])))]):el('p','sub',pw('recon_none'));
  const mis=(P.refusals||[]).length?el('div','',[el('h3','',pw('misuse_h')),el('ul','plain',P.refusals.map((x)=>el('li','sub',x.what+' · '+x.code)))]):null;
  host.append(el('section','card panel prbooks'+(R&&!R.ok?' bad':''),[el('div','th',[el('h2','',[ic('landmark'),' '+pw('booked_h')]),prLabel(P)]),el('p','sub',pw('booked_sub')),tbl,recon,mis,prLinks(P)].filter(Boolean)));
}
`;

export const PARTNER_VIEW_CSS = `
.prblock { margin-top: 12px; display: grid; gap: 6px; }
.prtok { display: grid; gap: 4px; }
.prtok.off { opacity: .75; }
.prtk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.prwallet { margin-top: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.prbooks { border-left: 4px solid var(--ok, #067647); display: grid; gap: 8px; margin-top: 16px; }
.prbooks.bad { border-left-color: var(--bad, #b42318); }
.prbooks .says { font-weight: 650; margin: 0; }
.prpays { display: grid; gap: 10px; margin: 0; padding: 0; }
.prpays > li { border: 1px solid var(--line, #e4e7ec); border-radius: 10px; padding: 10px 12px; display: grid; gap: 6px; }
.prph { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.prkvs { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.prkv { display: grid; min-width: 0; }
.prkv small { opacity: .7; font-size: 12px; }
.prkv b { font-weight: 600; overflow-wrap: anywhere; }
.prrec ul.prrl > li.prrli { display: flex; gap: 6px; align-items: flex-start; }
.prrec ul.prrl > li.prrli > svg, .prrec ul.prrl > li.prrli > i { flex: none; margin-top: 3px; }
`;
