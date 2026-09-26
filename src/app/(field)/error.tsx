"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";

export default function FieldError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-4 py-12">
      <Callout
        tone="danger"
        title="This page hit an error"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => reset()}>
              Try again
            </Button>
            <Link href="/field" className="inline-flex h-8 items-center rounded-md px-3 text-sm hover:underline">
              My jobs
            </Link>
          </div>
        }
      >
        {error.message || "Something went wrong rendering this page."}
      </Callout>
    </div>
  );
}
