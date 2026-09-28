"use client";

/**
 * useHistoryRecords - 历史记录数据（左侧抽屉与底部 Sheet 共用）
 *
 * 从 HistoryDrawer 抽出（纯搬移）。
 */

import { useState, useCallback } from "react";
import { getAllHistory, deleteAllHistory, deleteHistory } from "@/lib/db";
import type { HistoryRecord } from "@/lib/types";

export function useHistoryRecords() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  const load = useCallback(async () => {
    setRecords(await getAllHistory());
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await deleteHistory(id);
      await load();
    },
    [load]
  );

  const clearAll = useCallback(async () => {
    await deleteAllHistory();
    await load();
  }, [load]);

  return { records, load, remove, clearAll };
}
