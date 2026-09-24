import type { DispatchLiveUpdate, DispatchPush } from "./types.js";

type AnyRecord = Record<string, unknown>;
const isObj = (v: unknown): v is AnyRecord => !!v && typeof v === "object";

/**
 * Pull the Dispatch fields out of whatever your push library hands you:
 *  - @react-native-firebase/messaging RemoteMessage ({ data, notification })
 *  - Notifee events ({ notification: { data } }) / ({ detail: { notification } })
 *  - raw APNs userInfo ({ aps, url, messageId })
 *  - expo-notifications Notification / request ({ request: { trigger: { payload } } } —
 *    for direct APNs pushes Expo leaves content.data empty and keeps the payload on the trigger)
 *  - a web push payload / Notification.data
 * Returns null when the payload is not from Dispatch.
 */
export function extractPush(payload: unknown): DispatchPush | null {
  if (!isObj(payload)) return null;
  // Breadth-first over the usual wrapper keys, a few levels deep
  const candidates: AnyRecord[] = [payload];
  for (let i = 0; i < candidates.length && candidates.length < 32; i++) {
    for (const key of ["data", "notification", "detail", "userInfo", "payload", "request", "trigger", "content", "remoteMessage"]) {
      const v = candidates[i][key];
      if (isObj(v)) candidates.push(v);
    }
  }

  // Prefer a nested payload: an RN Firebase RemoteMessage has its *own*
  // top-level messageId (FCM's id); ours is in remoteMessage.data.messageId.
  const hasId = (c: AnyRecord) => typeof c.messageId === "string";
  const data = candidates.slice(1).find(hasId) ?? (hasId(payload) ? payload : undefined);
  if (!data) return null;

  const strings: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") strings[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") strings[k] = String(v);
  }

  const alert = findAlert(candidates);
  return {
    messageId: strings.messageId,
    url: strings.url && strings.url !== "/" ? strings.url : null,
    imageUrl: strings.imageUrl ?? strings.image ?? null,
    title: alert.title,
    body: alert.body,
    data: strings,
  };
}

function findAlert(candidates: AnyRecord[]): { title: string | null; body: string | null } {
  for (const c of candidates) {
    const aps = isObj(c.aps) ? c.aps : null;
    const alert = aps && isObj(aps.alert) ? aps.alert : null;
    if (alert) return { title: str(alert.title), body: str(alert.body) };
    if (typeof c.title === "string" || typeof c.body === "string") return { title: str(c.title), body: str(c.body) };
  }
  return { title: null, body: null };
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Android: parse a Live Update data message (null if the message isn't one). */
export function extractLiveUpdate(payload: unknown): DispatchLiveUpdate | null {
  if (!isObj(payload)) return null;
  const data = (isObj(payload.data) ? payload.data : payload) as AnyRecord;
  if (data.dispatchType !== "live_update" || typeof data.activityKey !== "string") return null;
  const json = (v: unknown) => {
    if (typeof v !== "string") return isObj(v) ? v : null;
    try {
      return JSON.parse(v) as AnyRecord;
    } catch {
      return null;
    }
  };
  const event = data.event === "start" || data.event === "end" ? data.event : "update";
  return {
    activityKey: data.activityKey,
    activityType: str(data.activityType) ?? "",
    event,
    contentState: json(data.contentState) ?? {},
    attributes: json(data.attributes),
    alert: typeof data.alertTitle === "string" ? { title: data.alertTitle, body: str(data.alertBody) ?? "" } : null,
    staleDate: str(data.staleDate),
  };
}
