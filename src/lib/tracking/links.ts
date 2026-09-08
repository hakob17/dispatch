import { sign } from "./sign";

const base = () => process.env.APP_BASE_URL || "http://localhost:3000";

export function openPixelUrl(messageId: string): string {
  return `${base()}/api/t/o?m=${encodeURIComponent(messageId)}&s=${sign(messageId)}`;
}

export function clickUrl(messageId: string, targetUrl: string): string {
  const u = encodeURIComponent(targetUrl);
  return `${base()}/api/t/c?m=${encodeURIComponent(messageId)}&u=${u}&s=${sign(messageId + "|" + targetUrl)}`;
}

/** Rewrite every http(s) href in the HTML through the click-tracking redirect. skipUrls stay direct (e.g. unsubscribe — RFC 8058 requires an unwrapped URL). */
export function wrapLinks(html: string, messageId: string, skipUrls: string[] = []): string {
  const skip = new Set(skipUrls);
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (full, url: string) =>
    skip.has(url) ? full : `href="${clickUrl(messageId, url)}"`
  );
}

/** Append the 1x1 open-tracking pixel before </body> (or at the end). */
export function injectPixel(html: string, messageId: string): string {
  const img = `<img src="${openPixelUrl(messageId)}" width="1" height="1" alt="" style="display:none" />`;
  if (html.includes("</body>")) return html.replace("</body>", `${img}</body>`);
  return html + img;
}
