"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckSquare, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HistoryItem } from "./HistoryItem";
import {
  getAllHistory,
  deleteHistoryBatch,
  deleteAllHistory,
} from "@/lib/db";
import type { HistoryRecord } from "@/lib/types";

interface SidebarProps {
  onSelectRecord: (record: HistoryRecord) => void;
}

export function Sidebar({ onSelectRecord }: SidebarProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadHistory = useCallback(async () => {
    const data = await getAllHistory();
    setRecords(data);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(records.map((r) => r.id)));
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    await deleteHistoryBatch(Array.from(selectedIds));
    setSelectedIds(new Set());
    await loadHistory();
  };

  const handleClearAll = async () => {
    await deleteAllHistory();
    setSelectedIds(new Set());
    await loadHistory();
  };

  return (
    <aside className="w-80 border-r border-border bg-card/50 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
            {selectedIds.size === records.length && records.length > 0 ? (
              <CheckSquare className="w-4 h-4" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? `已选 ${selectedIds.size}` : "全选"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            清除历史
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {records.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无历史记录
            </p>
          )}
          {records.map((record) => (
            <HistoryItem
              key={record.id}
              record={record}
              selected={selectedIds.has(record.id)}
              onSelect={toggleSelect}
              onClick={onSelectRecord}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
