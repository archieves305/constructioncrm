import { execFile } from "node:child_process";
import path from "node:path";
import { logger } from "@/lib/logger";

/**
 * Runs the flat-form worker (`form-worker.mjs`) as its own process and reads
 * its JSON lines — the takeoff worker's pattern. Started by path from the
 * working directory, which is the app folder in dev and on the droplet.
 */
const WORKER_PATH = path.join(process.cwd(), "src", "lib", "permit-intel", "flat", "form-worker.mjs");

export type RenderedPage = { page: number; width: number; height: number; widthPt: number; heightPt: number; png: string; gray: string };

async function run(args: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [WORKER_PATH, JSON.stringify(args)], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      const lines: Record<string, unknown>[] = [];
      for (const raw of String(stdout).split("\n")) {
        const t = raw.trim();
        if (!t) continue;
        try {
          lines.push(JSON.parse(t));
        } catch {
          /* a stray line from a dependency */
        }
      }
      const errLine = lines.find((l) => typeof l.error === "string");
      if (errLine) return reject(new Error(`form pages: ${String(errLine.error)}`));
      if (error) {
        logger.warn("form worker failed", { code: (error as NodeJS.ErrnoException).code, stderr: String(stderr).slice(0, 500) });
        return reject(new Error((error as { killed?: boolean }).killed ? "rendering the form timed out" : "the form could not be rendered"));
      }
      resolve(lines);
    });
  });
}

/** Render up to `maxPages` pages at `dpi`: a PNG and a raw grayscale buffer (one byte a pixel) per page. */
export async function renderFormPages(pdfPath: string, outDir: string, dpi = 150, maxPages = 12): Promise<{ pages: RenderedPage[]; pageCount: number }> {
  const lines = await run({ mode: "render", pdf: pdfPath, outDir, dpi, maxPages }, 180_000);
  const done = lines.find((l) => l.done) as { pages?: number } | undefined;
  return { pages: lines.filter((l) => typeof l.page === "number") as unknown as RenderedPage[], pageCount: done?.pages ?? 0 };
}

/** The page with each candidate drawn as a numbered box, for the AI to read. */
export async function markPage(pngPath: string, outPath: string, boxes: { id: number; kind: string; x: number; y: number; w: number; h: number }[]): Promise<void> {
  await run({ mode: "mark", png: pngPath, out: outPath, boxes }, 60_000);
}
