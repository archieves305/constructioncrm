import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * VoiceOver check, from the source: every Pressable says what it is
 * (accessibilityRole) and what it does (accessibilityLabel, or text inside
 * that VoiceOver reads), and every TextInput has a name. A failure lists the
 * file and line.
 */
const ROOT = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/** Each `<Tag …>` opening element with its attributes and, for Pressable, the children up to `</Tag>`. */
function elements(src: string, tag: string): { line: number; attrs: string; body: string }[] {
  const out: { line: number; attrs: string; body: string }[] = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + tag.length + 1;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const attrs = src.slice(m.index, i + 1);
    const selfClosing = attrs.endsWith("/>");
    const close = selfClosing ? i + 1 : src.indexOf(`</${tag}>`, i);
    out.push({ line: src.slice(0, m.index).split("\n").length, attrs, body: selfClosing ? "" : src.slice(i + 1, close) });
  }
  return out;
}

const problems: string[] = [];
for (const f of files(ROOT)) {
  const src = readFileSync(f, "utf8");
  const rel = f.slice(ROOT.length + 1);
  for (const e of elements(src, "Pressable")) {
    if (/accessible=\{false\}/.test(e.attrs)) continue; // a tap-catcher, hidden from VoiceOver on purpose
    if (!/accessibilityRole=/.test(e.attrs)) problems.push(`${rel}:${e.line} Pressable without accessibilityRole`);
    const named = /accessibilityLabel=/.test(e.attrs) || /<Text\b/.test(e.body);
    if (!named) problems.push(`${rel}:${e.line} Pressable with no accessibilityLabel and no text`);
  }
  for (const e of elements(src, "TextInput")) {
    if (!/accessibilityLabel=/.test(e.attrs)) problems.push(`${rel}:${e.line} TextInput without accessibilityLabel`);
  }
}

test("every control has a role and a name for VoiceOver", () => {
  assert.deepEqual(problems, []);
});
