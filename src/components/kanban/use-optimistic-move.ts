"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Move a card now, confirm with the server, snap back on failure. Lifted
 * from the pipeline board so every board behaves the same way.
 */
export function useOptimisticMove<TData, TVars extends { id: string; toColumnId: string }>(opts: {
  queryKey: QueryKey;
  mutationFn: (vars: TVars) => Promise<unknown>;
  applyOptimistic: (data: TData | undefined, vars: TVars) => TData | undefined;
  invalidate: QueryKey[];
  messages: { success?: string; error: string };
}) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, TVars, { previous?: TData }>({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: opts.queryKey });
      const previous = qc.getQueryData<TData>(opts.queryKey);
      qc.setQueryData<TData>(opts.queryKey, (old) => opts.applyOptimistic(old, vars));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(opts.queryKey, ctx.previous);
      toast.error(opts.messages.error);
    },
    onSuccess: () => {
      if (opts.messages.success) toast.success(opts.messages.success);
    },
    onSettled: () => {
      for (const k of opts.invalidate) qc.invalidateQueries({ queryKey: k });
    },
  });
}
