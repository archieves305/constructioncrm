"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson } from "@/lib/fetch-json";
import { isScopeForced, resolveClientScope, scopeToPref, type ListScope, type ListScopePref } from "@/lib/lists/scope";
import { useSearchParamState } from "./use-search-param-state";

export type BoardDensity = "COMFORTABLE" | "COMPACT";

export type MePreferences = {
  taskEmailsEnabled: boolean;
  escalationEmailsEnabled: boolean;
  reminderDigestEnabled: boolean;
  nudgeEmailsEnabled: boolean;
  defaultListScope: ListScopePref;
  boardDensity: BoardDensity;
};

export const ME_PREFERENCES_KEY = ["me-preferences"] as const;

export function useMePreferences() {
  return useQuery<MePreferences>({
    queryKey: ME_PREFERENCES_KEY,
    queryFn: () => fetchJson("/api/me/preferences"),
    staleTime: 5 * 60_000,
  });
}

export function usePatchPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<MePreferences>) =>
      fetchJson<MePreferences>("/api/me/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ME_PREFERENCES_KEY });
      const prev = qc.getQueryData<MePreferences>(ME_PREFERENCES_KEY);
      if (prev) qc.setQueryData<MePreferences>(ME_PREFERENCES_KEY, { ...prev, ...patch });
      return { prev };
    },
    onError: (e: Error, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(ME_PREFERENCES_KEY, ctx.prev);
      toast.error(e.message || "Could not save that");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ME_PREFERENCES_KEY }),
  });
}

/**
 * Mine / All for a list or board: the URL wins for this visit, the saved
 * preference otherwise, Mine by default. Changing it writes both, so the
 * choice follows the person to the next page and the next device.
 * `ready` is false only while the preference is still loading and the URL
 * says nothing — gate the list query on it to avoid a Mine→All flash.
 */
export function useListScope() {
  const { get, set } = useSearchParamState();
  const { data: session } = useSession();
  const role = session?.user.role ?? null;
  const { data: prefs, isLoading } = useMePreferences();
  const patch = usePatchPreferences();
  const urlScope = get("scope");

  const scope: ListScope = resolveClientScope({ url: urlScope, pref: prefs?.defaultListScope ?? null, role });
  const forced = role ? isScopeForced(role) : false;
  const ready = Boolean(urlScope) || !isLoading || forced;
  const density: BoardDensity = prefs?.boardDensity ?? "COMFORTABLE";

  const setScope = useCallback(
    (next: ListScope) => {
      set("scope", next);
      if (prefs && prefs.defaultListScope !== scopeToPref(next)) patch.mutate({ defaultListScope: scopeToPref(next) });
    },
    [set, prefs, patch],
  );

  const setDensity = useCallback(
    (next: BoardDensity) => {
      if (prefs?.boardDensity !== next) patch.mutate({ boardDensity: next });
    },
    [prefs, patch],
  );

  return { scope, setScope, forced, ready, density, setDensity };
}
