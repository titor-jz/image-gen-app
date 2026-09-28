"use client";

/**
 * TaskList - 任务进度列表（按 batchId 分组，每批一个微容器）
 *
 * 从 UnifiedInputCard 抽出（纯搬移）；桌面输入卡与移动结果态共用。
 * - polling 用 shimmer 流光表示"工作中"，不显示假百分比爬行（motion-meaning）
 * - 终态用状态图标 + 状态色（color-not-only：不只靠颜色传达状态）
 * - 进行中/刚终态(淡出期)都显示；终态 1.5s 后由 hook 移除
 */

import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Ban, Loader2, Clock, RotateCw, X } from "lucide-react";
import type { GenTask } from "@/lib/types";

export function TaskList({
  tasks,
  onCancelTask,
  onResumeTask,
  onDismissTask,
  className = "",
}: {
  tasks: GenTask[];
  onCancelTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onDismissTask: (id: string) => void;
  /** 外层留白（桌面输入卡 px-4 pb-3；移动结果态按容器） */
  className?: string;
}) {
  if (tasks.length === 0) return null;
  return (
        <div className={`${className} flex flex-col gap-2 animate-fade-in`}>
          {Object.entries(
            tasks.reduce<Record<string, GenTask[]>>((acc, t) => {
              (acc[t.batchId] ??= []).push(t);
              return acc;
            }, {})
          ).map(([batchId, group]) => (
            <div
              key={batchId}
              className="rounded-xl bg-muted/60 border border-border/60 px-3 py-2 flex flex-col gap-1.5"
            >
              {group.map((slot) => {
                const running =
                  slot.status === "submitting" || slot.status === "polling";
                // 状态图标 + 颜色（§1 color-not-only：图标辅助颜色传达状态）
                const Icon =
                  slot.status === "success"
                    ? CheckCircle2
                    : slot.status === "failed"
                    ? XCircle
                    : slot.status === "timeout"
                    ? Clock
                    : slot.status === "cancelled"
                    ? Ban
                    : Loader2;
                const iconColor =
                  slot.status === "success"
                    ? "text-emerald-500"
                    : slot.status === "failed"
                    ? "text-destructive"
                    : slot.status === "timeout"
                    ? "text-amber-500"
                    : slot.status === "cancelled"
                    ? "text-muted-foreground/60"
                    : "text-primary";
                const barColor =
                  slot.status === "failed"
                    ? "bg-destructive"
                    : slot.status === "timeout"
                    ? "bg-amber-500/70"
                    : slot.status === "cancelled"
                    ? "bg-muted-foreground/40"
                    : slot.status === "success"
                    ? "bg-emerald-500"
                    : "bg-primary";
                const isTerminal =
                  slot.status === "success" ||
                  slot.status === "failed" ||
                  slot.status === "timeout" ||
                  slot.status === "cancelled";
                const label = isTerminal
                  ? slot.status === "success"
                    ? "完成"
                    : slot.status === "failed"
                    ? "失败"
                    : slot.status === "timeout"
                    ? "超时"
                    : "取消"
                  : slot.elapsedSec
                  ? `${slot.elapsedSec}s`
                  : "等待";
                return (
                  <div key={slot.id} className="flex items-center gap-2.5">
                    {/* 状态图标：polling 时旋转，终态静态 */}
                    <Icon
                      className={`w-4 h-4 shrink-0 ${iconColor} ${
                        slot.status === "submitting" || slot.status === "polling"
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums">
                      #{slot.slot + 1}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
                      {/* 进度填充：终态满格；submitting/polling 用低填充 + 流光表示工作中 */}
                      <div
                        className={`h-full transition-all duration-500 ease-soft ${barColor}`}
                        style={{
                          width: `${
                            isTerminal
                              ? 100
                              : slot.status === "submitting"
                              ? 15
                              : Math.min(90, Math.max(20, Math.round((slot.progress || 0.1) * 100)))
                          }%`,
                        }}
                      />
                      {/* polling 阶段叠加 shimmer 流光，传达"正在工作"（motion-meaning） */}
                      {running && (
                        <div className="absolute inset-0 animate-shimmer rounded-full" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground w-9 text-right shrink-0 tabular-nums">
                      {label}
                    </span>
                    {running ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 sm:w-6 sm:h-6 shrink-0 press hover:bg-accent/60"
                        onClick={() => onCancelTask(slot.id)}
                        aria-label={`取消第 ${slot.slot + 1} 张`}
                      >
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    ) : slot.status === "timeout" ? (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* 超时可续查：上游可能已完成，用保留的 taskId 再查一轮 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 sm:h-6 text-xs gap-1 press text-amber-600 hover:bg-amber-500/10"
                          onClick={() => onResumeTask(slot.id)}
                          aria-label={`继续等待第 ${slot.slot + 1} 张`}
                        >
                          <RotateCw className="w-3 h-3" />
                          继续等待
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 sm:w-6 sm:h-6 press hover:bg-accent/60"
                          onClick={() => onDismissTask(slot.id)}
                          aria-label={`忽略第 ${slot.slot + 1} 张`}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <span className="w-8 h-8 sm:w-6 sm:h-6 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
  );
}
