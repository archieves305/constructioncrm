import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

type AvatarUser = { id?: string; firstName: string; lastName: string };

/**
 * Initials in a coloured circle. The colour is a stable hash of the user id
 * so the same person is the same colour on every page. `null` renders an
 * explicit "unassigned" marker rather than nothing — an empty slot on a card
 * should say so.
 */

const TONES = [
  "bg-stage-0-soft text-stage-0-fg",
  "bg-tone-info-soft text-tone-info-fg",
  "bg-stage-2-soft text-stage-2-fg",
  "bg-tone-success-soft text-tone-success-fg",
  "bg-tone-warning-soft text-tone-warning-fg",
  "bg-tone-danger-soft text-tone-danger-fg",
  "bg-stage-0-soft text-stage-0-fg",
  "bg-surface-strong text-foreground",
];

const SIZE = {
  xs: "size-5 text-3xs",
  sm: "size-6 text-3xs",
  default: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(u: AvatarUser): string {
  return `${u.firstName.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase() || "?";
}

export function UserAvatar({
  user,
  size = "default",
  className,
  title,
}: {
  user: AvatarUser | null | undefined;
  size?: keyof typeof SIZE;
  className?: string;
  title?: string;
}) {
  if (!user) {
    return (
      <span
        title={title ?? "Unassigned"}
        aria-label="Unassigned"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted-foreground",
          SIZE[size],
          className,
        )}
      >
        <UserRound className="size-[55%]" />
      </span>
    );
  }
  const tone = TONES[hash(user.id ?? `${user.firstName} ${user.lastName}`) % TONES.length];
  return (
    <span
      title={title ?? `${user.firstName} ${user.lastName}`.trim()}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        tone,
        SIZE[size],
        className,
      )}
    >
      {initialsOf(user)}
    </span>
  );
}
