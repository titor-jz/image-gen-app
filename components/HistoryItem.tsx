"use client";

import { Image as ImageIcon, Clock } from "lucide-react";
import type { HistoryRecord } from "@/lib/types";

interface HistoryItemProps {
  record: HistoryRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  onClick: (record: HistoryRecord) => void;
}

export function HistoryItem({ record, selected, onSelect, onClick }: HistoryItemProps) {
  const time = new Date(record.createdAt).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const firstResult = record.results[0];

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-accent ${
        selected ? "bg-accent border border-primary/30" : ""
      }`}
      onClick={() => onClick(record)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation();
          onSelect(record.id);
        }}
        className="mt-1 rounded border-border"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
        {firstResult?.b64_json ? (
          <img
            src={`data:${firstResult.mime};base64,${firstResult.b64_json}`}
            alt=""
            className="w-full h-full object-cover"
          />
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
