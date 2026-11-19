import { unzipSync, strFromU8 } from "fflate";

/**
 * A Word proposal (.docx) as text the model can read: paragraphs on their
 * own lines, table rows as `cell | cell | cell` (prices usually sit in a
 * table), headers and footers first (the letterhead names the company and
 * the proposal number). No layout, no pictures. A .docx is a zip of XML, so
 * this needs nothing beyond fflate.
 */
export const DOCX_TEXT_CAP = 150_000;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITY[e] ?? m)));

/** One WordprocessingML part → text, keeping paragraph and table structure. */
export function wordXmlToText(xml: string): string {
  let out = "";
  let inText = false;
  let cellDepth = 0;
  const tag = /<(\/?)(w:p|w:tr|w:tc|w:t|w:tab|w:br|w:cr)(?:\s[^>]*)?(\/?)>|([^<]+)|<[^>]*>/g;
  for (const m of xml.matchAll(tag)) {
    const [, close, name, selfClose, text] = m;
    if (text !== undefined) {
      if (inText) out += decode(text);
      continue;
    }
    if (!name) continue;
    if (name === "w:t") inText = !close && !selfClose;
    else if (name === "w:tab" && !close) out += "\t";
    else if ((name === "w:br" || name === "w:cr") && !close) out += cellDepth ? " " : "\n";
    else if (name === "w:tc") {
      if (close) {
        out = out.replace(/[ \t]+$/, "") + " | ";
        cellDepth -= 1;
      } else if (!selfClose) cellDepth += 1;
    } else if (name === "w:tr" && close) out = out.replace(/ \| $/, "") + "\n";
    else if (name === "w:p" && close) out += cellDepth ? " " : "\n";
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .trim();
}

export function docxToText(bytes: Uint8Array): { text: string; truncated: boolean } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) });
  } catch {
    throw new Error("The Word file could not be opened");
  }
  const body = files["word/document.xml"];
  if (!body) throw new Error("The Word file has no document body");
  const parts = Object.keys(files).filter((n) => n !== "word/document.xml").sort();
  const head = parts.map((n) => wordXmlToText(strFromU8(files[n]!))).filter(Boolean);
  const text = [...(head.length ? ["## Header / footer", ...new Set(head)] : []), "## Document", wordXmlToText(strFromU8(body))].join("\n");
  return text.length > DOCX_TEXT_CAP ? { text: text.slice(0, DOCX_TEXT_CAP), truncated: true } : { text, truncated: false };
}
