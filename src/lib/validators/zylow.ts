import { z } from "zod";

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_miles: z.coerce.number().min(0).max(50).default(5),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const compsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const autocompleteQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
export type CompsQuery = z.infer<typeof compsQuerySchema>;
export type AutocompleteQuery = z.infer<typeof autocompleteQuerySchema>;
