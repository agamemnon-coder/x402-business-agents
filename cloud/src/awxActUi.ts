// Purser Cloud's console: the Airwallex actions (14 Nov). Kept in its own file and appended to the console's script, so
// the console's own pages change in four places only (cloud/src/console.ts, cloud/src/consoleUi.ts):
//   awxCard(id)          on an invoice: which bank, the payee's beneficiary id, the payee's bank check, the quote and the
//                        conversion for a shortfall, the transfer (id in full, copyable, its status live), the labels
//   awxSupplier(i, show) on an invoice waiting for a new supplier: the owner's check, then the CFO's passkey
//   awxBar(o)            on Invoices: "Pay all ready" (one batch, one signature) and "Money in" (a deposit simulation)
//   awxBankNote(id)      in the payment card: which bank this payment runs at, in place of the fixed stand-in line
// Everything is test money: the Airwallex sandbox or the simulated bank. A guest (read only) sees what was recorded and
// no button. Words are short and plain; English, and Dutch where the person chose it.

export const AWX_CSS = `
.awx dl.read dd.mono { word-break: break-all; }
.awx .badge-awx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #eef4ff; color: #1d3f8f; }
.awx .badge-sim { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #f2f4f7; color: #344054; }
.awx .idrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.awx .idrow code { font-size: 12px; word-break: break-all; }
.awx ul.awx-notes { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: #475467; }
.awx-form { display: grid; gap: 8px; margin-top: 8px; }
.awx-form label { display: grid; gap: 4px; font-size: 13px; }
.awx-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.awx-bar input.field { width: 110px; }
@media (max-width: 600px) { .awx-bar { flex-direction: column; align-items: stretch; } .awx-bar input.field { width: 100%; } }
`;

export const AWX_JS = String.raw`
// --- Airwallex actions (cloud/src/awxActUi.ts) ----------------------------------------------------------------------
const AWX_W={
  en:{h:'Airwallex',awx:'Airwallex sandbox · test money',sim:'Simulated bank · test money',not_yet:'Not planned yet.',
    payee:'Payee (beneficiary id)',payee_bank:'Payee at',twin:'Twin at the simulated bank',check:'Payee bank check',quote:'Quote (shortfall only)',rate:'Rate',valid:'Valid until',
    conv:'Conversion',tr:'Transfer id',req:'Request id',hash:'Signed terms (SHA-256)',status:'Status',batch:'Batch',follow:'Follow the status',
    copy:'Copy',copied:'Copied',guest:'Read only. Airwallex actions run in a signed-in test company.',off:'Airwallex is off now: ',caps:'Used today at Airwallex: ',of:' of ',
    sup_h:'New supplier',sup_lede:'Confirm the account on a contact you already had. Then Purser asks the payee\'s bank whether the account carries the supplier\'s name, and the CFO signs the new supplier with a passkey.',
    how:'How you confirmed it (who, which number from your own records)',street:'Street',city:'City',postcode:'Postcode',sup_go:'Check and file for the CFO',
    pay_all:'Pay all ready',pay_all_none:'No invoice is ready to pay.',money_in:'Money in',amount:'Amount (USD)',in_go:'Simulate a deposit',
    batch_lede:'One signature over the batch total and every line.',sign:'Approve with passkey',in_ok:'Deposit booked: ',
    test_money:'Test money · see the bank below',
    foot:'Purser Cloud · test money only: each payment runs at the Airwallex sandbox or on the simulated bank, approved with a passkey over the exact terms. No real money moves.',
    chip_title:'Test money only: payments run at the Airwallex sandbox or on the simulated bank inside Purser. No real money moves.',
    stand_awx:'This payment runs at the Airwallex sandbox, with test money. Nothing real is paid.',
    stand_sim:'This payment runs on the simulated bank inside Purser, with test money.'},
  nl:{h:'Airwallex',awx:'Airwallex-sandbox · testgeld',sim:'Nagebootste bank · testgeld',not_yet:'Nog niet gepland.',
    payee:'Begunstigde (beneficiary id)',payee_bank:'Begunstigde bij',twin:'Tweeling bij de nagebootste bank',check:'Controle bij de bank van de begunstigde',quote:'Koers (alleen het tekort)',rate:'Koers',valid:'Geldig tot',
    conv:'Omwisseling',tr:'Transfer-id',req:'Request-id',hash:'Getekende voorwaarden (SHA-256)',status:'Status',batch:'Batch',follow:'Volg de status',
    copy:'Kopieer',copied:'Gekopieerd',guest:'Alleen lezen. Airwallex-acties lopen in een ingelogd testbedrijf.',off:'Airwallex staat nu uit: ',caps:'Vandaag gebruikt bij Airwallex: ',of:' van ',
    sup_h:'Nieuwe leverancier',sup_lede:'Bevestig de rekening via een contact dat u al had. Dan vraagt Purser de bank van de begunstigde of de rekening op naam van de leverancier staat, en tekent de CFO de nieuwe leverancier met een passkey.',
    how:'Hoe u het bevestigde (wie, welk nummer uit uw eigen administratie)',street:'Straat',city:'Plaats',postcode:'Postcode',sup_go:'Controleer en leg voor aan de CFO',
    pay_all:'Betaal alles wat klaarstaat',pay_all_none:'Geen factuur staat klaar om te betalen.',money_in:'Geld in',amount:'Bedrag (USD)',in_go:'Simuleer een storting',
    batch_lede:'Eén handtekening over het totaal en elke regel.',sign:'Goedkeuren met passkey',in_ok:'Storting geboekt: ',
    test_money:'Testgeld · zie de bank hieronder',
    foot:'Purser Cloud · alleen testgeld: elke betaling loopt via de Airwallex-sandbox of de nagebootste bank, goedgekeurd met een passkey over de precieze voorwaarden. Er beweegt geen echt geld.',
    chip_title:'Alleen testgeld: betalingen lopen via de Airwallex-sandbox of de nagebootste bank binnen Purser. Er beweegt geen echt geld.',
    stand_awx:'Deze betaling loopt via de Airwallex-sandbox, met testgeld. Er wordt niets echts betaald.',
    stand_sim:'Deze betaling loopt via de nagebootste bank binnen Purser, met testgeld.'}};
// When this company's Airwallex actions are on, the engine's fixed words about the stand-in bank no longer hold for
// every payment: the footer, the chip and the "At work" lines say "the bank", and the Airwallex card says which one.
var AWX_ON=false;
function awxLine(x){if(!AWX_ON||!x||typeof x.text!=='string')return x;return {...x,text:x.text.replace(/\bthe stand-in bank\b/g,'the bank').replace(/\bThe stand-in bank\b/g,'The bank').replace(/\bde nagebootste bank\b/g,'de bank').replace(/\bDe nagebootste bank\b/g,'De bank')}}
// The footer and the chip's title, in Airwallex's words while this company's Airwallex actions are on.
function awxWords(){if(!AWX_ON)return;try{const f=$('#foot');if(f&&ENG_ON)f.textContent=aw('foot');const c=$('.appbar .test');if(c&&ENG_ON)c.title=aw('chip_title')}catch(x){}}
const aw=(k)=>((AWX_W[L.lang]||AWX_W.en)[k]??AWX_W.en[k]??k);
const AWX={p:null,token:null};
function awxView(fresh){if(AWX.token!==S.token){AWX.token=S.token;AWX.p=null}
  if(fresh||!AWX.p){AWX.p=api('/v1/engine/airwallex').catch((e)=>{if(e instanceof Expired)throw e;return null});
    AWX.p.then((v)=>{AWX_ON=!!(v&&v.airwallex&&v.airwallex.on);awxWords()},()=>undefined)}
  return AWX.p}
const awxBadge=(bank)=>el('span',bank==='airwallex'?'badge-awx':'badge-sim',[ic(bank==='airwallex'?'landmark':'flask'),aw(bank==='airwallex'?'awx':'sim')]);
const awxCopy=(text)=>{const b=btn(aw('copy'),'mini','copy');b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.replaceChildren(ic('circle-check'),aw('copied'))}catch(x){}};return b};
const awxId=(id)=>id?el('span','idrow',[el('code','mono',id),awxCopy(id)]):null;
const AWX_DONE=['PAID','FAILED','CANCELLED','APPROVAL_REJECTED'];
// One invoice's Airwallex record. Its status is followed while the transfer is on its way (every 4 s, at most 10 times).
function awxCard(id){
  const box=el('section','card panel awx');box.id='airwallex';
  let tries=0;
  async function draw(fresh){
    let v;try{v=await awxView(fresh)}catch(e){if(e instanceof Expired)return;v=null}
    if(!box.isConnected&&tries>0)return;
    if(!v){box.replaceChildren(el('h2','',aw('h')),note(aw('guest')));return}
    const r=(v.invoices||[]).find((x)=>x.invoice_id===id);
    const kids=[el('h2','',[aw('h'),' ',r&&r.bank?awxBadge(r.bank):null])];
    if(!v.airwallex.on)kids.push(note(aw('off')+(v.airwallex.why||''),'warn'));
    if(!r||(!r.payee&&!r.transfer)){kids.push(el('p','sub',aw('not_yet')));box.replaceChildren(...kids);return}
    const pairs=[];
    if(r.payee){pairs.push([aw('payee'),awxId(r.payee.beneficiary_id)]);pairs.push([aw('payee_bank'),awxBadge(r.payee.bank)]);if(r.payee.twin)pairs.push([aw('twin'),awxId(r.payee.twin)])}
    if(r.name_check)pairs.push([aw('check'),r.name_check.code+(r.name_check.match?' · '+r.name_check.match:'')+' — '+r.name_check.label]);
    if(r.quote){pairs.push([aw('quote'),awxId(r.quote.quote_id)]);pairs.push([aw('rate'),r.quote.pair+' '+r.quote.rate+' · '+r.quote.sell+' → '+r.quote.buy]);pairs.push([aw('valid'),r.quote.valid_to])}
    if(r.conversion)pairs.push([aw('conv'),r.conversion.conversion_id?el('span','',[awxId(r.conversion.conversion_id),' ',r.conversion.status||'']):r.conversion.request_id]);
    if(r.transfer){pairs.push([aw('tr'),r.transfer.transfer_id?awxId(r.transfer.transfer_id):'—']);pairs.push([aw('status'),el('b','',r.transfer.status||'—')]);pairs.push([aw('req'),awxId(r.transfer.request_id)]);pairs.push([aw('hash'),awxId(r.transfer.approval_sha256)])}
    if(r.batch)pairs.push([aw('batch'),r.batch.batch_id+(r.batch.awx_batch_id?' · '+r.batch.awx_batch_id:'')+(r.batch.status?' · '+r.batch.status:'')]);
    kids.push(dl(pairs));
    if(r.notes&&r.notes.length)kids.push(el('ul','awx-notes',r.notes.map((n)=>el('li','',n.label))));
    const live=r.transfer&&r.transfer.transfer_id&&!AWX_DONE.includes(r.transfer.status||'');
    if(live&&ME&&!ME.demo){const b=btn(aw('follow'),'', 'arrow-right');b.onclick=async()=>{b.disabled=true;try{await engineCall('/v1/engine/sync',{method:'POST'});await draw(true)}catch(e){if(!(e instanceof Expired))b.after(note(e.message,'bad'))}finally{b.disabled=false}};kids.push(el('div','acts',[b]))}
    box.replaceChildren(...kids);
    if(live&&tries<10){tries++;setTimeout(()=>{if(box.isConnected)engineCall('/v1/engine/sync',{method:'POST'}).then(()=>draw(true),()=>undefined)},4000)}
  }
  box.append(el('h2','',aw('h')),el('p','sub',t('loading')));tries=0;draw(true).then(()=>{tries=tries||0});
  return box}
// Which bank this payment runs at, in the payment card (the fixed stand-in line until the record says otherwise).
function awxBankNote(id){
  const n=note(t('cs.eng.stand_in'));
  awxView(true).then((v)=>{const r=v&&(v.invoices||[]).find((x)=>x.invoice_id===id);if(r&&r.bank==='airwallex')n.textContent=aw('stand_awx')},()=>undefined);
  return n}
// A new supplier from an invoice waiting for one: the owner's own check, then the payee's bank, then the CFO's passkey.
function awxSupplier(i,show){
  const box=el('div','awx-form');const said=el('div','');said.setAttribute('role','status');
  const field=(label,name,max)=>{const inp=el('input','field');inp.name=name;inp.maxLength=max;inp.autocomplete='off';return [el('label','',[label,inp]),inp]};
  const [lh,how]=field(aw('how'),'how',300),[ls,street]=field(aw('street'),'street',120),[lc,city]=field(aw('city'),'city',80),[lp,pc]=field(aw('postcode'),'postcode',20);
  const go=btn(aw('sup_go'),'primary','shield-check');
  go.onclick=async()=>{if(go.disabled)return;go.disabled=true;said.replaceChildren();
    try{const r=await engineCall('/v1/engine/invoices/'+encodeURIComponent(i.id)+'/supplier',{method:'POST',body:{how:how.value,street:street.value,city:city.value,postcode:pc.value}});
      AWX.p=null;show(r.proposal,r.name_check?note(aw('check')+': '+r.name_check.code+(r.name_check.match?' · '+r.name_check.match:'')+' — '+r.name_check.label,r.name_check.source==='airwallex'?'ok':'info'):null)}
    catch(e){if(!(e instanceof Expired))said.replaceChildren(note(e.message,'bad'))}finally{go.disabled=false}};
  box.append(el('h3','',aw('sup_h')),el('p','sub',aw('sup_lede')),lh,ls,lc,lp,el('div','acts',[go]),said);
  return box}
// Sign a proposal with the approval passkey (the same ceremony as the payment card), then answer what the engine says.
async function awxSign(p){
  const eng=await engineStatus();
  if(!eng||!eng.passkey)throw new Error(t('cs.eng.setup'));
  const c=await navigator.credentials.get({publicKey:{challenge:fromB64u(p.challenge),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:fromB64u(eng.passkey.credential_id)}],userVerification:'required',timeout:120000}});
  return engineCall('/v1/engine/proposals/'+encodeURIComponent(p.id)+'/approve',{method:'POST',body:{terms_sha256:p.terms_sha256,credential:signedOf(c)}})}
// On Invoices: Pay all ready (one batch, one signature) and Money in (a deposit on the bank's simulation). Owners only.
function awxBar(o){
  const bar=el('div','card panel awx');const said=el('div','');said.setAttribute('role','status');
  const all=btn(aw('pay_all'),'primary','wallet');
  all.onclick=async()=>{if(all.disabled)return;all.disabled=true;said.replaceChildren();
    try{const ev=await api('/v1/engine/invoices');const ids=(ev.items||[]).filter((x)=>x.payable&&x.status==='ready').map((x)=>x.id).slice(0,20);
      if(!ids.length){said.replaceChildren(note(aw('pay_all_none')));return}
      const r=await engineCall('/v1/engine/batch',{method:'POST',body:{invoice_ids:ids}});AWX.p=null;
      const p=r.proposal;const sign=btn(aw('sign'),'primary','scan-face');
      sign.onclick=async()=>{sign.disabled=true;try{const a=await awxSign(p);said.replaceChildren(note(a.message,a.status==='approved'?'ok':'bad'));if(a.settled&&a.settled.error)said.append(note(a.settled.error,'warn'));AWX.p=null;await o.reload()}
        catch(e){if(!(e instanceof Expired))said.append(note(e&&e.name==='NotAllowedError'?t('cs.eng.cancelled'):e.message,'bad'))}finally{sign.disabled=false}};
      said.replaceChildren(el('p','sub',aw('batch_lede')),dl([...(p.facts||[]).slice(0,6),[t('cs.eng.terms_hash'),p.terms_sha256,'mono']]),...(r.not_planned||[]).map((x)=>note(x.id+': '+x.reason,'warn')),el('div','acts',[sign]))}
    catch(e){if(!(e instanceof Expired))said.replaceChildren(note(e.message,'bad'))}finally{all.disabled=false}};
  const amt=el('input','field');amt.value='10.00';amt.inputMode='decimal';amt.setAttribute('aria-label',aw('amount'));amt.maxLength=6;
  const inn=btn(aw('in_go'),'','arrow-down-left');
  inn.onclick=async()=>{if(inn.disabled)return;inn.disabled=true;said.replaceChildren();
    try{const r=await engineCall('/v1/engine/deposit',{method:'POST',body:{amount:amt.value.trim()}});AWX.p=null;const v=await awxView(true);const d=v&&(v.deposits||[]).find((x)=>x.deposit_id===r.deposit_id);
      said.replaceChildren(note(aw('in_ok')+r.currency+' '+r.amount+' · ','ok'));said.firstChild.append(el('code','mono',r.deposit_id),' · ',d?awxBadge(d.bank):'');await o.reload()}
    catch(e){if(!(e instanceof Expired))said.replaceChildren(note(e.message,'bad'))}finally{inn.disabled=false}};
  bar.append(el('h2','',aw('h')),el('div','awx-bar',[all,el('span','sub',aw('money_in')),amt,inn]),said);
  awxView(true).then((v)=>{if(!v)return;if(!v.airwallex.on)bar.insertBefore(note(aw('off')+(v.airwallex.why||''),'warn'),bar.children[1]);
    if(v.caps)bar.insertBefore(el('p','sub',aw('caps')+(v.caps.company_used_cents/100).toFixed(2)+aw('of')+(v.caps.company_cents_day/100).toFixed(2)),bar.children[1])},()=>undefined);
  return bar}
`;
