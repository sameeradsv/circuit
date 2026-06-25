self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      payload = { title: "Circuit reminder", body: event.data.text() };
    }
  }

  const title = payload.title || "Circuit reminder";
  const options = {
    body: payload.body || "A task is coming up.",
    tag: payload.tag || "circuit-reminder",
    renotify: true,
    requireInteraction: false,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    timestamp: payload.scheduledAt || Date.now(),
    data: {
      url: payload.url || "/",
      taskId: payload.taskId,
      scheduledAt: payload.scheduledAt,
      reminderType: payload.reminderType,
    },
    actions: [
      { action: "open", title: "Open" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) {
          return client.navigate(targetUrl);
        }
        return;
      }
    }
    return clients.openWindow(targetUrl);
  })());
});
