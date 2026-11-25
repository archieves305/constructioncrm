"use client";

import { use } from "react";
import { InspectionReview } from "@/components/inspector/inspection-review";

/** One inspection: areas, photos with the AI's boxes, findings to review, punch items, acceptance. */
export default function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <InspectionReview id={id} />;
}
