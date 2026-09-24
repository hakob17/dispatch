import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/channels";
import { renderMessage } from "@/lib/channels/render";

/**
 * Send a single test message inline (bypasses the queue).
 * POST { templateId, contactId? , toEmail? }
 * - EMAIL: sends to toEmail (or the contact's email)
 * - push channels: sends to all active subscriptions of the contact
 */
export async function POST(req: NextRequest) {
  const { templateId, contactId, toEmail } = await req.json();
  const template = await db.messageTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const adapter = getAdapter(template.channel);
  if (!(await adapter.isConfigured())) {
    return NextResponse.json({ error: `${template.channel} not configured: ${adapter.configHint}` }, { status: 400 });
  }

  let contact = contactId
    ? await db.contact.findUnique({ where: { id: contactId }, include: { subscriptions: true } })
    : null;
  if (!contact && toEmail) {
    contact = await db.contact.findUnique({ where: { email: toEmail.toLowerCase() }, include: { subscriptions: true } });
  }

  // Synthetic contact for email tests to arbitrary addresses
  const testContact = contact ?? {
    id: "test",
    email: toEmail ?? null,
    phone: null,
    firstName: "Test",
    lastName: "Recipient",
    attributes: {} as object,
    createdAt: new Date(),
    updatedAt: new Date(),
    subscriptions: [],
  };

  const results: unknown[] = [];

  if (template.channel === "EMAIL") {
    const to = toEmail ?? testContact.email;
    if (!to) return NextResponse.json({ error: "no recipient email" }, { status: 400 });
    // Create a real Message row (campaignId null = test) so tracking works end-to-end
    const msg = contact
      ? await db.message.create({ data: { contactId: contact.id, channel: "EMAIL", status: "SENDING" } })
      : null;
    const rendered = await renderMessage({
      template,
      contact: { ...testContact, email: to } as never,
      messageId: msg?.id ?? "test",
      track: !!msg,
    });
    const result = await adapter.send(rendered);
    if (msg) {
      await db.message.update({
        where: { id: msg.id },
        data: result.ok
          ? { status: "SENT", providerMessageId: result.providerMessageId, sentAt: new Date() }
          : { status: "FAILED", error: result.error },
      });
    }
    results.push(result);
  } else {
    if (!contact) return NextResponse.json({ error: "contact required for push/webhook test" }, { status: 400 });
    const subs =
      template.channel === "WEBHOOK" || template.channel === "IN_APP" || template.channel === "CONTENT_CARD"
        ? [null]
        : contact.subscriptions.filter((s) => s.channel === template.channel && s.isActive);
    if (template.channel !== "WEBHOOK" && template.channel !== "IN_APP" && template.channel !== "CONTENT_CARD" && !subs.length) {
      return NextResponse.json({ error: "contact has no active subscription on this channel" }, { status: 400 });
    }
    for (const sub of subs) {
      const msg = await db.message.create({
        data: {
          contactId: contact.id,
          pushSubscriptionId: sub?.id,
          channel: template.channel,
          status: "SENDING",
        },
      });
      const rendered = await renderMessage({ template, contact, messageId: msg.id, subscription: sub });
      const result = await adapter.send(rendered);
      await db.message.update({
        where: { id: msg.id },
        data: result.ok
          ? {
              status: result.delivered ? "DELIVERED" : "SENT",
              providerMessageId: result.providerMessageId,
              sentAt: new Date(),
              ...(result.delivered ? { deliveredAt: new Date() } : {}),
              // in-app: lands in the contact's message centre like a real send
              ...(result.content
                ? { content: result.content as object, expiresAt: new Date(Date.now() + (template.inAppExpiresHours ?? 720) * 3600_000) }
                : {}),
            }
          : { status: "FAILED", error: result.error },
      });
      if (!result.ok && result.deactivateSubscription && sub) {
        await db.pushSubscription.update({ where: { id: sub.id }, data: { isActive: false } });
      }
      results.push(result);
    }
  }

  const allOk = results.every((r) => (r as { ok: boolean }).ok);
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 502 });
}
