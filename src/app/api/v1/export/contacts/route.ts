import { NextRequest, NextResponse } from "next/server";
import { authenticateApi } from "@/lib/apiAuth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Streaming NDJSON export of every contact with their device tokens,
 * subscription-group states and attributes — for migration or exit.
 * Raw FCM/APNs tokens are included so another provider using the same
 * Firebase project / APNs key can keep messaging users without a new
 * permission prompt.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, "/api/v1/export/contacts", { scopes: ["SERVER"], openWhenNoKeys: false });
  if (!auth.ok) return auth.response;
  await audit({ userEmail: auth.key ? `api-key:${auth.key.prefix}` : null, action: "api.export.contacts" });

  const encoder = new TextEncoder();
  let cursor: string | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const rows = await db.contact.findMany({
        take: 1000,
        ...(cursor ? { where: { id: { gt: cursor } } } : {}),
        orderBy: { id: "asc" },
        include: {
          subscriptions: { select: { channel: true, endpoint: true, keys: true, platform: true, deviceId: true, isActive: true, createdAt: true, lastUsedAt: true } },
          subscriptionStates: { select: { groupId: true, subscribed: true } },
        },
      });
      if (!rows.length) return controller.close();
      cursor = rows[rows.length - 1].id;
      controller.enqueue(encoder.encode(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"));
      if (rows.length < 1000) controller.close();
    },
  });
  return new NextResponse(stream, {
    headers: {
      ...auth.headers,
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.ndjson"`,
    },
  });
}
