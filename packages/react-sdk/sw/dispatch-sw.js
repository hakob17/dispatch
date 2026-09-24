/* Dispatch web push service worker.
 * Register via registerWebPush() from "@dispatch/react-sdk/web", which passes
 * ?apiKey=…&baseUrl=… so this worker can report deliveries and opens. */
const params = new URLSearchParams(self.location.search);
const API_KEY = params.get("apiKey");
const BASE_URL = (params.get("baseUrl") || "").replace(/\/+$/, "");

function report(kind, messageId) {
  if (!API_KEY || !BASE_URL || !messageId) return Promise.resolve();
  return fetch(`${BASE_URL}/api/sdk/v1/push/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ messageId }),
  }).catch(() => {});
}

self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/", messageId: null };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        image: data.image || undefined,
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: data.url, messageId: data.messageId },
      }),
      report("received", data.messageId),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, messageId } = event.notification.data || {};
  event.waitUntil(
    Promise.all([
      report("opened", messageId),
      url
        ? clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
            for (const win of wins) if (win.url === url && "focus" in win) return win.focus();
            return clients.openWindow(url);
          })
        : null,
    ])
  );
});
