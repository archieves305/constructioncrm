import { promises as fs } from "node:fs";
import { ensureStorageDir, fileExists, resolveStoragePath } from "@/lib/files/storage";
import { extractPages } from "../pdf/worker-client";
import { documentArtifactKey } from "../sheet-cache";
import { imageScale } from "./candidates";

/**
 * The picture of a sheet that goes to the model: rendered by the worker at
 * the whole dpi that keeps the long edge under the model's limit, kept
 * beside the sheet's other renders and reused on a re-run.
 */
export type AiImage = { dpi: number; pxPerPt: number; widthPx: number; heightPx: number; base64: string; bytes: number };

export async function aiImageFor(sheet: { pageNumber: number; widthPt: number; heightPt: number; planDocument: { id: string; file: { storageKey: string } } }): Promise<AiImage> {
  const scale = imageScale(sheet.widthPt, sheet.heightPt);
  const dirKey = documentArtifactKey(sheet.planDocument.id);
  const key = `${dirKey}/p${sheet.pageNumber}.r${scale.dpi}.png`;
  if (!(await fileExists(key))) {
    const outDir = await ensureStorageDir(dirKey);
    const [result] = await extractPages({ pdfPath: resolveStoragePath(sheet.planDocument.file.storageKey), outDir, pages: [sheet.pageNumber], renders: [scale.dpi], extract: false });
    if (!result?.files.renders[String(scale.dpi)]) throw new Error(`page ${sheet.pageNumber} could not be rendered`);
  }
  const buffer = await fs.readFile(resolveStoragePath(key));
  return { ...scale, base64: buffer.toString("base64"), bytes: buffer.length };
}
