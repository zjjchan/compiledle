self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  storageBucket: params.get('storageBucket') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

if (
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
) {
  importScripts('https://www.gstatic.com/firebasejs/11.4.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/11.4.0/firebase-messaging-compat.js');

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    // Skip manual notification if browser already rendered the webpush.notification block
    if (payload?.notification) {
      return;
    }
    const title = payload?.data?.title || 'Compiledle';
    const body = payload?.data?.body || 'Your daily games are ready to play!';
    const url = payload?.data?.url || '/';
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url },
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath =
    event.notification?.data?.url ||
    event.notification?.data?.FCM_MSG?.data?.url ||
    '/';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'NAVIGATE_DAILY', url: targetPath });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
