import type { OutboundEvent } from "./webhooks/events";

/**
 * Dispatch → Segment: an event webhook of kind SEGMENT sends message lifecycle
 * events to Segment's HTTP Tracking API as Segment-spec track calls
 * ("Push Notification Received", "Email Opened", …).
 */
const PUSH = new Set(["FCM", "APNS", "WEB_PUSH"]);

function segmentEventName(e: OutboundEvent): string {
  const channel = String(e.data.channel ?? "");
  const push = PUSH.has(channel);
  const email = channel === "EMAIL";
  switch (e.type) {
    case "message.sent": return push ? "Push Notification Sent" : email ? "Email Sent" : "Message Sent";
    case "message.delivered": return push ? "Push Notification Received" : email ? "Email Delivered" : "Message Delivered";
    case "message.opened": return push ? "Push Notification Tapped" : email ? "Email Opened" : "Message Opened";
    case "message.clicked": return email ? "Email Link Clicked" : "Message Clicked";
    case "message.bounced": return push ? "Push Notification Bounced" : "Email Bounced";
    case "message.failed": return push ? "Push Notification Bounced" : "Message Failed";
    case "message.converted": return "Campaign Converted";
    case "contact.unsubscribed": return "Unsubscribed";
  }
}

/** Dispatch events → Segment HTTP Tracking API batch (messageId = event id, so Segment dedupes retries). */
export function toSegmentBatch(events: OutboundEvent[]): { batch: Record<string, unknown>[] } {
  return {
    batch: events.map((e) => {
      const { externalId, contactId, ...props } = e.data as Record<string, unknown>;
      return {
        type: "track",
        event: segmentEventName(e),
        messageId: e.id,
        timestamp: e.timestamp,
        ...(externalId ? { userId: externalId } : { anonymousId: `dispatch:${contactId}` }),
        properties: { ...props, dispatchContactId: contactId, dispatchEventType: e.type },
        context: { library: { name: "dispatch", version: "1.0" } },
      };
    }),
  };
}

export const SEGMENT_ENDPOINTS = {
  us: "https://api.segment.io/v1/batch",
  eu: "https://events.eu1.segmentapis.com/v1/batch",
};
