import { openDB, type IDBPDatabase } from "idb";
import type { HistoryRecord } from "./types";

const DB_NAME = "image-gen-db";
const STORE_NAME = "history";
const DB_VERSION = 1;

let dbInstance: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: false,
        });
        store.createIndex("createdAt", "createdAt");
      }
    },
  });

  return dbInstance;
}

export async function addHistory(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, record);
}

export async function getAllHistory(): Promise<HistoryRecord[]> {
  const db = await getDB();
  const records = await db.getAll(STORE_NAME);
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getHistory(id: string): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function deleteHistory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function deleteAllHistory(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE_NAME);
}

export async function deleteHistoryBatch(ids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function updateHistory(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, record);
}
