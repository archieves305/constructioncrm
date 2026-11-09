import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "./page-header";
import { DIALOG_SIZE_CLASS, SHEET_SIZE_CLASS } from "@/components/ui/overlay-size";

describe("PageHeader", () => {
  it("shows the title as the page's one h1, with the badge beside it and the actions", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Weekly payroll",
        badge: createElement("span", null, "Draft"),
        description: "One line",
        actions: createElement("button", null, "CSV"),
      }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Weekly payroll</h1><span>Draft</span>");
    expect(html).toContain("One line");
    expect(html).toContain("<button>CSV</button>");
  });

  it("names the back link", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "T", back: { href: "/admin/x", label: "Back to templates" } }));
    expect(html).toContain('href="/admin/x"');
    expect(html).toContain('aria-label="Back to templates"');
  });
});

describe("overlay sizes", () => {
  const px = { "sm:max-w-sm": 384, "sm:max-w-lg": 512, "sm:max-w-xl": 576, "sm:max-w-2xl": 672, "sm:max-w-4xl": 896, "sm:max-w-6xl": 1152 } as Record<string, number>;
  it("grow with the size, and every class is one Tailwind knows", () => {
    for (const table of [DIALOG_SIZE_CLASS, SHEET_SIZE_CLASS]) {
      const widths = Object.values(table).map((c) => px[c]);
      expect(widths.every(Boolean)).toBe(true);
      expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    }
  });
});
