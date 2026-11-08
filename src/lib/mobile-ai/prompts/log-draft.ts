import { z } from "zod";
import { UNTRUSTED_RULE, untrustedDocument } from "@/lib/ai/untrusted";

/**
 * A daily log's write-up from what the crew lead said (`mobile_log_draft`).
 * The answer fills the phone's log form as unsaved text the person reads,
 * changes and saves; nothing is stored from it. Hours are not taken from
 * speech: the crew sheet is filled by hand.
 */
export const PURPOSE = "mobile_log_draft";
export const PROMPT_VERSION = "v1";
export const MODEL = "claude-haiku-5-5";

const field = (what: string) => z.string().nullable().describe(`${what} Plain sentences in the speaker's words; null when the speaker said nothing about it.`);

export const schema = z.object({
  workPerformed: field("What work got done today."),
  areasWorked: field("Where on the site the work was (rooms, units, roof slopes, floors)."),
  delays: field("Anything that held the work up (weather, materials, inspections, waiting on others)."),
  safetyIssues: field("Anything unsafe seen, an injury or near miss, and what was done about it."),
  materialsDelivered: field("Materials that arrived, and from whom."),
  subcontractorsOnsite: field("Other companies or trades on site."),
  tomorrowPlan: field("What is planned next."),
  notes: field("Anything else worth recording that fits none of the above."),
  safetyToolboxTalk: z.boolean().nullable().describe("true only if the speaker says a toolbox talk or safety meeting was held; false only if they say it was not; otherwise null."),
  safetyPpeVerified: z.boolean().nullable().describe("true only if the speaker says PPE was checked; false only if they say it was not; otherwise null."),
  safetyHousekeeping: z.boolean().nullable().describe("true only if the speaker says the site was cleaned up; false only if they say it was not; otherwise null."),
});
export type LogDraftAnswer = z.infer<typeof schema>;

export const SYSTEM = `You sort what a construction crew lead said into their phone into the sections of the day's site log for their company's CRM. The words were dictated, so expect missing punctuation and misheard words; read for meaning.

- Put each thing said in the one section it belongs to. Keep the speaker's facts, numbers and names; tidy the grammar, but do not add, guess or embellish anything.
- Leave a section null when nothing was said about it. Do not record hours or pay.

${UNTRUSTED_RULE}`;

export type LogDraftContext = { date: string; job: string; speaker: string; speech: string };

export function content(ctx: LogDraftContext): string {
  return [
    `LOG DATE: ${ctx.date}. JOB: ${ctx.job}. SPEAKER: ${ctx.speaker}.`,
    "",
    untrustedDocument("what the crew lead said", ctx.speech),
    "",
    "Sort it into the log's sections.",
  ].join("\n");
}
