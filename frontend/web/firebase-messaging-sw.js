// Firebase Messaging Service Worker
// This file MUST be in the public/web root for FCM to work
/* eslint-disable no-undef */
/* global importScripts, firebase, clients */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD9wqO2-JN6eBapFy4vHf_VgJujEdFjlA8",
  authDomain: "ahgaff-attendance.firebaseapp.com",
  projectId: "ahgaff-attendance",
  storageBucket: "ahgaff-attendance.firebasestorage.app",
  messagingSenderId: "211335153410",
  appId: "1:211335153410:web:6788154ede0f4b04f5e41b"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'جامعة الأحقاف';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    dir: 'rtl',
    lang: 'ar',
    data: payload.data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
