import { z } from "zod";

/**
 * The crew mode's view of work (docs/audits/crew-experience): the jobs a crew
 * lead is on, as a crew sees them. By construction there is no money and no
 * customer contact here: the street, the PM to call, their own tasks, the
 * day's log and the crew's install days.
 */
export const crewTaskLite = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueAt: z.string().nullable(),
});

export const crewJobCard = z.object({
  jobId: z.string(),
  street: z.string(),
  city: z.string().nullable(),
  title: z.string(),
  /** Minutes after midnight on an install day today; null when none is set. */
  startMinutes: z.number().int().nullable(),
  installToday: z.boolean(),
  pm: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
  tasks: z.array(crewTaskLite),
  logStatus: z.enum(["NONE", "DRAFT", "SUBMITTED", "APPROVED"]),
  openIssues: z.number().int(),
});
export type CrewJobCardDto = z.infer<typeof crewJobCard>;

export const crewToday = z.object({
  date: z.string(),
  jobs: z.array(crewJobCard),
  /** The next install day ahead, for an empty day. */
  next: z.object({ date: z.string(), street: z.string(), jobId: z.string() }).nullable(),
});

export const crewWeekItem = z.object({
  crewAssignmentId: z.string(),
  jobId: z.string(),
  street: z.string(),
  crewName: z.string().nullable(),
  startMinutes: z.number().int().nullable(),
  confirmation: z.string().nullable(),
});
export type CrewWeekItemDto = z.infer<typeof crewWeekItem>;

export const crewWeek = z.object({
  from: z.string(),
  days: z.array(z.object({ date: z.string(), items: z.array(crewWeekItem) })),
});

export const crewAckRequest = z.object({
  answer: z.enum(["CONFIRMED", "CANT_MAKE_IT"]),
  note: z.string().trim().max(500).optional(),
});

export const crewAckResponse = z.object({
  id: z.string(),
  confirmation: z.string(),
  confirmationAt: z.string(),
});

/** A job's plan sheets for the phone (GET /api/jobs/[id]/plan-sheets). */
export const planSheet = z.object({
  id: z.string(),
  sheetNumber: z.string().nullable(),
  title: z.string().nullable(),
  pageNumber: z.number().int(),
  discipline: z.string(),
  setName: z.string(),
  /** The sheet image (needs the sign-in header), 144 dpi. */
  imageUrl: z.string(),
});
export type PlanSheetDto = z.infer<typeof planSheet>;
export const planSheetList = z.object({ sheets: z.array(planSheet) });
