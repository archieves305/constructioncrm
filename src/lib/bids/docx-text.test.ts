import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { docxToText, wordXmlToText } from "./docx-text";

const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const tc = (t: string) => `<w:tc><w:tcPr/>${p(t)}</w:tc>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
${p("Bid Proposal — Roofing")}${p("Project: 6300 Block &amp; Live")}
<w:tbl><w:tr>${tc("Scope")}${tc("Amount")}</w:tr><w:tr>${tc("TPO roof")}${tc("$187,250.00")}</w:tr></w:tbl>
<w:p><w:r><w:t>Valid</w:t></w:r><w:r><w:tab/><w:t>30 days</w:t></w:r></w:p>
</w:body></w:document>`;

describe("docx text", () => {
  it("keeps paragraphs, decodes entities and turns table rows into cells", () => {
    expect(wordXmlToText(DOC)).toBe("Bid Proposal — Roofing\nProject: 6300 Block & Live\nScope | Amount\nTPO roof | $187,250.00\nValid 30 days");
  });
  it("reads the header before the body", () => {
    const bytes = zipSync({ "word/document.xml": strToU8(DOC), "word/header1.xml": strToU8(`<w:hdr xmlns:w="x">${p("KNU Construction LLC · Proposal KNU-77")}</w:hdr>`), "word/media/x.png": new Uint8Array([1, 2]) });
    const r = docxToText(bytes);
    expect(r.text.startsWith("## Header / footer\nKNU Construction LLC · Proposal KNU-77\n## Document\nBid Proposal")).toBe(true);
    expect(r.truncated).toBe(false);
  });
  it("refuses something that is not a Word file", () => {
    expect(() => docxToText(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
