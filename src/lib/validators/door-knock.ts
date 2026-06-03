import { z } from "zod/v4";

export const createDoorKnockSchema = z.object({
  outcome: z.enum([
    "NO_ANSWER",
    "SPOKE_WITH_OWNER",
    "SPOKE_WITH_OCCUPANT",
    "LEFT_DOOR_HANGER",
    "VACANT",
    "HOSTILE",
    "GATE_BLOCKED",
    "OTHER",
  ]),
  notes: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracyMeters: z.number().optional(),
  knockedAt: z.string().optional(),
});

export const createDoorKnockRouteSchema = z.object({
  name: z.string().min(1, "Route name is required"),
  description: z.string().optional(),
  scheduledFor: z.string().optional(),
  assignedToUserId: z.string().optional(),
});

export const updateDoorKnockRouteSchema = createDoorKnockRouteSchema
  .partial()
  .extend({
    status: z
      .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "ARCHIVED"])
      .optional(),
  });

export const addStopsToRouteSchema = z.object({
  leadIds: z.array(z.string()).min(1, "At least one lead is required"),
});

export const optimizeRouteSchema = z.object({
  startLat: z.number().optional(),
  startLng: z.number().optional(),
  startLabel: z.string().optional(),
  roundTrip: z.boolean().default(true),
});

export const updateRouteStopSchema = z.object({
  status: z.enum(["PENDING", "VISITED", "SKIPPED"]).optional(),
  notes: z.string().optional(),
  sortOrder: z.number().optional(),
  knockId: z.string().optional(),
});

export type CreateDoorKnockInput = z.infer<typeof createDoorKnockSchema>;
export type CreateDoorKnockRouteInput = z.infer<
  typeof createDoorKnockRouteSchema
>;
export type UpdateDoorKnockRouteInput = z.infer<
  typeof updateDoorKnockRouteSchema
>;
export type AddStopsToRouteInput = z.infer<typeof addStopsToRouteSchema>;
export type OptimizeRouteInput = z.infer<typeof optimizeRouteSchema>;
export type UpdateRouteStopInput = z.infer<typeof updateRouteStopSchema>;
