import type { CodeViolationEventType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export type CaseEventInput = {
  caseId: string;
  itemId?: string | null;
  actorUserId: string | null;
  type: CodeViolationEventType;
  body?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
};

/** The case timeline. Written in the same transaction as the change it records. */
export async function recordCaseEvent(db: Db, e: CaseEventInput) {
  return db.codeViolationEvent.create({
    data: {
      caseId: e.caseId,
      itemId: e.itemId ?? null,
      actorUserId: e.actorUserId,
      type: e.type,
      body: e.body ?? null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
    },
  });
}

export async function recordCaseEvents(db: Db, events: CaseEventInput[]) {
  if (events.length === 0) return;
  await db.codeViolationEvent.createMany({
    data: events.map((e) => ({
      caseId: e.caseId,
      itemId: e.itemId ?? null,
      actorUserId: e.actorUserId,
      type: e.type,
      body: e.body ?? null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
    })),
  });
}
