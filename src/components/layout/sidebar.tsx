"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: RoleName[];
};

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/production", label: "Production", icon: Factory },
  { href: "/permits", label: "Permits", icon: Shield },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/crews", label: "Crews", icon: Hammer, roles: ["ADMIN", "MANAGER"] },
  { href: "/collections", label: "Collections", icon: DollarSign },
  { href: "/referrals", label: "Referrals", icon: DollarSign, roles: ["ADMIN", "MANAGER"] },
  {
    href: "/incoming-receipts",
    label: "Incoming Receipts",
    icon: DollarSign,
    roles: ["ADMIN", "MANAGER", "OFFICE_STAFF"],
  },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/reports", label: "Reports", icon: BarChart3 },
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
    href: "/admin/job-task-templates",
    label: "Job Task Templates",
    icon: CheckSquare,
    roles: ["ADMIN", "MANAGER"],
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

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-white">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <HardHat className="h-6 w-6 text-blue-600" />
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
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3">
        <NotificationBell />
      </div>

      <div className="border-t px-3 py-4">
        <div className="mb-2 px-3 text-sm">
          <div className="font-medium">
            {user.firstName} {user.lastName}
          </div>
          <div className="text-muted-foreground text-xs capitalize">
            {user.role.replace("_", " ").toLowerCase()}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-gray-600"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
