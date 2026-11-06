/**
 * FCM service worker — real device notifications for the web app (banners,
 * lock screen) once a user enables them. Config arrives via query params at
 * registration time since public/ files don't see Vite env vars.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URL(self.location).searchParams;
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('senderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(({ notification, data }) => {
  self.registration.showNotification(notification?.title ?? 'The Draw', {
    body: notification?.body ?? '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: data ?? {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link;
  event.waitUntil(clients.openWindow(link ? self.location.origin + link : self.location.origin));
});
