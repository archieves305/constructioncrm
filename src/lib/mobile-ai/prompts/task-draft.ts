import { z } from "zod";
import { UNTRUSTED_RULE, untrustedDocument } from "@/lib/ai/untrusted";

/**
 * A task from what a person said into the phone (`mobile_task_draft`). The
 * answer is a draft the person checks on the New task form; nothing is saved
 * from it. The job and the owner are picked by number from the lists the
 * person may use, never named freely, so the model cannot invent a record.
 */
export const PURPOSE = "mobile_task_draft";
export const PROMPT_VERSION = "v1";
export const MODEL = "claude-haiku-5-5";

export const schema = z.object({
  title: z.string().describe("A short imperative task title, under 90 characters, in the speaker's words where possible (e.g. 'Order 12 sheets of 5/8 drywall')."),
  description: z.string().nullable().describe("Any detail beyond the title that the speaker gave, as plain sentences; null when there is none."),
  jobNumber: z.number().int().nullable().describe("The number of the job in the JOBS list the task is about, only when the speaker names its address, street, customer or job number clearly; otherwise null."),
  assigneeNumber: z.number().int().nullable().describe("The number of the person in the PEOPLE list the speaker says should do it; null when no one is named. 'Me' or 'I' means the speaker."),
  dueDate: z.string().nullable().describe("The due day as YYYY-MM-DD when the speaker gives one ('tomorrow', 'Friday', 'by the 14th'), counted from TODAY in the office's calendar; null when none is said."),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).describe("MEDIUM unless the speaker says it is urgent, important, a safety matter, or can wait."),
  unclear: z.array(z.string()).describe("Short notes on anything the speaker said that you could not place (a job you could not match, a name not in PEOPLE). Empty when everything was clear."),
});
export type TaskDraftAnswer = z.infer<typeof schema>;

export const SYSTEM = `You turn what a construction company's staff member said into their phone into one task for the company's CRM. The words were dictated, so expect missing punctuation and misheard words; read for meaning.

- Use only the numbered JOBS and PEOPLE you are given. Never guess a job or a person: if the match is not clear, leave it null and say so in "unclear".
- Do not add work the speaker did not ask for, and do not give advice.
- If the speech holds several tasks, draft the first and note the rest in "unclear".

${UNTRUSTED_RULE}`;

export type TaskDraftContext = {
  today: string;
  weekday: string;
  speaker: string;
  jobs: { number: number; label: string }[];
  people: { number: number; label: string }[];
  /** The job the person was on when they spoke, if any. */
  currentJob: number | null;
  speech: string;
};

export function content(ctx: TaskDraftContext): string {
  return [
    `TODAY: ${ctx.today} (${ctx.weekday}), office time.`,
    `SPEAKER: ${ctx.speaker}.`,
    ctx.currentJob != null ? `The speaker was looking at job ${ctx.currentJob} when they spoke; use it unless they name another.` : "",
    "JOBS:",
    ctx.jobs.length ? ctx.jobs.map((j) => `${j.number}. ${j.label}`).join("\n") : "(none)",
    "PEOPLE:",
    ctx.people.map((p) => `${p.number}. ${p.label}`).join("\n"),
    "",
    untrustedDocument("what the speaker said", ctx.speech),
    "",
    "Draft the task.",
  ]
    .filter(Boolean)
    .join("\n");
}
