import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { runAiCall } from "@/lib/ai/calls";
import { jobAccessWhere } from "@/lib/access/records";
import { jobText } from "@/lib/labels/job";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { dayKey, weekdayOf } from "@/lib/time/zone";
import * as logPrompt from "./prompts/log-draft";
import * as taskPrompt from "./prompts/task-draft";
import { logDraftFrom, numbered, taskDraftFrom, voiceSubjectId, type LogDraft, type TaskDraft } from "./plan";

/**
 * Drafts from what a person said into the phone. Each is one AI call held to
 * the person's monthly allowance; the answer is returned, never stored, and
 * becomes a record only when the person saves the form it fills.
 */
type Viewer = { id: string; role: RoleName; name: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_JOBS = 60;

export async function draftTask(viewer: Viewer, speech: string, currentJobId?: string): Promise<TaskDraft> {
  const where = { ...jobAccessWhere(viewer), currentStage: { isClosed: false } };
  const [openJobs, current, users] = await Promise.all([
    prisma.job.findMany({ where, select: JOB_LABEL_SELECT, orderBy: { updatedAt: "desc" }, take: MAX_JOBS }),
    currentJobId ? prisma.job.findFirst({ where: { id: currentJobId, ...jobAccessWhere(viewer) }, select: JOB_LABEL_SELECT }) : null,
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);
  const jobRows = current && !openJobs.some((j) => j.id === current.id) ? [current, ...openJobs] : openJobs;
  const jobs = numbered(jobRows, (j) => j.id, (j) => jobText(j as never));
  const people = numbered(users, (u) => u.id, (u) => `${u.firstName} ${u.lastName}`.trim() + (u.id === viewer.id ? " (the speaker)" : ""));
  const today = dayKey(new Date());
  const ctx: taskPrompt.TaskDraftContext = {
    today,
    weekday: WEEKDAYS[weekdayOf(today)],
    speaker: viewer.name,
    jobs: jobs.map(({ number, label }) => ({ number, label })),
    people: people.map(({ number, label }) => ({ number, label })),
    currentJob: current ? jobs.find((j) => j.id === current.id)?.number ?? null : null,
    speech,
  };
  const r = await runAiCall({
    subjectType: "mobile_voice",
    subjectId: voiceSubjectId(viewer.id, today),
    purpose: taskPrompt.PURPOSE,
    promptVersion: taskPrompt.PROMPT_VERSION,
    schema: taskPrompt.schema,
    inputs: ctx,
    system: taskPrompt.SYSTEM,
    content: taskPrompt.content(ctx),
    model: taskPrompt.MODEL,
    maxTokens: 2_000,
    userId: viewer.id,
  });
  return taskDraftFrom(r.output, jobs, people.map((p) => ({ ...p, label: p.label.replace(" (the speaker)", "") })), today);
}

export async function draftLog(viewer: Viewer, jobId: string, date: string, speech: string): Promise<LogDraft> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_LABEL_SELECT });
  const ctx: logPrompt.LogDraftContext = { date, job: job ? jobText(job as never) : "the job", speaker: viewer.name, speech };
  const r = await runAiCall({
    subjectType: "mobile_voice",
    subjectId: voiceSubjectId(viewer.id, dayKey(new Date())),
    purpose: logPrompt.PURPOSE,
    promptVersion: logPrompt.PROMPT_VERSION,
    schema: logPrompt.schema,
    inputs: ctx,
    system: logPrompt.SYSTEM,
    content: logPrompt.content(ctx),
    model: logPrompt.MODEL,
    maxTokens: 3_000,
    userId: viewer.id,
  });
  return logDraftFrom(r.output);
}
