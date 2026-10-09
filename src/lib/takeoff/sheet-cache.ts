import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { ensureStorageDir, fileExists, resolveStoragePath } from "@/lib/files/storage";
import { extractPages } from "./pdf/worker-client";
import type { PageGeometry, PageText } from "./types";

/** Where a document's derived artefacts live under the store. */
export const documentArtifactKey = (planDocumentId: string) => `plans/${planDocumentId}`;

export async function readSheetText(sheet: { textKey: string | null }): Promise<PageText | null> {
  if (!sheet.textKey) return null;
  try {
    return JSON.parse(await fs.readFile(resolveStoragePath(sheet.textKey), "utf8")) as PageText;
  } catch {
    return null;
  }
}

export async function readSheetGeometry(sheet: { geometryKey: string | null }): Promise<PageGeometry | null> {
  if (!sheet.geometryKey) return null;
  try {
    return JSON.parse(await fs.readFile(resolveStoragePath(sheet.geometryKey), "utf8")) as PageGeometry;
  } catch {
    return null;
  }
}

/**
 * The absolute path of a sheet's render at `dpi`, rendering it first when it
 * is not there yet (the 144 dpi level is made on first use, not at index time).
 */
export async function renderPathFor(sheetId: string, dpi: 72 | 144): Promise<string | null> {
  const sheet = await prisma.planSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, pageNumber: true, renderKey72: true, renderKey144: true, planDocument: { select: { id: true, file: { select: { storageKey: true } } } } },
  });
  if (!sheet) return null;
  const key = dpi === 72 ? sheet.renderKey72 : sheet.renderKey144;
  if (key && (await fileExists(key))) return resolveStoragePath(key);
  const dirKey = documentArtifactKey(sheet.planDocument.id);
  const outDir = await ensureStorageDir(dirKey);
  const pdfPath = resolveStoragePath(sheet.planDocument.file.storageKey);
  const [result] = await extractPages({ pdfPath, outDir, pages: [sheet.pageNumber], renders: [dpi], extract: false });
  const name = result?.files.renders[String(dpi)];
  if (!name) return null;
  const newKey = `${dirKey}/${name}`;
  await prisma.planSheet.update({ where: { id: sheetId }, data: dpi === 72 ? { renderKey72: newKey } : { renderKey144: newKey } });
  return resolveStoragePath(newKey);
}
