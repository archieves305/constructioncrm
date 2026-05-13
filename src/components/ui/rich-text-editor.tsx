"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Link2Off,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eraser,
  Undo2,
  Redo2,
  Palette,
  Highlighter,
  Pilcrow,
  Code2,
} from "lucide-react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
};

const COLORS = [
  "#111827", "#374151", "#6B7280", "#DC2626", "#EA580C",
  "#CA8A04", "#16A34A", "#0EA5E9", "#2563EB", "#7C3AED",
];

const HIGHLIGHTS = [
  "transparent", "#FEF3C7", "#FECACA", "#FED7AA", "#BBF7D0",
  "#BAE6FD", "#DDD6FE", "#FBCFE8",
];

function exec(cmd: string, val?: string) {
  document.execCommand(cmd, false, val);
}

export type RichTextEditorHandle = {
  insertAtCursor: (text: string) => void;
  focus: () => void;
};

export const RichTextEditor = React.forwardRef<RichTextEditorHandle, Props>(
  function RichTextEditor({ value, onChange, placeholder, className, minHeight = 280 }, ref) {
    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const [showColor, setShowColor] = React.useState(false);
    const [showHighlight, setShowHighlight] = React.useState(false);
    const isInternalUpdate = React.useRef(false);

    // Sync external value into editor only when it differs from current DOM
    React.useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (isInternalUpdate.current) {
        isInternalUpdate.current = false;
        return;
      }
      if (el.innerHTML !== value) {
        el.innerHTML = value || "";
      }
    }, [value]);

    React.useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        // Restore selection if it lives inside the editor; otherwise append to end.
        const sel = window.getSelection();
        let range: Range;
        if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
          range = sel.getRangeAt(0);
        } else {
          range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
        }
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel?.removeAllRanges();
        sel?.addRange(range);
        emitChange();
      },
      focus: () => editorRef.current?.focus(),
    }));

    function emitChange() {
      const el = editorRef.current;
      if (!el) return;
      isInternalUpdate.current = true;
      onChange(el.innerHTML);
    }

    function applyFormat(cmd: string, val?: string) {
      editorRef.current?.focus();
      exec(cmd, val);
      emitChange();
    }

    function applyBlock(tag: string) {
      editorRef.current?.focus();
      exec("formatBlock", `<${tag}>`);
      emitChange();
    }

    function insertLink() {
      const url = window.prompt("Link URL (https://…)");
      if (!url) return;
      applyFormat("createLink", url);
      // Make link target=_blank for safety in email clients (best-effort).
      const sel = window.getSelection();
      if (sel?.anchorNode?.parentElement?.tagName === "A") {
        sel.anchorNode.parentElement.setAttribute("target", "_blank");
        sel.anchorNode.parentElement.setAttribute("rel", "noopener noreferrer");
        emitChange();
      }
    }

    return (
      <div className={cn("rounded-md border bg-white", className)}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 border-b bg-gray-50 px-1 py-1">
          <ToolbarBtn title="Undo" onClick={() => applyFormat("undo")}>
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Redo" onClick={() => applyFormat("redo")}>
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          <ToolbarBtn title="Paragraph" onClick={() => applyBlock("p")}>
            <Pilcrow className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Heading 1" onClick={() => applyBlock("h1")}>
            <Heading1 className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Heading 2" onClick={() => applyBlock("h2")}>
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => applyFormat("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => applyFormat("italic")}>
            <Italic className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Underline (Ctrl+U)" onClick={() => applyFormat("underline")}>
            <Underline className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Strikethrough" onClick={() => applyFormat("strikeThrough")}>
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          {/* Color */}
          <div className="relative">
            <ToolbarBtn title="Text color" onClick={() => { setShowColor((s) => !s); setShowHighlight(false); }}>
              <Palette className="h-3.5 w-3.5" />
            </ToolbarBtn>
            {showColor && (
              <SwatchPopover
                colors={COLORS}
                onPick={(c) => { applyFormat("foreColor", c); setShowColor(false); }}
                onClose={() => setShowColor(false)}
              />
            )}
          </div>
          {/* Highlight */}
          <div className="relative">
            <ToolbarBtn title="Highlight" onClick={() => { setShowHighlight((s) => !s); setShowColor(false); }}>
              <Highlighter className="h-3.5 w-3.5" />
            </ToolbarBtn>
            {showHighlight && (
              <SwatchPopover
                colors={HIGHLIGHTS}
                onPick={(c) => {
                  applyFormat("hiliteColor", c);
                  // Fallback for browsers that need backColor
                  applyFormat("backColor", c);
                  setShowHighlight(false);
                }}
                onClose={() => setShowHighlight(false)}
              />
            )}
          </div>

          <Sep />

          <ToolbarBtn title="Bulleted list" onClick={() => applyFormat("insertUnorderedList")}>
            <List className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Numbered list" onClick={() => applyFormat("insertOrderedList")}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Quote" onClick={() => applyBlock("blockquote")}>
            <Quote className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Inline code" onClick={() => applyFormat("formatBlock", "pre")}>
            <Code2 className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          <ToolbarBtn title="Align left" onClick={() => applyFormat("justifyLeft")}>
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Align center" onClick={() => applyFormat("justifyCenter")}>
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Align right" onClick={() => applyFormat("justifyRight")}>
            <AlignRight className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          <ToolbarBtn title="Add link" onClick={insertLink}>
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Remove link" onClick={() => applyFormat("unlink")}>
            <Link2Off className="h-3.5 w-3.5" />
          </ToolbarBtn>

          <Sep />

          <ToolbarBtn title="Clear formatting" onClick={() => applyFormat("removeFormat")}>
            <Eraser className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>

        {/* Editor surface */}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          data-placeholder={placeholder}
          className={cn(
            "prose prose-sm max-w-none px-3 py-2 outline-none",
            "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-2",
            "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2",
            "[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
            "[&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600",
            "[&_a]:text-blue-600 [&_a]:underline",
            "[&_pre]:bg-gray-100 [&_pre]:rounded [&_pre]:px-2 [&_pre]:py-1 [&_pre]:font-mono [&_pre]:text-xs",
            "empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400",
          )}
          style={{ minHeight }}
        />
      </div>
    );
  },
);

function ToolbarBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep selection
      onClick={onClick}
      className="h-7 w-7"
    >
      {children}
    </Button>
  );
}

function Sep() {
  return <Separator orientation="vertical" className="mx-1 h-5" />;
}

function SwatchPopover({
  colors,
  onPick,
  onClose,
}: {
  colors: string[];
  onPick: (c: string) => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-swatch-popover]")) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  return (
    <div
      data-swatch-popover
      className="absolute left-0 top-full z-30 mt-1 grid grid-cols-5 gap-1 rounded-md border bg-white p-2 shadow-md"
    >
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
          className="h-5 w-5 rounded border border-gray-200"
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  );
}
