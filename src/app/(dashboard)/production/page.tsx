import { redirect } from "next/navigation";
import { boardRedirectUrl } from "@/lib/lists/board-redirect";

/** The production board is the board view of Jobs now; old links and bookmarks land there with their filters. */
export default async function ProductionRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(boardRedirectUrl("/jobs", await searchParams));
}
