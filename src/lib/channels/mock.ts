import type { ChannelAdapter, RenderedMessage, SendResult } from "./types";
import { demoRelayEnabled, relayToDemoDevices } from "./push/demoRelay";

/**
 * Load-test provider: accepts every message after a simulated provider
 * round-trip, so a load test measures Dispatch's own pipeline (fan-out,
 * queue, render, bulk status writes) up to the hand-off to FCM/APNs.
 *
 * Enabled with PUSH_PROVIDER_MODE=mock. Refused in production unless
 * LOADTEST_ALLOW_MOCK=true — it would silently drop real notifications.
 *
 *   MOCK_PUSH_BATCH_LATENCY_MS  per provider call (FCM sendEach of ≤500). Default 400.
 *   MOCK_PUSH_FAILURE_RATE      fraction answered as a dead token. Default 0.
 *   DEMO_DEVICE_RELAY=true      also hand pushes for the example apps to the local
 *                               iOS simulator / Android emulator (push/demoRelay.ts)
 */
export function mockEnabled(): boolean {
  if (process.env.PUSH_PROVIDER_MODE !== "mock") return false;
  if (process.env.NODE_ENV === "production" && process.env.LOADTEST_ALLOW_MOCK !== "true") {
    throw new Error("PUSH_PROVIDER_MODE=mock is refused in production (set LOADTEST_ALLOW_MOCK=true for a load-test stack)");
  }
  return true;
}

export function mockAdapter(real: ChannelAdapter): ChannelAdapter {
  const latency = Number(process.env.MOCK_PUSH_BATCH_LATENCY_MS ?? 400);
  const failRate = Number(process.env.MOCK_PUSH_FAILURE_RATE ?? 0);
  const sendBatch = async (msgs: RenderedMessage[]): Promise<SendResult[]> => {
    const out: SendResult[] = [];
    for (let i = 0; i < msgs.length; i += 500) {
      await new Promise((r) => setTimeout(r, latency));
      for (const m of msgs.slice(i, i + 500)) {
        out.push(
          Math.random() < failRate
            ? { ok: false, error: "mock: unregistered token", permanent: true, deactivateSubscription: true }
            : { ok: true, providerMessageId: `mock-${m.messageId}` }
        );
      }
    }
    if (demoRelayEnabled()) {
      const accepted = msgs.filter((_, i) => out[i].ok);
      // Off the send path: a slow simulator must not hold the batch
      void relayToDemoDevices(accepted).catch((e) => console.warn("[demo-relay]", e));
    }
    return out;
  };
  return {
    channel: real.channel,
    configHint: "mock provider (load test)",
    isConfigured: async () => true,
    send: async (m) => (await sendBatch([m]))[0],
    sendBatch,
  };
}
