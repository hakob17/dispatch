import { z } from "zod";
import type { RecItem } from "./recommend";

export const recoQuery = z.object({
  strategy: z.enum(["for_you", "trending", "latest"]).default("for_you"),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  section: z.string().max(100).optional(),
});

export const publicRec = (r: RecItem) => ({
  id: r.externalId,
  title: r.title,
  url: r.url,
  summary: r.summary,
  imageUrl: r.imageUrl,
  section: r.section,
  publishedAt: r.publishedAt,
  score: r.score,
});
