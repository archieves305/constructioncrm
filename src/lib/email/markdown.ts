import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function markdownToHtml(source: string): string {
  return marked.parse(source, { async: false }) as string;
}

export function stripMarkdown(source: string): string {
  return source
    // Drop HTML tags, keeping inner text and converting blocks to line breaks.
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Decode the most common entities so plain text reads naturally.
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Markdown leftovers (legacy templates).
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    // Collapse runs of blank lines.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
