import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";

/** A status chip in the app's tones; the label carries the meaning, the colour only repeats it. */
export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  const t = toneClasses(tone);
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-2xs font-medium whitespace-nowrap", t.pill, className)}>
      <span className={cn("size-1.5 rounded-full", t.dot)} aria-hidden />
      {children}
    </span>
  );
}
