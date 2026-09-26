import { randomBytes } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { formatAddressLine } from "@/lib/labels/address";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { recomputeJobLabor, recomputeJobBalance } from "@/lib/services/job-pricing";
import { getEmailBrand } from "@/lib/email/brand";
import { sendEmail } from "@/lib/email/send";
import { renderChangeOrderBillPdf } from "@/lib/pdf/change-order-bill";
import { nextInvoiceNumber } from "@/lib/services/invoices";
import { canRemoveChangeOrderSovLine, changeOrderSovLine } from "@/lib/billing/sov";
import { closeAutoTask, ensureAutoTask, sourceKeyFor } from "@/lib/tasks/auto-tasks";
import { runAfterResponse } from "@/lib/tasks/defer";
import { logger } from "@/lib/logger";

// Customer approval links are long-lived (30 days) since the homeowner may take
// a while to respond. Token is a 32-byte hex string, unique per change order.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateChangeOrderToken(): string {
  return randomBytes(32).toString("hex");
}

export function changeOrderTokenExpiry(): Date {
  return new Date(Date.now() + TOKEN_TTL_MS);
}

// Include used wherever we need the customer + job context for a change order.
const CO_INCLUDE = {
  job: {
    select: {
      id: true,
      jobNumber: true,
      title: true,
      serviceType: true,
      jobType: true,
      billingMethod: true,
      leadId: true,
      lead: {
        select: {
          fullName: true,
          email: true,
          propertyAddress1: true,
          propertyAddress2: true,
          city: true,
          state: true,
          zipCode: true,
        },
      },
    },
  },
  laborContract: { select: { id: true, label: true, crew: { select: { name: true } } } },
} as const;

type ChangeOrderWithContext = Prisma.ChangeOrderGetPayload<{
  include: typeof CO_INCLUDE;
}>;

export function formatCustomerAddress(lead: {
  propertyAddress1: string | null;
  propertyAddress2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}): string {
  return [
    lead.propertyAddress1,
    lead.propertyAddress2,
    `${lead.city ?? ""}, ${lead.state ?? ""} ${lead.zipCode ?? ""}`.trim(),
  ]
    .filter((p) => p && p.trim() && p.trim() !== ",")
    .join(", ");
}

/** Next sequential customer change-order number for a job (max+1, no reuse). */
export async function nextChangeOrderNumber(
  tx: typeof prisma,
  jobId: string,
): Promise<number> {
  const agg = await tx.changeOrder.aggregate({
    where: { jobId },
    _max: { number: true },
  });
  return (agg._max.number ?? 0) + 1;
}

/** Next sequential labor change-order number for a contract (max+1, no reuse). */
export async function nextLaborChangeNumber(
  tx: typeof prisma,
  laborContractId: string,
): Promise<number> {
  const agg = await tx.laborChangeOrder.aggregate({
    where: { laborContractId },
    _max: { changeNumber: true },
  });
  return (agg._max.changeNumber ?? 0) + 1;
}

export async function getChangeOrderByToken(
  token: string,
): Promise<ChangeOrderWithContext | null> {
  return prisma.changeOrder.findUnique({ where: { token }, include: CO_INCLUDE });
}

export async function getChangeOrderById(
  id: string,
): Promise<ChangeOrderWithContext | null> {
  return prisma.changeOrder.findUnique({ where: { id }, include: CO_INCLUDE });
}

export function buildBillData(co: ChangeOrderWithContext) {
  return {
    number: co.number,
    title: co.title,
    description: co.description,
    customerPrice: Number(co.customerPrice),
    changeDate: co.createdAt,
    status: co.status,
    job: {
      jobNumber: co.job.jobNumber,
      title: co.job.title,
      serviceType: co.job.serviceType,
      address: formatAddressLine(co.job.lead),
    },
    customer: {
      fullName: co.job.lead.fullName,
      email: co.job.lead.email,
      address: formatCustomerAddress(co.job.lead),
    },
  };
}

export async function renderChangeOrderBill(co: ChangeOrderWithContext): Promise<Buffer> {
  return renderChangeOrderBillPdf(buildBillData(co));
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Email the customer a branded change-order bill with Approve / Reject buttons.
 * The buttons link to the public no-login page at /co/{token}. Returns false
 * when email isn't configured or the lead has no email on file.
 */
export async function sendChangeOrderEmail(
  co: ChangeOrderWithContext,
  replyTo?: string | null,
): Promise<boolean> {
  const to = co.job.lead.email;
  if (!to || !co.token) return false;

  const brand = await getEmailBrand();
  const url = `${env.APP_BASE_URL}/co/${co.token}`;
  const color = brand.primaryColor || "#b45309";
  const price = money(Number(co.customerPrice));
  const heading = co.title ? `Change Order: ${co.title}` : `Change Order CO-${co.number}`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <div style="background:${color};color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.85">${brand.companyName}</div>
      <h1 style="margin:6px 0 0;font-size:20px">${heading}</h1>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
      <p>Hi ${co.job.lead.fullName.split(" ")[0] || co.job.lead.fullName},</p>
      <p>We've prepared a change order for your project at <strong>${formatAddressLine(co.job.lead) || co.job.title}</strong>.</p>
      ${co.description ? `<p style="background:#f9fafb;border:1px solid #eee;border-radius:6px;padding:12px;white-space:pre-wrap">${co.description}</p>` : ""}
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:16px 0">
        <div style="font-size:11px;text-transform:uppercase;color:#92400e">Additional amount</div>
        <div style="font-size:28px;font-weight:bold;color:${color}">${price}</div>
      </div>
      <p>Please review and let us know how you'd like to proceed:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${url}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">Review &amp; Respond</a>
      </p>
      <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${url}</p>
      ${brand.signatureHtml ? `<hr style="border:none;border-top:1px solid #eee;margin:20px 0">${brand.signatureHtml}` : ""}
    </div>
  </div>`;

  const text = `${heading}\n\nProject: ${formatAddressLine(co.job.lead) || co.job.title}\nAdditional amount: ${price}\n\nReview and respond: ${url}`;

  try {
    await sendEmail({
      to,
      subject: `${heading} — ${formatAddressLine(co.job.lead) || co.job.title}`,
      html,
      text,
      replyTo: replyTo || undefined,
    });
    return true;
  } catch (err) {
    logger.error("change-order email send failed", {
      changeOrderId: co.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export type DecisionResult =
  | {
      ok: true;
      status: "APPROVED" | "REJECTED";
      /** How an approval was billed: a lump-sum invoice, or an SOV line on a PROGRESS job. */
      billing?: "INVOICE" | "SOV";
      invoiceNumber?: string;
      sovItemNo?: number;
    }
  | { ok: false; reason: "not_found" | "expired" | "already_decided" };

type DecisionSource = "customer" | "internal";

/**
 * Apply a customer's decision via the emailed no-login link. Requires the change
 * order to be SENT and the token unexpired. Idempotent: re-submitting after a
 * decision returns the existing outcome rather than billing twice.
 */
export async function decideChangeOrder(
  token: string,
  decision: "APPROVE" | "REJECT",
  name: string,
  ip: string | null,
  reason?: string | null,
): Promise<DecisionResult> {
  const co = await getChangeOrderByToken(token);
  if (!co) return { ok: false, reason: "not_found" };
  if (co.tokenExpiresAt && co.tokenExpiresAt < new Date())
    return { ok: false, reason: "expired" };

  // Idempotency — already decided.
  if (co.status === "APPROVED" || co.status === "REJECTED") {
    return { ok: false, reason: "already_decided" };
  }
  if (co.status !== "SENT") return { ok: false, reason: "not_found" };

  return applyDecision(co, decision, name, ip, reason, "customer");
}

/**
 * Record a decision internally (e.g. a change order approved in a meeting). Auth
 * is enforced at the route. Works on DRAFT or SENT change orders — it does not
 * require the bill to have been emailed first.
 */
export async function decideChangeOrderById(
  id: string,
  decision: "APPROVE" | "REJECT",
  name: string,
  reason?: string | null,
): Promise<DecisionResult> {
  const co = await getChangeOrderById(id);
  if (!co) return { ok: false, reason: "not_found" };
  if (co.status === "APPROVED" || co.status === "REJECTED")
    return { ok: false, reason: "already_decided" };
  if (co.status === "VOID") return { ok: false, reason: "not_found" };

  return applyDecision(co, decision, name, null, reason, "internal");
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_payments"; invoiceNumber?: string }
  | { ok: false; reason: "has_billing"; sovItemNo: number; billed: number };

/**
 * Delete a change order and unwind anything its approval created. Draft (and
 * other un-billed) change orders are removed directly. Approving a change order
 * issues a customer invoice, may file a crew-side labor change order, and moves
 * the job's contract/balance — so deleting an APPROVED one reverses all of that:
 *
 *  - the issued invoice is deleted (blocked if payments are already recorded
 *    against it — those must be removed first so we never orphan money),
 *  - on a PROGRESS job the SOV line it added is deleted instead (blocked once
 *    an application has billed work on that line — void the application
 *    first),
 *  - the linked labor change order is deleted (its generated addendum docs
 *    cascade away),
 *  - fixed-price contracts, which were incremented directly on approval, are
 *    decremented back; cost-plus / owned-rehab contracts self-heal from the
 *    labor rollup recompute below.
 */
export async function deleteChangeOrder(id: string): Promise<DeleteResult> {
  const co = await prisma.changeOrder.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      jobId: true,
      customerPrice: true,
      invoiceId: true,
      laborChangeOrderId: true,
      createdByUserId: true,
      job: { select: { id: true, jobType: true, leadId: true } },
      invoice: {
        select: {
          invoiceNumber: true,
          _count: { select: { payments: true } },
        },
      },
      sovLine: {
        select: {
          id: true,
          itemNo: true,
          invoiceLines: { where: { invoice: { status: { not: "VOID" } } }, select: { workCompleted: true } },
        },
      },
    },
  });
  if (!co) return { ok: false, reason: "not_found" };

  const retire = () =>
    runAfterResponse(
      async () => {
        await closeAutoTask(sourceKeyFor({ kind: "change-order.sent", changeOrderId: co.id }), {
          actorUserId: null,
          outcome: "CANCELLED",
          because: "change order deleted",
        });
        if (co.invoiceId) {
          await closeAutoTask(sourceKeyFor({ kind: "invoice.sent", invoiceId: co.invoiceId }), {
            actorUserId: null,
            outcome: "CANCELLED",
            because: "change order deleted",
          });
        }
      },
      { where: "change-orders.delete", changeOrderId: co.id },
    );

  if (co.status !== "APPROVED") {
    // No financial artifacts to unwind for draft / sent / rejected / void.
    await prisma.changeOrder.delete({ where: { id } });
    retire();
    return { ok: true };
  }

  if (co.invoice && co.invoice._count.payments > 0) {
    return {
      ok: false,
      reason: "has_payments",
      invoiceNumber: co.invoice.invoiceNumber,
    };
  }
  if (co.sovLine) {
    const billed = co.sovLine.invoiceLines.reduce((s, l) => s + Number(l.workCompleted), 0);
    if (!canRemoveChangeOrderSovLine(billed)) {
      return { ok: false, reason: "has_billing", sovItemNo: co.sovLine.itemNo, billed };
    }
  }

  const isFixedPrice = co.job.jobType === "FIXED_PRICE";
  const customerPrice = Number(co.customerPrice);
  const invoiceNumber = co.invoice?.invoiceNumber;

  await prisma.$transaction(async (tx) => {
    // Delete the change order first so its FK references to the invoice and
    // labor change order clear before we remove those rows.
    await tx.changeOrder.delete({ where: { id: co.id } });
    if (co.invoiceId) await tx.invoice.delete({ where: { id: co.invoiceId } });
    if (co.sovLine) {
      // Only VOID applications can still reference the line here (anything
      // live blocked above); drop those rows so the line can go.
      await tx.invoiceLine.deleteMany({ where: { sovLineId: co.sovLine.id, invoice: { status: "VOID" } } });
      await tx.sovLine.delete({ where: { id: co.sovLine.id } });
    }
    if (co.laborChangeOrderId)
      await tx.laborChangeOrder.delete({ where: { id: co.laborChangeOrderId } });

    if (isFixedPrice) {
      await tx.job.update({
        where: { id: co.job.id },
        data: { contractAmount: { decrement: customerPrice } },
      });
    }

    await tx.activityLog.create({
      data: {
        leadId: co.job.leadId,
        activityType: "NOTE",
        title: `Change order CO-${co.number} deleted`,
        description: `Approved change order reversed${
          invoiceNumber ? ` — invoice ${invoiceNumber} removed` : ""
        }${co.sovLine ? ` — SOV item #${co.sovLine.itemNo} removed` : ""}.`,
        createdByUserId: co.createdByUserId,
      },
    });
  });

  // Recompute labor rollup (fixes cost-plus / owned-rehab contractAmount) and
  // the derived balance, mirroring the approval flow.
  await recomputeJobLabor(co.jobId);
  await recomputeJobBalance(co.jobId);

  retire();
  return { ok: true };
}

/**
 * Core decision logic shared by the customer (token) and internal flows. The
 * caller is responsible for validating the change order's current status.
 */
async function applyDecision(
  co: ChangeOrderWithContext,
  decision: "APPROVE" | "REJECT",
  name: string,
  ip: string | null,
  reason: string | null | undefined,
  source: DecisionSource,
): Promise<DecisionResult> {
  const by = source === "internal" ? "internally" : "by customer";

  if (decision === "REJECT") {
    await prisma.$transaction(async (tx) => {
      await tx.changeOrder.update({
        where: { id: co.id },
        data: {
          status: "REJECTED",
          decidedAt: new Date(),
          decisionName: name,
          decisionIp: ip,
          rejectionReason: reason?.trim() || null,
        },
      });
      await tx.activityLog.create({
        data: {
          leadId: co.job.leadId,
          activityType: "NOTE",
          title: `Change order CO-${co.number} rejected ${by}`,
          description: `${name}${reason?.trim() ? `: ${reason.trim()}` : ""}`,
          createdByUserId: co.createdByUserId,
        },
      });
    });
    runAfterResponse(
      () =>
        closeAutoTask(sourceKeyFor({ kind: "change-order.sent", changeOrderId: co.id }), {
          actorUserId: source === "internal" ? co.createdByUserId : null,
          outcome: "CANCELLED",
          because: `rejected ${by}`,
        }).then(() => undefined),
      { where: "change-orders.reject", changeOrderId: co.id },
    );
    return { ok: true, status: "REJECTED" };
  }

  const customerPrice = Number(co.customerPrice);
  const crewCost = co.crewCost != null ? Number(co.crewCost) : null;
  const isFixedPrice = co.job.jobType === "FIXED_PRICE";
  // PROGRESS jobs never get a stand-alone change-order invoice: the change
  // order joins the schedule of values and is billed on the next payment
  // applications as the work is completed.
  const isProgress = co.job.billingMethod === "PROGRESS";

  const result = await prisma.$transaction(async (tx) => {
    // 1. Crew-side cost delta (keeps internal labor rollup correct).
    let laborChangeOrderId: string | null = null;
    if (crewCost != null && co.laborContractId) {
      const changeNumber = await nextLaborChangeNumber(
        tx as typeof prisma,
        co.laborContractId,
      );
      const laborCO = await tx.laborChangeOrder.create({
        data: {
          laborContractId: co.laborContractId,
          amount: crewCost,
          reason: `Customer change order CO-${co.number}${co.title ? `: ${co.title}` : ""}`,
          scopeChange: co.description ?? null,
          changeNumber,
          createdByUserId: co.createdByUserId,
        },
      });
      laborChangeOrderId = laborCO.id;
    }

    // 2. Bill the customer. Fixed-price contracts are bumped directly; rollup
    //    jobs (cost-plus / owned-rehab) have their contract recomputed from the
    //    crew cost via recomputeJobLabor below — adding here would double-count.
    if (isFixedPrice) {
      await tx.job.update({
        where: { id: co.job.id },
        data: { contractAmount: { increment: customerPrice } },
      });
    }

    // 3. Bill the customer — as an SOV line on a PROGRESS job, otherwise as
    //    an invoice for the change-order amount.
    let invoiceNumber: string | undefined;
    let invoiceId: string | undefined;
    let sovItemNo: number | undefined;
    let billedAs: string;
    if (isProgress) {
      const existing = await tx.sovLine.findMany({
        where: { jobId: co.job.id },
        select: { itemNo: true, sortOrder: true },
      });
      const line = changeOrderSovLine({ number: co.number, title: co.title, customerPrice }, existing);
      const created = await tx.sovLine.create({
        data: { jobId: co.job.id, ...line, changeOrderId: co.id },
        select: { itemNo: true },
      });
      sovItemNo = created.itemNo;
      billedAs = `Added to the schedule of values as item #${sovItemNo} — bill it on the next payment application.`;
    } else {
      invoiceNumber = await nextInvoiceNumber(
        co.job.jobNumber,
        co.job.id,
        tx as typeof prisma,
      );
      const invoice = await tx.invoice.create({
        data: {
          jobId: co.job.id,
          invoiceNumber,
          amount: customerPrice,
          status: "SENT",
          // Net-30 so the change-order invoice ages into A/R if unpaid.
          dueDate: new Date(Date.now() + 30 * 86400000),
          notes: `Change order CO-${co.number}${co.title ? ` — ${co.title}` : ""}`,
        },
      });
      invoiceId = invoice.id;
      billedAs = `Invoice ${invoiceNumber} created.`;
    }

    // 4. Mark the change order approved and link the artifacts.
    await tx.changeOrder.update({
      where: { id: co.id },
      data: {
        status: "APPROVED",
        decidedAt: new Date(),
        decisionName: name,
        decisionIp: ip,
        invoiceId: invoiceId ?? null,
        laborChangeOrderId,
      },
    });

    await tx.activityLog.create({
      data: {
        leadId: co.job.leadId,
        activityType: "NOTE",
        title: `Change order CO-${co.number} approved ${by}`,
        description: `${name} approved ${money(customerPrice)}. ${billedAs}`,
        createdByUserId: co.createdByUserId,
      },
    });

    return { invoiceNumber, invoiceId, sovItemNo };
  });

  // Recompute labor rollup, then the derived balance, outside the txn
  // (mirrors the existing change-order flow).
  await recomputeJobLabor(co.job.id);
  await recomputeJobBalance(co.job.id);

  // The CO follow-up is done; a lump-sum invoice it issued needs collecting
  // (an SOV line is collected through the applications, which raise their
  // own follow-ups). The customer flow has no session, so the CO's author
  // stands in as actor.
  runAfterResponse(
    async () => {
      await closeAutoTask(sourceKeyFor({ kind: "change-order.sent", changeOrderId: co.id }), {
        actorUserId: source === "internal" ? co.createdByUserId : null,
        outcome: "COMPLETED",
        because: `approved ${by}`,
      });
      if (result.invoiceId) {
        await ensureAutoTask({ kind: "invoice.sent", invoiceId: result.invoiceId }, co.createdByUserId);
      }
    },
    { where: "change-orders.approve", changeOrderId: co.id },
  );

  return {
    ok: true,
    status: "APPROVED",
    billing: isProgress ? "SOV" : "INVOICE",
    invoiceNumber: result.invoiceNumber,
    sovItemNo: result.sovItemNo,
  };
}
