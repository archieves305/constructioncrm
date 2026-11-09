import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A custom property that refers to itself resolves to nothing, and the browser
// falls back silently (the whole app rendered in Times until 2026-11 because
// `--font-sans: var(--font-sans)`). Guard every declaration in globals.css.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("globals.css", () => {
  it("has no custom property that refers to itself", () => {
    const selfRefs: string[] = [];
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const [, name, value] = m;
      if (new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(value)) selfRefs.push(name);
    }
    expect(selfRefs).toEqual([]);
  });

  it("sets the sans font to Geist", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-geist-sans\)/);
  });
});
