"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type MentionCandidate = { id: string; firstName: string; lastName: string };

/**
 * Note box with @mention autocomplete.
 *
 * The autocomplete is not a nicety — the server only resolves a bare first
 * name when it is unambiguous, so with two Franks a hand-typed "@Frank"
 * notifies nobody. Inserting the full name is what makes the mention land.
 */
export function NoteComposer({
  users,
  submitting,
  onSubmit,
  placeholder = "Add a note… use @ to pull someone in",
}: {
  users: MentionCandidate[];
  submitting: boolean;
  onSubmit: (body: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches =
    query === null
      ? []
      : users
          .filter((u) =>
            `${u.firstName} ${u.lastName}`.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 6);

  /** Track the partial handle between the last "@" and the caret. */
  function syncQuery(text: string, caret: number) {
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return setQuery(null);
    const fragment = upto.slice(at + 1);
    // A mention is at most two words; anything longer is ordinary prose that
    // happens to sit after an "@".
    if (/^[\p{L}'’.-]*(\s[\p{L}'’.-]*)?$/u.test(fragment)) {
      setQuery(fragment);
      setHighlight(0);
    } else {
      setQuery(null);
    }
  }

  function insertMention(u: MentionCandidate) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return;
    const handle = `@${u.firstName} ${u.lastName}`.trimEnd();
    const next = `${value.slice(0, at)}${handle} ${value.slice(caret)}`;
    setValue(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + handle.length + 1;
      el?.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const body = value.trim();
    if (!body || submitting) return;
    onSubmit(body);
    setValue("");
    setQuery(null);
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          syncQuery(e.target.value, e.target.selectionStart ?? 0);
        }}
        onKeyDown={(e) => {
          if (matches.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insertMention(matches[highlight]);
              return;
            }
            if (e.key === "Escape") {
              setQuery(null);
              return;
            }
          }
          // Enter alone inserts a newline: notes are often several lines, and
          // losing a half-written paragraph to a stray Enter is unforgivable.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {matches.length > 0 && (
        <ul className="absolute bottom-full left-0 z-50 mb-1 w-64 overflow-hidden rounded-md border bg-white shadow-lg">
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-left text-sm",
                  i === highlight ? "bg-blue-50 text-blue-900" : "hover:bg-gray-50",
                )}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => insertMention(u)}
              >
                {u.firstName} {u.lastName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">⌘↵ to post</span>
        <Button size="sm" disabled={!value.trim() || submitting} onClick={submit}>
          {submitting ? "Posting…" : "Post note"}
        </Button>
      </div>
    </div>
  );
}
