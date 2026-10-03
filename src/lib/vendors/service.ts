import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import type { VendorKind } from "@/generated/prisma/client";
import { aliasRows, groupPayees, matchVendor, normalisePayee, MIN_PATTERN_LENGTH, type AliasRow } from "./match";

/** A refusal the route turns into a response. */
export class VendorError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type VendorInput = {
  name: string;
  kind: VendorKind;
  trade?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

/** What a new vendor (or an existing one) is being connected to from the Unmatched tab. */
export type VendorLink = { payee?: string | null; crewId?: string | null; contractLabel?: string | null };

const clean = (v: string | null | undefined) => v?.trim() || null;

/** Every pattern an expense's payee is matched against: active vendors' names and aliases. */
export async function loadAliasRows(): Promise<AliasRow[]> {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    select: { id: true, name: true, aliases: { select: { pattern: true } } },
  });
  return aliasRows(vendors);
}

/**
 * The vendor a payee text belongs to, for an expense being written. Payroll
 * rows are never matched — their "vendor" is a worker's name. Never throws:
 * an expense must not fail to post because matching did.
 */
export async function resolveVendorId(text: string | null | undefined): Promise<string | null> {
  if (!normalisePayee(text)) return null;
  try {
    return matchVendor(text, await loadAliasRows());
  } catch {
    return null;
  }
}

/** Unlinked, non-payroll expenses that carry a payee text. */
const UNLINKED_WHERE = { vendorId: null, payrollPaymentId: null, vendor: { not: null } } as const;

/**
 * Link every unlinked expense one vendor's patterns now match. Returns the
 * number linked. `dryRun` counts without writing.
 */
export async function linkExpensesForVendor(vendorId: string, opts: { dryRun?: boolean } = {}): Promise<number> {
  const all = await loadAliasRows();
  if (!all.some((a) => a.vendorId === vendorId)) return 0;
  const rows = await prisma.jobExpense.findMany({ where: UNLINKED_WHERE, select: { id: true, vendor: true } });
  const ids = rows.filter((r) => matchVendor(r.vendor, all) === vendorId).map((r) => r.id);
  if (ids.length && !opts.dryRun) {
    await prisma.jobExpense.updateMany({ where: { id: { in: ids }, vendorId: null }, data: { vendorId } });
  }
  return ids.length;
}

/** Link every unlinked expense any vendor matches — the backfill. */
export async function linkAllExpenses(opts: { dryRun?: boolean } = {}): Promise<{ scanned: number; linked: number; byVendor: Record<string, number> }> {
  const all = await loadAliasRows();
  const rows = await prisma.jobExpense.findMany({ where: UNLINKED_WHERE, select: { id: true, vendor: true } });
  const byVendorIds = new Map<string, string[]>();
  for (const r of rows) {
    const vendorId = matchVendor(r.vendor, all);
    if (!vendorId) continue;
    byVendorIds.set(vendorId, [...(byVendorIds.get(vendorId) ?? []), r.id]);
  }
  const byVendor: Record<string, number> = {};
  let linked = 0;
  for (const [vendorId, ids] of byVendorIds) {
    if (!opts.dryRun) await prisma.jobExpense.updateMany({ where: { id: { in: ids }, vendorId: null }, data: { vendorId } });
    byVendor[vendorId] = ids.length;
    linked += ids.length;
  }
  return { scanned: rows.length, linked, byVendor };
}

async function assertAliasFree(pattern: string, vendorId: string | null) {
  if (pattern.length < MIN_PATTERN_LENGTH) throw new VendorError(400, "That name is too short to match payees on.");
  const taken = await prisma.vendorAlias.findUnique({ where: { pattern }, select: { vendorId: true, vendor: { select: { name: true } } } });
  if (taken && taken.vendorId !== vendorId) throw new VendorError(409, `"${pattern}" already belongs to ${taken.vendor.name}.`);
  return Boolean(taken);
}

/** Add a payee spelling to a vendor and link the expenses it now matches. */
export async function addAlias(vendorId: string, text: string, actorUserId: string): Promise<{ pattern: string; linked: number }> {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } });
  if (!vendor) throw new VendorError(404, "Vendor not found");
  const pattern = normalisePayee(text);
  const exists = await assertAliasFree(pattern, vendorId);
  // Nothing to store when the vendor's name or an alias it has already catches
  // this spelling ("the home depot hollywood fl" under a vendor named Home Depot).
  if (!exists && matchVendor(pattern, await loadAliasRows()) !== vendorId) {
    await prisma.vendorAlias.create({ data: { vendorId, pattern } });
  }
  const linked = await linkExpensesForVendor(vendorId);
  await recordAudit({ actorUserId, entityType: "Vendor", entityId: vendorId, action: "alias_add", after: { pattern, expensesLinked: linked } });
  return { pattern, linked };
}

/** Remove a spelling. Expenses already linked stay linked — the link was a person's decision. */
export async function removeAlias(vendorId: string, aliasId: string, actorUserId: string): Promise<void> {
  const alias = await prisma.vendorAlias.findFirst({ where: { id: aliasId, vendorId } });
  if (!alias) throw new VendorError(404, "Alias not found");
  await prisma.vendorAlias.delete({ where: { id: aliasId } });
  await recordAudit({ actorUserId, entityType: "Vendor", entityId: vendorId, action: "alias_remove", before: { pattern: alias.pattern } });
}

/** Connect a vendor to a payee spelling, a crew, or every contract typed under a label. */
export async function linkVendor(vendorId: string, link: VendorLink, actorUserId: string): Promise<{ expensesLinked: number; contractsLinked: number; crewLinked: boolean }> {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new VendorError(404, "Vendor not found");
  let expensesLinked = 0;
  let contractsLinked = 0;
  let crewLinked = false;

  if (clean(link.payee)) expensesLinked = (await addAlias(vendorId, link.payee as string, actorUserId)).linked;

  if (link.crewId) {
    const crew = await prisma.crew.findUnique({ where: { id: link.crewId }, select: { id: true, vendorId: true } });
    if (!crew) throw new VendorError(404, "Crew not found");
    await prisma.crew.update({ where: { id: crew.id }, data: { vendorId } });
    crewLinked = true;
    await recordAudit({ actorUserId, entityType: "Crew", entityId: crew.id, action: "vendor_link", before: { vendorId: crew.vendorId }, after: { vendorId } });
  }

  const label = clean(link.contractLabel);
  if (label) {
    const contracts = await prisma.laborContract.findMany({ where: { crewId: null, vendorId: null, label: { not: null } }, select: { id: true, label: true } });
    const ids = contracts.filter((c) => normalisePayee(c.label) === normalisePayee(label)).map((c) => c.id);
    if (ids.length) await prisma.laborContract.updateMany({ where: { id: { in: ids } }, data: { vendorId } });
    contractsLinked = ids.length;
    await recordAudit({ actorUserId, entityType: "Vendor", entityId: vendorId, action: "contract_label_link", after: { label, contracts: ids.length } });
  }
  return { expensesLinked, contractsLinked, crewLinked };
}

export async function createVendor(input: VendorInput, link: VendorLink | undefined, actorUserId: string) {
  const name = input.name.trim();
  const own = normalisePayee(name);
  const clash = await prisma.vendor.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (clash) throw new VendorError(409, "A vendor with that name already exists.");
  // Another vendor's alias equal to this name would make matching ambiguous.
  if (own.length >= MIN_PATTERN_LENGTH) await assertAliasFree(own, null);

  const vendor = await prisma.vendor.create({
    data: {
      name,
      kind: input.kind,
      trade: clean(input.trade),
      contactName: clean(input.contactName),
      phone: clean(input.phone),
      email: clean(input.email),
      address: clean(input.address),
      notes: clean(input.notes),
    },
  });
  await recordAudit({ actorUserId, entityType: "Vendor", entityId: vendor.id, action: "create", after: vendor });

  let expensesLinked = await linkExpensesForVendor(vendor.id);
  let contractsLinked = 0;
  if (link) {
    const r = await linkVendor(vendor.id, link, actorUserId);
    expensesLinked += r.expensesLinked;
    contractsLinked = r.contractsLinked;
  }
  return { vendor, expensesLinked, contractsLinked };
}

export async function updateVendor(id: string, input: Partial<VendorInput> & { isActive?: boolean }, actorUserId: string) {
  const before = await prisma.vendor.findUnique({ where: { id } });
  if (!before) throw new VendorError(404, "Vendor not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = await prisma.vendor.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw new VendorError(409, "A vendor with that name already exists.");
    data.name = name;
  }
  if (input.kind !== undefined) data.kind = input.kind;
  for (const key of ["trade", "contactName", "phone", "email", "address", "notes"] as const) {
    if (input[key] !== undefined) data[key] = clean(input[key]);
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  const vendor = await prisma.vendor.update({ where: { id }, data });
  await recordAudit({ actorUserId, entityType: "Vendor", entityId: id, action: "update", before, after: vendor });
  // A new name is a new implicit alias.
  const expensesLinked = data.name !== undefined || input.isActive === true ? await linkExpensesForVendor(id) : 0;
  return { vendor, expensesLinked };
}

/** The directory: each vendor with its approved spend and the jobs it appears on. */
export async function listVendors(opts: { q?: string; kind?: VendorKind; includeInactive?: boolean } = {}) {
  const vendors = await prisma.vendor.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" as const } }, { trade: { contains: opts.q, mode: "insensitive" as const } }, { contactName: { contains: opts.q, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { aliases: true, crews: true } } },
  });
  const ids = vendors.map((v) => v.id);
  const [spend, jobPairs] = await Promise.all([
    prisma.jobExpense.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, status: "APPROVED" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.jobExpense.groupBy({ by: ["vendorId", "jobId"], where: { vendorId: { in: ids }, status: "APPROVED" } }),
  ]);
  const spendBy = new Map(spend.map((s) => [s.vendorId, { total: Number(s._sum.amount ?? 0), count: s._count._all }]));
  const jobsBy = new Map<string, number>();
  for (const p of jobPairs) if (p.vendorId) jobsBy.set(p.vendorId, (jobsBy.get(p.vendorId) ?? 0) + 1);
  return vendors.map((v) => ({
    id: v.id,
    name: v.name,
    kind: v.kind,
    trade: v.trade,
    contactName: v.contactName,
    phone: v.phone,
    email: v.email,
    isActive: v.isActive,
    aliasCount: v._count.aliases,
    crewCount: v._count.crews,
    approvedSpend: spendBy.get(v.id)?.total ?? 0,
    expenseCount: spendBy.get(v.id)?.count ?? 0,
    jobCount: jobsBy.get(v.id) ?? 0,
  }));
}

/** Labor contracts that are a vendor's: linked directly, or through the vendor's crew. */
export const laborContractsOfVendor = (vendorId: string) => ({ OR: [{ vendorId }, { vendorId: null, crew: { vendorId } }] });

/** The vendor a labor contract belongs to: its own link, else its crew's. */
export function vendorForLaborContract(contract: { vendorId: string | null; crew?: { vendorId: string | null } | null }): string | null {
  return contract.vendorId ?? contract.crew?.vendorId ?? null;
}

export async function getVendorDetail(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { aliases: { orderBy: { pattern: "asc" } }, crews: { select: { id: true, name: true, isActive: true, trades: true } } },
  });
  if (!vendor) return null;
  const [byJob, contracts, recent] = await Promise.all([
    prisma.jobExpense.groupBy({ by: ["jobId"], where: { vendorId: id, status: "APPROVED" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.laborContract.findMany({
      where: laborContractsOfVendor(id),
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, contractAmount: true, createdAt: true,
        crew: { select: { name: true } },
        job: { select: JOB_LABEL_SELECT },
        payments: { select: { amount: true } },
        changeOrders: { select: { amount: true } },
      },
    }),
    prisma.jobExpense.findMany({
      where: { vendorId: id },
      orderBy: { incurredDate: "desc" },
      take: 25,
      select: { id: true, vendor: true, description: true, amount: true, incurredDate: true, type: true, status: true, externalId: true, job: { select: JOB_LABEL_SELECT } },
    }),
  ]);
  const jobs = await prisma.job.findMany({ where: { id: { in: byJob.map((b) => b.jobId) } }, select: JOB_LABEL_SELECT });
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  return {
    vendor,
    spendByJob: byJob
      .map((b) => ({ job: jobById.get(b.jobId) ?? null, total: Number(b._sum.amount ?? 0), count: b._count._all }))
      .filter((r) => r.job)
      .sort((a, b) => b.total - a.total),
    approvedSpend: byJob.reduce((sum, b) => sum + Number(b._sum.amount ?? 0), 0),
    laborContracts: contracts.map((c) => ({
      id: c.id,
      name: c.crew?.name ?? c.label ?? "",
      job: c.job,
      amount: Number(c.contractAmount) + c.changeOrders.reduce((s, o) => s + Number(o.amount), 0),
      paid: c.payments.reduce((s, p) => s + Number(p.amount), 0),
    })),
    recentExpenses: recent.map((e) => ({ ...e, amount: Number(e.amount), fed: Boolean(e.externalId), externalId: undefined })),
  };
}

/** Everything that has no vendor yet: payee spellings, crews, and contractors typed on labor contracts. */
export async function getUnmatched() {
  const [expenses, crews, contracts] = await Promise.all([
    prisma.jobExpense.findMany({ where: UNLINKED_WHERE, select: { vendor: true, amount: true, jobId: true } }),
    prisma.crew.findMany({ where: { vendorId: null, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, trades: true, phone: true, email: true, _count: { select: { laborContracts: true } } } }),
    prisma.laborContract.findMany({ where: { crewId: null, vendorId: null, label: { not: null } }, select: { label: true, contractAmount: true, jobId: true } }),
  ]);
  const labels = groupPayees(contracts.map((c) => ({ vendor: c.label, amount: Number(c.contractAmount), jobId: c.jobId })));
  return {
    payees: groupPayees(expenses.map((e) => ({ vendor: e.vendor, amount: Number(e.amount), jobId: e.jobId }))),
    crews: crews.map((c) => ({ id: c.id, name: c.name, trades: c.trades, phone: c.phone, email: c.email, contracts: c._count.laborContracts })),
    contractLabels: labels,
  };
}
