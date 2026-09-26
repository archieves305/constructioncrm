import { GLOSSARY, type GlossaryKey } from "@/lib/ui/glossary";

/** A jargon word with its explanation on hover — dotted underline, cursor help. */
export function Term({ k, children, className }: { k: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const { term, help } = GLOSSARY[k];
  return (
    <abbr title={help} className={["cursor-help underline decoration-dotted underline-offset-2", className].filter(Boolean).join(" ")}>
      {children ?? term}
    </abbr>
  );
}
