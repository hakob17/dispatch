import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** ⌘K global search across contacts, campaigns, segments, templates, journeys. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const contains = { contains: q, mode: "insensitive" as const };

  const [contacts, campaigns, segments, templates, journeys] = await Promise.all([
    db.contact.findMany({
      where: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] },
      take: 5,
      select: { id: true, email: true, firstName: true, lastName: true },
    }),
    db.campaign.findMany({ where: { name: contains }, take: 5, select: { id: true, name: true, status: true, channel: true } }),
    db.segment.findMany({ where: { name: contains }, take: 5, select: { id: true, name: true } }),
    db.messageTemplate.findMany({ where: { name: contains }, take: 5, select: { id: true, name: true, channel: true } }),
    db.journey.findMany({ where: { name: contains }, take: 5, select: { id: true, name: true, status: true } }),
  ]);

  const results = [
    ...contacts.map((c) => ({
      type: "contact",
      id: c.id,
      title: c.email ?? [c.firstName, c.lastName].filter(Boolean).join(" ") ?? c.id,
      sub: [c.firstName, c.lastName].filter(Boolean).join(" "),
      href: `/contacts/${c.id}`,
    })),
    ...campaigns.map((c) => ({ type: "campaign", id: c.id, title: c.name, sub: `${c.channel} · ${c.status}`, href: `/campaigns/${c.id}` })),
    ...segments.map((s) => ({ type: "segment", id: s.id, title: s.name, sub: "", href: `/segments/${s.id}` })),
    ...templates.map((t) => ({ type: "template", id: t.id, title: t.name, sub: t.channel, href: `/templates/${t.id}` })),
    ...journeys.map((j) => ({ type: "journey", id: j.id, title: j.name, sub: j.status, href: `/journeys/${j.id}` })),
  ];
  return NextResponse.json({ results });
}
