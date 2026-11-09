export function EmptyColumn({ label = "Drop here" }: { label?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong/80 py-6 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}
