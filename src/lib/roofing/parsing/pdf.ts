
import { recommendedWasteFromItems, type RecommendedWaste } from "./waste-table";

// PDF → text extraction using the maintained pdfjs-dist (legacy Node build),
// which handles modern PDFs (object streams, compression) that the ancient
// pdf.js bundled inside pdf-parse cannot.

export interface PdfTextResult {
  text: string;
  pages: number;
  usedOcr: boolean;
  /** Roofr's recommended waste, read from text positions; null when the report has no waste table. */
  recommendedWaste: RecommendedWaste | null;
}

export async function extractPdfText(bytes: Buffer): Promise<PdfTextResult> {
  let text = "";
  let pages = 0;
  let recommendedWaste: RecommendedWaste | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Node has no DOM worker; the library falls back to a fake worker when none
    // is configured. Passing the data as a Uint8Array avoids Buffer quirks.
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;
    pages = doc.numPages;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // pdfjs returns positioned glyph runs with no line breaks. Reconstruct
      // lines by grouping runs with the same vertical position so label/value
      // pairs ("Eaves: 140 ft") stay on their own line for the parser.
      const items = content.items as Array<{ str: string; transform?: number[]; width?: number }>;
      // The waste recommendation only exists as a position (see waste-table.ts).
      recommendedWaste ??= recommendedWasteFromItems(
        items.map((it) => ({ str: it.str, x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, width: it.width ?? 0 })),
      );
      let line = "";
      let lastY: number | null = null;
      const lines: string[] = [];
      for (const it of items) {
        const y = it.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.trim());
          line = "";
        }
        line += (line && it.str ? " " : "") + it.str;
        if (y !== null) lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      parts.push(lines.join("\n"));
    }
    text = parts.join("\n").replace(/[ \t]{2,}/g, " ");
    await doc.destroy();
  } catch (err) {
    console.error("[pdf] text extraction failed", err);
  }

  // A scanned (image-only) report yields almost no text. There is no OCR: the
  // caller keeps the document and a person types the measurements.
  return { text, pages, usedOcr: false, recommendedWaste };
}
