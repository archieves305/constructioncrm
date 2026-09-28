"use client";

import { ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/shared/user-avatar";
import { fullName, type UserOption } from "@/components/tasks/types";
import { coerceUsersParam, UNASSIGNED_SENTINEL, usersParamOf, type UsersSelection } from "@/lib/calendar/access";

/**
 * "Viewing: My calendar ▾" — only rendered for roles that may see other
 * people's calendars. The value is the raw `?users=` string so the URL stays
 * the single source of truth; the server coerces it again regardless.
 */
export function ViewingSelector({
  value,
  onChange,
  users,
  currentUserId,
}: {
  value: string;
  onChange: (users: string) => void;
  users: UserOption[];
  currentUserId: string;
}) {
  // The selector only exists for view-all roles, so ADMIN is the right lens to parse with.
  const sel = coerceUsersParam(value, "ADMIN");
  const active = users.filter((u) => u.isActive);
  const selectedIds = new Set(sel.kind === "ids" ? sel.ids : sel.kind === "me" ? [currentUserId] : active.map((u) => u.id));
  const includeUnassigned = sel.kind === "all" || (sel.kind === "ids" && sel.includeUnassigned);

  function label(): string {
    if (sel.kind === "me") return "My calendar";
    if (sel.kind === "all") return "Everyone";
    const names = sel.ids.map((id) => active.find((u) => u.id === id)).filter(Boolean) as UserOption[];
    const base = names.length === 0 ? "" : names.length === 1 ? (names[0].id === currentUserId ? "My calendar" : names[0].firstName) : `${names.length} people`;
    if (sel.includeUnassigned) return base ? `${base} + Unassigned` : "Unassigned";
    return base || "Nobody";
  }

  function emit(next: UsersSelection) {
    onChange(usersParamOf(next));
  }

  function toggleUser(id: string, on: boolean) {
    const ids = new Set(selectedIds);
    if (on) ids.add(id);
    else ids.delete(id);
    const list = active.map((u) => u.id).filter((x) => ids.has(x));
    if (list.length === 1 && list[0] === currentUserId && !includeUnassigned) return emit({ kind: "me" });
    if (list.length === active.length && includeUnassigned) return emit({ kind: "all" });
    emit({ kind: "ids", ids: list, includeUnassigned });
  }

  function toggleUnassigned(on: boolean) {
    const list = active.map((u) => u.id).filter((x) => selectedIds.has(x));
    if (list.length === active.length && on) return emit({ kind: "all" });
    if (list.length === 1 && list[0] === currentUserId && !on) return emit({ kind: "me" });
    emit({ kind: "ids", ids: list, includeUnassigned: on });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} aria-label={`Viewing: ${label()}`}>
        <Users className="size-4" />
        <span className="hidden text-muted-foreground sm:inline">Viewing:</span>
        <span className="max-w-[10rem] truncate">{label()}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          value={sel.kind === "ids" ? "" : sel.kind}
          onValueChange={(v) => {
            if (v === "me") emit({ kind: "me" });
            else if (v === "all") emit({ kind: "all" });
          }}
        >
          <DropdownMenuRadioItem value="me">My calendar</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">Everyone</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Base UI requires a GroupLabel to sit inside a Group; a bare label throws on open. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>People</DropdownMenuLabel>
          {active.map((u) => (
            <DropdownMenuCheckboxItem key={u.id} checked={selectedIds.has(u.id)} onCheckedChange={(c) => toggleUser(u.id, Boolean(c))}>
              <span className="flex items-center gap-2">
                <UserAvatar user={u} size="xs" /> {fullName(u)}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={includeUnassigned} onCheckedChange={(c) => toggleUnassigned(Boolean(c))}>
          <span className="flex items-center gap-2">
            <UserAvatar user={null} size="xs" /> Unassigned work
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UNASSIGNED_SENTINEL };
