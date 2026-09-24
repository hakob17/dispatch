import type { Contact } from "@prisma/client";

export type TemplateVars = Record<string, string>;

/** Flatten a contact into {{var}} substitution values. attributes.x is addressable as both `x` and `attributes.x`. */
export function contactVars(contact: Pick<Contact, "email" | "firstName" | "lastName" | "attributes"> & Partial<Pick<Contact, "externalId" | "language">>): TemplateVars {
  const vars: TemplateVars = {
    email: contact.email ?? "",
    externalId: contact.externalId ?? "",
    language: contact.language ?? "",
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
  };
  const attrs = (contact.attributes ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    vars[k] = vars[k] ?? s;
    vars[`attributes.${k}`] = s;
  }
  return vars;
}

/** Interpolate {{ var }} placeholders. Unknown vars render as empty string. */
export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "");
}
