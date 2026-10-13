"use strict";

const CACHE_NAME = "zeitwerk-shell-apple-experiment-3";
const SHELL_FILES = ["./", "styles.css?v=apple-experiment-3", "ios-next.css?v=apple-experiment-3", "app.js?v=apple-experiment-3", "app-icon.svg", "favicon.svg?v=4.4.0", "icon-180.png?v=4.4.0", "icon-192.png", "icon-512.png", "manifest.webmanifest?v=4.4.0"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const isDataRequest = /\/api\/(?:state|timer|entries|settings|import|export\.csv|backup\.json)(?:\/|$)/.test(url.pathname);
  if (request.method !== "GET" || url.origin !== self.location.origin || isDataRequest) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match("./"))));
});
