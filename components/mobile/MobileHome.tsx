"use client";

/**
 * MobileHome - 移动端首页（<640px）：专注式两态推拉
 *
 * 输入态（Composer）⇄ 结果态（ResultsView），无常驻导航栏。
 * - 点生成：切结果态（任务进度置顶可见）
 * - 顶部栏随状态切换：输入态=节点/历史/主题/设置；结果态=‹ 返回 + 标题
 * - ParamSheet / HistorySheet / FullscreenPreview 为底部/全屏弹层
 * - 安卓返回键经 navApiRef 由 page.tsx 统一接管（顺序：预览 → 面板 → 结果态 → 退出）
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Clock, Sun, Moon, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NodeSwitcher } from "@/components/NodeSwitcher";
import { SettingsDialog } from "@/components/SettingsDialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { HistoryList } from "@/components/HistoryList";
import { Composer } from "@/components/mobile/Composer";
import { ParamSheet } from "@/components/mobile/ParamSheet";
import { ResultsView } from "@/components/mobile/ResultsView";
import { FullscreenPreview } from "@/components/mobile/FullscreenPreview";
import { useTheme } from "@/hooks/useTheme";
import { useHistoryRecords } from "@/hooks/useHistoryRecords";
import { useNodeBModels } from "@/hooks/useNodeBModels";
import { isCapacitor } from "@/lib/capacitor-env";
import { SIZES, QUALITIES, type Quality, type RefQuality, type ReferenceImage } from "@/components/UnifiedInputCard";
import type { ApiProfile } from "@/lib/api-config-context";
import type { AspectRatio, GenerateResult, GenTask, HistoryRecord, ModelInfo } from "@/lib/types";

/** 供 page.tsx 的安卓返回键统一接管（返回 true = 已消费） */
export interface MobileNavApi {
  handleBack: () => boolean;
}

export type MobileView = "compose" | "results";

export interface MobileHomeProps {
  // 输入态
  prompt: string;
  onPromptChange: (v: string) => void;
  referenceImages: ReferenceImage[];
  onReferenceImagesChange: React.Dispatch<React.SetStateAction<ReferenceImage[]>>;
  models: ModelInfo[];
  modelsLoading?: boolean;
  selectedModel: string;
  onModelChange: (m: string) => void;
  selectedSize: AspectRatio;
  onSizeChange: (s: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (q: Quality) => void;
  selectedN: 1 | 2 | 3 | 4;
  onNChange: (n: 1 | 2 | 3 | 4) => void;
  refQuality: RefQuality;
  onRefQualityChange: (q: RefQuality) => void;
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
  modelB: string;
  onModelBChange: (m: string) => void;
  profiles: ApiProfile[];
  activeNodeId: string;
  nodeBId: string | null;
  onNodeBChange: (id: string | null) => void;
  // 结果态
  results: GenerateResult[];
  tasks: GenTask[];
  onCancelTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onDismissTask: (id: string) => void;
  onGenerate: () => void;
  // 历史
  onSelectHistory: (record: HistoryRecord) => void;
  /** 返回键接管：MobileHome 挂载/状态变化时上报导航 API（page 侧写入自己的 ref） */
  onNavApi?: (api: MobileNavApi | null) => void;
}

export function MobileHome(props: MobileHomeProps) {
  const [view, setView] = useState<MobileView>("compose");
  const [paramOpen, setParamOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const { records, load, remove, clearAll } = useHistoryRecords();
  // 仅 Capacitor 壳内为真（mounted 门控，避免 hydration 不一致）
  const [appMode, setAppMode] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后检测原生环境（SSR 首帧无 window.Capacitor）
    setAppMode(isCapacitor());
  }, []);

  // 历史面板打开时加载
  useEffect(() => {
    if (historyOpen) void load();
  }, [historyOpen, load]);

  // 清空确认 3 秒复位
  useEffect(() => {
    if (!confirmingClear) return;
    const t = setTimeout(() => setConfirmingClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingClear]);

  // B 侧模型（跨节点对比）
  const nodeBProfile = useMemo(
    () => props.profiles.find((p) => p.id === props.nodeBId) ?? null,
    [props.profiles, props.nodeBId]
  );
  const { modelsB, isCrossNode } = useNodeBModels({
    compareMode: props.compareMode,
    nodeBProfile,
    activeNodeId: props.activeNodeId,
    modelB: props.modelB,
    onModelBChange: props.onModelBChange,
  });
  const modelBOptions = isCrossNode && modelsB ? modelsB : props.models;

  // 参数摘要（一行）
  const paramSummary = useMemo(() => {
    const modelLabel = props.models.find((m) => m.id === props.selectedModel)?.name ?? props.selectedModel;
    const sizeLabel = SIZES.find((s) => s.value === props.selectedSize)?.label ?? props.selectedSize;
    const qualityLabel = QUALITIES.find((q) => q.value === props.selectedQuality)?.label ?? props.selectedQuality;
    const parts = [modelLabel, sizeLabel, qualityLabel];
    parts.push(props.compareMode ? "对比" : `${props.selectedN}张`);
    return parts.join(" · ");
  }, [props.models, props.selectedModel, props.selectedSize, props.selectedQuality, props.selectedN, props.compareMode]);

  const runningCount = useMemo(
    () => props.tasks.filter((t) => t.status === "submitting" || t.status === "polling").length,
    [props.tasks]
  );

  const handleGenerate = useCallback(() => {
    props.onGenerate();
    setView("results");
  }, [props]);

  const handleSelectHistory = useCallback(
    (record: HistoryRecord) => {
      props.onSelectHistory(record);
      setHistoryOpen(false);
      setView("results");
    },
    [props]
  );

  // 安卓返回键接管顺序：预览 → 参数面板 → 历史面板 → 结果态 → 交还页面（退出）
  const { onNavApi } = props;
  useEffect(() => {
    onNavApi?.({
      handleBack: () => {
        if (previewIndex !== null) { setPreviewIndex(null); return true; }
        if (paramOpen) { setParamOpen(false); return true; }
        if (historyOpen) { setHistoryOpen(false); return true; }
        if (view === "results") { setView("compose"); return true; }
        return false;
      },
    });
    return () => onNavApi?.(null);
  }, [onNavApi, previewIndex, paramOpen, historyOpen, view]);

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* 顶栏：随状态切换 */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          {view === "compose" ? (
            <>
              <NodeSwitcher />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="press hover:bg-accent/60"
                  onClick={() => setHistoryOpen(true)}
                  aria-label="历史记录"
                >
                  <Clock className="w-4.5 h-4.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="press hover:bg-accent/60"
                  onClick={toggleTheme}
                  aria-label="切换主题"
                >
                  <span key={isDark ? "sun" : "moon"} className="block animate-fade-in">
                    {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
                  </span>
                </Button>
                <SettingsDialog />
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 press hover:bg-accent/60 -ml-1.5"
                onClick={() => setView("compose")}
                aria-label="返回输入"
              >
                <ChevronLeft className="w-4.5 h-4.5" />
                返回
              </Button>
              <span className="text-sm font-medium text-foreground">
                生成结果{props.results.length > 0 ? ` ${props.results.length}` : ""}
              </span>
              <span className="w-16" aria-hidden="true" />
            </>
          )}
        </div>
      </header>

      {/* 两态容器（推拉动画） */}
      <main className="flex-1 min-h-0">
        {view === "compose" ? (
          <div key="compose" className="h-full animate-slide-down-in">
            <Composer
              prompt={props.prompt}
              onPromptChange={props.onPromptChange}
              referenceImages={props.referenceImages}
              onReferenceImagesChange={props.onReferenceImagesChange}
              refQuality={props.refQuality}
              paramSummary={paramSummary}
              runningCount={runningCount}
              onOpenParams={() => setParamOpen(true)}
              onShowResults={() => setView("results")}
              onGenerate={handleGenerate}
              canGenerate={!!props.prompt.trim()}
            />
          </div>
        ) : (
          <div key="results" className="h-full animate-slide-up-in">
            <ResultsView
              tasks={props.tasks}
              results={props.results}
              appMode={appMode}
              onCancelTask={props.onCancelTask}
              onResumeTask={props.onResumeTask}
              onDismissTask={props.onDismissTask}
              onPreview={setPreviewIndex}
            />
          </div>
        )}
      </main>

      {/* 生成参数面板 */}
      <ParamSheet
        open={paramOpen}
        onClose={() => setParamOpen(false)}
        models={props.models}
        modelsLoading={props.modelsLoading}
        selectedModel={props.selectedModel}
        onModelChange={props.onModelChange}
        refQuality={props.refQuality}
        onRefQualityChange={props.onRefQualityChange}
        selectedSize={props.selectedSize}
        onSizeChange={props.onSizeChange}
        selectedQuality={props.selectedQuality}
        onQualityChange={props.onQualityChange}
        selectedN={props.selectedN}
        onNChange={props.onNChange}
        compareMode={props.compareMode}
        onCompareModeChange={props.onCompareModeChange}
        modelB={props.modelB}
        onModelBChange={props.onModelBChange}
        profiles={props.profiles}
        activeNodeId={props.activeNodeId}
        nodeBId={props.nodeBId}
        onNodeBChange={props.onNodeBChange}
        modelBOptions={modelBOptions}
      />

      {/* 历史面板 */}
      <BottomSheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="历史记录">
        <div className="px-4 pt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!confirmingClear) { setConfirmingClear(true); return; }
              setConfirmingClear(false);
              await clearAll();
            }}
            className={`press transition-base text-muted-foreground hover:text-foreground ${
              confirmingClear ? "bg-destructive/10 text-destructive hover:text-destructive" : "hover:bg-accent/60"
            }`}
          >
            {confirmingClear ? "再点一次确认" : "清除历史"}
          </Button>
        </div>
        <HistoryList records={records} onSelectRecord={handleSelectHistory} onDelete={remove} />
      </BottomSheet>

      {/* 全屏预览 */}
      {previewIndex !== null && (
        <FullscreenPreview
          results={props.results}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          appMode={appMode}
        />
      )}
    </div>
  );
}
