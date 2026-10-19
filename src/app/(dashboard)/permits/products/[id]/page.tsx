"use client";

import { use } from "react";
import { ApprovalDetailView } from "@/components/permit-intel/approvals/approval-detail";

/** One product approval: the document beside its fields. */
export default function ProductApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ApprovalDetailView id={id} />;
}
