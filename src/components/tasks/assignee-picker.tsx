"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import { fullName, type UserOption } from "./types";

const NONE = "__none";

/**
 * Who a task belongs to. Base-UI's `SelectValue` takes a render-function
 * child, so the trigger draws the avatar + name itself rather than echoing
 * the raw id.
 */
export function AssigneePicker({
  value,
  onChange,
  users,
  className,
  size = "default",
  placeholder = "Unassigned",
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  users: UserOption[];
  className?: string;
  size?: "sm" | "default";
  placeholder?: string;
}) {
  const byId = new Map(users.map((u) => [u.id, u]));
  return (
    <Select value={value ?? NONE} onValueChange={(v: string | null) => onChange(!v || v === NONE ? null : v)}>
      <SelectTrigger className={cn(size === "sm" ? "h-7 text-xs" : "h-9", className)}>
        <SelectValue>
          {(v: string) => {
            const u = v && v !== NONE ? byId.get(v) : null;
            return (
              <span className="flex items-center gap-2 truncate">
                <UserAvatar user={u ?? null} size="xs" />
                <span className="truncate">{u ? fullName(u) : placeholder}</span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="flex items-center gap-2">
            <UserAvatar user={null} size="xs" /> {placeholder}
          </span>
        </SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            <span className="flex items-center gap-2">
              <UserAvatar user={u} size="xs" /> {fullName(u)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
