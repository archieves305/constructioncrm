"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { fetchJson } from "@/lib/fetch-json";

type Gallery = { items: { key: string; url: string; day: string; missing: boolean; by: { firstName: string; lastName: string } }[] };
type Issue = { id: string; title: string; status: string; createdAt: string; raisedBy: { firstName: string; lastName: string } | null };

/**
 * On a day's log: what the field sent that day — photos taken on the job and
 * problems raised — so the reviewer sees the day the crew saw. Read from the
 * job's gallery and field issues; nothing is copied into the log.
 */
export function CrewDayCard({ jobId, date }: { jobId: string; date: string }) {
  const gallery = useQuery<Gallery>({ queryKey: ["gallery", jobId, date], queryFn: () => fetchJson(`/api/jobs/${jobId}/gallery?from=${date}&to=${date}`) });
  const issues = useQuery<Issue[]>({ queryKey: ["field-issues", jobId], queryFn: () => fetchJson(`/api/jobs/${jobId}/field-issues`) });
  const problems = (issues.data ?? []).filter((i) => i.createdAt.slice(0, 10) === date);
  const photos = (gallery.data?.items ?? []).filter((p) => !p.missing);
  if (!photos.length && !problems.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">From the field this day</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {photos.length ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {photos.length} photo{photos.length === 1 ? "" : "s"} on the job
            </p>
            <div className="flex flex-wrap gap-2">
              {photos.slice(0, 12).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin file route, sized thumbnails
                <img key={p.key} src={p.url} alt={`Photo by ${p.by.firstName} ${p.by.lastName}`} className="size-20 rounded-md object-cover" />
              ))}
            </div>
          </div>
        ) : null}
        {problems.length ? (
          <ul className="space-y-2">
            {problems.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge kind="task" value={i.status} />
                <span className="font-medium">{i.title}</span>
                {i.raisedBy ? <span className="text-muted-foreground">· {i.raisedBy.firstName} {i.raisedBy.lastName}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
