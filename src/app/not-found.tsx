import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/** An address nothing answers to. The dashboard group has its own for records that are gone. */
export default function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <EmptyState
        icon={Compass}
        title="That page doesn't exist"
        description="The link may be old, or it was typed wrong."
        action={
          <Link href="/">
            <Button variant="brand">Back to Dashboard</Button>
          </Link>
        }
      />
    </div>
  );
}
