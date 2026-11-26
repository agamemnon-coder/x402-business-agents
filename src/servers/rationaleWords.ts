// A payment's rationale record (src/payouts/rationale.ts) in plain words, for the invoice's page: one sentence each for
// the funding, the rail, the rule, the approval, a replacement and a refusal. Every value in them is the record's; only
// the connecting words are written here. It runs in the browser (src/servers/payablesPage.ts puts this source in the
// page's script), so it is plain JavaScript without helpers; test/payment-rationale.test.ts runs the same text. Its
// labels are here too, in both languages, so the shared word catalogue (src/ui/i18n.ts, in Purser Cloud's bundle) does
// not carry them.

export const RATIONALE_WORDS_JS = `const WHY_LABELS={
  en:{why:'Why it was paid this way',entity:'Paying entity',funding:'Paid from',rail:'Rail',rule:'Rule',approval:'Approval',replaced:'Replaced',refused:'Refused',policy:'CFO policy v',none:'No approval recorded',executed:'paid or on its way',failed:'failed at Airwallex',stopped:'refused by Purser'},
  nl:{why:'Waarom zo betaald',entity:'Betalende entiteit',funding:'Betaald uit',rail:'Route',rule:'Regel',approval:'Goedkeuring',replaced:'Vervangen',refused:'Geweigerd',policy:'CFO-beleid v',none:'Geen goedkeuring vastgelegd',executed:'betaald of onderweg',failed:'mislukt bij Airwallex',stopped:'geweigerd door Purser'}};
function rationaleWords(r){
  var f=r.funding,c=f.conversion,cur=r.currency,acct=f.account?' of '+f.account:'',rl=r.rail,ru=r.rule,a=r.approval;
  var to=rl.to||"the supplier's account",h=a?' (hash '+a.terms_sha256.slice(0,8)+')':'';
  return {
    funding:c?'Paid '+cur+' from the '+cur+' balance'+acct+' after buying '+c.buy+' with '+c.sell+' at '+c.rate+' (quote '+c.quote_id+'): the '+cur+' balance held '+cur+' '+f.balance+' with a floor of '+cur+' '+f.floor+', short of '+cur+' '+r.amount+' and its fee; only the shortfall was bought'
      :'Paid '+cur+' from the '+cur+' balance'+acct+', no conversion: it held '+cur+' '+f.balance+', enough for '+cur+' '+r.amount+' and its fee above the floor of '+cur+' '+f.floor,
    rail:(rl.method==='LOCAL'?'LOCAL'+(rl.clearing?' ('+rl.clearing+')':'')+': '+to+' takes '+cur+' on a local route, so it is not sent by SWIFT; '+rl.fee_held+' held back for the fee'
      :r.kind==='invoice_payment'?'SWIFT: the euro route to '+to+'; at most '+rl.fee_held+' for the fee'
      :'SWIFT: Airwallex has no local route for '+cur+' to '+to+'; '+rl.fee_held+' held back for the fee')+(rl.fee_charged?'; Airwallex charged '+rl.fee_charged:''),
    rule:ru.by_code?(ru.note||'within the limit to pay alone ('+ru.key+' '+ru.value+')')
      :!a?'no approval is recorded: nothing may be paid'
      :ru.value?'an agent may pay a supplier invoice alone up to EUR '+ru.value+' ('+ru.key+'); this one was not paid alone, so a person decided it'
      :'no limit to pay alone is set ('+ru.key+'), so a person decides every supplier payment',
    approval:!a?'':a.decision!=='APPROVED'?a.by+' rejected the terms'+h:ru.by_code?"approved by Purser's code under the CFO's rule, on the exact terms"+h:a.by+' approved the exact terms'+h+' by '+(a.method==='passkey'?'passkey (Face ID)':a.method),
    replacement:r.replacement&&r.transfer?'the first transfer '+(r.transfer.transfer_id||r.transfer.request_id)+' failed at Airwallex ('+(r.transfer.failure_type||r.transfer.status)+'); one replacement under a new request_id, on the same approved terms: '+r.replacement.status:'',
    refused:r.refused||''
  };
}`;
