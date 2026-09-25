"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/session-client";
import { cn } from "@/lib/utils";
import type { RoleName } from "@/generated/prisma/client";
import { NotificationBell } from "./notification-bell";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  KanbanSquare,
  BarChart3,
  Settings,
  LogOut,
  HardHat,
  CheckSquare,
  Briefcase,
  Factory,
  DollarSign,
  Zap,
  Shield,
  Calendar,
  Hammer,
  MessageSquare,
  MapPin,
  Gauge,
  Route,
  UsersRound,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTaskSummary } from "@/components/tasks/use-tasks";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: RoleName[];
  badge?: "tasks";
};

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/production", label: "Production", icon: Factory },
  { href: "/permits", label: "Permits", icon: Shield },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/canvassing", label: "Canvassing Leads", icon: MapPin },
  { href: "/crews", label: "Crews", icon: Hammer, roles: ["ADMIN", "MANAGER"] },
  {
    href: "/personnel",
    label: "Personnel",
    icon: Users,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  {
    href: "/field-logs",
    label: "Daily Logs",
    icon: ClipboardList,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  {
    href: "/field",
    label: "Field Mode",
    icon: HardHat,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  { href: "/collections", label: "Collections", icon: DollarSign },
  { href: "/referrals", label: "Referrals", icon: DollarSign, roles: ["ADMIN", "MANAGER"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "tasks" },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  {
    href: "/reports/labor",
    label: "Labor Reports",
    icon: HardHat,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  {
    href: "/response-dashboard",
    label: "Response Times",
    icon: Zap,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: ClipboardList,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/templates",
    label: "Templates",
    icon: MessageSquare,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/follow-up-rules",
    label: "Follow-ups",
    icon: Zap,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/workflow-templates",
    label: "Workflow Templates",
    icon: Route,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  {
    href: "/admin/workflow-role-defaults",
    label: "Workflow Roles",
    icon: UsersRound,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/job-task-templates",
    label: "Stage Task Templates",
    icon: CheckSquare,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/canvassing-settings",
    label: "Lead Scoring",
    icon: Gauge,
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/admin/job-cost-reconciliation",
    label: "Cost Reconciliation",
    icon: Scale,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    roles: ["ADMIN", "MANAGER"],
  },
];

interface SidebarProps {
  user: {
    firstName: string;
    lastName: string;
    role: RoleName;
  };
}

/**
 * My overdue count in red, else my open count in grey, nothing at zero.
 * A component of its own so the hook lives outside the nav `map`.
 */
function TaskNavBadge() {
  const { data } = useTaskSummary();
  if (!data || data.open === 0) return null;
  const overdue = data.overdue > 0;
  return (
    <span
      title={`${data.overdue} overdue · ${data.dueToday} due today · ${data.open} open`}
      className={cn(
        "ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none",
        overdue ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600",
      )}
    >
      {overdue ? data.overdue : data.open}
    </span>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-white">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <HardHat className="h-6 w-6 text-brand" />
        <span className="text-lg font-bold">Knu Construction</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-soft font-semibold text-brand-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.badge === "tasks" && <TaskNavBadge />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3">
        <NotificationBell />
      </div>

      <div className="border-t px-3 py-4">
        <div className="mb-2 flex items-start justify-between px-3 text-sm">
          <div>
            <div className="font-medium">
              {user.firstName} {user.lastName}
            </div>
            <div className="text-muted-foreground text-xs capitalize">
              {user.role.replace("_", " ").toLowerCase()}
            </div>
          </div>
          <Link
            href="/settings/notifications"
            title="Notification settings"
            aria-label="Notification settings"
            className={cn(
              "rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900",
              pathname.startsWith("/settings") && "bg-brand-soft text-brand-fg",
            )}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-gray-600"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
