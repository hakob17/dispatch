/* Web Push service worker — must live at the site root for full scope. */

self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/", messageId: null };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url, messageId: data.messageId },
      image: data.image || undefined,
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: "/icon.png",
      badge: "/icon.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (win.url === url && "focus" in win) return win.focus();
      }
      return clients.openWindow(url);
    })
  );
});
