// The Dispatch React SDK is linked from packages/react-sdk (file: dependency).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, "../../packages/react-sdk");
config.watchFolders = [sdk];

// The SDK lives outside this app, so a plain lookup from its files would find the
// repo root's React (the web console's copy) — two Reacts break hooks. Pin them here.
const pinned = new Set(["react", "react/jsx-runtime", "react-native"]);
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const ctx = pinned.has(moduleName) && context.originModulePath.startsWith(sdk)
    ? { ...context, originModulePath: path.join(__dirname, "index.ts") }
    : context;
  return (defaultResolve ?? context.resolveRequest)(ctx, moduleName, platform);
};
module.exports = config;
