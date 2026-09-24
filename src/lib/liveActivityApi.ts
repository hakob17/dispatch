import { z } from "zod";

export const liveOptionsSchema = z.object({
  contentState: z.record(z.string(), z.unknown()),
  alert: z.object({ title: z.string().max(200), body: z.string().max(1000), sound: z.string().optional() }).optional(),
  staleDate: z.string().datetime({ offset: true }).optional(),
  dismissalDate: z.string().datetime({ offset: true }).optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  priority: z.enum(["high", "low"]).default("high"),
});

/** /api/v1/live-activities/<key>/… → <key> */
export function keyFromPath(pathname: string): string {
  const parts = pathname.split("/");
  const i = parts.indexOf("live-activities");
  return decodeURIComponent(parts[i + 1] ?? "");
}
