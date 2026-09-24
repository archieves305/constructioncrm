import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";

const ICON: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  warning: AlertTriangle,
  danger: OctagonAlert,
  success: CheckCircle2,
};

/**
 * An inline notice with a tone. Replaces the ad-hoc amber divs so warnings,
 * legal notes and "N tasks need assignment" all read the same way.
 */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon | null;
  className?: string;
}) {
  const t = toneClasses(tone);
  const Icon = icon === null ? null : (icon ?? ICON[tone]);
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "note"} className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm", t.soft, t.text, className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-[13px] leading-snug opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
