// Client-side photo downscaling before queue/upload. One move solves four
// problems: HEIC → universal JPEG (Safari decodes HEIC into the canvas),
// jobsite-LTE upload size (~3–8 MB → ~300–600 KB), IndexedDB queue
// footprint, and react-pdf memory when photos embed in daily reports.

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.8;

export type PreparedPhoto = {
  blob: Blob;
  fileName: string;
  converted: boolean;
};

export async function downscalePhoto(file: File): Promise<PreparedPhoto> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) throw new Error("toBlob failed");

      return {
        blob,
        fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        converted: true,
      };
    } finally {
      bitmap.close();
    }
  } catch {
    // Decode failure (odd format, memory pressure): upload the original.
    return { blob: file, fileName: file.name, converted: false };
  }
}
