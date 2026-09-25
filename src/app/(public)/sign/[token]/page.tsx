import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEmailBrand } from "@/lib/email/brand";
import { getContractForSigning } from "@/lib/customer-contracts/sign-service";
import { SignView } from "./sign-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign your agreement", robots: { index: false, follow: false } };

function Shell({ title, children, contact }: { title: string; children: React.ReactNode; contact: { email: string | null; phone: string | null } }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">{title}</h1>
        <div className="text-gray-600">{children}</div>
        {(contact.phone || contact.email) && (
          <p className="mt-4 text-sm text-gray-500">
            Questions? {contact.phone ? `Call ${contact.phone}` : ""}
            {contact.phone && contact.email ? " or " : ""}
            {contact.email ? `email ${contact.email}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getContractForSigning(token);
  if (view.kind === "not_found") notFound();
  const brand = await getEmailBrand();
  const contact = { email: brand.contactEmail, phone: brand.officePhone };

  if (view.kind === "expired") {
    return (
      <Shell title="This link has expired" contact={contact}>
        <p>The signing link for {view.contract.contractNumber} is no longer valid. Contact us and we will send a fresh one.</p>
      </Shell>
    );
  }
  if (view.kind === "declined") {
    return (
      <Shell title="Agreement declined" contact={contact}>
        <p>
          You declined {view.contract.contractNumber}
          {view.declinedAt ? ` on ${view.declinedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. If that was a mistake, get in touch and we will send it again.
        </p>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SignView
        token={token}
        initialState={view.kind === "signed" ? { signed: true, signedAt: view.signedAt?.toISOString() ?? null, signerName: view.signerName } : { signed: false }}
        contract={{ ...view.contract, expiresAt: view.contract.expiresAt?.toISOString() ?? null }}
        brand={{ companyName: brand.companyName, primaryColor: brand.primaryColor, logoUrl: brand.logoUrl, contactEmail: brand.contactEmail, officePhone: brand.officePhone }}
      />
    </div>
  );
}
