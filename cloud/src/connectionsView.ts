// Purser Cloud's Connections page (20 Nov, the owner: "Purser connects to everything and everyone, findable in Purser
// Cloud"; 21 Nov: its own tab, one card per connection). The list GET /v1/connections returns (cloud/src/connections.ts),
// grouped as the hub groups it (docs/integrations/README.md). Each card: a mark, the name, its honest label (live,
// sandbox, testnet, format export, built and not tested live, run once in a sandbox, planned), one line on what it does
// (the rest folded), where it stands for THIS company (GET /v1/connections/mine, when the reader may see it), what a
// company needs to connect it, and its guide and dated run record. Buttons only where the console really does something
// (o.action, cloud/src/console.ts); nothing here claims more than the catalogue's label.
//
// One implementation serves the console and its test: CONNECTIONS_VIEW_JS is plain script the console carries as it is
// (cloud/src/console.ts puts it in at __UI__), and test/connections-hub.test.ts runs the same text with a stand-in for
// the page's el(). It builds elements only through el() and sets text as text; it calls nothing and reads no clock.

export const CONNECTIONS_VIEW_JS = String.raw`
// --- Connections ----------------------------------------------------------------------------------------------------
const CX_GROUPS=['rails','ai','api','no-code','accounting','more'];
const cxSlug=(s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
// The label's colour: live green, test money (sandbox, testnet, a run once in a sandbox) blue, built and not yet tried
// live amber, a file in another product's format and planned grey.
const CX_TONE={live:'ok',sandbox:'tmoney',testnet:'tmoney',built_run_once_in_a_sandbox:'tmoney',built_not_tested_live:'warn',planned:'plan'};
// Each card's mark: letters for a named product (no borrowed logo), an icon for Purser's own ways in and out.
const CX_MARK={airwallex:'Aw',alta:'Al','visa-airi':'V',t0:'T:0',claude:'C',chatgpt:'G',cursor:'Cu',vscode:'VS',gemini:'Ge',windsurf:'W','awx-codemode':'Aw',
  'xero-csv':'X','xero-runner':'X',xero:'X','quickbooks-csv':'QB',quickbooks:'QB','exact-csv':'E',exact:'E',moneybird:'Mb','bc-odoo':'BC','zapier-make':'Z',n8n:'n8n','slack-teams':'S·T',
  'peppol-ubl':'P','peppol-network':'P',iso20022:'ISO'};
const CX_ICON={mcp:'bot','agent-api':'credit-card',rest:'link-2',webhook:'zap',sdks:'file-text',a2a:'sparkles',inbox:'mail','sign-in':'key-round',alerts:'scan-face',workplace:'users',export:'download'};
// Where a connection stands for this company, from the rows of GET /v1/connections/mine it names: connected when one of
// them is, not offered when none of them is offered on this cloud, else not connected (the company can switch it on).
function cxHere(ids,mine){
  if(!mine||!ids||!ids.length)return null;
  const rows=mine.filter((x)=>ids.includes(x.id));if(!rows.length)return null;
  const on=rows.filter((x)=>x.status==='connected');
  return {status:on.length?'connected':rows.every((x)=>x.status==='not_available')?'not_available':'not_connected',detail:on.map((x)=>x.detail).filter(Boolean).join(' · ')||null}}
// The first sentence on the card; the rest, word for word, one click away.
function cxSplit(s){const m=/^(.+?[.!?])\s+(\S[^]*)$/.exec(String(s||''));return m?[m[1],m[2]]:[String(s||''),'']}
function connectionsViewOf(cat,t,tk,el,o){
  o=o||{};const mine=o.mine||null;
  const link=(href,text)=>{if(!/^https?:\/\//.test(String(href||'')))return null;const a=el('a','',text+' ↗');a.href=href;a.target='_blank';a.rel='noopener';return a};
  const all=[].concat(cat.money||[],cat.connections||[]);const planned=cat.planned||[];
  const n=(f)=>all.filter(f).length;
  const here=mine?all.filter((x)=>{const h=cxHere(x.company,mine);return h&&h.status==='connected'}).length:null;
  const stat=(v,label,tone)=>el('div','cx-stat'+(tone?' '+tone:''),[el('b','num',String(v)),el('span','',label)]);
  const sum=el('div','cx-sum',[here===null?null:stat(here,t('cs.cx.sum.here'),'here'),stat(n((x)=>x.kind==='live'),t('cs.cx.sum.live'),'ok'),
    stat(n((x)=>['sandbox','testnet','built, run once in a sandbox'].includes(x.kind)),t('cs.cx.sum.test'),'tmoney'),stat(n((x)=>x.kind==='format export'),t('cs.cx.sum.file'),''),
    stat(n((x)=>x.kind==='built, not tested live'),t('cs.cx.sum.built'),'warn'),stat(planned.length,t('cs.cx.sum.planned'),'plan')]);
  const kids=[el('h2','',t('cs.cx.title')),el('p','',t('cs.cx.lede')),sum,el('p','sub cx-links',[link(cat.connect_ai,t('cs.claude.guide')),' · ',link(cat.hub,t('cs.cx.hub'))])];
  const card=(x,kind)=>{
    const k=cxSlug(kind),tone=CX_TONE[k],h=cxHere(x.company,mine),[first,rest]=cxSplit(x.what);
    const mark=CX_ICON[x.id]&&o.icon?el('span','cx-mark ic-mark g-'+cxSlug(x.group),[o.icon(CX_ICON[x.id])]):el('span','cx-mark g-'+cxSlug(x.group),CX_MARK[x.id]||String(x.name||'?').slice(0,2));
    return el('li','cx-card'+(h&&h.status==='connected'?' on':'')+(k==='planned'?' planned':''),[
      el('div','cx-top',[mark,el('div','cx-nm',[el('b','',x.name),el('span','pill'+(tone?' '+tone:''),tk('cs.cx.kind.'+k,kind))])]),
      el('p','cx-what',first),rest?el('details','cx-more',[el('summary','',t('cs.cx.more')),el('p','',rest)]):null,
      h?el('p','cx-here '+h.status,[el('i',''),el('span','',t('cs.cx.here.'+h.status)),h.detail?el('span','sub',' · '+h.detail):null]):null,
      x.needs?el('p','cx-needs',[el('b','',t('cs.cx.needs')+' '),x.needs]):null,
      el('div','cx-acts',[o.action?o.action(x):null,link(x.doc,t('cs.cx.guide')),link(x.record,t('cs.cx.record'))])])};
  for(const g of CX_GROUPS){
    const items=all.filter((x)=>x.group===g),later=planned.filter((x)=>x.group===g);
    if(!items.length&&!later.length)continue;
    kids.push(el('h2','sub-h',tk('cs.cx.group.'+cxSlug(g),g)),el('ul','plain cx-grid',[...items.map((x)=>card(x,x.kind)),...later.map((x)=>card(x,'planned'))]));
  }
  kids.push(el('p','note-info',t('cs.cx.rule')));
  return kids;
}
`;
