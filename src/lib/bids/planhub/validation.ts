import { z } from "zod";

/** What the "Send to CRM" bookmarklet hands the CRM page. */
export const planhubPayloadSchema = z.object({
  url: z.string().trim().url().max(2000),
  text: z.string().max(400_000),
  cards: z.array(z.object({ text: z.string().max(4000), column: z.string().max(60).nullish() })).max(500).nullish(),
});

const id = z.string().trim().min(1).max(64);

export const planhubApplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("BOARD"),
    snapshotId: id,
    rows: z.array(z.object({ index: z.number().int().min(0), projectId: z.union([id, z.literal("new")]) })).min(1, "Tick at least one project").max(500),
  }),
  z.object({
    kind: z.literal("PROJECT"),
    snapshotId: id,
    projectId: z.union([id, z.literal("new")]),
    project: z.object({
      name: z.string().trim().max(300),
      address1: z.string().trim().max(200).nullable(),
      city: z.string().trim().max(120).nullable(),
      state: z.string().trim().max(2).nullable(),
      zipCode: z.string().trim().max(10).nullable(),
    }),
    scopeTradeIds: z.array(id).max(60),
    gcs: z.array(z.object({ index: z.number().int().min(0), organizationId: z.union([id, z.literal("new")]), addContact: z.boolean() })).max(30),
  }),
]);
