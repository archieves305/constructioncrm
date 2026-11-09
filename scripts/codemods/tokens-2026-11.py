#!/usr/bin/env python3
"""T-10 codemod: raw Tailwind palette classes -> design tokens, arbitrary text sizes -> the scale.

usage: python3 scripts/codemods/tokens-2026-11.py [--dry] [files...]   (default: src/**/*.ts(x))
Prints every class it could not map; those are fixed by hand. Variant prefixes
(hover:, focus-visible:, group-hover:) and opacity suffixes (/60) are kept;
`dark:` raw-colour classes are dropped (the tokens carry both themes).
"""
import pathlib, re, sys

NEUTRAL = {"gray", "slate", "zinc", "neutral", "stone"}
TONE = {"red": "tone-danger", "rose": "tone-danger",
        "amber": "tone-warning", "yellow": "tone-warning", "orange": "tone-warning",
        "green": "tone-success", "emerald": "tone-success", "lime": "tone-success",
        "blue": "tone-info", "sky": "tone-info"}
STAGE = {"violet": "stage-0", "indigo": "stage-0", "purple": "stage-0", "fuchsia": "stage-0", "pink": "stage-0",
         "teal": "stage-2", "cyan": "stage-2"}
HUES = "|".join(sorted(NEUTRAL | set(TONE) | set(STAGE)))
PROPS = "bg|text|border(?:-[trblxy])?|ring|divide|outline|decoration|placeholder|fill|stroke|from|to|via|accent|caret"
CLS = re.compile(r"(?<![\w-])((?:[a-z0-9-]+:)*)(" + PROPS + r")-(" + HUES + r")-(\d{2,3})(/\d+)?(?![\w-])")
SIZE = re.compile(r"(?<![\w-])((?:[a-z0-9-]+:)*)text-\[(9|10|11|12)px\](?![\w-])|text-\[0\.8rem\]")

DARK = re.compile(r" ?(?<![\w-])dark:(?:" + PROPS + r")-(?:" + HUES + r")-\d{2,3}(?:/\d+)?(?![\w-])")

LINE_PROPS = ("border", "ring", "divide", "outline")

def neutral(prop, n):
    base = prop.split("-")[0]
    if base == "bg":
        return {50: "surface-subtle", 100: "surface-muted", 200: "surface-strong", 300: "surface-emphasis"}.get(n) or ("tone-neutral" if n <= 500 else "foreground")
    if base in ("text", "placeholder", "decoration", "caret"):
        if n >= 800: return "foreground"
        if n >= 600: return "fg-secondary"
        if n >= 300: return "muted-foreground"
        return "background"
    if base in LINE_PROPS:
        return "border" if n <= 200 else ("border-strong" if n <= 500 else "foreground")
    if base in ("fill", "stroke"):
        return "muted-foreground" if n >= 300 else "surface-strong"
    return None

def tone(prop, n, t):
    base = prop.split("-")[0]
    if base == "bg":
        if n <= 200: return f"{t}-soft"
        if n == 300: return f"{t}-line"
        return t
    if base in ("text", "placeholder", "decoration", "caret"):
        if n <= 200: return "background"
        return t if n <= 400 else f"{t}-fg"
    if base in LINE_PROPS:
        return f"{t}-line" if n <= 300 else t
    if base in ("fill", "stroke", "accent"):
        return f"{t}-soft" if n <= 200 else t
    return None

def stage(prop, n, s):
    base = prop.split("-")[0]
    if base == "bg":
        return f"{s}-soft" if n <= 200 else (f"{s}/40" if n == 300 else s)
    if base in ("text", "placeholder", "decoration", "caret"):
        return "background" if n <= 200 else (s if n <= 400 else f"{s}-fg")
    if base in LINE_PROPS:
        return f"{s}/40" if n <= 300 else s
    if base in ("fill", "stroke"):
        return f"{s}-soft" if n <= 200 else s
    return None

unmapped = {}

def repl(m):
    variants, prop, hue, shade, alpha = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5) or ""
    if "dark:" in variants:
        return ""  # the token already has a dark value
    if prop in ("from", "to", "via"):
        unmapped[m.group(0)] = unmapped.get(m.group(0), 0) + 1
        return m.group(0)
    if hue in NEUTRAL: tok = neutral(prop, shade)
    elif hue in TONE: tok = tone(prop, shade, TONE[hue])
    else: tok = stage(prop, shade, STAGE[hue])
    if tok is None:
        unmapped[m.group(0)] = unmapped.get(m.group(0), 0) + 1
        return m.group(0)
    if "/" in tok and alpha:
        alpha = ""
    return f"{variants}{prop}-{tok}{alpha}"

def size(m):
    if m.group(0) == "text-[0.8rem]": return "text-xs"
    variants, px = m.group(1) or "", int(m.group(2))
    return variants + {9: "text-3xs", 10: "text-3xs", 11: "text-2xs", 12: "text-xs"}[px]

def main():
    args = [a for a in sys.argv[1:] if a != "--dry"]
    dry = "--dry" in sys.argv
    files = [pathlib.Path(a) for a in args] or [p for p in pathlib.Path("src").rglob("*") if p.suffix in (".ts", ".tsx") and "generated" not in p.parts]
    changed = 0
    for p in files:
        s = p.read_text()
        t = DARK.sub("", s)  # with its leading space, so no gap is left
        t = CLS.sub(repl, t)
        t = SIZE.sub(size, t)
        if t != s:
            changed += 1
            if not dry: p.write_text(t)
    print(f"{'would change' if dry else 'changed'} {changed} files")
    for k, v in sorted(unmapped.items(), key=lambda kv: -kv[1]):
        print(f"  unmapped: {k} ×{v}")

main()
