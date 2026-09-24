import { z } from "zod";
import { TRANSLATABLE_FIELDS, normalizeLanguage } from "./localize";

const translations = z
  .record(z.string(), z.object(Object.fromEntries(TRANSLATABLE_FIELDS.map((f) => [f, z.string().optional()]))))
  .refine((t) => Object.keys(t).every((k) => normalizeLanguage(k)), "keys must be language tags like de or pt-BR")
  .nullable()
  .optional();

/** Field shapes without defaults — reused for PATCH, where absent means "unchanged". */
export const templateFields = z.object({
  name: z.string().min(1),
  channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP"]),
  subject: z.string().nullable().optional(),
  htmlBody: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
  pushTitle: z.string().nullable().optional(),
  pushBody: z.string().nullable().optional(),
  pushUrl: z.string().nullable().optional(),
  pushImageUrl: z.string().url().nullable().optional().or(z.literal("")),
  pushPriority: z.enum(["HIGH", "NORMAL"]).optional(),
  pushCollapseKey: z.string().max(64).nullable().optional(),
  pushTtlSeconds: z.number().int().min(0).max(28 * 86400).nullable().optional(),
  pushData: z.record(z.string(), z.string()).nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  webhookBody: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  inAppLayout: z.enum(["MODAL", "BANNER", "FULLSCREEN", "INBOX"]).nullable().optional(),
  inAppButtons: z.array(z.object({ label: z.string().max(40), url: z.string().max(2000) })).max(2).nullable().optional(),
  inAppExpiresHours: z.number().int().min(1).max(24 * 365).nullable().optional(),
  cardStyle: z.enum(["CLASSIC", "CAPTIONED_IMAGE", "BANNER"]).nullable().optional(),
  cardPinned: z.boolean().optional(),
  cardCategory: z.string().max(40).regex(/^[a-z0-9_-]*$/, "lowercase letters, digits, _ and -").nullable().optional(),
  cardDismissible: z.boolean().optional(),
  smsBody: z.string().max(1600).nullable().optional(), // 10 SMS segments
  whatsappContentSid: z.string().regex(/^HX[0-9a-f]{32}$/, "a Twilio Content SID starts with HX").nullable().optional().or(z.literal("")),
  whatsappVariables: z.record(z.string(), z.string()).nullable().optional(),
  translations,
});

export const templateSchema = templateFields.extend({
  pushPriority: z.enum(["HIGH", "NORMAL"]).default("HIGH"),
  tags: z.array(z.string()).default([]),
});
