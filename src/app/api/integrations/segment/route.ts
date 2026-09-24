import { NextRequest, NextResponse } from "next/server";
import { authenticateApi } from "@/lib/apiAuth";
import { handleSegmentCall, type SegmentPayload } from "@/lib/segment";

/**
 * Segment destination endpoint. Configure Segment's Webhooks destination with
 * this URL and header `Authorization: Bearer <server key>` (or Basic auth with
 * the key as username). Accepts single calls or { batch: [...] }.
 */
export async function POST(req: NextRequest) {
  // Segment's webhook destination can send the key as Basic auth username
  const basic = req.headers.get("authorization")?.match(/^Basic (.+)$/i);
  if (basic) {
    const user = Buffer.from(basic[1], "base64").toString("utf8").split(":")[0];
    req.headers.set("authorization", `Bearer ${user}`);
  }
  const auth = await authenticateApi(req, "/api/integrations/segment", { scopes: ["SERVER"], openWhenNoKeys: false });
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as (SegmentPayload & { batch?: SegmentPayload[] }) | null;
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const calls = Array.isArray(body.batch) ? body.batch : [body];
  if (calls.length > 500) return NextResponse.json({ error: "max 500 calls per request" }, { status: 413 });

  const results = [];
  for (const call of calls) {
    try {
      results.push(await handleSegmentCall(call));
    } catch (err) {
      console.error("[segment] call failed:", err);
      results.push({ ok: false, skipped: "error" });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  // 2xx even with skips: Segment retries non-2xx, and skipped calls would never succeed
  return NextResponse.json({ ok: failed === 0, processed: results.length - failed, skipped: failed, results }, { headers: auth.headers });
}
