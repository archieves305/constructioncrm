import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFRef, PDFSignature, PDFTextField, StandardFonts, popGraphicsState, pushGraphicsState, rgb, type PDFField, type PDFPage } from "pdf-lib";
import { logger } from "@/lib/logger";
import { CHECKED, nearestLabel, type FieldType, type FillValue, type InventoryField, type TextItem } from "./field-fill";

/**
 * The PDF work behind form templates, with pdf-lib (MIT): read a blank
 * form's fields, and write values into a copy. Values go into the form's own
 * fields — the page is never redrawn — and the copy is saved twice: editable,
 * and flattened for submission.
 */
export type FormKind = "ACROFORM" | "XFA" | "FLAT";
export type Inventory = { kind: FormKind; pageCount: number; fields: InventoryField[] };

function typeOf(f: PDFField): FieldType {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) return "dropdown";
  if (f instanceof PDFSignature) return "signature";
  return "other";
}

/** The page a field's first widget sits on: its /P entry, else the page whose annotations hold it. */
function pageIndexOf(doc: PDFDocument, f: PDFField): number {
  const widget = f.acroField.getWidgets()[0];
  if (!widget) return 0;
  const pages = doc.getPages();
  const p = widget.P();
  if (p) {
    const i = pages.findIndex((pg) => pg.ref === p);
    if (i >= 0) return i;
  }
  // refs are interned by pdf-lib, so the same object is the same ref
  const ref = doc.context.getObjectRef(widget.dict);
  if (!ref) return 0;
  const i = pages.findIndex((pg) => pg.node.Annots()?.asArray().some((a) => a instanceof PDFRef && a === ref));
  return i >= 0 ? i : 0;
}

export async function pageTextItems(bytes: Uint8Array): Promise<TextItem[][]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
    const out: TextItem[][] = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        out.push(
          (content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
            .filter((t) => t.str && t.transform)
            .map((t) => ({ str: t.str!, x: t.transform![4], y: t.transform![5], w: t.width ?? 0, h: t.height || Math.abs(t.transform![3]) || 8 })),
        );
      }
    } finally {
      await doc.destroy();
    }
    return out;
  } catch (err) {
    logger.warn("form labels not read", { message: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** The fields of a blank form, each with its type, page, box and the printed label beside it. */
export async function readInventory(bytes: Uint8Array): Promise<Inventory> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const fields = form.getFields();
  const pageCount = doc.getPageCount();
  if (!fields.length) return { kind: form.hasXFA() ? "XFA" : "FLAT", pageCount, fields: [] };
  const text = await pageTextItems(bytes);
  const inventory: InventoryField[] = [];
  for (const f of fields) {
    const type = typeOf(f);
    if (type === "other") continue; // push buttons and the like carry no value
    const r = f.acroField.getWidgets()[0]?.getRectangle();
    const rect: [number, number, number, number] = r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : [0, 0, 0, 0];
    const page = pageIndexOf(doc, f);
    const options = f instanceof PDFRadioGroup ? f.getOptions() : f instanceof PDFDropdown || f instanceof PDFOptionList ? f.getOptions() : undefined;
    const maxLen = f instanceof PDFTextField ? (f.getMaxLength() ?? null) : null;
    inventory.push({ name: f.getName(), type, page, rect, ...(options ? { options } : {}), maxLen, label: nearestLabel(rect, text[page] ?? []) });
  }
  // reading order: page, then top to bottom, then left to right
  inventory.sort((a, b) => a.page - b.page || b.rect[1] - a.rect[1] || a.rect[0] - b.rect[0]);
  return { kind: "ACROFORM", pageCount, fields: inventory };
}

/**
 * Write the values into a copy of the blank form. A field the copy no longer
 * has, or a value it refuses, is reported, never guessed around.
 */
export async function fillForm(bytes: Uint8Array, values: readonly FillValue[]): Promise<{ editable: Uint8Array; flattened: Uint8Array; skipped: string[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  // a hybrid form also carries an XFA copy that viewers would show instead of the filled fields
  if (form.hasXFA()) form.deleteXFA();
  const skipped: string[] = [];
  for (const v of values) {
    if (v.type === "signature" || v.status === "SIGN_BY_HAND") continue;
    let f: PDFField;
    try {
      f = form.getField(v.field);
    } catch {
      skipped.push(v.field);
      continue;
    }
    try {
      if (f instanceof PDFTextField) {
        f.setText(v.value ?? "");
      } else if (f instanceof PDFCheckBox) {
        if (v.value === CHECKED) f.check();
        else f.uncheck();
      } else if (f instanceof PDFRadioGroup) {
        if (v.value) f.select(v.value);
        else f.clear();
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        if (v.value) f.select(v.value);
        else f.clear();
      }
    } catch (err) {
      skipped.push(v.field);
      logger.warn("form field not filled", { field: v.field, message: err instanceof Error ? err.message : String(err) });
    }
  }
  form.updateFieldAppearances();
  const editable = await doc.save();
  form.flatten();
  const flattened = await doc.save();
  return { editable, flattened, skipped };
}

/**
 * Before drawing on a page, its own content is wrapped in a save / restore of
 * the graphics state. A scan's hidden OCR text sets "invisible" text and never
 * restores it — without the wrap everything we print inherits that and does
 * not show. Once per page.
 */
function isolatePage(doc: PDFDocument, page: PDFPage, done: Set<PDFPage>) {
  if (done.has(page)) return;
  done.add(page);
  const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
  const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

/** The smallest size a value is printed at on a flat form; a value that will not fit even then is reported, never cut. */
export const FLAT_MIN_SIZE = 5.5;

/** What Helvetica can print: anything outside Latin-1 becomes a plain stand-in. */
function printable(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

/**
 * Write the values onto a flat form: each printed just above its blank's line
 * (or as an X in its tick box), shrunk to fit its space. Signatures are never
 * written. The result is one PDF — a flat form has no fields to keep editable.
 */
export async function fillFlatForm(bytes: Uint8Array, values: readonly FillValue[], inventory: readonly InventoryField[]): Promise<{ editable: Uint8Array; flattened: Uint8Array; skipped: string[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const fields = new Map(inventory.map((f) => [f.name, f]));
  const ink = rgb(0.05, 0.05, 0.25);
  const skipped: string[] = [];
  const isolated = new Set<PDFPage>();
  for (const v of values) {
    if (v.type === "signature" || v.status === "SIGN_BY_HAND" || !v.value) continue;
    const f = fields.get(v.field);
    const page = f ? pages[f.page] : undefined;
    if (!f || !page) {
      skipped.push(v.field);
      continue;
    }
    if (page.getRotation().angle % 360 !== 0) {
      skipped.push(`${f.label ?? f.name}: the page is rotated`);
      continue;
    }
    isolatePage(doc, page, isolated);
    const box = page.getCropBox();
    const [x, y, w, h] = f.rect;
    const ox = x + box.x;
    const oy = y + box.y;
    if (f.type === "checkbox") {
      if (v.value !== CHECKED) continue;
      const size = Math.max(7, Math.min(12, h * 0.9, w * 1.1));
      const tw = font.widthOfTextAtSize("X", size);
      page.drawText("X", { x: ox + Math.max(0, (w - tw) / 2), y: oy + Math.max(0.5, (h - size * 0.72) / 2), size, font, color: ink });
      continue;
    }
    const text = printable(v.value.replace(/\s+/g, " ").trim());
    let size = Math.max(FLAT_MIN_SIZE, Math.min(10, h * 0.75));
    while (size > FLAT_MIN_SIZE && font.widthOfTextAtSize(text, size) > w - 3) size -= 0.5;
    if (font.widthOfTextAtSize(text, size) > w - 3) {
      skipped.push(`${f.label ?? f.name}: too long for its space`);
      continue;
    }
    page.drawText(text, { x: ox + 2, y: oy + Math.max(1.5, (h - size) * 0.25), size, font, color: ink });
  }
  const out = await doc.save();
  return { editable: out, flattened: out, skipped };
}

/** Each field outlined, with its label, on a copy of a filled form: where the blanks are, for a person checking a template. */
export async function outlineFields(bytes: Uint8Array, inventory: readonly InventoryField[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const blue = rgb(0.1, 0.35, 0.85);
  const isolated = new Set<PDFPage>();
  for (const f of inventory) {
    const page = pages[f.page];
    if (!page) continue;
    isolatePage(doc, page, isolated);
    const box = page.getCropBox();
    const [x, y, w, h] = f.rect;
    page.drawRectangle({ x: x + box.x, y: y + box.y, width: w, height: h, borderColor: blue, borderWidth: 0.6, opacity: 0, borderOpacity: 0.8 });
    const label = printable((f.label ?? f.name).slice(0, 60));
    page.drawText(label, { x: x + box.x + 1, y: y + box.y + h + 1, size: 4.5, font, color: blue, opacity: 0.9 });
  }
  return doc.save();
}
