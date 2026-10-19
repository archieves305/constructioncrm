import { logger } from "@/lib/logger";

/**
 * The text of a PDF, page by page, with pdfjs (the legacy Node build, as the
 * roofing reader uses). Glyph runs on the same line are joined; a scanned
 * page simply comes back empty — no OCR here. Links are the pages' link
 * annotations (what a reader clicks). Never throws: an unreadable
 * file is `null`.
 */
export type PdfText = { pages: string[]; pageCount: number; links: { page: number; url: string }[] };

/** Long plan sets are read only so far: enough to search and to name the document. */
export const MAX_PAGES_READ = 60;

export async function readPdfText(bytes: Buffer, maxPages = MAX_PAGES_READ): Promise<PdfText | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
    const pages: string[] = [];
    const links: { page: number; url: string }[] = [];
    try {
      for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const lines: string[] = [];
        let line = "";
        let lastY: number | null = null;
        for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
          const str = it.str ?? "";
          const y = it.transform?.[5] ?? null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
            if (line.trim()) lines.push(line.trim());
            line = "";
          }
          line += (line && str ? " " : "") + str;
          if (y !== null) lastY = y;
        }
        if (line.trim()) lines.push(line.trim());
        pages.push(lines.join("\n").replace(/[ \t]{2,}/g, " "));
        // the page's link annotations — what a reader clicks
        try {
          for (const a of (await page.getAnnotations()) as Array<{ subtype?: string; url?: string; unsafeUrl?: string }>) {
            const url = a.subtype === "Link" ? (a.url ?? a.unsafeUrl) : undefined;
            if (url) links.push({ page: i, url });
          }
        } catch {
          /* a page whose annotations cannot be read still has its text */
        }
        page.cleanup();
      }
      return { pages, pageCount: doc.numPages, links };
    } finally {
      await doc.destroy();
    }
  } catch (err) {
    logger.warn("pdf text extraction failed", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The stored text: pages separated by a form feed, capped so one plan set cannot fill a row. */
export const MAX_STORED_TEXT = 500_000;

export function joinPages(t: PdfText): string {
  // Postgres refuses a NUL in text, and some PDFs carry them in their glyph runs
  return t.pages.join("\n\f\n").replace(/\u0000/g, "").slice(0, MAX_STORED_TEXT);
}
