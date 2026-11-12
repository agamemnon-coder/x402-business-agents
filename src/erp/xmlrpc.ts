// The small part of XML-RPC Odoo's External API needs (odoo.com/documentation/18.0/developer/reference/external_api):
// a methodCall with ints, doubles, booleans, strings, lists, structs and nil (Odoo accepts nil), and a methodResponse or
// fault back. No library: the format is small and the parser only ever reads Odoo's own answers.

export type XmlValue = null | boolean | number | string | XmlValue[] | { [k: string]: XmlValue };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

export function encodeValue(v: XmlValue): string {
  if (v === null || v === undefined) return "<value><nil/></value>";
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("XML-RPC: not a finite number");
    return Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? `<value><int>${v}</int></value>` : `<value><double>${v}</double></value>`;
  }
  if (typeof v === "string") return `<value><string>${esc(v)}</string></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(encodeValue).join("")}</data></array></value>`;
  return `<value><struct>${Object.entries(v).map(([k, x]) => `<member><name>${esc(k)}</name>${encodeValue(x)}</member>`).join("")}</struct></value>`;
}

export function encodeCall(method: string, params: XmlValue[]): string {
  return `<?xml version="1.0"?><methodCall><methodName>${esc(method)}</methodName><params>${params.map((p) => `<param>${encodeValue(p)}</param>`).join("")}</params></methodCall>`;
}

/** A cursor over Odoo's XML: tags and text, whitespace between tags ignored. */
class Reader {
  private i = 0;
  constructor(private readonly s: string) {}
  private skipWs() { while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++; }
  peekTag(): string | null {
    this.skipWs();
    const m = /^<\/?([A-Za-z0-9_.]+)\s*\/?>/.exec(this.s.slice(this.i, this.i + 64));
    return m ? m[0] : null;
  }
  open(name: string): boolean {
    this.skipWs();
    const t = this.peekTag();
    if (t === `<${name}/>`) { this.i += t.length; return false; } // empty element
    if (t !== `<${name}>`) throw new Error(`XML-RPC: expected <${name}> at ${this.i}, found ${t ?? JSON.stringify(this.s.slice(this.i, this.i + 20))}`);
    this.i += t.length;
    return true;
  }
  close(name: string) {
    this.skipWs();
    const t = `</${name}>`;
    if (!this.s.startsWith(t, this.i)) throw new Error(`XML-RPC: expected ${t} at ${this.i}`);
    this.i += t.length;
  }
  text(): string {
    const j = this.s.indexOf("<", this.i);
    const t = this.s.slice(this.i, j < 0 ? undefined : j);
    this.i = j < 0 ? this.s.length : j;
    return unesc(t);
  }
  skipProlog() { this.skipWs(); if (this.s.startsWith("<?xml", this.i)) this.i = this.s.indexOf("?>", this.i) + 2; }
}

function readValue(r: Reader): XmlValue {
  if (!r.open("value")) return "";
  const t = r.peekTag();
  if (t === null || t.startsWith("</")) { const s = r.text(); r.close("value"); return s; } // untyped: a string
  const name = /^<([A-Za-z0-9_.]+)/.exec(t)![1]!;
  let v: XmlValue;
  if (name === "nil") { r.open("nil"); v = null; }
  else if (name === "array") {
    r.open("array");
    const out: XmlValue[] = [];
    if (r.open("data")) { while (r.peekTag()?.startsWith("<value")) out.push(readValue(r)); r.close("data"); }
    r.close("array");
    v = out;
  } else if (name === "struct") {
    const o: Record<string, XmlValue> = {};
    if (r.open("struct")) {
      while (r.peekTag() === "<member>") {
        r.open("member");
        r.open("name"); const k = r.text(); r.close("name");
        o[k] = readValue(r);
        r.close("member");
      }
      r.close("struct");
    }
    v = o;
  } else {
    const empty = !r.open(name);
    const raw = empty ? "" : r.text();
    if (!empty) r.close(name);
    if (name === "int" || name === "i4" || name === "i8") v = Number.parseInt(raw, 10);
    else if (name === "double") v = Number(raw);
    else if (name === "boolean") v = raw.trim() === "1";
    else v = raw; // string, base64, dateTime.iso8601
  }
  r.close("value");
  return v;
}

export class XmlRpcFault extends Error {
  constructor(readonly faultCode: XmlValue, readonly faultString: string) { super(faultString); this.name = "XmlRpcFault"; }
}

/** The value of a methodResponse; a fault throws XmlRpcFault. */
export function decodeResponse(xml: string): XmlValue {
  const r = new Reader(xml);
  r.skipProlog();
  r.open("methodResponse");
  if (r.peekTag() === "<fault>") {
    r.open("fault");
    const f = readValue(r) as { faultCode?: XmlValue; faultString?: XmlValue };
    throw new XmlRpcFault(f.faultCode ?? null, String(f.faultString ?? "fault"));
  }
  r.open("params");
  r.open("param");
  const v = readValue(r);
  return v;
}

/** A methodCall read back (tests read what the connector sent with it). */
export function decodeCallForTest(xml: string): { method: string; params: XmlValue[] } {
  const r = new Reader(xml);
  r.skipProlog();
  r.open("methodCall");
  r.open("methodName"); const method = r.text(); r.close("methodName");
  const params: XmlValue[] = [];
  if (r.open("params")) {
    while (r.peekTag() === "<param>") { r.open("param"); params.push(readValue(r)); r.close("param"); }
  }
  return { method, params };
}
