"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Download, FileText } from "lucide-react";

type Props = {
  token: string;
  status: "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "VOID";
  decisionName: string | null;
  number: number;
  title: string | null;
  description: string | null;
  customerPrice: number;
  job: { jobNumber: string; title: string; serviceType: string };
  customer: { fullName: string; address: string };
  brand: {
    companyName: string;
    primaryColor: string;
    logoUrl: string | null;
    contactEmail: string | null;
    officePhone: string | null;
  };
};

function money(n: number) {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ChangeOrderBillView(props: Props) {
  const { token, brand } = props;
  const color = brand.primaryColor || "#b45309";

  const [decided, setDecided] = useState<"APPROVED" | "REJECTED" | null>(
    props.status === "APPROVED" || props.status === "REJECTED"
      ? props.status
      : null,
  );
  const [name, setName] = useState(props.decisionName ?? "");
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: "APPROVE" | "REJECT") {
    setError(null);
    if (!name.trim()) {
      setError("Please type your name to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/co/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          name: name.trim(),
          reason: decision === "REJECT" ? reason.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setError("This change order has already been responded to.");
        } else if (res.status === 410) {
          setError("This link has expired.");
        } else {
          setError(body?.error || "Something went wrong. Please try again.");
        }
        return;
      }
      setDecided(decision === "APPROVE" ? "APPROVED" : "REJECTED");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      {/* Header */}
      <div
        className="rounded-t-xl px-6 py-5 text-white"
        style={{ backgroundColor: color }}
      >
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt={brand.companyName}
            className="mb-2 h-8 object-contain"
          />
        ) : (
          <div className="text-xs uppercase tracking-wider opacity-80">
            {brand.companyName}
          </div>
        )}
        <h1 className="mt-1 text-xl font-bold">Change Order CO-{props.number}</h1>
        {props.title ? (
          <div className="mt-1 text-sm opacity-90">{props.title}</div>
        ) : null}
      </div>

      <div className="space-y-4 rounded-b-xl border border-t-0 bg-white p-6 shadow-sm">
        {/* Project + customer */}
        <div className="text-sm text-gray-600">
          <div className="font-medium text-gray-900">{props.customer.fullName}</div>
          <div>{props.customer.address}</div>
          <div className="mt-2">
            Project: {props.job.jobNumber} — {props.job.title}
          </div>
        </div>

        {/* Scope */}
        {props.description ? (
          <div className="rounded-lg bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-700">
            {props.description}
          </div>
        ) : null}

        {/* Amount */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: "#fffbeb", border: "1px solid #fde68a" }}
        >
          <div className="text-xs uppercase text-amber-800">
            Additional amount
          </div>
          <div className="text-3xl font-bold" style={{ color }}>
            {money(props.customerPrice)}
          </div>
        </div>

        {/* PDF link */}
        <a
          href={`/api/co/${token}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium"
          style={{ color }}
        >
          <Download className="h-4 w-4" />
          Download PDF
        </a>

        {/* Decision area */}
        {decided ? (
          <div
            className={`flex items-center gap-3 rounded-lg p-4 ${
              decided === "APPROVED"
                ? "bg-green-50 text-green-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {decided === "APPROVED" ? (
              <CheckCircle className="h-6 w-6" />
            ) : (
              <XCircle className="h-6 w-6" />
            )}
            <div>
              <div className="font-semibold">
                {decided === "APPROVED"
                  ? "Change order approved"
                  : "Change order rejected"}
              </div>
              <div className="text-sm opacity-80">
                Thank you. We&apos;ve recorded your response
                {name ? ` from ${name}` : ""}.
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Your name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Type your full name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            {mode === "reject" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Let us know why"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex gap-3">
              <button
                disabled={submitting}
                onClick={() => submit("APPROVE")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                <CheckCircle className="h-5 w-5" />
                Approve
              </button>
              {mode === "reject" ? (
                <button
                  disabled={submitting}
                  onClick={() => submit("REJECT")}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  <XCircle className="h-5 w-5" />
                  Confirm reject
                </button>
              ) : (
                <button
                  disabled={submitting}
                  onClick={() => setMode("reject")}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <XCircle className="h-5 w-5" />
                  Reject
                </button>
              )}
            </div>
          </div>
        )}

        {/* Contact footer */}
        <div className="flex items-center gap-2 border-t pt-3 text-xs text-gray-500">
          <FileText className="h-3.5 w-3.5" />
          Questions? Contact {brand.companyName}
          {brand.officePhone ? ` · ${brand.officePhone}` : ""}
          {brand.contactEmail ? ` · ${brand.contactEmail}` : ""}
        </div>
      </div>
    </div>
  );
}
