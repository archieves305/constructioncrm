import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/auth/session";
import { discard, enqueue, flush, listOps, retry, setOnSent, subscribe, type OutboxOp } from "./outbox";

type OutboxValue = {
  ops: OutboxOp[];
  waiting: number;
  failed: number;
  forTarget: (id: string) => OutboxOp[];
  enqueue: (op: Omit<Parameters<typeof enqueue>[0], "userId">) => Promise<OutboxOp | null>;
  retry: (id: string, body?: unknown) => Promise<void>;
  discard: (id: string) => Promise<void>;
  flushNow: () => Promise<void>;
};

const Ctx = createContext<OutboxValue | null>(null);

export function useOutbox(): OutboxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOutbox outside OutboxProvider");
  return v;
}

/** Keeps the outbox moving: on start, on regaining signal, on return to the app, and every 30 s while anything waits. */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  const qc = useQueryClient();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  const [ops, setOps] = useState<OutboxOp[]>([]);

  const reload = useCallback(async () => {
    setOps(userId ? await listOps(userId) : []);
  }, [userId]);

  useEffect(() => {
    void reload();
    return subscribe(() => void reload());
  }, [reload]);

  useEffect(() => {
    setOnSent((op) => {
      // Refresh what the change touched; the server's copy is the truth now.
      void qc.invalidateQueries({ queryKey: ["task", op.targetId] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      if (op.kind === "file.upload") {
        void qc.invalidateQueries({ queryKey: ["files"] });
        void qc.invalidateQueries({ queryKey: ["gallery"] });
      }
      if (op.kind === "issue.create" || op.targetId.startsWith("issue:")) void qc.invalidateQueries({ queryKey: ["issues"] });
      if (op.targetId.startsWith("log:")) void qc.invalidateQueries({ queryKey: ["dailyLog"] });
    });
    return () => setOnSent(null);
  }, [qc]);

  useEffect(() => {
    if (!userId) return;
    void flush(userId);
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void flush(userId);
    });
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void flush(userId);
    });
    const timer = setInterval(() => void flush(userId), 30_000);
    return () => {
      net();
      app.remove();
      clearInterval(timer);
    };
  }, [userId]);

  const value = useMemo<OutboxValue>(
    () => ({
      ops,
      waiting: ops.filter((o) => o.state === "queued").length,
      failed: ops.filter((o) => o.state === "failed").length,
      forTarget: (id) => ops.filter((o) => o.targetId === id),
      enqueue: async (op) => (userId ? enqueue({ ...op, userId }) : null),
      retry: async (id, body) => {
        if (userId) await retry(id, userId, body);
      },
      discard,
      flushNow: async () => {
        if (userId) await flush(userId);
      },
    }),
    [ops, userId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
