import type { MessageTemplate } from "@prisma/client";

/**
 * Per-language template content. `MessageTemplate.translations` holds
 * overrides keyed by BCP-47 tag:
 *
 *   { "de": { "pushTitle": "Eilmeldung", "pushBody": "…" },
 *     "pt-BR": { "subject": "…", "htmlBody": "…" } }
 *
 * The contact's `language` picks the most specific match ("pt-BR" → "pt-BR",
 * then "pt"); anything not translated falls back to the template's default
 * content, field by field.
 */
export const TRANSLATABLE_FIELDS = ["subject", "htmlBody", "textBody", "pushTitle", "pushBody", "pushUrl", "pushImageUrl"] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];
export type Translations = Record<string, Partial<Record<TranslatableField, string>>>;

/** "pt_br" / "PT-br" → "pt-BR"; invalid → null. */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const parts = tag.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (!parts.length || !/^[a-zA-Z]{2,3}$/.test(parts[0])) return null;
  return [parts[0].toLowerCase(), ...parts.slice(1).map((p) => (p.length === 2 ? p.toUpperCase() : p))].join("-");
}

export function pickTranslation(translations: Translations | null | undefined, language: string | null | undefined): string | null {
  if (!translations || !language) return null;
  const lang = normalizeLanguage(language);
  if (!lang) return null;
  const keys = Object.keys(translations);
  const exact = keys.find((k) => normalizeLanguage(k) === lang);
  if (exact) return exact;
  const primary = lang.split("-")[0];
  return keys.find((k) => normalizeLanguage(k) === primary) ?? keys.find((k) => normalizeLanguage(k)?.split("-")[0] === primary) ?? null;
}

/** The template with the contact's language applied (unchanged when there's no match). */
export function localize<T extends Pick<MessageTemplate, TranslatableField | "translations">>(template: T, language: string | null | undefined): T {
  const key = pickTranslation(template.translations as Translations | null, language);
  if (!key) return template;
  const tr = (template.translations as Translations)[key];
  const out = { ...template };
  for (const f of TRANSLATABLE_FIELDS) {
    const v = tr[f];
    if (typeof v === "string" && v.trim() !== "") (out as Record<string, unknown>)[f] = v;
  }
  return out;
}
