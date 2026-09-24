import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import WebReader from "./WebReader";

/**
 * Web demo reader (the browser counterpart of the example apps): React SDK in a web page —
 * web push, content cards, in-app messages and newsletters. Uses the SDK key written by
 * `npm run demo -- setup`.
 */
export default function DemoReaderPage() {
  const file = join(process.cwd(), "examples", "demo-config.json");
  const cfg = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { sdkKey?: string; baseUrl?: string }) : {};
  if (!cfg.sdkKey) return <p style={{ padding: 32 }}>Run <code>npm run demo -- setup</code> first.</p>;
  return <WebReader sdkKey={cfg.sdkKey} baseUrl={cfg.baseUrl ?? "http://localhost:3000"} />;
}
