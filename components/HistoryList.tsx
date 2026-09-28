"use client";

/**
 * HistoryList - 历史记录列表（左侧抽屉与底部 Sheet 共用）
 *
 * 从 HistoryDrawer 抽出（纯搬移）。
 */

import { Image as ImageIcon, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HistoryRecord } from "@/lib/types";

export function HistoryItem({ record, onClick, onDelete }: {
  record: HistoryRecord;
  onClick: (record: HistoryRecord) => void;
  onDelete: (id: string) => void;
}) {
  const time = new Date(record.createdAt).toLocaleString("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const firstResult = record.results[0];

  return (
    <div
      className="group flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-base hover:bg-accent/60 active:scale-[0.98]"
      onClick={() => onClick(record)}
    >
      <div className="w-11 h-11 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 ring-1 ring-border/50">
        {firstResult?.b64_json ? (
          <img src={`data:${firstResult.mime};base64,${firstResult.b64_json}`} alt={record.params.prompt} className="w-full h-full object-cover transition-slow group-hover:scale-105" />
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
      {/* 单条删除：触屏无 hover，移动端常驻显示；桌面保留 hover 显隐 */}
      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9 sm:w-6 sm:h-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 press transition-base hover:bg-destructive/10 shrink-0"
        onClick={(e) => { e.stopPropagation(); onDelete(record.id); }}
        aria-label={`删除 ${record.params.prompt.slice(0, 10)} 的记录`}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
}

export function HistoryList({
  records,
  onSelectRecord,
  onDelete,
  className = "p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-0.5",
}: {
  records: HistoryRecord[];
  onSelectRecord: (record: HistoryRecord) => void;
  onDelete: (id: string) => void;
  /** 外层留白（抽屉默认；底部 Sheet 可覆盖） */
  className?: string;
}) {
  return (
    <div className={className}>
      {records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-in">
          <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm">暂无历史记录</p>
        </div>
      )}
      {records.map((record, i) => (
        <div key={record.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}>
          <HistoryItem record={record} onClick={onSelectRecord} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}
