import { openDB, type IDBPDatabase } from "idb";
import type { HistoryRecord, GenerateResult } from "./types";

const DB_NAME = "image-gen-db";
const DB_VERSION = 3;
const HISTORY_STORE = "history";
const CACHE_STORE = "prompt_cache";
const IN_FLIGHT_STORE = "in_flight";

let dbInstance: IDBPDatabase | null = null;

export interface PromptCacheEntry {
  hash: string;
  results: GenerateResult[];
  createdAt: number;
  expiresAt: number;
}

export type InFlightStatus = "pending" | "polling" | "success" | "failed" | "cancelled" | "abandoned";

export interface InFlightEntry {
  id: string;
  promptHash: string;
  promptPreview: string;
  status: InFlightStatus;
  taskId?: string;
  startedAt: number;
  updatedAt: number;
}

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(HISTORY_STORE, {
          keyPath: "id",
          autoIncrement: false,
        });
        store.createIndex("createdAt", "createdAt");
      }
      if (oldVersion < 2) {
        db.createObjectStore(CACHE_STORE, { keyPath: "hash" });
      }
      if (oldVersion < 3) {
        const store = db.createObjectStore(IN_FLIGHT_STORE, { keyPath: "id" });
        store.createIndex("promptHash", "promptHash");
        store.createIndex("status", "status");
      }
    },
  });

  return dbInstance;
}

export async function addHistory(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  await db.put(HISTORY_STORE, record);
}

export async function getAllHistory(): Promise<HistoryRecord[]> {
  const db = await getDB();
  const records = await db.getAll(HISTORY_STORE);
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getHistory(id: string): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  return db.get(HISTORY_STORE, id);
}

export async function deleteHistory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(HISTORY_STORE, id);
}

export async function deleteAllHistory(): Promise<void> {
  const db = await getDB();
  await db.clear(HISTORY_STORE);
}

export async function deleteHistoryBatch(ids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(HISTORY_STORE, "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function updateHistory(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  await db.put(HISTORY_STORE, record);
}

export async function getPromptCache(hash: string): Promise<PromptCacheEntry | undefined> {
  const db = await getDB();
  const entry = await db.get(CACHE_STORE, hash);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    await db.delete(CACHE_STORE, hash);
    return undefined;
  }
  return entry;
}

export async function setPromptCache(
  hash: string,
  results: GenerateResult[],
  ttlMs: number
): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  await db.put(CACHE_STORE, {
    hash,
    results,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
}

export async function cleanExpiredCache(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(CACHE_STORE, "readwrite");
  const all = await tx.store.getAll();
  const now = Date.now();
  let removed = 0;
  for (const entry of all as PromptCacheEntry[]) {
    if (entry.expiresAt < now) {
      await tx.store.delete(entry.hash);
      removed++;
    }
  }
  await tx.done;
  return removed;
}

export async function clearPromptCache(): Promise<void> {
  const db = await getDB();
  await db.clear(CACHE_STORE);
}

export async function findActiveInFlight(promptHash: string): Promise<InFlightEntry | undefined> {
  const db = await getDB();
  const tx = db.transaction(IN_FLIGHT_STORE, "readonly");
  const idx = tx.store.index("promptHash");
  const matches = (await idx.getAll(promptHash)) as InFlightEntry[];
  await tx.done;
  return matches.find((m) => m.status === "pending" || m.status === "polling");
}

export async function createInFlight(entry: Omit<InFlightEntry, "startedAt" | "updatedAt">): Promise<InFlightEntry> {
  const db = await getDB();
  const now = Date.now();
  const full: InFlightEntry = { ...entry, startedAt: now, updatedAt: now };
  await db.put(IN_FLIGHT_STORE, full);
  return full;
}

export async function updateInFlightStatus(
  id: string,
  patch: Partial<Pick<InFlightEntry, "status" | "taskId">>
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(IN_FLIGHT_STORE, id)) as InFlightEntry | undefined;
  if (!existing) return;
  await db.put(IN_FLIGHT_STORE, { ...existing, ...patch, updatedAt: Date.now() });
}

export async function deleteInFlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(IN_FLIGHT_STORE, id);
}

export async function listRecoverableInFlight(maxAgeMs: number): Promise<InFlightEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(IN_FLIGHT_STORE)) as InFlightEntry[];
  const now = Date.now();
  return all.filter(
    (e) =>
      (e.status === "pending" || e.status === "polling") &&
      now - e.startedAt < maxAgeMs
  );
}

export async function markStaleInFlight(maxAgeMs: number): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(IN_FLIGHT_STORE, "readwrite");
  const all = (await tx.store.getAll()) as InFlightEntry[];
  const now = Date.now();
  let updated = 0;
  for (const entry of all) {
    if (
      (entry.status === "pending" || entry.status === "polling") &&
      now - entry.startedAt > maxAgeMs
    ) {
      await tx.store.put({ ...entry, status: "abandoned", updatedAt: now });
      updated++;
    }
  }
  await tx.done;
  return updated;
}
