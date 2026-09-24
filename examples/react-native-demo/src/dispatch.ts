import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { DispatchClient } from "@dispatch/react-sdk";

const extra = (Constants.expoConfig?.extra ?? {}) as { dispatchBaseUrl?: string; dispatchSdkKey?: string };

export const baseUrl = extra.dispatchBaseUrl ?? "http://localhost:3000";
export const sdkKey = extra.dispatchSdkKey ?? "";

/** Demo devices are recognised by a "demo-" device id; "demo-rn-" routes simulator pushes to this app. */
async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem("demo.deviceId");
  if (existing) return existing;
  const id = `demo-rn-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem("demo.deviceId", id);
  return id;
}

let client: DispatchClient | null = null;

/** One client for the app (and for notification listeners outside React). */
export async function getDispatch(): Promise<DispatchClient> {
  if (client) return client;
  client = new DispatchClient({
    apiKey: sdkKey || "dk_pub_missing",
    baseUrl,
    storage: AsyncStorage,
    platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android",
    appVersion: "demo-rn-1.0",
    deviceId: await deviceId(),
    flushIntervalMs: 5_000,
  });
  return client;
}
