"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";

/**
 * A page that threw while rendering. Without this a render error was a
 * blank screen; now it says what broke and offers to try again.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Callout
        tone="danger"
        title="This page hit an error"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => reset()}>
              Try again
            </Button>
            <Link href="/" className="inline-flex h-8 items-center rounded-md px-3 text-sm hover:underline">
              Back to Dashboard
            </Link>
          </div>
        }
      >
        {error.message || "Something went wrong rendering this page."}
        {error.digest && <span className="mt-1 block font-mono text-[11px] text-muted-foreground">ref {error.digest}</span>}
      </Callout>
    </div>
  );
}
