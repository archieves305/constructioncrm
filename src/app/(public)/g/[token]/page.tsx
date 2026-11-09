import type { Metadata } from "next";
import { GUEST_TEXT } from "@/lib/guest/purposes";
import { guestView } from "@/lib/guest/service";
import { GuestForm } from "./guest-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KNU Construction", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A crew's guest page (no sign-in). Shows only what the action needs: the
 * job's street, the crew's own scope line or install day. Every bad, expired
 * or used link gets the same kind of page, so nothing can be guessed.
 */
export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await guestView(token);
  if (view.state !== "open") {
    const t = GUEST_TEXT[view.state === "notFound" ? "en" : view.language];
    const key = view.state === "notFound" ? "notFound" : view.state;
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-subtle p-6">
        <div className="max-w-sm text-center">
          <p className="mb-1 text-sm font-semibold tracking-wide text-muted-foreground">KNU Construction</p>
          <p className="text-lg text-foreground">{t[key]}</p>
          {view.state === "notFound" ? <p className="mt-2 text-lg text-foreground">{GUEST_TEXT.es.notFound}</p> : null}
        </div>
      </main>
    );
  }
  return <GuestForm token={token} view={view} />;
}
