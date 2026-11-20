// The strict XML reader for documents from outside (src/ap/xmlStrict.ts): each way a document can be malformed or try
// something XML allows but an invoice never needs is refused with its own code, and never half-read; a BOM, a UTF-8
// declaration, comments, CDATA, character references and namespaced attributes are read as XML says.
import { describe, expect, it } from "vitest";
import { child, kids, parseXmlStrict, XML_LIMITS, XmlRefused, type XmlRefusalCode } from "../src/ap/xmlStrict.js";

const refusal = (input: string | Uint8Array, limits = XML_LIMITS): { code: XmlRefusalCode; message: string } => {
  try { parseXmlStrict(input, limits); } catch (e) { if (e instanceof XmlRefused) return { code: e.code, message: e.message }; throw e; }
  throw new Error("expected a refusal");
};

describe("what the strict reader refuses", () => {
  it.each([
    ["an unclosed XML declaration", "<?xml version=\"1.0\"", "malformed", "the XML declaration is not closed"],
    ["a declaration without a version", "<?xml encoding=\"UTF-8\"?><a/>", "malformed", "the XML declaration has no version"],
    ["a processing instruction", "<?xml version=\"1.0\"?><?php echo 1 ?><a/>", "pi", "a processing instruction is refused"],
    ["a DOCTYPE", "<!DOCTYPE a [<!ENTITY x \"y\">]><a/>", "dtd", "a DOCTYPE (DTD) is refused"],
    ["another markup declaration", "<!ENTITY x \"y\"><a/>", "dtd", "a markup declaration is refused"],
    ["an encoding other than UTF-8", "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><a/>", "encoding", "the declared encoding is ISO-8859-1; only UTF-8 is read"],
    ["content after the root", "<a/><b/>", "malformed", "content after the root element"],
    ["\"--\" in a comment", "<!-- a -- b --><a/>", "malformed", "\"--\" inside a comment"],
    ["an unclosed comment", "<!-- never closed <a/>", "malformed", "a comment is not closed"],
    ["text before the root", "hello<a/>", "malformed", "no root element"],
    ["a bad element name", "<1a/>", "malformed", "an element name is missing or not allowed"],
    ["attributes run together", "<a x=\"1\"y=\"2\"/>", "malformed", "no space before an attribute of <a>"],
    ["an unclosed attribute value", "<a x=\"1/>", "malformed", "an attribute value of <a> is not closed"],
    ["\"<\" in an attribute", "<a x=\"<\"/>", "malformed", "\"<\" inside an attribute value of <a>"],
    ["an xmlns prefix declared empty", "<a xmlns:p=\"\"/>", "namespace", "the prefix p cannot be declared that way"],
    ["the xml prefix redeclared", "<a xmlns:xml=\"urn:x\"/>", "namespace", "the prefix xml cannot be declared that way"],
    ["an element never closed", "<a><b>text", "malformed", "<b> is not closed"],
    ["\"]]>\" in text", "<a>x ]]> y</a>", "malformed", "\"]]>\" in text"],
    ["an end tag of another element", "<a><b></c></a>", "malformed", "</c> does not close <b>"],
    ["an unclosed CDATA section", "<a><![CDATA[never", "malformed", "a CDATA section is not closed"],
    ["a reference to a character XML does not allow", "<a>&#x1;</a>", "char", "the character reference &#x1; is not an XML character"],
    ["an entity XML does not define", "<a>&nbsp;</a>", "entity", "the entity &nbsp; is not one of XML's five"],
    ["a bare ampersand", "<a>Smith & Co</a>", "entity", "a bare \"&\" (write &amp;)"],
  ])("%s", (_what, xml, code, words) => {
    const r = refusal(xml);
    expect(r.code).toBe(code);
    expect(r.message).toContain(words);
  });

  it("a name or a text over its limit", () => {
    expect(refusal(`<${"a".repeat(20)}/>`, { ...XML_LIMITS, maxNameLength: 10 })).toMatchObject({ code: "limit", message: "line 1: an element name is too long" });
    expect(refusal(`<a>${"x".repeat(20)}</a>`, { ...XML_LIMITS, maxTextLength: 10 })).toMatchObject({ code: "limit", message: "line 1: <a> holds more than 10 characters of text" });
    expect(refusal(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toMatchObject({ code: "encoding", message: "UTF-16 is not read: send UTF-8" });
    expect(refusal(new Uint8Array([0xfe, 0xff, 0x00, 0x3c]))).toMatchObject({ code: "encoding" });
    expect(refusal(new Uint8Array([0x3c, 0x61, 0xc3, 0x28, 0x2f, 0x3e]))).toMatchObject({ code: "encoding", message: "the bytes are not valid UTF-8" });
  });
});

describe("what it reads", () => {
  it("a BOM, a UTF-8 declaration, comments, CDATA, references and namespaced attributes", () => {
    const xml = "﻿<?xml version='1.0' encoding='UTF-8'?>\n<!-- a supplier's note -->\n<inv:Invoice xmlns:inv=\"urn:inv\" xmlns:c=\"urn:c\" c:id=\"7\" xml:lang=\"nl\">\n<c:Note><![CDATA[a < b]]> &amp; &#233;&#x20AC;</c:Note><!-- inside --><c:Note/></inv:Invoice>";
    const root = parseXmlStrict(new TextEncoder().encode(xml));
    expect(root).toMatchObject({ ns: "urn:inv", local: "Invoice", line: 3 });
    expect(root.attrs).toEqual(expect.arrayContaining([{ ns: "urn:c", local: "id", value: "7" }, { ns: "http://www.w3.org/XML/1998/namespace", local: "lang", value: "nl" }]));
    expect(child(root, "urn:c", "Note")!.text).toBe("a < b & é€");
    expect(kids(root, "urn:c", "Note")).toHaveLength(2);
    expect(kids(null, "urn:c", "Note")).toEqual([]);
    expect(child(undefined, "urn:c", "Note")).toBeNull();
  });
});
