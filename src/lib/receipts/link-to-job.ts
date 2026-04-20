import { prisma } from "@/lib/db/prisma";

export async function linkReceiptToJob(
  receiptId: string,
  jobId: string,
  userId: string,
): Promise<void> {
  const receipt = await prisma.incomingReceipt.findUnique({
    where: { id: receiptId },
  });
  if (!receipt) throw new Error("Receipt not found");
  if (receipt.status === "MATCHED" && receipt.jobExpenseId) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { leadId: true },
  });
  if (!job) throw new Error("Job not found");

  const expense = await prisma.jobExpense.create({
    data: {
      jobId,
      type: "MATERIAL",
      vendor: receipt.vendor,
      description: [receipt.poText, receipt.notes].filter(Boolean).join(" · ") || null,
      amount: receipt.amount,
      incurredDate: receipt.purchaseDate,
      billable: false,
      createdByUserId: userId,
    },
  });

  await prisma.incomingReceipt.update({
    where: { id: receiptId },
    data: {
      status: "MATCHED",
      matchedJobId: jobId,
      jobExpenseId: expense.id,
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "NOTE",
      title: `Receipt matched: ${receipt.vendor} — $${Number(receipt.amount).toFixed(2)}`,
      description: receipt.poText || undefined,
      createdByUserId: userId,
    },
  });
}

export async function unlinkReceipt(receiptId: string): Promise<void> {
  const receipt = await prisma.incomingReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return;

  if (receipt.jobExpenseId) {
    await prisma.jobExpense.delete({ where: { id: receipt.jobExpenseId } }).catch(() => {});
  }

  await prisma.incomingReceipt.update({
    where: { id: receiptId },
    data: {
      status: "UNMATCHED",
      matchedJobId: null,
      jobExpenseId: null,
    },
  });
}
