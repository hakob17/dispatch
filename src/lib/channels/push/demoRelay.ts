import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import type { RenderedMessage } from "../types";
import { buildApnsPayload } from "./apns";
import { buildFcmMessage } from "./fcm";

/**
 * Local demo only: with PUSH_PROVIDER_MODE=mock and DEMO_DEVICE_RELAY=true the
 * mock provider also hands each push for a demo app (examples/*) to the
 * booted iOS simulator (`xcrun simctl push`) or the Android emulator (an adb
 * broadcast the demo app forwards to the SDK). This lets a campaign launched
 * in the console reach simulator phones without Firebase or an Apple push key.
 * Never active in production.
 */
const exec = promisify(execFile);
/** A wedged simulator/emulator must not stall the worker */
const run = (cmd: string, args: string[]) => exec(cmd, args, { timeout: 15_000 });
export const DEMO_BUNDLE_ID = process.env.DEMO_IOS_BUNDLE_ID || "com.dispatch.demo";
/** The React Native demo shares the simulator with the Swift one; its device ids start "demo-rn-". */
export const DEMO_RN_BUNDLE_ID = process.env.DEMO_RN_BUNDLE_ID || "com.dispatch.demo.rn";
export const DEMO_ANDROID_PACKAGE = process.env.DEMO_ANDROID_PACKAGE || "com.dispatch.demo";
export const DEMO_ANDROID_ACTION = "com.dispatch.demo.PUSH";

export function demoRelayEnabled(): boolean {
  return process.env.DEMO_DEVICE_RELAY === "true" && process.env.NODE_ENV !== "production";
}

/** Demo devices are the ones the example apps register (deviceId demo-… or appVersion demo…). */
export const demoDeviceWhere = { OR: [{ appVersion: { startsWith: "demo" } }, { deviceId: { startsWith: "demo-" } }] };

const shellQuote = (s: string) => (/^[\w./:@=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export async function pushToIosSimulator(payload: object, bundleId = DEMO_BUNDLE_ID, device = "booted"): Promise<void> {
  const file = join(tmpdir(), `dispatch-demo-${Date.now()}-${Math.random().toString(36).slice(2)}.apns`);
  await writeFile(file, JSON.stringify({ "Simulator Target Bundle": bundleId, ...payload }));
  try {
    await run("xcrun", ["simctl", "push", device, bundleId, file]);
  } finally {
    await unlink(file).catch(() => {});
  }
}

/** adb is often not on PATH: ADB_PATH, then the Android SDK locations. */
function adbPath(): string {
  const candidates = [
    process.env.ADB_PATH,
    ...[process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")]
      .filter(Boolean)
      .map((sdk) => join(sdk!, "platform-tools", "adb")),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? "adb";
}

/** `adb shell am broadcast` joins args into one shell line, so each value is quoted. */
export async function broadcastToAndroidEmulator(data: Record<string, string>): Promise<void> {
  const extras = Object.entries(data).flatMap(([k, v]) => ["--es", k, shellQuote(v)]);
  await run(adbPath(), ["shell", "am", "broadcast", "-a", DEMO_ANDROID_ACTION, "-p", DEMO_ANDROID_PACKAGE, ...extras]);
}

/** Relays the push messages addressed to demo devices; everything else is ignored. */
export async function relayToDemoDevices(msgs: RenderedMessage[]): Promise<void> {
  const push = msgs.filter((m) => (m.channel === "APNS" || m.channel === "FCM") && m.subscription?.endpoint);
  if (!push.length) return;
  const demo = await db.pushSubscription.findMany({
    where: { endpoint: { in: push.map((m) => m.subscription!.endpoint) }, isActive: true, ...demoDeviceWhere },
    select: { endpoint: true, deviceId: true },
  });
  const deviceOf = new Map(demo.map((d) => [d.endpoint, d.deviceId ?? ""]));
  for (const m of push) {
    const deviceId = deviceOf.get(m.subscription!.endpoint);
    if (deviceId === undefined) continue;
    try {
      if (m.channel === "APNS") {
        const bundleId = deviceId.startsWith("demo-rn-") ? DEMO_RN_BUNDLE_ID : DEMO_BUNDLE_ID;
        await pushToIosSimulator(buildApnsPayload(m), bundleId);
        console.log(`[demo-relay] iOS simulator (${bundleId}) ← "${m.pushTitle}" (${m.messageId})`);
      } else {
        const fcm = buildFcmMessage(m);
        await broadcastToAndroidEmulator({ ...fcm.data, title: m.pushTitle ?? "", body: m.pushBody ?? "" });
        console.log(`[demo-relay] Android emulator ← "${m.pushTitle}" (${m.messageId})`);
      }
    } catch (e) {
      console.warn(`[demo-relay] ${m.channel} device not reachable: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}
