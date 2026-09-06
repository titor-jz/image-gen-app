"use client";

/**
 * HistoryDrawer - 历史记录侧边栏
 *
 * 显示所有历史生成记录，支持单击回填、单条删除、清空（带确认）。
 * 遮罩点击 / Esc / 关闭按钮均可关闭抽屉。
 * 数据来源：IndexedDB（通过 lib/db.getAllHistory）。
 */

import { useState, useEffect, useCallback } from "react";
import { X, Image as ImageIcon, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getAllHistory,
  deleteAllHistory,
  deleteHistory,
} from "@/lib/db";
import type { HistoryRecord } from "@/lib/types";

interface HistoryDrawerProps {
  onClose: () => void;
  onSelectRecord: (record: HistoryRecord) => void;
}

function HistoryItem({ record, onClick, onDelete }: {
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
      {/* 单条删除：hover 出现，阻止冒泡避免触发回填 */}
      <Button
        variant="ghost"
        size="icon"
        className="w-6 h-6 opacity-0 group-hover:opacity-100 press transition-base hover:bg-destructive/10 shrink-0"
        onClick={(e) => { e.stopPropagation(); onDelete(record.id); }}
        aria-label={`删除 ${record.params.prompt.slice(0, 10)} 的记录`}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
}

export function HistoryDrawer({ onClose, onSelectRecord }: HistoryDrawerProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  // 清空历史的两步确认状态（不用 window.confirm：Electron 对原生对话框支持差）
  const [confirmingClear, setConfirmingClear] = useState(false);

  const loadHistory = useCallback(async () => {
    const data = await getAllHistory();
    setRecords(data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 抽屉打开时加载历史，事件驱动加载的标准写法
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 确认态 3 秒未点击则自动复位
  useEffect(() => {
    if (!confirmingClear) return;
    const timer = setTimeout(() => setConfirmingClear(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingClear]);

  const handleClearAll = async () => {
    // 破坏性操作：第一次点击进入确认态，3 秒内再点才真正清空
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    await deleteAllHistory();
    await loadHistory();
  };

  const handleDelete = async (id: string) => {
    await deleteHistory(id);
    await loadHistory();
  };

  return (
    <>
      {/* 遮罩：点击空白处关闭 */}
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed top-0 left-0 z-50 w-80 h-full bg-card border-r border-border shadow-2xl flex flex-col animate-drawer-in" role="dialog" aria-label="历史记录">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">对话列表</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className={`press transition-base text-muted-foreground hover:text-foreground ${confirmingClear ? "bg-destructive/10 text-destructive hover:text-destructive" : "hover:bg-accent/60"}`}
            >
              {confirmingClear ? "再点一次确认" : "清除历史"}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="press transition-base hover:bg-accent/60" aria-label="关闭">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 scrollbar-thin">
          <div className="p-2 space-y-0.5">
            {records.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-in">
                <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">暂无历史记录</p>
              </div>
            )}
            {records.map((record, i) => (
              <div key={record.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}>
                <HistoryItem record={record} onClick={onSelectRecord} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
