import type { Brief, DeskPayload } from "@/lib/news/types";

const DB_NAME = "padma-brief";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed"));
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("read failed"));
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("write failed"));
  });
}

export async function loadDeskCache(): Promise<DeskPayload | null> {
  try {
    return await kvGet<DeskPayload>("desk");
  } catch (err) {
    console.error("[padma] cache read failed", err);
    return null;
  }
}

export async function saveDeskCache(payload: DeskPayload): Promise<void> {
  const counts = new Map<string, number>();
  const stories = payload.stories.filter((story) => {
    const key = story.categories[0] ?? "world";
    const n = counts.get(key) ?? 0;
    if (n >= 50) return false;
    counts.set(key, n + 1);
    return true;
  });
  try {
    await kvSet("desk", { ...payload, stories });
  } catch (err) {
    console.error("[padma] cache write failed", err);
  }
}

export async function loadBrief(id: string): Promise<Brief | null> {
  try {
    return await kvGet<Brief>(`brief:${id}`);
  } catch {
    return null;
  }
}

export async function saveBrief(id: string, brief: Brief): Promise<void> {
  try {
    await kvSet(`brief:${id}`, brief);
  } catch (err) {
    console.error("[padma] brief cache failed", err);
  }
}
