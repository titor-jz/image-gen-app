"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Image as ImageIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAllHistory, deleteHistoryBatch, deleteAllHistory } from "@/lib/db";
import type { HistoryRecord } from "@/lib/types";

interface HistoryDrawerProps {
  onClose: () => void;
  onSelectRecord: (record: HistoryRecord) => void;
}

function HistoryItem({ record, onClick }: {
  record: HistoryRecord;
  onClick: (record: HistoryRecord) => void;
}) {
  const time = new Date(record.createdAt).toLocaleString("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const firstResult = record.results[0];

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-accent"
      onClick={() => onClick(record)}
    >
      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
        {firstResult?.b64_json ? (
          <img src={`data:${firstResult.mime};base64,${firstResult.b64_json}`} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{record.params.prompt}</p>
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
      </div>
    </div>
  );
}

export function HistoryDrawer({ onClose, onSelectRecord }: HistoryDrawerProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  const loadHistory = useCallback(async () => {
    const data = await getAllHistory();
    setRecords(data);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleClearAll = async () => {
    await deleteAllHistory();
    await loadHistory();
  };

  return (
    <>
      {/* 抽屉 */}
      <div className="fixed top-0 left-0 z-50 w-80 h-full bg-card border-r border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">对话列表</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleClearAll}>清除历史</Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {records.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">暂无历史记录</p>
            )}
            {records.map((record) => (
              <HistoryItem key={record.id} record={record} onClick={onSelectRecord} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
