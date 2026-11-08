import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  calendarRange,
  dailyLog,
  dailyLogWithSheet,
  crewList,
  type DailyLogDto,
  fieldIssueList,
  inspectionList,
  jobDetail,
  jobFiles,
  jobGallery,
  jobList,
  taskDetail,
  taskList,
} from "@crm/mobile-api";
import { useSession } from "@/auth/session";
import { addDays, dayKey } from "@/lib/format";
import { api, ApiError } from "./client";

/**
 * Read queries over the CRM's existing routes, the same ones the web's field
 * mode uses. Each response is checked against the shared contract. The
 * definitions (`q.*`) are shared by the screens' hooks and the background
 * refresh that fills the phone's saved copy (`cache/warm.ts`), so both fetch
 * exactly the same thing under the same key.
 */
export const q = {
  /** Today, as /field/day reads it: the day's items, done ones included. */
  today: (day = dayKey()) =>
    queryOptions({
      queryKey: ["calendar", "day", day],
      queryFn: () => api(`/api/calendar?from=${day}&to=${day}&users=me&includeCompleted=1`, { schema: calendarRange }),
    }),
  /** Overdue from the last 30 days (the calendar's own "overdue" status). */
  overdue: (day = dayKey()) =>
    queryOptions({
      queryKey: ["calendar", "overdue", day],
      queryFn: async () => {
        const r = await api(`/api/calendar?from=${addDays(day, -30)}&to=${addDays(day, -1)}&users=me`, { schema: calendarRange });
        return r.items.filter((i) => i.derived === "overdue");
      },
    }),
  /** A week (or any span) of my calendar: tasks plus read-only records. */
  range: (from: string, to: string) =>
    queryOptions({
      queryKey: ["calendar", "range", from, to],
      queryFn: () => api(`/api/calendar?from=${from}&to=${to}&users=me&includeCompleted=1`, { schema: calendarRange }),
    }),
  /** My jobs: the web's "Mine" rule (jobs I have a role on), open ones. */
  myJobs: () =>
    queryOptions({
      queryKey: ["jobs", "mine"],
      queryFn: () => api("/api/jobs?scope=mine&excludeClosed=1&withTaskCounts=true&pageSize=200", { schema: jobList }),
    }),
  job: (id: string) => queryOptions({ queryKey: ["job", id], queryFn: () => api(`/api/jobs/${id}`, { schema: jobDetail }) }),
  /** Open tasks on one job. */
  jobTasks: (jobId: string) =>
    queryOptions({
      queryKey: ["tasks", "job", jobId],
      queryFn: () => api(`/api/tasks?jobId=${encodeURIComponent(jobId)}`, { schema: taskList }),
    }),
  /** My open tasks, every date. */
  myTasks: (userId: string) =>
    queryOptions({
      queryKey: ["tasks", "mine", userId],
      queryFn: () => api(`/api/tasks?assignedUserId=${encodeURIComponent(userId)}`, { schema: taskList }),
    }),
  task: (id: string) => queryOptions({ queryKey: ["task", id], queryFn: () => api(`/api/tasks/${id}`, { schema: taskDetail }) }),
  /** A job's files and its lead's documents (the web's Files tab). */
  jobFiles: (jobId: string) =>
    queryOptions({
      queryKey: ["files", "job", jobId],
      queryFn: () => api(`/api/files?jobId=${encodeURIComponent(jobId)}`, { schema: jobFiles }),
    }),
  /** Booked inspections and the last 30 days' results, on jobs I can see. */
  inspections: () =>
    queryOptions({ queryKey: ["inspections"], queryFn: () => api("/api/inspections?days=30", { schema: inspectionList }) }),
  /** A job's photos: daily-log photos and image files, newest first. */
  jobGallery: (jobId: string) =>
    queryOptions({
      queryKey: ["gallery", "job", jobId],
      queryFn: () => api(`/api/jobs/${encodeURIComponent(jobId)}/gallery`, { schema: jobGallery }),
    }),
  /** A job's field issues and punch items. */
  jobIssues: (jobId: string) =>
    queryOptions({
      queryKey: ["issues", "job", jobId],
      queryFn: () => api(`/api/jobs/${encodeURIComponent(jobId)}/field-issues`, { schema: fieldIssueList }),
    }),
};

export const useToday = (day = dayKey()) => useQuery(q.today(day));
export const useOverdue = (day = dayKey()) => useQuery(q.overdue(day));
export const useMyJobs = () => useQuery(q.myJobs());
export const useJob = (id: string) => useQuery(q.job(id));
export const useJobTasks = (jobId: string) => useQuery(q.jobTasks(jobId));
export function useMyTasks() {
  const { user } = useSession();
  return useQuery({ ...q.myTasks(user?.id ?? ""), enabled: Boolean(user?.id) });
}
export const useTask = (id: string) => useQuery(q.task(id));
export const useJobFiles = (jobId: string) => useQuery(q.jobFiles(jobId));
export const useInspections = () => useQuery(q.inspections());
export const useCalendarRange = (from: string, to: string, enabled = true) => useQuery({ ...q.range(from, to), enabled });
export const useJobIssues = (jobId: string) => useQuery(q.jobIssues(jobId));
export const useJobGallery = (jobId: string) => useQuery(q.jobGallery(jobId));

/** A job's log for one day, or null when nobody has started it. */
export function useDailyLog(jobId: string, date: string) {
  return useQuery({
    queryKey: ["dailyLog", jobId, date],
    queryFn: async () => {
      try {
        return (await api(`/api/jobs/${encodeURIComponent(jobId)}/daily-logs/${date}`, { schema: dailyLog })) as DailyLogDto;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

/** The day's log with its crew sheet, or null when nobody has started it. */
export function useDailySheet(jobId: string, date: string) {
  return useQuery({
    queryKey: ["dailyLog", jobId, date, "sheet"],
    queryFn: async () => {
      try {
        return await api(`/api/jobs/${encodeURIComponent(jobId)}/daily-logs/${date}`, { schema: dailyLogWithSheet });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

/** Active crew members (name, trade, crew only). Office roles and crew leads. */
export function useCrewList() {
  return useQuery({
    queryKey: ["crew"],
    queryFn: () => api("/api/personnel?activeOnly=true", { schema: crewList }),
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });
}
