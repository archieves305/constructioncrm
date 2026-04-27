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
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "");
}
