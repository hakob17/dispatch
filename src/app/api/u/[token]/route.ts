import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseUnsubToken } from "@/lib/tracking/sign";
import { suppress, unsuppress, isSuppressed } from "@/lib/suppression";

type Params = { params: Promise<{ token: string }> };

/** Preference-center data: subscription groups + current states (public, token-authenticated). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const parsed = parseUnsubToken(token);
  if (!parsed) return NextResponse.json({ error: "invalid token" }, { status: 400 });

  const contact = await db.contact.findUnique({
    where: { id: parsed.contactId },
    select: { id: true, email: true, subscriptionStates: true },
  });
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });

  const groups = await db.subscriptionGroup.findMany({ orderBy: { createdAt: "asc" } });
  const stateMap = new Map(contact.subscriptionStates.map((s) => [s.groupId, s.subscribed]));

  return NextResponse.json({
    email: contact.email,
    globallyUnsubscribed: contact.email ? await isSuppressed("EMAIL", contact.email) : false,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      subscribed: stateMap.get(g.id) ?? true, // default opt-in
    })),
  });
}

/**
 * One-click unsubscribe (RFC 8058 — mail clients POST a form body here) AND
 * the preference-center save button.
 * - No JSON body (or {}): global unsubscribe (RFC 8058 behaviour).
 * - JSON { groups: {id: bool}, globallyUnsubscribed?: bool }: granular update.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const parsed = parseUnsubToken(token);
  if (!parsed) return NextResponse.json({ error: "invalid token" }, { status: 400 });

  const contact = await db.contact.findUnique({ where: { id: parsed.contactId } });
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { groups?: Record<string, boolean>; globallyUnsubscribed?: boolean } | null = null;
  try {
    const text = await req.text();
    if (text && text.trim().startsWith("{")) body = JSON.parse(text);
  } catch {}

  if (!body) {
    // RFC 8058 one-click / bare confirm → global unsubscribe
    if (contact.email) {
      await suppress("EMAIL", contact.email, "UNSUBSCRIBE");
      if (parsed.messageId) {
        try {
          await db.messageEvent.create({ data: { messageId: parsed.messageId, type: "UNSUBSCRIBE" } });
        } catch {}
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (body.groups) {
    for (const [groupId, subscribed] of Object.entries(body.groups)) {
      await db.subscriptionState.upsert({
        where: { groupId_contactId: { groupId, contactId: contact.id } },
        create: { groupId, contactId: contact.id, subscribed },
        update: { subscribed },
      });
    }
  }
  if (typeof body.globallyUnsubscribed === "boolean" && contact.email) {
    if (body.globallyUnsubscribed) await suppress("EMAIL", contact.email, "UNSUBSCRIBE");
    else await unsuppress("EMAIL", contact.email);
  }
  return NextResponse.json({ ok: true });
}
