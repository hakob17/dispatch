import { db } from "./db";
import { getSetting } from "./settings";

export interface DeliveryRules {
  maxPerDay: number | null; // max messages per contact per 24h
  maxPerWeek: number | null; // max messages per contact per 7d
  quietStart: string | null; // "22:00" — no sends from here…
  quietEnd: string | null; // "08:00" — …until here (server-local time)
}

export async function getDeliveryRules(): Promise<DeliveryRules> {
  const stored = await getSetting<Partial<DeliveryRules>>("deliveryRules");
  return {
    maxPerDay: stored?.maxPerDay ?? null,
    maxPerWeek: stored?.maxPerWeek ?? null,
    quietStart: stored?.quietStart || null,
    quietEnd: stored?.quietEnd || null,
  };
}

/** If we're inside the quiet window, return when it ends; otherwise null. */
export function quietHoursEndsAt(rules: DeliveryRules, now = new Date()): Date | null {
  if (!rules.quietStart || !rules.quietEnd) return null;
  const [sh, sm] = rules.quietStart.split(":").map(Number);
  const [eh, em] = rules.quietEnd.split(":").map(Number);
  if ([sh, sm, eh, em].some(isNaN)) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  const overnight = start > end; // e.g. 22:00 → 08:00
  const inQuiet = overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inQuiet) return null;

  const endDate = new Date(now);
  endDate.setHours(eh, em, 0, 0);
  if (endDate <= now) endDate.setDate(endDate.getDate() + 1);
  return endDate;
}

/** True when sending one more message to this contact would exceed the caps. */
export async function exceedsFrequencyCap(rules: DeliveryRules, contactId: string): Promise<boolean> {
  if (!rules.maxPerDay && !rules.maxPerWeek) return false;
  const now = Date.now();
  if (rules.maxPerDay) {
    const day = await db.message.count({
      where: { contactId, sentAt: { gte: new Date(now - 24 * 3600_000) } },
    });
    if (day >= rules.maxPerDay) return true;
  }
  if (rules.maxPerWeek) {
    const week = await db.message.count({
      where: { contactId, sentAt: { gte: new Date(now - 7 * 24 * 3600_000) } },
    });
    if (week >= rules.maxPerWeek) return true;
  }
  return false;
}

/** True when the contact opted out of the campaign's subscription group. */
export async function isUnsubscribedFromGroup(groupId: string | null | undefined, contactId: string): Promise<boolean> {
  if (!groupId) return false;
  const state = await db.subscriptionState.findUnique({
    where: { groupId_contactId: { groupId, contactId } },
  });
  return state ? !state.subscribed : false; // no state row = subscribed by default
}
