import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { runAiCall } from "@/lib/ai/calls";
import { defaultModel } from "@/lib/ai/client";
import { nearestLabel, type InventoryField } from "../field-fill";
import { pageTextItems } from "../form-pdf";
import * as flatMap from "../prompts/flat-form-map";
import { findBlanks, toPdfRect } from "./detect";
import { markPage, renderFormPages } from "./form-worker-client";

/**
 * A flat form's fields: the blanks found on each rendered page, named
 * `p<page>-<n>`, with their position in PDF points and what the AI says each
 * asks for. The rest of form filling treats them as ordinary fields; only the
 * writer differs (text printed at the position instead of a field filled).
 */
export const FLAT_DPI = 150;
export const FLAT_MAX_PAGES = 12;
const PARALLEL = 3;

export type FlatMapping = { fieldName: string; dataKey: string | null; transform: string | null; confidence: number; rationale: string };

export async function mapFlatForm(bytes: Buffer, ctx: { templateId: string; sha256: string; userId: string | null }): Promise<{ inventory: InventoryField[]; mappings: FlatMapping[]; callIds: string[]; blanksFound: number }> {
  const dir = path.join(os.tmpdir(), `knuco-flat-${ctx.templateId}-${randomBytes(4).toString("hex")}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const pdfPath = path.join(dir, "form.pdf");
    await fs.writeFile(pdfPath, bytes);
    const [{ pages }, text] = await Promise.all([renderFormPages(pdfPath, dir, FLAT_DPI, FLAT_MAX_PAGES), pageTextItems(new Uint8Array(bytes))]);
    const inventory: InventoryField[] = [];
    const mappings: FlatMapping[] = [];
    const callIds: string[] = [];
    let blanksFound = 0;

    const work = pages.map((p) => async () => {
      const gray = new Uint8Array(await fs.readFile(path.join(dir, p.gray)));
      const found = findBlanks(gray, p.width, p.height, FLAT_DPI);
      if (!found.length) return;
      blanksFound += found.length;
      const pageIndex = p.page - 1;
      const candidates = found.map((c) => {
        const rect = toPdfRect(c, FLAT_DPI, p.heightPt);
        return { ...c, rect, nearby: nearestLabel(rect, text[pageIndex] ?? []) };
      });
      const marked = path.join(dir, `p${p.page}.marked.png`);
      await markPage(path.join(dir, p.png), marked, candidates);
      const png = await fs.readFile(marked);
      const r = await runAiCall({
        subjectType: "form_template",
        subjectId: ctx.templateId,
        purpose: flatMap.PURPOSE,
        promptVersion: flatMap.PROMPT_VERSION,
        schema: flatMap.schema,
        inputs: { sha256: ctx.sha256, page: p.page, candidates: candidates.map((c) => [c.id, c.kind, c.x, c.y, c.w, c.h]) },
        system: flatMap.SYSTEM,
        content: flatMap.content({ number: p.page, pngBase64: png.toString("base64"), width: p.width, height: p.height }, candidates),
        model: defaultModel(),
        effort: "medium",
        maxTokens: 16_000,
        userId: ctx.userId,
      });
      callIds.push(r.callId);
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const seen = new Set<number>();
      for (const a of r.output.fields) {
        const c = byId.get(a.id);
        if (!c || seen.has(a.id)) continue; // a number not on the page is not a field
        seen.add(a.id);
        const name = `p${p.page}-${a.id}`;
        // a tick box found on the page is a checkbox whatever the answer says
        const type = c.kind === "box" ? "checkbox" : a.type;
        inventory.push({ name, type, page: pageIndex, rect: c.rect, maxLen: null, label: a.label.trim().slice(0, 160) || c.nearby });
        mappings.push({ fieldName: name, dataKey: a.dataKey, transform: a.transform, confidence: a.confidence, rationale: a.rationale });
      }
    });
    for (let i = 0; i < work.length; i += PARALLEL) await Promise.all(work.slice(i, i + PARALLEL).map((w) => w()));

    inventory.sort((a, b) => a.page - b.page || b.rect[1] - a.rect[1] || a.rect[0] - b.rect[0]);
    return { inventory, mappings, callIds, blanksFound };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
