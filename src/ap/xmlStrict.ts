// A strict, small XML parser for documents from outside (Peppol UBL invoices, src/ap/peppol.ts). It reads only what
// an invoice needs and refuses everything else, so the classic XML attacks have nothing to work with:
//
//   - No DTD at all: a <!DOCTYPE anywhere is refused, so there is no internal or external entity, no XXE, no "billion
//     laughs" expansion and no fetch of anything. Only the five predefined entities and numeric character references
//     are read; any other &name; is refused.
//   - No processing instructions besides the XML declaration, whose encoding (if given) must be UTF-8. The bytes must be
//     valid UTF-8 (a fatal decoder), and only XML 1.0 characters are allowed.
//   - Caps on size, depth, number of elements, attributes per element, name length and text per element; past any of
//     them the document is refused, never truncated.
//   - Well-formed or nothing: one root, matching end tags, unique attributes, quoted values, every namespace prefix
//     declared. Names are resolved to (namespace URI, local name), so a document cannot pass by choosing other prefixes.
//
// It builds a plain tree of elements; text is kept per element (the concatenation of its direct text and CDATA).

export interface XmlElement {
  /** The namespace URI the element's prefix (or the default namespace) resolves to; "" for none. */
  ns: string;
  local: string;
  attrs: { ns: string; local: string; value: string }[];
  children: XmlElement[];
  /** The element's own text (direct text and CDATA, in order), entities decoded. */
  text: string;
  /** 1-based line of the start tag, for messages. */
  line: number;
}

export interface XmlLimits { maxBytes: number; maxDepth: number; maxElements: number; maxAttrs: number; maxNameLength: number; maxTextLength: number }

/** Far above any real invoice (the OpenPeppol examples are 5 to 16 KB, under 400 elements, depth 7). */
export const XML_LIMITS: XmlLimits = { maxBytes: 2 * 1024 * 1024, maxDepth: 32, maxElements: 20_000, maxAttrs: 16, maxNameLength: 128, maxTextLength: 64 * 1024 };

export type XmlRefusalCode = "too_large" | "encoding" | "dtd" | "entity" | "pi" | "malformed" | "limit" | "namespace" | "char";

export class XmlRefused extends Error {
  constructor(readonly code: XmlRefusalCode, message: string) {
    super(message);
    this.name = "XmlRefused";
  }
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** XML 1.0 Char, minus what a document from outside never needs (the C1 controls stay allowed, as XML allows them). */
// eslint-disable-next-line no-control-regex -- these are exactly the control characters XML 1.0 does not allow
const BAD_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function decodeEntities(s: string, line: number): string {
  if (!s.includes("&")) return s;
  return s.replace(/&([^;&\s]{0,32});|&/g, (whole, name: string | undefined) => {
    if (name === undefined) throw new XmlRefused("entity", `line ${line}: a bare "&" (write &amp;)`);
    if (Object.hasOwn(PREDEFINED, name)) return PREDEFINED[name]!;
    const num = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(name);
    if (num) {
      const cp = num[1] !== undefined ? parseInt(num[1], 16) : parseInt(num[2]!, 10);
      const ok = cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
      if (!ok) throw new XmlRefused("char", `line ${line}: the character reference ${whole} is not an XML character`);
      return String.fromCodePoint(cp);
    }
    throw new XmlRefused("entity", `line ${line}: the entity ${whole.slice(0, 40)} is not one of XML's five; no DTD is read, so no other entity exists`);
  });
}

/** Parses bytes (or a string) into the root element, or throws XmlRefused with the reason. */
export function parseXmlStrict(input: Uint8Array | string, limits: XmlLimits = XML_LIMITS): XmlElement {
  const size = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.length;
  if (size > limits.maxBytes) throw new XmlRefused("too_large", `the document is ${size} bytes; at most ${limits.maxBytes} are read`);
  let src: string;
  if (typeof input === "string") src = input;
  else {
    if ((input[0] === 0xfe && input[1] === 0xff) || (input[0] === 0xff && input[1] === 0xfe)) throw new XmlRefused("encoding", "UTF-16 is not read: send UTF-8");
    try {
      src = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new XmlRefused("encoding", "the bytes are not valid UTF-8");
    }
  }
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const bad = BAD_CHAR.exec(src);
  if (bad) throw new XmlRefused("char", `a character XML does not allow (U+${bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}) at offset ${bad.index}`);

  let i = 0;
  let line = 1;
  const advance = (to: number) => { for (let k = i; k < to; k++) if (src.charCodeAt(k) === 10) line++; i = to; };
  const fail = (code: XmlRefusalCode, why: string): never => { throw new XmlRefused(code, `line ${line}: ${why}`); };

  // The XML declaration, only at the very start.
  if (src.startsWith("<?xml") && /^<\?xml[\s?]/.test(src)) {
    const end = src.indexOf("?>");
    if (end < 0) fail("malformed", "the XML declaration is not closed");
    const decl = src.slice(5, end);
    if (!/^\s+version\s*=\s*(["'])1\.[0-9]\1/.test(decl)) fail("malformed", "the XML declaration has no version");
    const enc = /\sencoding\s*=\s*(["'])([^"']*)\1/.exec(decl)?.[2];
    if (enc !== undefined && !/^utf-?8$/i.test(enc)) fail("encoding", `the declared encoding is ${enc.slice(0, 20)}; only UTF-8 is read`);
    advance(end + 2);
  }

  /** Skips whitespace, comments and refuses what may not stand outside the root. */
  const misc = () => {
    for (;;) {
      const ws = /^\s*/.exec(src.slice(i, i + 4096))![0].length;
      advance(i + ws);
      if (src.startsWith("<!--", i)) comment();
      else if (src.startsWith("<!DOCTYPE", i) || src.startsWith("<!doctype", i)) fail("dtd", "a DOCTYPE (DTD) is refused: no entity or external reference is read");
      else if (src.startsWith("<?", i)) fail("pi", "a processing instruction is refused");
      else if (src.startsWith("<!", i)) fail("dtd", "a markup declaration is refused");
      else return;
    }
  };
  const comment = () => {
    const end = src.indexOf("-->", i + 4);
    if (end < 0) fail("malformed", "a comment is not closed");
    if (src.slice(i + 4, end).includes("--")) fail("malformed", "\"--\" inside a comment");
    advance(end + 3);
  };

  let elements = 0;
  type Scope = Map<string, string>;
  const root = (() => {
    misc();
    if (src[i] !== "<") fail("malformed", "no root element");
    const el = element(new Map([["xml", XML_NS]]), 1);
    misc();
    if (i < src.length) fail("malformed", "content after the root element");
    return el;
  })();
  return root;

  function element(parent: Scope, depth: number): XmlElement {
    if (depth > limits.maxDepth) fail("limit", `elements nested deeper than ${limits.maxDepth}`);
    if (++elements > limits.maxElements) fail("limit", `more than ${limits.maxElements} elements`);
    const startLine = line;
    const m = /^<([^\s/>]+)/.exec(src.slice(i, i + limits.maxNameLength + 2));
    if (!m || !NAME.test(m[1]!)) fail("malformed", "an element name is missing or not allowed");
    const qname = m![1]!;
    if (qname.length > limits.maxNameLength) fail("limit", "an element name is too long");
    advance(i + 1 + qname.length);
    // Attributes.
    const raw: { name: string; value: string }[] = [];
    for (;;) {
      const ws = /^\s*/.exec(src.slice(i, i + 4096))![0].length;
      advance(i + ws);
      if (src.startsWith("/>", i) || src[i] === ">") break;
      if (!ws) fail("malformed", `no space before an attribute of <${qname}>`);
      const a = /^([^\s=/>]+)\s*=\s*(["'])/.exec(src.slice(i, i + limits.maxNameLength + 64));
      if (!a || !NAME.test(a[1]!)) fail("malformed", `an attribute of <${qname}> is malformed`);
      const close = src.indexOf(a![2]!, i + a![0].length);
      if (close < 0) fail("malformed", `an attribute value of <${qname}> is not closed`);
      const rawValue = src.slice(i + a![0].length, close);
      if (rawValue.includes("<")) fail("malformed", `"<" inside an attribute value of <${qname}>`);
      if (raw.length >= limits.maxAttrs) fail("limit", `<${qname}> has more than ${limits.maxAttrs} attributes`);
      if (raw.some((x) => x.name === a![1])) fail("malformed", `<${qname}> repeats the attribute ${a![1]}`);
      raw.push({ name: a![1]!, value: decodeEntities(rawValue.replace(/[\t\n\r]/g, " "), line) });
      advance(close + 1);
    }
    // Namespace declarations first, then names resolved in this element's scope.
    const scope: Scope = new Map(parent);
    for (const x of raw) {
      if (x.name === "xmlns") scope.set("", x.value);
      else if (x.name.startsWith("xmlns:")) {
        const p = x.name.slice(6);
        if (p === "xml" || p === "xmlns" || x.value === "") fail("namespace", `the prefix ${p} cannot be declared that way`);
        scope.set(p, x.value);
      }
    }
    const resolve = (name: string, isAttr: boolean): { ns: string; local: string } => {
      const c = name.indexOf(":");
      if (c < 0) return { ns: isAttr ? "" : scope.get("") ?? "", local: name };
      const p = name.slice(0, c);
      const ns = scope.get(p);
      if (ns === undefined) fail("namespace", `the prefix ${p} is not declared`);
      return { ns: ns!, local: name.slice(c + 1) };
    };
    const { ns, local } = resolve(qname, false);
    const attrs = raw.filter((x) => x.name !== "xmlns" && !x.name.startsWith("xmlns:")).map((x) => ({ ...resolve(x.name, true), value: x.value }));
    const seen = new Set(attrs.map((x) => `${x.ns}\u0000${x.local}`));
    if (seen.size !== attrs.length) fail("malformed", `<${qname}> repeats an attribute under two prefixes`);
    const el: XmlElement = { ns, local, attrs, children: [], text: "", line: startLine };
    if (src.startsWith("/>", i)) { advance(i + 2); return el; }
    advance(i + 1);
    // Content.
    for (;;) {
      const lt = src.indexOf("<", i);
      if (lt < 0) fail("malformed", `<${qname}> is not closed`);
      if (lt > i) {
        const chunk = src.slice(i, lt);
        if (chunk.includes("]]>")) fail("malformed", "\"]]>\" in text");
        el.text += decodeEntities(chunk, line);
        advance(lt);
      }
      if (el.text.length > limits.maxTextLength) fail("limit", `<${qname}> holds more than ${limits.maxTextLength} characters of text`);
      if (src.startsWith("</", i)) {
        const end = /^<\/([^\s>]+)\s*>/.exec(src.slice(i, i + limits.maxNameLength + 64));
        if (!end || end[1] !== qname) fail("malformed", `</${end?.[1]?.slice(0, 40) ?? "?"}> does not close <${qname}>`);
        advance(i + end![0].length);
        return el;
      }
      if (src.startsWith("<!--", i)) { comment(); continue; }
      if (src.startsWith("<![CDATA[", i)) {
        const end = src.indexOf("]]>", i + 9);
        if (end < 0) fail("malformed", "a CDATA section is not closed");
        el.text += src.slice(i + 9, end);
        advance(end + 3);
        continue;
      }
      if (src.startsWith("<!", i)) fail("dtd", "a markup declaration inside the document is refused");
      if (src.startsWith("<?", i)) fail("pi", "a processing instruction is refused");
      el.children.push(element(scope, depth + 1));
    }
  }
}

/** The first child with this namespace and local name, or null. */
export const child = (el: XmlElement | null | undefined, ns: string, local: string): XmlElement | null => el?.children.find((c) => c.ns === ns && c.local === local) ?? null;
/** Every child with this namespace and local name. */
export const kids = (el: XmlElement | null | undefined, ns: string, local: string): XmlElement[] => el?.children.filter((c) => c.ns === ns && c.local === local) ?? [];
/** An attribute without a namespace, or null. */
export const attr = (el: XmlElement | null | undefined, local: string): string | null => el?.attrs.find((a) => a.ns === "" && a.local === local)?.value ?? null;
