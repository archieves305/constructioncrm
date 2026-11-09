import { notFound } from "next/navigation";
import {
  getChangeOrderByToken,
  buildBillData,
  formatCustomerAddress,
} from "@/lib/services/change-orders";
import { getEmailBrand } from "@/lib/email/brand";
import { ChangeOrderBillView } from "./change-order-bill-view";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
      <div className="text-center">{children}</div>
    </div>
  );
}

export default async function ChangeOrderPublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const co = await getChangeOrderByToken(token);
  if (!co) notFound();

  if (co.tokenExpiresAt && co.tokenExpiresAt < new Date()) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-bold">Link Expired</h1>
        <p className="text-fg-secondary">
          This change order link has expired. Please contact us for an updated
          copy.
        </p>
      </Shell>
    );
  }

  const brand = await getEmailBrand();
  const bill = buildBillData(co);

  return (
    <div className="min-h-screen bg-surface-subtle">
      <ChangeOrderBillView
        token={token}
        status={co.status}
        decisionName={co.decisionName}
        number={bill.number}
        title={bill.title}
        description={bill.description}
        customerPrice={bill.customerPrice}
        job={bill.job}
        customer={{
          fullName: bill.customer.fullName,
          address: formatCustomerAddress(co.job.lead),
        }}
        brand={{
          companyName: brand.companyName,
          primaryColor: brand.primaryColor,
          logoUrl: brand.logoUrl,
          contactEmail: brand.contactEmail,
          officePhone: brand.officePhone,
        }}
      />
    </div>
  );
}
