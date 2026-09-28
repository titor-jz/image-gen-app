"use client";

/**
 * ResultsView - 移动端结果态
 *
 * 任务进度列表置顶（进行中优先，复用 TaskList）+ 结果网格（2 列，对比组并排）。
 * 点击图片 → 全屏预览（FullscreenPreview，由 MobileHome 承载）。
 */

import { Sparkles } from "lucide-react";
import { TaskList } from "@/components/TaskList";
import { ResultCard } from "@/components/ResultCard";
import { buildResultRenderItems } from "@/lib/result-groups";
import { getResultImageSrc, downloadResult, saveResultToGallery } from "@/lib/image-actions";
import type { GenerateResult, GenTask } from "@/lib/types";

export function ResultsView({
  tasks,
  results,
  appMode,
  onCancelTask,
  onResumeTask,
  onDismissTask,
  onPreview,
}: {
  tasks: GenTask[];
  results: GenerateResult[];
  /** Capacitor 壳内：卡片操作钮为「保存到相册」 */
  appMode: boolean;
  onCancelTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onDismissTask: (id: string) => void;
  onPreview: (index: number) => void;
}) {
  const renderItems = buildResultRenderItems(results);
  const isEmpty = results.length === 0 && tasks.length === 0;

  return (
    <div className="h-full overflow-y-auto px-4 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* 任务进度置顶 */}
      {tasks.length > 0 && (
        <div className="mb-5">
          <TaskList
            tasks={tasks}
            onCancelTask={onCancelTask}
            onResumeTask={onResumeTask}
            onDismissTask={onDismissTask}
          />
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-fade-up">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">还没有结果</p>
          <p className="text-[13px] mt-1 text-muted-foreground/80">返回输入画面描述，生成后在这里查看</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {renderItems.map((item) => {
            if (item.type === "compare") {
              return (
                <div key={item.a.compareGroup} className="col-span-2 space-y-1 animate-fade-up">
                  <div className="text-xs text-muted-foreground px-1">
                    {item.a.model === item.b.model && item.a.nodeName && item.b.nodeName
                      ? `线路对比 · ${item.a.nodeName} vs ${item.b.nodeName}`
                      : `模型对比 · ${item.a.model} vs ${item.b.model}`}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ResultCard
                      result={item.a}
                      index={item.indexA}
                      onExpand={onPreview}
                      onDownload={downloadResult}
                      onSaveToGallery={saveResultToGallery}
                      appMode={appMode}
                      getImageSrc={getResultImageSrc}
                      showModelAlways
                      className="m-shot rounded-2xl"
                    />
                    <ResultCard
                      result={item.b}
                      index={item.indexB}
                      onExpand={onPreview}
                      onDownload={downloadResult}
                      onSaveToGallery={saveResultToGallery}
                      appMode={appMode}
                      getImageSrc={getResultImageSrc}
                      showModelAlways
                      className="m-shot rounded-2xl"
                    />
                  </div>
                </div>
              );
            }
            return (
              <ResultCard
                key={item.result.id}
                result={item.result}
                index={item.index}
                onExpand={onPreview}
                onDownload={downloadResult}
                onSaveToGallery={saveResultToGallery}
                appMode={appMode}
                getImageSrc={getResultImageSrc}
                className="m-shot rounded-2xl"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
