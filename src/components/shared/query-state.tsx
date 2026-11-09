"use client";

import Link from "next/link";
import { CircleSlash, Lock, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { queryStatus, type QueryLike } from "@/lib/ui/query-status";

/**
 * One way to show a query that is not ready: loading, refused, gone, or failed.
 * Pair it with `fetchJson` (which throws an `HttpError` carrying the status) so
 * a 403 reads "You don't have access" instead of an empty list or a skeleton
 * that never ends.
 *
 * Usage, either wrapping the content:
 *   <QueryState query={q} noun="person" back={{ href: "/personnel", label: "All personnel" }}>
 *     {(person) => <Detail person={person} />}
 *   </QueryState>
 * or as an early return:
 *   if (!q.data) return <QueryState query={q} noun="person" />;
 */
export interface QueryStateProps<T> {
  query: QueryLike & { data?: T; refetch?: () => unknown };
  /** "person", "daily log", "route" — used in the wording. */
  noun?: string;
  /** Where "not found" and "no access" send people. */
  back?: { href: string; label: string };
  /** Replaces the default skeleton. */
  loading?: React.ReactNode;
  /** Replaces the default not-found screen (e.g. "Start the log for this day"). */
  notFound?: React.ReactNode;
  /** Replaces the default refusal screen. */
  forbidden?: React.ReactNode;
  className?: string;
  children?: React.ReactNode | ((data: T) => React.ReactNode);
}

export function QueryState<T>({ query, noun = "page", back, loading, notFound, forbidden, className, children }: QueryStateProps<T>) {
  const status = queryStatus(query);
  const backLink = back ? (
    <Button variant="outline" size="sm" render={<Link href={back.href} />} nativeButton={false}>
      {back.label}
    </Button>
  ) : undefined;

  if (status === "loading") return <>{loading ?? <ListSkeleton rows={4} className={className} />}</>;
  if (status === "forbidden") {
    return (
      <>
        {forbidden ?? (
          <EmptyState
            className={className}
            icon={Lock}
            title="You don't have access to this"
            description={`Your role can't open this ${noun}. Ask an office manager if you need it.`}
            action={backLink}
          />
        )}
      </>
    );
  }
  if (status === "not_found") {
    return (
      <>
        {notFound ?? (
          <EmptyState
            className={className}
            icon={SearchX}
            title={`This ${noun} no longer exists`}
            description="It may have been deleted, or the link is wrong."
            action={backLink}
          />
        )}
      </>
    );
  }
  if (status === "failed") {
    const message = query.error instanceof Error ? query.error.message : undefined;
    return (
      <EmptyState
        className={className}
        icon={CircleSlash}
        title="Couldn't load"
        description={message}
        action={
          query.refetch ? (
            <Button variant="outline" size="sm" onClick={() => query.refetch?.()}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          ) : (
            backLink
          )
        }
      />
    );
  }
  return <>{typeof children === "function" ? children(query.data as T) : children}</>;
}
