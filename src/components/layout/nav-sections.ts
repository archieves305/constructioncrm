import type { ElementType } from "react";
import type { RoleName } from "@/generated/prisma/client";
import { BarChart3, BellRing, Briefcase, Building2, Calendar, CheckSquare, ClipboardCheck, ClipboardList, DollarSign, FileSignature, FolderLock, Gauge, Gavel, Hammer, Handshake, HardHat, Inbox, Landmark, LayoutDashboard, ListChecks, MapPin, MessageSquare, Repeat, Route, Ruler, Scale, Settings, Shield, Smartphone, Sparkles, Store, UserCheck, Users, UsersRound, Zap } from "lucide-react";
import { PARTNER_VIEW_ROLES } from "@/lib/partners/access";
import { canWriteLeads } from "@/lib/access/roles";

/**
 * The navigation table, shared by the sidebar and ⌘K. Each entry's `roles`
 * follows the rule its page's API applies, so nobody is offered a page that
 * only answers "no access" (nav-sections.test.ts holds the known cases).
 */
export type NavItem = {
  href: string;
  label: string;
  icon: ElementType;
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
  icon?: ElementType;
  roles?: RoleName[];
  items: NavItem[];
};

const ALL_ROLES: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "CREW_LEAD", "READ_ONLY"];
/** Canvassing routes answer only the lead-writing roles (`guardCanvassing`). */
export const CANVASS_ROLES: RoleName[] = ALL_ROLES.filter(canWriteLeads);
const OFFICE: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];
const VIOLATION_VIEWERS: RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP", "MARKETING", "READ_ONLY"];
const PARTNER_VIEWERS: RoleName[] = [...PARTNER_VIEW_ROLES];

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
      { href: "/calendar", label: "Calendar", icon: Calendar, hint: "What is on today, this week and this month — yours, or anyone's" },
      { href: "/permits", label: "Permits", icon: Shield },
      { href: "/canvassing", label: "Canvassing", icon: MapPin, roles: CANVASS_ROLES, hint: "Door-knocking routes and the properties knocked; a prospect becomes a lead when it converts" },
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
    key: "business-development",
    label: "Business Development",
    icon: Handshake,
    roles: PARTNER_VIEWERS,
    items: [
      { href: "/partners", label: "GC Partnerships", icon: Building2, match: "exact", hint: "The general contractors and other accounts KNU courts for work — who owns each, where it stands, when it was last touched" },
      { href: "/partners/contacts", label: "Contacts", icon: Users, hint: "The estimators, preconstruction managers and executives at those accounts" },
      { href: "/partners/analytics", label: "Analytics", icon: BarChart3, roles: ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"], hint: "Which GCs bring work worth having: bids, wins, revenue, profit, days to pay" },
      { href: "/partners/bids", label: "Bids", icon: Landmark, hint: "Bid packages from the accounts: due dates, go / no-go, what went out, what came back" },
      { href: "/partners/intake", label: "Bid intake", icon: Inbox, roles: ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"], hint: "Bid invitations that arrived by email, waiting for someone to create the bid or file them" },
      { href: "/partners/qualifications", label: "Qualifications", icon: ClipboardCheck, hint: "Prequalification applications with each GC: where each stands, what they still want, when it expires" },
      { href: "/partners/vault", label: "Document Vault", icon: FolderLock, hint: "KNU's own licences, certificates and company papers, versioned, with expiry alerts" },
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
      { href: "/collections", label: "Collections", icon: DollarSign, roles: ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"], hint: "Deposits missing, balances due and unpaid invoices" },
      { href: "/vendors", label: "Vendors", icon: Store, roles: ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"], hint: "Subcontractors, crews and suppliers — who they are and what has been spent with them" },
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
      { href: "/admin/notifications", label: "Notification Digests", icon: BellRing, hint: "When staff get email: the four daily digests, what goes out right away, and the delivery log" },
      { href: "/admin/workflow-role-defaults", label: "Workflow Role Defaults", icon: UserCheck, hint: "Who a workflow step is assigned to when the job has nobody in that role" },
      { href: "/admin/partners", label: "Business Development", icon: Handshake, hint: "Follow-up timing for GC accounts, who gets the tasks by default, and the markets list" },
      { href: "/admin/canvassing-settings", label: "Knock Scoring", icon: Gauge, heading: "Canvassing", hint: "How promising a canvassed door looks, from its history and neighbourhood" },
      { href: "/admin/job-cost-reconciliation", label: "Cost Reconciliation", icon: Scale, heading: "Finance", hint: "Matches card postings from cc-allocator against job expenses" },
      { href: "/admin/permits", label: "Permits", icon: Landmark, heading: "Permits", hint: "The building departments KNU files with and the documents each one asks for" },
      { href: "/admin/roofing", label: "Roofing Prices & Takeoff", icon: Ruler, hint: "What roofing materials cost and how measurements become a material list" },
      { href: "/admin/ai-usage", label: "AI Usage", icon: Sparkles, heading: "System", hint: "What the AI features have cost this month, by purpose, and the spending limits" },
      { href: "/admin/phones", label: "Phones", icon: Smartphone, hint: "Phones signed in to the KNU Field app; sign out a lost one" },
    ],
  },
];


/** The sections and items a role is offered, empty sections dropped. */
export function navSectionsFor(role: RoleName): NavSection[] {
  return navSections
    .filter((s) => !s.roles || s.roles.includes(role))
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}
