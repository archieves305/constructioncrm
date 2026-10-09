import { execFile } from "node:child_process";
import path from "node:path";
import { logger } from "@/lib/logger";

/**
 * Runs the extraction worker (`extract-worker.mjs`) as its own process and
 * reads its JSON lines. The worker is started by path from the working
 * directory, which is the app folder in dev and on the droplet.
 */
const WORKER_PATH = path.join(process.cwd(), "src", "lib", "takeoff", "pdf", "extract-worker.mjs");

export type InventoryResult = { pages: number; sizes: { page: number; widthPt: number; heightPt: number; rotation: number }[] };

export type PageResult = {
  page: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  textItems: number;
  segments: number;
  images: number;
  files: { text: string | null; geometry: string | null; renders: Record<string, string> };
  ms: number;
};

type Line = Record<string, unknown>;

async function run(args: Record<string, unknown>, timeoutMs: number): Promise<Line[]> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [WORKER_PATH, JSON.stringify(args)], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      const lines: Line[] = [];
      for (const raw of String(stdout).split("\n")) {
        const t = raw.trim();
        if (!t) continue;
        try { lines.push(JSON.parse(t) as Line); } catch { /* a stray line from a dependency; ignored */ }
      }
      const errLine = lines.find((l) => typeof l.error === "string");
      if (errLine) return reject(new Error(`extraction failed: ${String(errLine.error)}`));
      if (error) {
        logger.warn("takeoff worker failed", { code: (error as NodeJS.ErrnoException).code, signal: (error as { signal?: string }).signal, stderr: String(stderr).slice(0, 500) });
        return reject(new Error((error as { killed?: boolean }).killed ? "extraction timed out" : `extraction failed (${(error as NodeJS.ErrnoException).code ?? "exit"})`));
      }
      resolve(lines);
    });
  });
}

export async function inventoryPdf(pdfPath: string, timeoutMs = 60_000): Promise<InventoryResult> {
  const lines = await run({ pdf: pdfPath, mode: "inventory" }, timeoutMs);
  const hit = lines.find((l) => typeof l.pages === "number");
  if (!hit) throw new Error("extraction returned no inventory");
  return hit as unknown as InventoryResult;
}

export async function extractPages(input: { pdfPath: string; outDir: string; pages: number[]; renders: number[]; extract?: boolean }, timeoutMs = 120_000): Promise<PageResult[]> {
  const lines = await run({ pdf: input.pdfPath, mode: "pages", outDir: input.outDir, pages: input.pages, renders: input.renders, extract: input.extract !== false }, timeoutMs);
  return lines.filter((l) => typeof l.page === "number") as unknown as PageResult[];
}
