/// <reference types="node" />
import type { ExpoConfig } from "expo/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Written by `npm run demo -- setup` at the repo root (server URL + SDK key)
const file = join(__dirname, "..", "demo-config.json");
const demo = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

const config: ExpoConfig = {
  name: "Dispatch RN",
  slug: "dispatch-react-native-demo",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "dispatchdemorn",
  ios: {
    bundleIdentifier: "com.dispatch.demo.rn",
    supportsTablet: false,
    entitlements: { "aps-environment": "development" },
  },
  android: { package: "com.dispatch.demo.rn" },
  web: { favicon: "./assets/favicon.png" },
  plugins: ["expo-notifications"],
  extra: { dispatchBaseUrl: demo.baseUrl ?? "http://localhost:3000", dispatchSdkKey: demo.sdkKey ?? "" },
};
export default config;
