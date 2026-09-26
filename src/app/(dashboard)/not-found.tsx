import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function NotFound() {
  return (
    <div className="py-16">
      <EmptyState
        icon={Compass}
        title="That page doesn't exist"
        description="The link may be old, or the record it pointed at was removed."
        action={
          <Link href="/">
            <Button variant="brand">Back to Dashboard</Button>
          </Link>
        }
      />
    </div>
  );
}
