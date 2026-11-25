/**
 * The scope an inspection is checked against, pre-filled from a crew labor
 * contract: its description and its lines (name, room, description). Pure.
 * Never money: amounts stay out of the prompt and off the crew's screens.
 */
export type ContractScopeInput = {
  description: string | null;
  tasks: readonly { name: string; room: string | null; description: string | null }[];
};

export function scopeFromContract(c: ContractScopeInput): string | null {
  const lines: string[] = [];
  if (c.description?.trim()) lines.push(c.description.trim());
  for (const t of c.tasks) {
    const head = t.room?.trim() ? `${t.name.trim()} (${t.room.trim()})` : t.name.trim();
    lines.push(`- ${head}${t.description?.trim() ? `: ${t.description.trim()}` : ""}`);
  }
  const text = lines.join("\n").trim();
  return text ? text.slice(0, 6000) : null;
}

/** The contractor's name on a contract: its crew, else the typed label. */
export function contractorName(c: { label: string | null; crew: { name: string } | null }): string {
  return c.crew?.name ?? c.label ?? "Contractor";
}
