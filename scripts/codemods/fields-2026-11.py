#!/usr/bin/env python3
"""T-12 codemod: `<div><Label>Text</Label><Control/>{error}</div>` -> `<Field label="Text">…</Field>`.

Only rewrites the exact shape: a <div> wrapper with no nested <div>, a plain-text
<Label>, then one Input / Textarea / Select (with its trigger and content), and
optionally an `{errors.x && <p>{errors.x.message}</p>}` line. Everything else
is left for hand migration. usage: python3 scripts/codemods/fields-2026-11.py [--dry] [files...]
"""
import pathlib, re, sys

OPEN = re.compile(r'<div(?: className="([^"]*)")?>\s*<Label(?: htmlFor="([^"]+)")?(?: className="([^"]*)")?>\s*([^<>{}]+?)\s*</Label>')
HELP = re.compile(r'\s*<p className="[^"]*\btext-muted-foreground\b[^"]*">((?:(?!</?p\b).)*?)</p>\s*$', re.S)
ERR = re.compile(r'\s*\{(errors\.[\w.]+) && \(?\s*<p className="[^"]*">\s*\{\1\.message\}\s*</p>\s*\)?\}')

def matching_div_end(s, start):
    """Index just past the </div> closing the <div at `start`, or None if a nested div appears."""
    i = start + 4
    while True:
        o = s.find("<div", i)
        c = s.find("</div>", i)
        if c < 0: return None
        if 0 <= o < c: return None  # nested div: not the simple shape
        return c + len("</div>")

def control_ok(body):
    b = body.strip()
    if not re.match(r'<(Input|Textarea|Select)\b', b): return False
    if re.search(r'<(Label|Checkbox|Switch|RadioGroup|Field)\b', b): return False
    head = re.match(r'<(Input|Textarea|Select)\b', b).group(1)
    if head == "Select":
        # the whole body must be one <Select>…</Select> element
        return b.endswith("</Select>") and len(re.findall(r"<Select[\s>]", b)) == 1
    # self-closing Input / Textarea, and nothing after it
    end = find_self_close(b)
    return end is not None and b[end:].strip() == ""

def find_self_close(b):
    depth = 0
    for i, ch in enumerate(b):
        if ch == "{": depth += 1
        elif ch == "}": depth -= 1
        elif ch == "/" and depth == 0 and i + 1 < len(b) and b[i + 1] == ">": return i + 2
    return None

def esc(t):
    return t.replace('"', "&quot;")

def migrate(s, tag="Field"):
    out, i, n = [], 0, 0
    for m in OPEN.finditer(s):
        if m.start() < i: continue
        end = matching_div_end(s, m.start())
        if end is None: continue
        inner = s[m.end(): end - len("</div>")]
        err = None
        em = ERR.search(inner)
        if em and inner[em.end():].strip() == "":
            err = em.group(1)
            inner = inner[: em.start()]
        help_ = None
        if not err:
            hm = HELP.search(inner)
            if hm:
                help_ = hm.group(1).strip()
                inner = inner[: hm.start()]
        if not control_ok(inner): continue
        wrap_cls, html_for, label_cls, text = m.group(1), m.group(2), m.group(3), m.group(4)
        # a side-by-side wrapper keeps its layout; Field stacks label over control
        if wrap_cls and re.search(r"(^|\s)(flex|inline-flex|grid|items-|justify-|gap-)", wrap_cls): continue
        required = text.endswith("*")
        text = text.rstrip("* ").strip()
        cls = " ".join(c for c in (wrap_cls or "").split() if not re.match(r"^space-y-\d", c))
        attrs = [f'label="{esc(text)}"']
        if html_for: attrs.append(f'id="{html_for}"')
        if required: attrs.append("required")
        if err: attrs.append(f"error={{{err}?.message}}")
        if help_:
            attrs.append(f'help="{esc(help_)}"' if re.fullmatch(r'[^<>{}"]*', help_) else f"help={{<>{help_}</>}}")
        if cls: attrs.append(f'className="{cls}"')
        if label_cls:
            lc = " ".join(c for c in label_cls.split() if not re.match(r"^m[tb]-", c))
            if lc: attrs.append(f'labelClassName="{lc}"')
        # the control keeps its own attributes; drop mt-1-style spacing the grid now gives
        body = re.sub(r'(className="[^"]*?)\bmt-1(?:\.5)? ?', r"\1", inner.strip(), count=1).replace('className=""', "").replace('className=" ', 'className="')
        indent = re.match(r"[ \t]*", s[s.rfind("\n", 0, m.start()) + 1:]).group(0)
        out.append(s[i: m.start()])
        out.append(f"<{tag} {' '.join(attrs)}>\n{indent}  {body}\n{indent}</{tag}>")
        i = end
        n += 1
    out.append(s[i:])
    return "".join(out), n

def add_import(s, tag="Field"):
    if 'from "@/components/ui/field"' in s: return s
    lines = s.split("\n")
    idx = max(k for k, l in enumerate(lines[:120]) if l.startswith("import ") or l.startswith("} from "))
    spec = "Field" if tag == "Field" else f"Field as {tag}"
    lines.insert(idx + 1, f'import {{ {spec} }} from "@/components/ui/field";')
    return "\n".join(lines)

def main():
    dry = "--dry" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--dry"]
    files = [pathlib.Path(a) for a in args] or [p for p in pathlib.Path("src").rglob("*.tsx") if "components/ui" not in str(p)]
    total = files_changed = 0
    for p in files:
        s = p.read_text()
        # a file with its own Field component gets ours as FormField
        tag = "FormField" if re.search(r"^(export )?(function|const) Field\b", s, re.M) else "Field"
        t, n = migrate(s, tag)
        if n:
            t = add_import(t, tag)
            total += n; files_changed += 1
            if not dry: p.write_text(t)
    print(f"{'would migrate' if dry else 'migrated'} {total} fields in {files_changed} files")

main()
