import { prisma } from "@/lib/db/prisma";
import type { Holidays } from "@/lib/time/working-days";

/** Company days off (Admin edits them); the bid cadence skips them. */
export async function loadHolidays(): Promise<Holidays> {
  const rows = await prisma.businessHoliday.findMany({ select: { day: true } });
  return new Set(rows.map((r) => r.day));
}

/** US federal holidays as observed (Saturday → Friday, Sunday → Monday): the seeded default. */
export const DEFAULT_HOLIDAYS: readonly { day: string; name: string }[] = [
  { day: "2026-01-01", name: "New Year's Day" },
  { day: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { day: "2026-02-16", name: "Presidents' Day" },
  { day: "2026-05-25", name: "Memorial Day" },
  { day: "2026-06-19", name: "Juneteenth" },
  { day: "2026-07-03", name: "Independence Day (observed)" },
  { day: "2026-09-07", name: "Labor Day" },
  { day: "2026-10-12", name: "Columbus Day" },
  { day: "2026-11-11", name: "Veterans Day" },
  { day: "2026-11-26", name: "Thanksgiving Day" },
  { day: "2026-12-25", name: "Christmas Day" },
  { day: "2027-01-01", name: "New Year's Day" },
  { day: "2027-01-18", name: "Martin Luther King Jr. Day" },
  { day: "2027-02-15", name: "Presidents' Day" },
  { day: "2027-05-31", name: "Memorial Day" },
  { day: "2027-06-18", name: "Juneteenth (observed)" },
  { day: "2027-07-05", name: "Independence Day (observed)" },
  { day: "2027-09-06", name: "Labor Day" },
  { day: "2027-10-11", name: "Columbus Day" },
  { day: "2027-11-11", name: "Veterans Day" },
  { day: "2027-11-25", name: "Thanksgiving Day" },
  { day: "2027-12-24", name: "Christmas Day (observed)" },
];
