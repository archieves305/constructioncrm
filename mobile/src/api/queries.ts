import { useQuery } from "@tanstack/react-query";
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
  jobList,
  taskDetail,
  taskList,
} from "@crm/mobile-api";
import { useSession } from "@/auth/session";
import { addDays, dayKey } from "@/lib/format";
import { api, ApiError } from "./client";

/**
 * Read queries over the CRM's existing routes, the same ones the web's field
 * mode uses. Each response is checked against the shared contract.
 */

/** Today, as /field/day reads it: the day's items, done ones included. */
export function useToday(day = dayKey()) {
  return useQuery({
    queryKey: ["calendar", "day", day],
    queryFn: () =>
      api(`/api/calendar?from=${day}&to=${day}&users=me&includeCompleted=1`, { schema: calendarRange }),
  });
}

/** Overdue from the last 30 days (the calendar's own "overdue" status). */
export function useOverdue(day = dayKey()) {
  return useQuery({
    queryKey: ["calendar", "overdue", day],
    queryFn: async () => {
      const r = await api(`/api/calendar?from=${addDays(day, -30)}&to=${addDays(day, -1)}&users=me`, {
        schema: calendarRange,
      });
      return r.items.filter((i) => i.derived === "overdue");
    },
  });
}

/** My jobs: the web's "Mine" rule (jobs I have a role on), open ones. */
export function useMyJobs() {
  return useQuery({
    queryKey: ["jobs", "mine"],
    queryFn: () => api("/api/jobs?scope=mine&excludeClosed=1&withTaskCounts=true&pageSize=200", { schema: jobList }),
  });
}

export function useJob(id: string) {
  return useQuery({ queryKey: ["job", id], queryFn: () => api(`/api/jobs/${id}`, { schema: jobDetail }) });
}

/** Open tasks on one job. */
export function useJobTasks(jobId: string) {
  return useQuery({
    queryKey: ["tasks", "job", jobId],
    queryFn: () => api(`/api/tasks?jobId=${encodeURIComponent(jobId)}`, { schema: taskList }),
  });
}

/** My open tasks, every date. */
export function useMyTasks() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["tasks", "mine", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => api(`/api/tasks?assignedUserId=${encodeURIComponent(user!.id)}`, { schema: taskList }),
  });
}

export function useTask(id: string) {
  return useQuery({ queryKey: ["task", id], queryFn: () => api(`/api/tasks/${id}`, { schema: taskDetail }) });
}

/** A job's files and its lead's documents (the web's Files tab). */
export function useJobFiles(jobId: string) {
  return useQuery({
    queryKey: ["files", "job", jobId],
    queryFn: () => api(`/api/files?jobId=${encodeURIComponent(jobId)}`, { schema: jobFiles }),
  });
}

/** Booked inspections and the last 30 days' results, on jobs I can see. */
export function useInspections() {
  return useQuery({
    queryKey: ["inspections"],
    queryFn: () => api("/api/inspections?days=30", { schema: inspectionList }),
  });
}

/** A week (or any span) of my calendar: tasks plus read-only records. */
export function useCalendarRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["calendar", "range", from, to],
    enabled,
    queryFn: () => api(`/api/calendar?from=${from}&to=${to}&users=me&includeCompleted=1`, { schema: calendarRange }),
  });
}

/** A job's field issues and punch items. */
export function useJobIssues(jobId: string) {
  return useQuery({
    queryKey: ["issues", "job", jobId],
    queryFn: () => api(`/api/jobs/${encodeURIComponent(jobId)}/field-issues`, { schema: fieldIssueList }),
  });
}

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
