"use client";

/**
 * HistoryDrawer - 历史记录侧边栏
 *
 * 显示所有历史生成记录，支持单击回填、单条删除、清空（带确认）。
 * 遮罩点击 / Esc / 关闭按钮均可关闭抽屉。
 * 数据来源：IndexedDB（通过 lib/db.getAllHistory）。
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHistoryRecords } from "@/hooks/useHistoryRecords";
import { HistoryList } from "@/components/HistoryList";
import type { HistoryRecord } from "@/lib/types";

interface HistoryDrawerProps {
  onClose: () => void;
  onSelectRecord: (record: HistoryRecord) => void;
}

export function HistoryDrawer({ onClose, onSelectRecord }: HistoryDrawerProps) {
  const { records, load, remove, clearAll } = useHistoryRecords();
  // 清空历史的两步确认状态（应用内联确认，不用 window.confirm 弹窗）
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => { load(); }, [load]);

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
    await clearAll();
  };

  const handleDelete = remove;

  return (
    <>
      {/* 遮罩：点击空白处关闭 */}
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed top-0 left-0 z-50 w-full sm:w-80 h-full bg-card border-r border-border shadow-2xl flex flex-col animate-drawer-in" role="dialog" aria-label="历史记录">
        <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b border-border">
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
          <HistoryList records={records} onSelectRecord={onSelectRecord} onDelete={handleDelete} />
        </ScrollArea>
      </div>
    </>
  );
}
