import { dictKey, type FormContext } from "./data-dictionary";

/**
 * Filling a form, without the database or the PDF. Pure and client-safe.
 *
 * A field's mapping is one of:
 *  - a dictionary key ("owner.name"),
 *  - "literal:<text>" — the same value on every permit ("Primary Permit"),
 *  - "when:<key>=<value>" — a box ticked when the key has that value,
 *  - null — left for a person to fill by hand.
 * The value then passes through one transform. Signature fields are never
 * filled; a key two records disagree on is a conflict a person settles.
 */
export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "signature" | "other";
export type InventoryField = { name: string; type: FieldType; page: number; rect: [number, number, number, number]; options?: string[]; maxLen?: number | null; label: string | null };
export type FieldMap = { fieldName: string; dataKey: string | null; transform: string | null };

export type FillStatus = "FILLED" | "MISSING" | "BLANK" | "SIGN_BY_HAND" | "OVERRIDDEN" | "CONFLICT" | "UNMATCHED";
export type FillValue = {
  field: string;
  label: string | null;
  type: FieldType;
  page: number;
  key: string | null;
  value: string | null;
  status: FillStatus;
  source: string | null;
  protected: boolean;
  /** The record field a person can fill in place ("lead.parcelNumber"). */
  recordField: string | null;
  alternatives?: { value: string; source: string }[];
  note?: string;
  /** A radio group's or dropdown's options, for a person choosing by hand. */
  options?: string[];
};

export const CHECKED = "Yes";
export const UNCHECKED = "Off";

export type ParsedMapping = { kind: "key"; key: string } | { kind: "literal"; text: string } | { kind: "when"; key: string; equals: string } | { kind: "none" };

export function parseMapping(dataKey: string | null): ParsedMapping {
  if (!dataKey?.trim()) return { kind: "none" };
  const v = dataKey.trim();
  if (v.startsWith("literal:")) return { kind: "literal", text: v.slice(8) };
  const when = v.match(/^when:([a-zA-Z.]+)=(.*)$/);
  if (when) return { kind: "when", key: when[1], equals: when[2].trim() };
  return { kind: "key", key: v };
}

const TRANSFORM = /^(upper|date|phone|money|digits|char:\d{1,2}|map:.+)$/;

/** Why a mapping cannot be used on this field, or null. */
export function mappingProblem(field: Pick<InventoryField, "type" | "options">, dataKey: string | null, transform: string | null): string | null {
  const m = parseMapping(dataKey);
  if (field.type === "signature" && m.kind !== "none") return "A signature is signed by hand; leave it unmapped";
  if ((m.kind === "key" || m.kind === "when") && !dictKey(m.key)) return `There is no data key "${m.key}"`;
  if (m.kind === "when" && field.type !== "checkbox") return "“when:” is for a checkbox";
  if (m.kind === "literal" && (field.type === "radio" || field.type === "dropdown") && field.options && !field.options.some((o) => same(o, m.text))) return `"${m.text}" is not one of the field's options`;
  if (transform && !TRANSFORM.test(transform)) return `Unknown transform "${transform}"`;
  if (transform?.startsWith("char:") && Number(transform.slice(5)) < 1) return "char: counts from 1";
  return null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "map:reroof=Roofing|building=Structural" → the translated value, or the value itself when no entry matches. */
function mapValue(value: string, table: string): string {
  for (const pair of table.split("|")) {
    const i = pair.indexOf("=");
    if (i > 0 && same(pair.slice(0, i), value)) return pair.slice(i + 1).trim();
  }
  return value;
}

export function applyTransform(value: string, transform: string | null): string {
  if (!transform) return value;
  if (transform === "upper") return value.toUpperCase();
  if (transform === "digits") return value.replace(/\D/g, "");
  if (transform === "date") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
  }
  if (transform === "phone") {
    const d = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : value;
  }
  if (transform === "money") {
    const n = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
  }
  if (transform.startsWith("char:")) {
    // one box of a number printed a character per box (a PCN): separators are not boxes
    const chars = value.replace(/[\s\-./]/g, "");
    return chars.charAt(Number(transform.slice(5)) - 1);
  }
  if (transform.startsWith("map:")) return mapValue(value, transform.slice(4));
  return value;
}

/** The value one field gets for this permit, before a person's override. */
export function fillField(field: InventoryField, map: FieldMap | undefined, ctx: FormContext): FillValue {
  const base = { field: field.name, label: field.label, type: field.type, page: field.page, key: null as string | null, value: null as string | null, source: null as string | null, protected: false, recordField: null as string | null, ...(field.options?.length ? { options: field.options } : {}) };
  if (field.type === "signature") return { ...base, status: "SIGN_BY_HAND" };
  const m = parseMapping(map?.dataKey ?? null);
  if (m.kind === "none") return { ...base, status: "BLANK" };
  if (m.kind === "literal") {
    const v = applyTransform(m.text, map?.transform ?? null);
    return finish(field, { ...base, value: v, source: "fixed on the form template", status: "FILLED" });
  }
  const d = dictKey(m.key);
  if (!d) return { ...base, key: m.key, status: "MISSING", note: `Unknown data key ${m.key}` };
  const res = d.resolve(ctx);
  const common = { ...base, key: d.key, source: res.source, protected: !!d.protected, recordField: d.field ?? null };
  if (m.kind === "when") {
    const on = res.value != null && same(res.value, m.equals);
    return { ...common, value: on ? CHECKED : UNCHECKED, status: "FILLED" };
  }
  if (res.value == null) return { ...common, status: "MISSING" };
  const value = applyTransform(res.value, map?.transform ?? null);
  if (res.alternatives?.length) return { ...common, value, status: "CONFLICT", alternatives: res.alternatives, note: "The records disagree — pick the right value" };
  return finish(field, { ...common, value, status: value ? "FILLED" : "MISSING" });
}

/** A radio or dropdown value must be one of the options; text longer than the box is cut and said so. */
function finish(field: InventoryField, v: FillValue & { status: FillStatus }): FillValue {
  if ((field.type === "radio" || field.type === "dropdown") && v.value != null) {
    const option = field.options?.find((o) => same(o, v.value!));
    if (!option) return { ...v, status: "UNMATCHED", note: `“${v.value}” is not one of: ${(field.options ?? []).join(", ")}` };
    return { ...v, value: option };
  }
  if (field.type === "checkbox" && v.value != null && v.value !== CHECKED && v.value !== UNCHECKED) {
    return { ...v, value: /^(y|yes|true|x|1|on|checked)$/i.test(v.value) ? CHECKED : UNCHECKED };
  }
  if (field.type === "text" && field.maxLen && v.value && v.value.length > field.maxLen) {
    return { ...v, value: v.value.slice(0, field.maxLen), note: `Cut to the box's ${field.maxLen} characters` };
  }
  return v;
}

/** Every field of the form, with a person's overrides on top. */
export function planFill(inventory: readonly InventoryField[], maps: readonly FieldMap[], ctx: FormContext, overrides: Record<string, string>): FillValue[] {
  const byField = new Map(maps.map((m) => [m.fieldName, m]));
  return inventory.map((f) => {
    const v = fillField(f, byField.get(f.name), ctx);
    if (Object.prototype.hasOwnProperty.call(overrides, f.name) && f.type !== "signature") {
      return finish(f, { ...v, value: overrides[f.name], status: "OVERRIDDEN", source: "typed by a person", alternatives: undefined, note: undefined });
    }
    return v;
  });
}

export type FillSummary = Record<FillStatus, number> & { total: number };

export function summarize(values: readonly FillValue[]): FillSummary {
  const s = { FILLED: 0, MISSING: 0, BLANK: 0, SIGN_BY_HAND: 0, OVERRIDDEN: 0, CONFLICT: 0, UNMATCHED: 0, total: values.length };
  for (const v of values) s[v.status]++;
  return s;
}

/** A form is finalised only once every disagreement and every impossible choice has been settled by a person. */
export function finalizeProblems(values: readonly FillValue[]): string[] {
  const out: string[] = [];
  const conflicts = values.filter((v) => v.status === "CONFLICT");
  const unmatched = values.filter((v) => v.status === "UNMATCHED");
  if (conflicts.length) out.push(`${conflicts.length} field${conflicts.length === 1 ? "" : "s"} where the records disagree: ${conflicts.map((v) => v.label ?? v.field).join(", ")}`);
  if (unmatched.length) out.push(`${unmatched.length} choice${unmatched.length === 1 ? "" : "s"} matching none of the form's options: ${unmatched.map((v) => v.label ?? v.field).join(", ")}`);
  return out;
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export type TextItem = { str: string; x: number; y: number; w: number; h: number };

/**
 * The printed label a field sits beside: the text to its left on the same
 * line, else the text just above it. A help for the person and the mapping;
 * the field name goes along too.
 */
export function nearestLabel(rect: [number, number, number, number], items: readonly TextItem[]): string | null {
  const [x, y, , h] = rect;
  const mid = y + h / 2;
  // "FBC Version: Permit Type" → "Permit Type": the last labelled part of a line is the field's
  const tidy = (s: string) => {
    const parts = s.replace(/_+/g, " ").replace(/\s+/g, " ").split(":").map((p) => p.trim());
    const last = [...parts].reverse().find((p) => p.replace(/[^a-zA-Z]/g, "").length >= 2);
    return (last ?? parts.join(" ")).replace(/[:\s]+$/, "").trim();
  };
  // A printed label often runs on as an underline beneath the field
  // ("PROPERTY OWNER:_____", "ADDRESS: ____UNIT:___"): such a run is cut where
  // the field starts, keeping the words after the last stretch of underscores.
  const cut = (t: TextItem): TextItem | null => {
    if (t.x + t.w <= x + 3) return t;
    if (t.x >= x - 2 || !t.str.length) return null;
    let keep = Math.floor(((x - t.x) / t.w) * t.str.length);
    // the width is spread evenly over the characters, which is rough: finish the word the cut lands in
    while (keep < t.str.length && /[^\s_]/.test(t.str[keep]) && /[^\s_]/.test(t.str[keep - 1] ?? "")) keep++;
    const head = t.str.slice(0, keep).split(/_{2,}/).filter((s) => s.trim()).pop() ?? "";
    return head.trim() ? { ...t, str: head, w: x - t.x } : null;
  };
  const left = items
    .filter((t) => t.str.trim() && Math.abs(t.y + t.h / 2 - mid) <= Math.max(4, h / 2) && t.x < x && x - (t.x + Math.min(t.w, x - t.x)) < 240)
    .map(cut)
    .filter((t): t is TextItem => !!t)
    .sort((a, b) => b.x - a.x);
  if (left.length) {
    const parts: TextItem[] = [left[0]];
    for (const t of left.slice(1)) {
      if (parts[0].x - (t.x + t.w) > 18) break;
      parts.unshift(t);
    }
    const label = tidy(parts.map((p) => p.str).join(" "));
    if (label.replace(/[^a-zA-Z]/g, "").length >= 2) return label.slice(0, 120);
  }
  const above = items
    .filter((t) => t.str.trim() && t.y > y + h - 2 && t.y - (y + h) < 16 && t.x < x + rect[2] && t.x + t.w > x - 4)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (above.length) {
    const label = tidy(above.filter((t) => Math.abs(t.y - above[0].y) < 3).map((t) => t.str).join(" "));
    if (label.replace(/[^a-zA-Z]/g, "").length >= 2) return label.slice(0, 120);
  }
  return null;
}

// ─── Accepting the AI's mapping ─────────────────────────────────────────────

/**
 * The model's mapping for one field, as it may be stored: a fixed value only
 * as a choice among a field's own options (never text — a document cannot
 * plant a licence number), anything the field cannot take dropped with the
 * reason, so the person sees why it is blank.
 */
export function acceptMapping(field: InventoryField, answer: { dataKey: string | null; transform: string | null }): { dataKey: string | null; transform: string | null; dropped: string | null } {
  const m = parseMapping(answer.dataKey);
  if (m.kind === "none") return { dataKey: null, transform: null, dropped: null };
  if (m.kind === "literal" && field.type !== "radio" && field.type !== "dropdown" && field.type !== "checkbox") {
    return { dataKey: null, transform: null, dropped: "A fixed text value is never taken from the AI" };
  }
  if (m.kind === "literal" && field.type === "checkbox" && m.text !== CHECKED && m.text !== UNCHECKED) {
    return { dataKey: null, transform: null, dropped: "A checkbox takes Yes or Off" };
  }
  const transform = answer.transform?.trim() || null;
  const problem = mappingProblem(field, answer.dataKey, transform);
  if (problem) return { dataKey: null, transform: null, dropped: problem };
  if (transform?.startsWith("char:") && m.kind !== "key") return { dataKey: null, transform: null, dropped: "char: takes a key" };
  return { dataKey: answer.dataKey!.trim(), transform, dropped: null };
}
