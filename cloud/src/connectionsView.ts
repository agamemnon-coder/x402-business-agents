// Settings, Connections (20 Nov, the owner: "Purser connects to everything and everyone, findable in Purser Cloud"):
// the list GET /v1/connections returns (cloud/src/connections.ts), grouped as the hub groups it
// (docs/integrations/README.md), each with its honest label and a link to its guide, then the hub and /connect-ai.
//
// One implementation serves the console and its test: CONNECTIONS_VIEW_JS is plain script the console carries as it is
// (cloud/src/console.ts puts it in at __UI__), and test/connections-hub.test.ts runs the same text with a stand-in for
// the page's el(). It builds elements only through el() and sets text as text; it calls nothing and reads no clock.

export const CONNECTIONS_VIEW_JS = String.raw`
// --- Settings, Connections ------------------------------------------------------------------------------------------
const CX_GROUPS=['rails','ai','api','no-code','accounting','more'];
const cxSlug=(s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const CX_TONE={live:'ok','built_not_tested_live':'warn'};
function connectionsViewOf(cat,t,tk,el){
  const link=(href,text)=>{if(!/^https?:\/\//.test(String(href||'')))return null;const a=el('a','',text+' ↗');a.href=href;a.target='_blank';a.rel='noopener';return a};
  const all=[].concat(cat.money||[],cat.connections||[]);
  const kids=[el('h2','',t('cs.cx.title')),el('p','',t('cs.cx.lede')),el('p','sub cx-links',[link(cat.connect_ai,t('cs.claude.guide')),' · ',link(cat.hub,t('cs.cx.hub'))])];
  for(const g of CX_GROUPS){
    const items=all.filter((x)=>x.group===g);
    if(!items.length)continue;
    kids.push(el('h2','sub-h',tk('cs.cx.group.'+cxSlug(g),g)),el('ul','plain cx',items.map((x)=>{const k=cxSlug(x.kind);const tone=CX_TONE[k];
      return el('li','',[el('b','',x.name),' ',el('span','pill'+(tone?' '+tone:''),tk('cs.cx.kind.'+k,x.kind)),' ',link(x.doc,t('cs.cx.guide'))])})));
  }
  kids.push(el('p','note-info',t('cs.cx.rule')));
  return kids;
}
`;
