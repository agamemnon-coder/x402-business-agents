// The hands-on page's last step before the visitor's company (screen 6): "What Purser did with it". After the payment,
// the engine's own records of this visitor's test company, one after another, each with a short animation (none when
// the visitor asks for reduced motion):
//   1. Filed    the invoice's PDF in its folder of the archive: the folder and the file name, as GET /v1/engine/vault lists them
//   2. Booked   the journal lines of the invoice (expense, VAT, creditors) and of the payment (creditors, bank), as
//               GET /v1/ledger/entries holds them, each line named by its account's role; "debits = credits" only
//               when the lines' own sums agree; the VAT line's role in the text colour, its amount aligned like every other
//   3. Matched  the payment linked to the invoice (the read model's payment and the transactions register), with its
//               status and reference
//   4. Next     three links: Purser Cloud, the live runs, how it stays safe
// Nothing is invented: every line comes from an answer; what an answer does not hold is left out, or said to be not in
// yet. The page (cloud/src/tryPage.ts) registers this screen with one hook, between screen 5 and screen 6.
import { accountType, FOREIGN_VAT, INPUT_VAT, isBank, LEDGER_ACCOUNTS, PAYABLES } from "../../../src/ledger/accounts.js";

/** The words, all of them (the word budget is held by test/try-books.test.ts: at most 45 outside the data). */
export const DID = {
  heading: "What Purser did with it",
  label: "Test company · simulated bank",
  filed: "Filed",
  booked: "Booked",
  matched: "Matched",
  balanced: "Balances: debits = credits",
  debit: "Debit",
  credit: "Credit",
  vat: "VAT",
  invoice: "Invoice",
  payment: "Payment",
  roles: { expense: "expense", vat: "VAT", creditors: "creditors", bank: "bank" },
  notIn: "Not in yet.",
  cloud: "See Purser Cloud",
  runs: "See the live runs",
  safe: "How it stays safe",
  company: "Your company",
} as const;

/** The site's pages the last step links to (kit11, package.json's homepage). */
export const LIVE_RUNS_URL = "https://kit11.max-31b.workers.dev/runs";
export const SECURITY_URL = "https://kit11.max-31b.workers.dev/security";
/** Purser Cloud's own start page on this deployment: a try session cannot open the console's pages (cloud/src/try/gate.ts). */
export const CLOUD_URL = "/";

export type Role = keyof typeof DID.roles;
/** An account's role in the invoice's and the payment's entries, by the chart (src/ledger/accounts.ts); else null. */
export function roleOf(account: string): Role | null {
  if (account === PAYABLES) return "creditors";
  if (account === INPUT_VAT || account === FOREIGN_VAT) return "vat";
  if (isBank(account)) return "bank";
  return accountType(account) === "expense" ? "expense" : null;
}

/** The chart as the page needs it: each account's name and role. */
export const ACCOUNTS_FOR_PAGE: Record<string, { name: string; role: Role | null }> = Object.fromEntries(
  Object.entries(LEDGER_ACCOUNTS).map(([a, name]) => [a, { name, role: roleOf(a) }]),
);

/**
 * The screen's pure helpers, as plain script (no backticks, no "${"): test/try-books.test.ts runs this text in Node.
 *   didKit.folderOf(path), didKit.lines(entries, accounts): each entry as { kind: "invoice" | "payment", description,
 *   lines: [{ account, name, role, debit, credit, currency }] }, the accrual first; didKit.even(entries): debits equal
 *   credits per currency, from the lines (and at least one line).
 */
export const DID_KIT_JS = String.raw`
const didKit=(()=>{
  const folderOf=(p)=>{const s=String(p||'');const i=s.lastIndexOf('/');return i>0?s.slice(0,i+1):''};
  const lines=(es,acc)=>(es||[]).map((e)=>({kind:String(e.source_key||'').split('@')[0].indexOf('ap-accrual|')===0?'invoice':'payment',description:String(e.description||''),
    lines:(e.lines||[]).map((l)=>{const a=acc[l.account]||{};return {account:String(l.account||''),name:a.name||'',role:a.role||null,debit:Number(l.debit_cents)||0,credit:Number(l.credit_cents)||0,currency:String(l.currency||'')}})}))
    .sort((a,b)=>a.kind===b.kind?0:a.kind==='invoice'?-1:1);
  const even=(es)=>{const d={},c={};let n=0;for(const e of es||[])for(const l of e.lines||[]){n++;d[l.currency]=(d[l.currency]||0)+(Number(l.debit_cents)||0);c[l.currency]=(c[l.currency]||0)+(Number(l.credit_cents)||0)}
    return n>0&&Object.keys(Object.assign({},d,c)).every((k)=>(d[k]||0)===(c[k]||0))};
  return {folderOf,lines,even};
})();
`;

/**
 * The screen, as plain script run inside the page's own (it uses the page's el, icon, api, everyPage, booksKit, fill,
 * note, words, btn, mainButton, screen, show and S). Each block is drawn when its read is back; the next one waits its turn.
 */
export const DID_SCREEN_JS = String.raw`
screen('did',{heading:DIDC.heading,draw(box){
  const D=DIDC;const invId=S.proposal&&S.proposal.invoice;
  const main=mainButton();main.set(D.company,()=>show('company'));
  const slot=(n)=>{const s=el('section','did-step');s.style.setProperty('--i',String(n));return s};
  const filed=slot(0),booked=slot(1),matched=slot(2);
  const head=(name,words)=>el('p','did-h',[icon(name,18),el('span','',words)]);
  const not=()=>el('p','muted',D.notIn);
  const link=(words,href,ext)=>{const a=el('a','btn did-next',[el('span','',words),ext?icon('external-link',14):null]);a.href=href;if(ext){a.target='_blank';a.rel='noopener'}return a};
  const next=el('div','did-step did-acts',[link(D.cloud,DIDURL.cloud,false),link(D.runs,DIDURL.runs,true),link(D.safe,DIDURL.safe,true)]);next.style.setProperty('--i','3');
  box.append(el('p','did-label',D.label),filed,booked,matched,next,main.node);
  const invs=api('GET','/v1/engine/invoices').then((r)=>{const items=r.status===200&&Array.isArray(r.json.items)?r.json.items:[];return {items,i:items.find((x)=>x&&x.id===invId)||null}});
  // 1 Filed: the original invoice's folder and name in the archive.
  Promise.all([invs,api('GET','/v1/engine/vault')]).then(([v,r])=>{
    if(S.screen!=='did')return;
    const fs=v.i&&r.status===200&&Array.isArray(r.json.files)?booksKit.filesOf(v.i,r.json.files,v.items):null;
    const f=fs&&fs.original;
    filed.replaceChildren(head('file-check',D.filed),f?el('p','did-file',[el('span','did-folder mono',[icon('file-lock-2',16),didKit.folderOf(f.path)]),el('span','did-doc mono',[icon('file-text',16),booksKit.fileName(f.path)])]):not());
    filed.classList.add('in');
  });
  // 2 Booked and 3 Matched: the read model's own rows for this invoice.
  Promise.all([invs,everyPage('/v1/payments'),everyPage('/v1/transactions'),everyPage('/v1/ledger/entries')]).then(([v,ps,txs,es])=>{
    if(S.screen!=='did')return;
    const p=v.i&&ps.items?booksKit.paymentOf(v.i,ps.items,txs.items||[]):null;
    const mine=v.i&&es.items?booksKit.entriesOf(v.i,p,txs.items||[],es.items):[];
    if(!mine.length){booked.replaceChildren(head('database',D.booked),not())}
    else{
      const tb=el('tbody');
      for(const e of didKit.lines(mine,DIDACC)){
        const h=el('td','en',(e.kind==='invoice'?D.invoice:D.payment)+' · '+e.description);h.colSpan=3;tb.append(el('tr','',[h]));
        for(const l of e.lines){const role=l.role?D.roles[l.role]:l.name;
          tb.append(el('tr',l.role==='vat'?'vatl':'',[el('td','',[el('span','mono',l.account),' ',el('span','role',role)]),el('td','r',l.debit?booksKit.money(l.currency,booksKit.fromCents(l.debit)):''),el('td','r',l.credit?booksKit.money(l.currency,booksKit.fromCents(l.credit)):'')]))}}
      const ok=didKit.even(mine);
      booked.replaceChildren(head('database',D.booked),el('div','scroll',el('table','lines did-lines',[el('thead','',el('tr','',[el('th','',''),el('th','r',D.debit),el('th','r',D.credit)])),tb])),ok?el('p','bal ok',[icon('check',16),el('span','',D.balanced)]):null);
    }
    booked.classList.add('in');
    if(p&&booksKit.isPaid(p))matched.replaceChildren(head('circle-check',D.matched),el('p','did-match',[el('span','pill ok',String(p.status)),' ',el('span','mono',String(p.invoice_no||'')),' ',el('span','',booksKit.money(p.currency,p.amount))]));
    else matched.replaceChildren(head('circle-check',D.matched),not());
    matched.classList.add('in');
    next.classList.add('in');
  });
}});
`;

/** The screen's look: each step slides in after the one before; with reduced motion, it is simply there. */
export const DID_CSS = `
.did-label { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
.did-step { opacity: 0; transform: translateY(8px); margin: 0 0 14px; }
.did-step.in { opacity: 1; transform: none; transition: opacity .35s ease, transform .35s cubic-bezier(.2,.7,.2,1); transition-delay: calc(var(--i, 0) * 180ms); }
.did-h { display: flex; gap: 8px; align-items: center; margin: 0 0 6px; font-weight: 650; }
.did-file { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; overflow-wrap: anywhere; }
.did-folder, .did-doc { display: inline-flex; gap: 6px; align-items: center; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); font-size: 13px; }
.did-step.in .did-doc { animation: did-drop .6s cubic-bezier(.2,.7,.2,1) both; animation-delay: .15s; }
@keyframes did-drop { from { transform: translate(-14px, -10px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
.did-step .role { color: var(--muted); font-size: 12.5px; }
.did-lines { table-layout: fixed; width: 100%; }
.did-lines td.r, .did-lines th.r { text-align: right; padding-right: 0; font-weight: 400; }
.did-lines th:nth-child(2), .did-lines th:nth-child(3) { width: 34%; }
.did-match .mono { font-size: 13px; }
.did-step tr.vatl .role { color: var(--fg); }
.did-match { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.did-acts { display: grid; gap: 8px; }
.did-acts .did-next { display: inline-flex; justify-content: center; gap: 6px; text-decoration: none; }
@media (prefers-reduced-motion: reduce) {
  .did-step, .did-step.in { opacity: 1; transform: none; transition: none; }
  .did-step.in .did-doc { animation: none; }
}
`;

/** The script's constants, set before DID_SCREEN_JS runs: the words, the links and the chart. */
export function didGlobals(json: (v: unknown) => string): string {
  return `const DIDC=${json(DID)};const DIDURL=${json({ cloud: CLOUD_URL, runs: LIVE_RUNS_URL, safe: SECURITY_URL })};const DIDACC=${json(ACCOUNTS_FOR_PAGE)}`;
}
