const DB_NAME = "padma-brief";
const STORE = "kv";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "padma-morning") event.waitUntil(pullDesk());
});

self.addEventListener("message", (event) => {
  if (event.data === "padma-refresh") event.waitUntil(pullDesk());
});

async function pullDesk() {
  const res = await fetch("/api/desk", { headers: { Accept: "application/json" } });
  if (!res.ok) return;
  const desk = await res.json();
  await putDesk(desk);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "padma-desk", desk });
}

function putDesk(desk) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(desk, "desk");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
