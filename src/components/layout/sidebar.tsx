"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "@/lib/auth/session-client";
import { cn } from "@/lib/utils";
import type { RoleName } from "@/generated/prisma/client";
import { NotificationBell } from "./notification-bell";
import { isNavActive } from "./nav-active";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  BarChart3,
  Settings,
  LogOut,
  HardHat,
  CheckSquare,
  Briefcase,
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
  FileSignature,
  Gavel,
  ChevronDown,
  ListChecks,
  UserCheck,
  ClipboardCheck,
  Repeat,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTaskSummary } from "@/components/tasks/use-tasks";
import { useViolationSummary } from "@/components/violations/use-violations";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: RoleName[];
  badge?: "tasks" | "violations";
  match?: "exact" | "prefix";
  /** A sub-heading printed above this item inside its group (Admin → Templates…). */
  heading?: string;
  /** One line of plain English for jargon, shown on hover. */
  hint?: string;
};

export type NavSection = {
  key: string;
  /** Unlabelled sections render flat, as the main list always has. */
  label?: string;
  icon?: React.ElementType;
  roles?: RoleName[];
  items: NavItem[];
};

const OFFICE: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const VIOLATION_VIEWERS: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "READ_ONLY"];

/**
 * Eleven entries for an admin (it was 41 links). One item per thing people
 * open daily; boards are a view of Leads / Jobs, not a second entry; the
 * seven saved violation views live on the Cases page itself; Field, Money
 * and Admin are groups.
 */
export const navSections: NavSection[] = [
  {
    key: "main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/leads", label: "Leads", icon: Users, hint: "Inquiries, from first call to Won — table or board" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, hint: "Won work, from deposit to close — table or board" },
      { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "tasks" },
      { href: "/schedule", label: "Schedule", icon: Calendar },
      { href: "/permits", label: "Permits", icon: Shield },
      { href: "/canvassing", label: "Canvassing", icon: MapPin, hint: "Door-knocking routes and the properties knocked; a prospect becomes a lead when it converts" },
    ],
  },
  {
    key: "violations",
    label: "Code Violations",
    icon: Gavel,
    roles: VIOLATION_VIEWERS,
    items: [
      { href: "/violations", label: "Overview", icon: LayoutDashboard, match: "exact" },
      { href: "/violations/list", label: "Cases", icon: ListChecks, badge: "violations", hint: "Every case; the queues (mine, overdue, awaiting agency…) are on the page" },
      { href: "/violations/inspections", label: "Inspections", icon: ClipboardCheck },
      { href: "/violations/hearings", label: "Hearings", icon: Gavel },
    ],
  },
  {
    key: "field",
    label: "Field",
    icon: HardHat,
    roles: OFFICE,
    items: [
      { href: "/field", label: "Field Mode", icon: HardHat, hint: "The crew-lead view: today's jobs, daily logs and tasks" },
      { href: "/field-logs", label: "Daily Logs", icon: ClipboardList },
      { href: "/crews", label: "Crews", icon: Hammer, roles: ["ADMIN", "MANAGER"] },
      { href: "/personnel", label: "Personnel", icon: Users },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: DollarSign,
    items: [
      { href: "/collections", label: "Collections", icon: DollarSign, hint: "Deposits missing, balances due and unpaid invoices" },
      { href: "/referrals", label: "Referrals", icon: Repeat, roles: ["ADMIN", "MANAGER"] },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/reports/labor", label: "Labor Reports", icon: HardHat, roles: OFFICE },
      { href: "/response-dashboard", label: "Response Times", icon: Zap, roles: ["ADMIN", "MANAGER"], hint: "How fast new web leads get their first call" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    roles: ["ADMIN", "MANAGER"],
    items: [
      { href: "/admin/users", label: "Users", icon: UsersRound, heading: "People" },
      { href: "/admin/settings", label: "Settings", icon: Settings },
      { href: "/admin/templates", label: "Message Templates", icon: MessageSquare, heading: "Templates" },
      { href: "/admin/contract-templates", label: "Contract Templates", icon: FileSignature },
      { href: "/admin/workflow-templates", label: "Job Workflow Templates", icon: Route, hint: "The phases and steps a job runs through, per trade" },
      { href: "/violations/templates", label: "Violation Workflow Templates", icon: Route, roles: OFFICE, hint: "The steps a code-violation case runs through" },
      { href: "/admin/job-task-templates", label: "Stage Task Templates", icon: CheckSquare, hint: "Tasks raised automatically when a job enters a stage" },
      { href: "/admin/follow-up-rules", label: "Follow-up Rules", icon: Zap, heading: "Automation" },
      { href: "/admin/nurture", label: "Customer Nurture", icon: Repeat, hint: "Automatic check-in emails to open leads that have gone quiet" },
      { href: "/admin/workflow-role-defaults", label: "Workflow Role Defaults", icon: UserCheck, hint: "Who a workflow step is assigned to when the job has nobody in that role" },
      { href: "/admin/canvassing-settings", label: "Knock Scoring", icon: Gauge, heading: "Canvassing", hint: "How promising a canvassed door looks, from its history and neighbourhood" },
      { href: "/admin/job-cost-reconciliation", label: "Cost Reconciliation", icon: Scale, heading: "Finance", hint: "Matches card postings from cc-allocator against job expenses" },
    ],
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

/** Overdue cases in red, else cases due within a week in amber, nothing otherwise. */
function ViolationsNavBadge() {
  const { data } = useViolationSummary();
  if (!data || (data.overdue === 0 && data.dueSoon === 0)) return null;
  const overdue = data.overdue > 0;
  return (
    <span
      title={`${data.overdue} overdue · ${data.dueSoon} due in 7 days · ${data.open} open`}
      className={cn(
        "ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none",
        overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800",
      )}
    >
      {overdue ? data.overdue : data.dueSoon}
    </span>
  );
}

/**
 * Which groups are collapsed lives in localStorage. Read through an external
 * store so the server render (always open) and the client agree without a
 * setState-in-effect, and so two sidebars on one page stay in sync.
 */
const NAV_EVENT = "nav:open-change";
function subscribeOpen(cb: () => void) {
  window.addEventListener(NAV_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(NAV_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function readOpen(key: string): boolean {
  try {
    return localStorage.getItem(`nav:open:${key}`) !== "0";
  } catch {
    return true;
  }
}
function writeOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(`nav:open:${key}`, open ? "1" : "0");
  } catch {
    // storage unavailable — the group just does not remember
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function Sidebar({ user, onSearch }: SidebarProps & { onSearch?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();

  const sections = navSections
    .filter((s) => !s.roles || s.roles.includes(user.role))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(user.role)) }))
    .filter((s) => s.items.length > 0);
  const allItems = sections.flatMap((s) => s.items);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-white">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <HardHat className="h-6 w-6 text-brand" />
        <span className="text-lg font-bold">Knu Construction</span>
      </div>
      {onSearch && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onSearch}
            className="flex w-full items-center gap-2 rounded-md border bg-gray-50 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-300 hover:bg-white hover:text-gray-900"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-500">⌘K</kbd>
          </button>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {sections.map((section) =>
          section.label ? (
            <NavGroup key={section.key} section={section} pathname={pathname} search={search} allItems={allItems} />
          ) : (
            section.items.map((item) => <NavLink key={item.href} item={item} active={isNavActive(pathname, search, item, allItems)} />)
          ),
        )}
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

function NavLink({ item, active, nested }: { item: NavItem; active: boolean; nested?: boolean }) {
  const Icon = item.icon;
  // The nav scrolls; bring the active item into view so a group below the
  // fold (Code Violations on a short screen) is not invisible on arrival.
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Link
      ref={ref}
      href={item.href}
      title={item.hint}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        nested && "py-1.5 pl-9 text-[13px]",
        active
          ? "bg-brand-soft font-semibold text-brand-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
      )}
    >
      <Icon className={cn("h-4 w-4", nested && "h-3.5 w-3.5")} />
      {item.label}
      {item.badge === "tasks" && <TaskNavBadge />}
      {item.badge === "violations" && <ViolationsNavBadge />}
    </Link>
  );
}

/** A collapsible group. Remembered per group in localStorage; forced open while a child is active. */
function NavGroup({ section, pathname, search, allItems }: { section: NavSection; pathname: string; search: URLSearchParams; allItems: NavItem[] }) {
  const active = section.items.map((i) => isNavActive(pathname, search, i, allItems));
  const anyActive = active.some(Boolean);
  const open = useSyncExternalStore(subscribeOpen, () => readOpen(section.key), () => true);
  const shown = open || anyActive;
  const Icon = section.icon ?? ChevronDown;
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => writeOpen(section.key, !shown)}
        aria-expanded={shown}
        className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", anyActive ? "text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")}
      >
        <Icon className="h-4 w-4" />
        {section.label}
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-gray-400 transition-transform", !shown && "-rotate-90")} />
      </button>
      {shown && (
        <div className="mt-0.5 space-y-0.5">
          {section.items.map((item, i) => (
            <div key={item.href}>
              {item.heading && item.heading !== section.items[i - 1]?.heading && (
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.heading}</div>
              )}
              <NavLink item={item} active={active[i]!} nested />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
