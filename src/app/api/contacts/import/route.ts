import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";

/**
 * CSV import. Body: { csv: string, mapping: { [csvColumn]: "email"|"firstName"|"lastName"|"phone"|"attributes.<key>"|"skip" } }
 * Upserts by email.
 */
export async function POST(req: NextRequest) {
  const { csv, mapping } = (await req.json()) as {
    csv: string;
    mapping: Record<string, string>;
  };
  if (!csv || !mapping) return NextResponse.json({ error: "csv and mapping required" }, { status: 400 });

  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];

  for (const row of parsed.data) {
    const data: { email?: string; firstName?: string; lastName?: string; phone?: string } = {};
    const attributes: Record<string, string> = {};
    for (const [col, target] of Object.entries(mapping)) {
      const val = row[col]?.trim();
      if (!val || target === "skip") continue;
      if (target === "email") data.email = val.toLowerCase();
      else if (target === "firstName" || target === "lastName" || target === "phone") data[target] = val;
      else if (target.startsWith("attributes.")) attributes[target.slice("attributes.".length)] = val;
    }
    if (!data.email) { skipped++; continue; }
    try {
      const existing = await db.contact.findUnique({ where: { email: data.email } });
      if (existing) {
        await db.contact.update({
          where: { email: data.email },
          data: { ...data, attributes: { ...(existing.attributes as object), ...attributes } },
        });
        updated++;
      } else {
        await db.contact.create({ data: { ...data, attributes } });
        created++;
      }
    } catch (e) {
      errors.push(`${data.email}: ${String(e).slice(0, 100)}`);
    }
  }

  return NextResponse.json({ created, updated, skipped, errors: errors.slice(0, 20) });
}
