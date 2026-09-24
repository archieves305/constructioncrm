/**
 * Semantic colour classes as complete literals. Tailwind v4 only emits
 * classes it can see in source, so nothing here is ever built from a
 * template string — look a tone up, get its full class strings.
 */
export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

export type ToneClasses = {
  /** Tinted chip: soft background + readable text. */
  pill: string;
  /** Solid dot / bar. */
  dot: string;
  /** Text on a plain background. */
  text: string;
  /** Soft background alone. */
  soft: string;
  /** Ring tint. */
  ring: string;
};

export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  neutral: {
    pill: "bg-tone-neutral-soft text-tone-neutral-fg",
    dot: "bg-tone-neutral",
    text: "text-tone-neutral-fg",
    soft: "bg-tone-neutral-soft",
    ring: "ring-tone-neutral/40",
  },
  info: {
    pill: "bg-tone-info-soft text-tone-info-fg",
    dot: "bg-tone-info",
    text: "text-tone-info-fg",
    soft: "bg-tone-info-soft",
    ring: "ring-tone-info/40",
  },
  warning: {
    pill: "bg-tone-warning-soft text-tone-warning-fg",
    dot: "bg-tone-warning",
    text: "text-tone-warning-fg",
    soft: "bg-tone-warning-soft",
    ring: "ring-tone-warning/40",
  },
  danger: {
    pill: "bg-tone-danger-soft text-tone-danger-fg",
    dot: "bg-tone-danger",
    text: "text-tone-danger-fg",
    soft: "bg-tone-danger-soft",
    ring: "ring-tone-danger/40",
  },
  success: {
    pill: "bg-tone-success-soft text-tone-success-fg",
    dot: "bg-tone-success",
    text: "text-tone-success-fg",
    soft: "bg-tone-success-soft",
    ring: "ring-tone-success/40",
  },
};

export function toneClasses(tone: Tone): ToneClasses {
  return TONE_CLASSES[tone];
}
