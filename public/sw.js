/**
 * Push service worker.
 *
 * Deliberately tiny. A service worker persists across deploys and updates on
 * its own schedule, so anything clever in here is code that can outlive the app
 * that shipped it and is very hard to debug from the outside. It does exactly
 * two things: show what the server sent, and focus the app when tapped.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Never show a raw blob to a person. A malformed push is a bug on our side.
    return;
  }

  const title = typeof payload.title === "string" ? payload.title : "Trador";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/home";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {url},
      // Collapses repeats of the same subject on the lock screen rather than
      // stacking them, which matters most for the case we try hardest to avoid.
      tag: url,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/home";

  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clients) => {
      // Reuse an open tab rather than piling up new ones.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
