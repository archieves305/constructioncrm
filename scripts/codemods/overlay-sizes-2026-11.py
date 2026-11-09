#!/usr/bin/env python3
"""T-16: hand-set widths on DialogContent / SheetContent → the `size` prop.

Reads each <DialogContent …> / <SheetContent …> opening tag, takes the width
the dialog actually had (a `sm:` class wins over an unprefixed one, because the
component's own `sm:max-w-sm` beat an unprefixed class from 640 px up — those
were narrower on a desktop than their author meant; they now get the width
they asked for), removes the width classes and the scroll classes the
component now carries itself, and writes `size="…"`. Dry run by default;
--write changes the files. Prints every change.
"""
import os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "src"
WRITE = "--write" in sys.argv
TAG = re.compile(r"<(DialogContent|SheetContent)\b(?=[\s>])(.*?)(/?>)", re.S)
CLASS = re.compile(r'className=(?:"([^"]*)"|\{cn\(\s*"([^"]*)")')
WIDTH = re.compile(r"^(sm:|md:|lg:)?max-w-(sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)$")
DIALOG = {"sm": "sm", "md": "md", "lg": "md", "xl": "lg", "2xl": "lg", "3xl": "xl", "4xl": "xl", "5xl": "full", "6xl": "full", "7xl": "full"}
SHEET = {"sm": "sm", "md": "md", "lg": "md", "xl": "lg", "2xl": "xl", "3xl": "xl", "4xl": "xl"}
# The component scrolls and caps its own height now; these only repeated it.
DIALOG_DROP = re.compile(r"^(max-h-\[9\d(?:d?vh)\]|overflow-y-auto|w-full|w-\[95vw\])$")

def size_for(kind, classes):
    pref = [c for c in classes if WIDTH.match(c) and WIDTH.match(c).group(1)]
    bare = [c for c in classes if WIDTH.match(c) and not WIDTH.match(c).group(1)]
    pick = (pref or bare)
    if not pick:
        return None
    w = WIDTH.match(pick[-1]).group(2)  # last wins, as in tailwind-merge
    return (DIALOG if kind == "DialogContent" else SHEET)[w]

changed = 0
for d, _, fs in os.walk(ROOT):
    for f in fs:
        if not f.endswith(".tsx") or f in ("dialog.tsx", "sheet.tsx"):
            continue
        p = os.path.join(d, f)
        src = open(p).read()
        out, pos = [], 0
        for m in TAG.finditer(src):
            kind, attrs, end = m.groups()
            cm = CLASS.search(attrs)
            if not cm or "size=" in attrs:
                continue
            raw = cm.group(1) if cm.group(1) is not None else cm.group(2)
            classes = raw.split()
            size = size_for(kind, classes)
            if size is None:
                continue
            keep = [c for c in classes if not WIDTH.match(c) and not (kind == "DialogContent" and DIALOG_DROP.match(c))]
            new_raw = " ".join(keep)
            if cm.group(1) is not None:
                new_cls = f'className="{new_raw}"' if new_raw else ""
            else:
                new_cls = cm.group(0).replace(f'"{raw}"', f'"{new_raw}"', 1)
            size_attr = "" if size == "sm" else f' size="{size}"'
            new_attrs = attrs[: cm.start()] + new_cls + attrs[cm.end():]
            new_attrs = re.sub(r"\s+$", "", new_attrs) if not new_raw and cm.group(1) is not None else new_attrs
            new_tag = f"<{kind}{size_attr}{new_attrs}{end}"
            new_tag = re.sub(r"\s{2,}(/?>)$", r"\1", new_tag)
            out.append(src[pos:m.start()]); out.append(new_tag); pos = m.end()
            changed += 1
            print(f"{p}: {' '.join(c for c in classes if WIDTH.match(c))} -> size={size}")
        if out:
            out.append(src[pos:])
            if WRITE:
                open(p, "w").write("".join(out))
print(f"{changed} tags {'changed' if WRITE else 'would change'}")
