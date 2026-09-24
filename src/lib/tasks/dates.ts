/**
 * Due dates arrive from the UI as a bare `yyyy-MM-dd`. Parsing that with
 * `new Date()` yields UTC midnight, which in Eastern time is the previous
 * evening — so a task due tomorrow bucketed under "Today" while its date
 * input still said tomorrow. Pinning date-only values to noon UTC keeps
 * them on the same calendar day for every timezone from UTC-12 to UTC+11.
 * Full timestamps pass through untouched.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueAt(value: string): Date {
  return DATE_ONLY.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
}
