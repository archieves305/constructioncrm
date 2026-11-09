#!/bin/bash
# Design-consistency measurements over src/app + src/components (*.tsx): the audit's Phase B exit checks.
cd "$(dirname "$0")/../.."
c() { grep -rEoh "$1" src/app src/components --include='*.tsx' | wc -l | tr -d ' '; }
f() { grep -rlE "$1" src/app src/components --include='*.tsx' | wc -l | tr -d ' '; }
P='(gray|slate|zinc|neutral|red|green|blue|amber|yellow|orange|emerald|sky|indigo|purple|pink|rose|teal|cyan|lime|violet|fuchsia|stone)'
# Patterns live in variables: bash 3.2 (macOS) brace-expands {2,3} inside "$( "…" )".
RAW="\b(bg|text|border|ring|from|to|fill|stroke|divide)-$P-[0-9]{2,3}"
RAWF="\b(bg|text|border|ring|divide)-$P-[0-9]{2,3}"
RAW3="\b(bg|text|border)-$P-[0-9]{2,3}"
printf '%s\n' "raw palette classes: $(c "$RAW") in $(f "$RAWF") files"
printf '%s\n' "  top raw colours: $(grep -rEoh "$RAW3" src/app src/components --include='*.tsx' | sort | uniq -c | sort -rn | head -8 | awk '{print $2"×"$1}' | tr '\n' ' ')"
printf '%s\n' "token classes: $(c '\b(bg|text|border|ring)-(primary|secondary|muted|accent|destructive|foreground|muted-foreground|background|card|popover|brand|tone-[a-z-]+|stage-[a-z0-9-]+)\b')"
printf '%s\n' "hex literals in tsx: $(c '#[0-9a-fA-F]{6}\b')"
printf '%s\n' "$(node scripts/qa/page-headers.mjs | head -2 | tr '\n' ' ')"
printf '%s\n' "dialogs/sheets with a hand-set max-w: $(grep -rEh -A3 '<(DialogContent|SheetContent)\b' src/app src/components --include='*.tsx' | grep -cE 'className=.*max-w-' | tr -d ' ')  with size=: $(c '<(DialogContent|SheetContent)[^>]*size=|^ +size="(md|lg|xl|full)"')"
printf '%s\n' "EmptyState files: $(f 'EmptyState')  Skeleton files: $(f '<Skeleton')"
printf '%s\n' "native confirm()/prompt(): $(c '\b(confirm|prompt)\(\s*["`]') calls in $(f '\b(confirm|prompt)\(\s*["`]') files; ConfirmDialog files: $(f 'ConfirmDialog')"
printf '%s\n' "raw <table> files: $(f '<table')  ui <Table> files: $(f '<Table\b')  sort-capable files: $(f 'aria-sort|onSort|toggleSort|sortBy')"
printf '%s\n' "native <select> files: $(f '<select\b')  <Select> files: $(f '<Select\b')  with items=: $(f '<Select[^>]*items=')"
printf '%s\n' "Button variants: $(grep -rEoh 'variant="[a-z]+"' src/app src/components --include='*.tsx' | sed 's/variant=//' | sort | uniq -c | sort -rn | head -7 | awk '{print $2"×"$1}' | tr '\n' ' ')"
printf '%s\n' "raw <button>: $(c '<button\b')  <Button>: $(c '<Button\b')"
printf '%s\n' "Badge files: $(f '<Badge\b')  stage/status pill files: $(f 'StagePill|StatusPill|PermitBadge|StagePillSelect')"
printf '%s\n' "arbitrary text-[Npx]: $(c 'text-\[[0-9]+px\]')  text-xs: $(c '\btext-xs\b')"
printf '%s\n' "toast calls: $(c 'toast\.(error|success|info|warning)\(')"
printf '%s\n' "raw fetch→json files: $(f 'fetch\([^;]*\)\s*\.then\(\(?(r|res)\)? => \(?(r|res)\.json')  fetchJson files: $(f 'fetchJson')"
printf '%s\n' "Dialog files: $(f '<Dialog\b')  Sheet files: $(f '<Sheet\b')"
printf '%s\n' "ui primitives: $(ls src/components/ui | wc -l | tr -d ' ')"
printf '%s\n' "Label without htmlFor: $(c '<Label( className="[^"]*")?>')  Label htmlFor: $(c '<Label htmlFor')"
printf '%s\n' "react-hook-form files: $(grep -rl 'from "react-hook-form"' src | wc -l | tr -d ' ')"
printf '%s\n' "icon-only Buttons (size=icon or sm + only an icon) approx: $(c 'size="icon')"
printf '%s\n' "aria-label count: $(c 'aria-label=')"
