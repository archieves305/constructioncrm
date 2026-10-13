import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { getPartnerSettings } from "@/lib/partners/settings";
import { PARTNER_STAGES } from "@/lib/partners/stages";
import { CONTACT_ROLES, INTERACTION_KINDS, INTERACTION_OUTCOMES, ORGANIZATION_KINDS, ORGANIZATION_PRIORITIES } from "@/lib/partners/validation";

const KIND_LABEL: Record<(typeof ORGANIZATION_KINDS)[number], string> = {
  GENERAL_CONTRACTOR: "General contractor",
  DEVELOPER: "Developer",
  PROPERTY_MANAGER: "Property manager",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  MUNICIPALITY: "Municipality",
  REFERRAL_PARTNER: "Referral partner",
  OTHER: "Other",
};

const ROLE_LABEL: Record<(typeof CONTACT_ROLES)[number], string> = {
  ESTIMATOR: "Estimator",
  SENIOR_ESTIMATOR: "Senior estimator",
  PRECON_MANAGER: "Preconstruction manager",
  PRECON_DIRECTOR: "Director of preconstruction",
  PROCUREMENT: "Procurement",
  TRADE_PARTNER_MANAGER: "Trade partner manager",
  BUSINESS_DEVELOPMENT: "Business development",
  PROJECT_EXECUTIVE: "Project executive",
  PROJECT_MANAGER: "Project manager",
  SUPERINTENDENT: "Superintendent",
  ACCOUNTS_PAYABLE: "Accounts payable",
  SAFETY: "Safety",
  OTHER: "Other",
};

const INTERACTION_LABEL: Record<(typeof INTERACTION_KINDS)[number], string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  SITE_VISIT: "Site visit",
  LUNCH: "Lunch",
  LINKEDIN: "LinkedIn",
  INTRO: "Introduction",
  PREQUAL_SUBMISSION: "Prequalification submitted",
  BID_DISCUSSION: "Bid discussion",
  DOC_SENT: "Documents sent",
  NOTE: "Note",
  OTHER: "Other",
};

const OUTCOME_LABEL: Record<(typeof INTERACTION_OUTCOMES)[number], string> = {
  NO_ANSWER: "No answer",
  LEFT_MESSAGE: "Left a message",
  SENT: "Sent, no reply yet",
  SPOKE: "Spoke with them",
  REPLIED: "They replied",
  MEETING_HELD: "Meeting held",
  NOT_APPLICABLE: "Not applicable",
};

/** Everything the Business Development forms need for their selects, with labels (Base UI needs `items`). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const [settings, trades, owners] = await Promise.all([
    getPartnerSettings(),
    prisma.serviceCategory.findMany({ where: { isActive: true, parentId: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true, role: { name: { in: ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"] } } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
  ]);
  return NextResponse.json({
    stages: PARTNER_STAGES.map((s) => ({ value: s.key, label: s.name, hint: s.hint, isClosed: s.isClosed })),
    kinds: ORGANIZATION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
    priorities: ORGANIZATION_PRIORITIES.map((p) => ({ value: p, label: `Priority ${p}` })),
    contactRoles: CONTACT_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    interactionKinds: INTERACTION_KINDS.map((k) => ({ value: k, label: INTERACTION_LABEL[k] })),
    outcomes: INTERACTION_OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] })),
    markets: settings.markets,
    trades: trades.map((t) => ({ value: t.id, label: t.name })),
    owners: owners.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })),
  });
}
