// Date-only helpers for the field-labor module. Log/work dates travel as
// "YYYY-MM-DD" strings end-to-end and hit Postgres as @db.Date columns; all
// math happens in UTC so a jobsite date never shifts across timezones.

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "2026-07-03" → Date at UTC midnight, for writing @db.Date columns. */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Date read from a @db.Date column → "YYYY-MM-DD". */
export function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toDbDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/**
 * Start of the payroll week containing `date`.
 * weekStartsOn: 0 = Sunday … 6 = Saturday (LaborSettings default: 1, Monday).
 */
export function weekStartOf(date: string, weekStartsOn: number): string {
  const d = toDbDate(date);
  const diff = (d.getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}
