import { openDB, type IDBPDatabase } from "idb";
import type { HistoryRecord, GenerateResult } from "./types";

const DB_NAME = "image-gen-db";
const DB_VERSION = 3;
const HISTORY_STORE = "history";
const CACHE_STORE = "prompt_cache";
const IN_FLIGHT_STORE = "in_flight";

// in-flight 记录默认最大有效期（5 分钟）
// 超过此时间视为"已放弃"，可被新的请求覆盖
const DEFAULT_IN_FLIGHT_MAX_AGE_MS = 5 * 60 * 1000;

let dbInstance: IDBPDatabase | null = null;

export interface PromptCacheEntry {
  hash: string;
  results: GenerateResult[];
  createdAt: number;
  expiresAt: number;
}

export type InFlightStatus =
  | "pending"
  | "polling"
  | "success"
  | "failed"
  | "cancelled"
  | "abandoned";

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

export async function getHistory(
  id: string
): Promise<HistoryRecord | undefined> {
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

export async function getPromptCache(
  hash: string
): Promise<PromptCacheEntry | undefined> {
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

// ============================================================
// in-flight 原子化 API
// ============================================================
//
// 背景：
//  之前的 findActiveInFlight + createInFlight 是两步非原子操作，
//  在以下场景会出现重复请求：
//   1. 多标签页同时点击生成
//   2. 同一标签页快速连点
//   3. React StrictMode 双调用
//
// 新方案：
//  把"检查 + 插入"合并到同一个 readwrite transaction 中，
//  利用 IndexedDB 事务的原子性保证只有第一个调用者能"占用"。
//  其余调用者会收到 null（已被他人占用），由调用方决定如何提示用户。
//
// 抢占规则：
//  - 同 promptHash 已有 active 记录（pending/polling）且未超时 → 占位失败
//  - 同 promptHash 已有 active 记录但已超时（视为 abandoned）→ 抢占成功（覆盖）
//  - 同 promptHash 已有终态记录（success/failed/cancelled）→ 占位成功
// ============================================================

/**
 * 原子抢占 in-flight 占位
 *
 * @returns
 *   - { result: "claimed", entry }   抢占成功，可以发起请求
 *   - { result: "busy", existing }   已有他人占用，请勿重复发起
 */
export type ClaimResult =
  | { result: "claimed"; entry: InFlightEntry }
  | { result: "busy"; existing: InFlightEntry };

export async function claimInFlight(
  promptHash: string,
  promptPreview: string,
  maxAgeMs: number = DEFAULT_IN_FLIGHT_MAX_AGE_MS
): Promise<ClaimResult> {
  const db = await getDB();
  const tx = db.transaction(IN_FLIGHT_STORE, "readwrite");
  const idx = tx.store.index("promptHash");
  const matches = (await idx.getAll(promptHash)) as InFlightEntry[];
  const now = Date.now();

  // 找出唯一的 active（pending/polling）记录
  const active = matches.find(
    (m) => m.status === "pending" || m.status === "polling"
  );

  if (active && now - active.startedAt <= maxAgeMs) {
    // 有人在做且未超时 → 占位失败
    await tx.done;
    return { result: "busy", existing: active };
  }

  // 占位成功：清理同 hash 的旧 active（如果超时则标 abandoned），再插入新记录
  if (active) {
    await tx.store.put({
      ...active,
      status: "abandoned",
      updatedAt: now,
    });
  }
  // 顺手清理同 hash 的历史终态记录，避免无限累积
  for (const m of matches) {
    if (m.id !== active?.id) {
      await tx.store.delete(m.id);
    }
  }

  const newEntry: InFlightEntry = {
    id: `inflight-${now}-${Math.random().toString(36).slice(2, 7)}`,
    promptHash,
    promptPreview,
    status: "pending",
    startedAt: now,
    updatedAt: now,
  };
  await tx.store.put(newEntry);
  await tx.done;
  return { result: "claimed", entry: newEntry };
}

/**
 * 释放占位（任务完成 / 失败 / 取消时调用）
 */
export async function releaseInFlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(IN_FLIGHT_STORE, id);
}

/**
 * 更新占位状态（轮询开始时标记 status=polling，taskId 写入）
 */
export async function updateInFlightStatus(
  id: string,
  patch: Partial<Pick<InFlightEntry, "status" | "taskId">>
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(IN_FLIGHT_STORE, id)) as InFlightEntry | undefined;
  if (!existing) return;
  await db.put(IN_FLIGHT_STORE, { ...existing, ...patch, updatedAt: Date.now() });
}

/**
 * 列出可恢复的 in-flight（启动时检测）
 * - status 仍为 active（pending/polling）
 * - 距 startedAt 不超过 maxAgeMs
 */
export async function listRecoverableInFlight(
  maxAgeMs: number = DEFAULT_IN_FLIGHT_MAX_AGE_MS
): Promise<InFlightEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(IN_FLIGHT_STORE)) as InFlightEntry[];
  const now = Date.now();
  return all.filter(
    (e) =>
      (e.status === "pending" || e.status === "polling") &&
      now - e.startedAt < maxAgeMs
  );
}

/**
 * 将超时的 active 记录标记为 abandoned
 */
export async function markStaleInFlight(
  maxAgeMs: number = DEFAULT_IN_FLIGHT_MAX_AGE_MS
): Promise<number> {
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

