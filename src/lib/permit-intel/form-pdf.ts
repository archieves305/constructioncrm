import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFRef, PDFSignature, PDFTextField, type PDFField } from "pdf-lib";
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

async function pageTextItems(bytes: Uint8Array): Promise<TextItem[][]> {
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
