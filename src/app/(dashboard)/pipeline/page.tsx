import { redirect } from "next/navigation";
import { boardRedirectUrl } from "@/lib/lists/board-redirect";

/** The pipeline is the board view of Leads now; old links and bookmarks land there with their filters. */
export default async function PipelineRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(boardRedirectUrl("/leads", await searchParams));
}
