"use client";

import { useState } from "react";
import { CheckCircle, Download, FileText, ShieldCheck } from "lucide-react";
import { SignaturePad } from "@/components/field/signature-pad";

type Contract = {
  contractNumber: string;
  version: number;
  title: string;
  total: number;
  depositAmount: number;
  customer: { fullName: string; email: string | null; address: string };
  company: { name: string; licenses: string[] };
  job: { title: string; address: string };
  scopeSummary: { title: string; lineCount: number }[];
  paymentSchedule: { label: string; amount: number; trigger: string }[];
  offerExpiresAt: string;
  expiresAt: string | null;
  consentText: string;
};

type Props = {
  token: string;
  initialState: { signed: false } | { signed: true; signedAt: string | null; signerName: string | null };
  contract: Contract;
  brand: { companyName: string; primaryColor: string; logoUrl: string | null; contactEmail: string | null; officePhone: string | null };
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function SignView({ token, initialState, contract, brand }: Props) {
  const color = brand.primaryColor || "#b45309";
  const [done, setDone] = useState<{ signedAt: string | null; signerName: string | null } | null>(initialState.signed ? { signedAt: initialState.signedAt, signerName: initialState.signerName } : null);
  const [declined, setDeclined] = useState(false);
  const [read, setRead] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(contract.customer.email ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"sign" | "decline">("sign");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const pdfUrl = `/api/sign/${token}/pdf`;
  const canSign = read && name.trim().length > 0 && Boolean(signature) && consent && !submitting;

  function explain(status: number, body: { error?: string; message?: string }): string {
    if (status === 409 && body.error === "already_signed") return "This agreement has already been signed.";
    if (status === 409) return "This agreement is no longer open for signature.";
    if (status === 410) return "This signing link has expired. Please contact us for a fresh one.";
    if (status === 429) return "Too many attempts — please wait a few minutes and try again.";
    return body.message || body.error || "Something went wrong. Please try again.";
  }

  async function submitSign() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || null, signaturePngDataUri: signature, consent: true, consentText: contract.consentText }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.error === "already_signed") {
        setDone({ signedAt: null, signerName: name.trim() });
        return;
      }
      if (res.status === 410) setExpired(true);
      if (!res.ok) {
        setError(explain(res.status, body));
        return;
      }
      setDone({ signedAt: body.signedAt ?? new Date().toISOString(), signerName: name.trim() });
    } catch {
      setError("Network problem — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDecline() {
    setError(null);
    if (!name.trim()) {
      setError("Please type your name so we know who declined.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${token}/decline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), reason: reason.trim() || null }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(explain(res.status, body));
        return;
      }
      setDeclined(true);
    } catch {
      setError("Network problem — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <div className="rounded-t-xl px-5 py-4 text-white" style={{ background: color }}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.companyName} className="mb-2 h-10 object-contain" />
      ) : (
        <div className="text-lg font-semibold">{brand.companyName}</div>
      )}
      <h1 className="text-xl font-bold">{contract.title}</h1>
      <p className="text-sm opacity-90">
        {contract.contractNumber} · {contract.job.title}
      </p>
    </div>
  );

  const footer = (
    <p className="mt-6 text-center text-xs text-gray-500">
      {brand.companyName}
      {brand.officePhone ? ` · ${brand.officePhone}` : ""}
      {brand.contactEmail ? ` · ${brand.contactEmail}` : ""}
    </p>
  );

  if (declined) {
    return (
      <div className="mx-auto max-w-lg p-4">
        {header}
        <div className="rounded-b-xl border bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold">Thank you — we have recorded that you declined.</h2>
          <p className="mt-2 text-sm text-gray-600">Someone from {brand.companyName} will follow up. If you change your mind, just get in touch.</p>
        </div>
        {footer}
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-4">
        {header}
        <div className="rounded-b-xl border bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4 text-green-800">
            <CheckCircle className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <p className="font-semibold">Signed{done.signerName ? ` as ${done.signerName}` : ""}</p>
              <p className="text-sm">{done.signedAt ? `On ${longDate(done.signedAt)}. ` : ""}A copy has been emailed to you{email ? ` at ${email}` : ""}.</p>
            </div>
          </div>
          <a href={`${pdfUrl}?kind=signed&download=1`} className="mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: color }}>
            <Download className="h-4 w-4" /> Download your signed copy
          </a>
          <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> The signed PDF ends with a signature certificate recording when and how it was signed.
          </p>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      {header}
      <div className="space-y-4 rounded-b-xl border bg-white p-5 shadow-sm">
        <section className="text-sm">
          <p className="text-gray-600">Prepared for</p>
          <p className="font-medium">{contract.customer.fullName}</p>
          <p className="text-gray-600">{contract.job.address}</p>
          <p className="mt-2 text-gray-600">
            By {contract.company.name}
            {contract.company.licenses.length ? ` · Lic. ${contract.company.licenses.join(", ")}` : ""}
          </p>
        </section>

        <section className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="font-medium">Scope of work</p>
          <ul className="mt-1 list-disc pl-5 text-gray-700">
            {contract.scopeSummary.map((s) => (
              <li key={s.title}>
                {s.title} <span className="text-gray-500">({s.lineCount} item{s.lineCount === 1 ? "" : "s"})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">Full line items are in the agreement below.</p>
        </section>

        <section className="rounded-lg border p-3" style={{ borderColor: color }}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Contract price</span>
            <span className="text-2xl font-bold" style={{ color }}>
              {money(contract.total)}
            </span>
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {contract.paymentSchedule.map((r) => (
                <tr key={r.label} className="border-t">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{r.label}</span>
                    <span className="block text-xs text-gray-500">{r.trigger}</span>
                  </td>
                  <td className="py-1.5 text-right font-medium">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">Price valid through {longDate(contract.offerExpiresAt)}.</p>
        </section>

        <section>
          <p className="mb-2 text-sm font-medium">The agreement</p>
          <iframe src={`${pdfUrl}#toolbar=0`} title="Agreement PDF" className="hidden h-[520px] w-full rounded border sm:block" />
          <a href={pdfUrl} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-2 text-sm font-medium underline" style={{ color }}>
            <FileText className="h-4 w-4" /> Open the full agreement (PDF)
          </a>
        </section>

        <section className="space-y-4 border-t pt-4">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={read} onChange={(e) => setRead(e.target.checked)} />
            <span>I have read the full agreement, including the scope of work, contract price and payment schedule.</span>
          </label>

          <div className={read ? "" : "pointer-events-none opacity-50"} aria-disabled={!read}>
            <label className="block text-sm font-medium">
              Full legal name
              <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-base" placeholder="As it should appear on the agreement" />
            </label>
            <label className="mt-3 block text-sm font-medium">
              Email for your signed copy
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-base" />
            </label>

            {mode === "sign" ? (
              <>
                <p className="mt-4 text-sm font-medium">Draw your signature</p>
                <div className="mt-1 rounded-md border bg-white">
                  <SignaturePad onChange={setSignature} />
                </div>
                <label className="mt-4 flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="text-gray-700">{contract.consentText}</span>
                </label>
                {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
                <button type="button" disabled={!canSign || expired} onClick={submitSign} className="mt-4 w-full rounded-md px-4 py-3 text-base font-semibold text-white disabled:opacity-50" style={{ background: color }}>
                  {submitting ? "Signing…" : "Sign agreement"}
                </button>
                <button type="button" className="mt-3 w-full text-center text-sm text-gray-500 underline" onClick={() => setMode("decline")}>
                  I don&rsquo;t want to sign — decline
                </button>
              </>
            ) : (
              <>
                <label className="mt-4 block text-sm font-medium">
                  Why are you declining? (optional)
                  <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-base" />
                </label>
                {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
                <button type="button" disabled={submitting} onClick={submitDecline} className="mt-4 w-full rounded-md border border-red-600 px-4 py-3 text-base font-semibold text-red-700 disabled:opacity-50">
                  {submitting ? "Sending…" : "Confirm decline"}
                </button>
                <button type="button" className="mt-3 w-full text-center text-sm text-gray-500 underline" onClick={() => setMode("sign")}>
                  Back to signing
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      {footer}
    </div>
  );
}
