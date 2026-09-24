import { Prisma } from "@prisma/client";
import { db } from "../db";

export type FilterOp = "eq" | "neq" | "contains" | "exists" | "gt" | "lt";

export interface SegmentFilter {
  /** "email" | "firstName" | "lastName" | "phone" | "language" | "externalId" | "attributes.<key>" | "event.<name>" (event count > 0) */
  field: string;
  op: FilterOp;
  value?: string | number | boolean;
}

const STANDARD_FIELDS = new Set(["email", "firstName", "lastName", "phone", "language", "externalId"]);

/**
 * Convert filter rows (AND-combined) to a Prisma where clause.
 * This is the only module that knows Postgres-specific JSON path syntax.
 */
export function filtersToWhere(filters: SegmentFilter[]): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];

  for (const f of filters) {
    if (STANDARD_FIELDS.has(f.field)) {
      const field = f.field as "email" | "firstName" | "lastName" | "phone" | "language" | "externalId";
      switch (f.op) {
        case "eq": and.push({ [field]: { equals: String(f.value ?? ""), mode: "insensitive" } }); break;
        case "neq": and.push({ NOT: { [field]: { equals: String(f.value ?? ""), mode: "insensitive" } } }); break;
        case "contains": and.push({ [field]: { contains: String(f.value ?? ""), mode: "insensitive" } }); break;
        case "exists": and.push({ [field]: { not: null } }); break;
        case "gt": and.push({ [field]: { gt: String(f.value ?? "") } }); break;
        case "lt": and.push({ [field]: { lt: String(f.value ?? "") } }); break;
      }
    } else if (f.field.startsWith("attributes.")) {
      const path = f.field.slice("attributes.".length).split(".");
      const numeric = typeof f.value === "number" || (!isNaN(Number(f.value)) && f.value !== "" && f.value !== undefined);
      const val = numeric ? Number(f.value) : f.value;
      switch (f.op) {
        case "eq": and.push({ attributes: { path, equals: val as never } }); break;
        case "neq": and.push({ NOT: { attributes: { path, equals: val as never } } }); break;
        case "contains": and.push({ attributes: { path, string_contains: String(f.value ?? "") } }); break;
        case "exists": and.push({ NOT: { attributes: { path, equals: Prisma.DbNull } } }); break;
        case "gt": and.push({ attributes: { path, gt: val as never } }); break;
        case "lt": and.push({ attributes: { path, lt: val as never } }); break;
      }
    } else if (f.field.startsWith("event.")) {
      const name = f.field.slice("event.".length);
      // "did perform event" / "did not perform event"
      if (f.op === "neq") and.push({ events: { none: { name } } });
      else and.push({ events: { some: { name } } });
    }
  }

  return and.length ? { AND: and } : {};
}

export async function countSegment(filters: SegmentFilter[]): Promise<number> {
  return db.contact.count({ where: filtersToWhere(filters) });
}

/** Stream contact ids in pages of `pageSize` (cursor on id, stable order). */
export async function* iterateSegmentContactIds(
  filters: SegmentFilter[],
  pageSize = 1000
): AsyncGenerator<string[]> {
  const where = filtersToWhere(filters);
  let cursor: string | undefined;
  for (;;) {
    const page = await db.contact.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (!page.length) return;
    yield page.map((c) => c.id);
    if (page.length < pageSize) return;
    cursor = page[page.length - 1].id;
  }
}
