"use client";

import { differenceInCalendarDays, format, isPast, isToday } from "date-fns";
import { AlertTriangle, CalendarClock, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskCountBadge } from "@/components/tasks/task-count-badge";
import { cn } from "@/lib/utils";

export type BoardLead = {
  id: string;
  fullName: string;
  primaryPhone: string;
  urgent: boolean;
  currentStageId: string;
  nextFollowUpAt?: string | null;
  source?: { name: string } | null;
  services: { serviceCategory: { name: string } }[];
  assignedUser: { id?: string; firstName: string; lastName: string } | null;
  taskCounts?: { pending: number; overdue: number };
};

export function LeadBoardCard({ lead }: { lead: BoardLead }) {
  const follow = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const overdue = follow ? isPast(follow) && !isToday(follow) : false;
  const overdueDays = follow && overdue ? differenceInCalendarDays(new Date(), follow) : 0;
  const services = lead.services ?? [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-gray-900">{lead.fullName}</p>
        {lead.urgent && (
          <Badge variant="destructive" className="shrink-0 text-[10px]">
            Urgent
          </Badge>
        )}
      </div>
      {lead.primaryPhone && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Phone className="size-3" /> {lead.primaryPhone}
        </p>
      )}
      {follow && (
        <p
          className={cn(
            "flex items-center gap-1 text-xs",
            overdue ? "font-medium text-tone-danger-fg" : isToday(follow) ? "font-medium text-tone-warning-fg" : "text-muted-foreground",
          )}
        >
          {overdue ? <AlertTriangle className="size-3" /> : <CalendarClock className="size-3" />}
          {overdue ? `Follow-up ${overdueDays}d overdue` : isToday(follow) ? "Follow-up today" : `Follow-up ${format(follow, "MMM d")}`}
        </p>
      )}
      {services.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {services.slice(0, 2).map((s, i) => (
            <Badge key={i} variant="outline" className="text-[11px]">
              {s.serviceCategory.name}
            </Badge>
          ))}
          {services.length > 2 && <span className="text-[11px] text-muted-foreground">+{services.length - 2}</span>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UserAvatar user={lead.assignedUser} size="sm" />
          <span className="truncate">
            {lead.assignedUser ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName.charAt(0)}.` : "Unassigned"}
          </span>
        </span>
        {lead.taskCounts && <TaskCountBadge open={lead.taskCounts.pending} overdue={lead.taskCounts.overdue} compact />}
      </div>
    </div>
  );
}
