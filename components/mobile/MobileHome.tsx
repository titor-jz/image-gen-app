"use client";

/**
 * MobileHome - 移动端首页（<640px）：专注式两态推拉
 *
 * 视觉（m-* 样式层）：环境光晕背景（m-ambient）、顶栏节点胶囊 + 图标组（m-iconcluster）、
 * 节点切换用底部面板（替代桌面下拉——同时规避左缘溢出 bug）。
 *
 * 交互：输入态（Composer）⇄ 结果态（ResultsView）；点生成切结果态；
 * 安卓返回键经 onNavApi 由 page.tsx 统一接管（顺序：预览 → 面板 → 结果态 → 退出）。
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Clock, Sun, Moon, ChevronLeft, Server, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useApiConfig } from "@/lib/api-config-context";
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
  const [nodeOpen, setNodeOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const { records, load, remove, clearAll } = useHistoryRecords();
  const { activeId, setActiveId } = useApiConfig();
  // 仅 Capacitor 壳内为真（mounted 门控，避免 hydration 不一致）
  const [appMode, setAppMode] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后检测原生环境（SSR 首帧无 window.Capacitor）
    setAppMode(isCapacitor());
  }, []);

  const activeNode = props.profiles.find((p) => p.id === (props.activeNodeId || activeId)) ?? null;

  // 挂载即加载（首屏"最近生成"轨），面板打开时刷新
  useEffect(() => {
    void load();
  }, [load]);
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

  // 安卓返回键接管顺序：预览 → 各面板 → 结果态 → 交还页面（退出）
  const { onNavApi } = props;
  useEffect(() => {
    onNavApi?.({
      handleBack: () => {
        if (previewIndex !== null) { setPreviewIndex(null); return true; }
        if (paramOpen) { setParamOpen(false); return true; }
        if (historyOpen) { setHistoryOpen(false); return true; }
        if (nodeOpen) { setNodeOpen(false); return true; }
        if (view === "results") { setView("compose"); return true; }
        return false;
      },
    });
    return () => onNavApi?.(null);
  }, [onNavApi, previewIndex, paramOpen, historyOpen, nodeOpen, view]);

  return (
    <div className="flex flex-col h-dvh bg-background m-ambient">
      {/* 顶栏：随状态切换 */}
      <header className="sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3">
          {view === "compose" ? (
            <>
              {/* 节点胶囊：点击唤出底部节点面板 */}
              <button
                type="button"
                onClick={() => setNodeOpen(true)}
                className="m-pill h-9 pl-2.5 pr-3 flex items-center gap-1.5 press max-w-40"
                aria-label="切换 API 节点"
              >
                <Server className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">
                  {activeNode?.name || "未配置节点"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
              <div className="m-iconcluster flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="press rounded-full"
                  onClick={() => setHistoryOpen(true)}
                  aria-label="历史记录"
                >
                  <Clock className="w-[18px] h-[18px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="press rounded-full"
                  onClick={toggleTheme}
                  aria-label="切换主题"
                >
                  <span key={isDark ? "sun" : "moon"} className="block animate-fade-in">
                    {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
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
                className="gap-1 press -ml-1.5 text-muted-foreground"
                onClick={() => setView("compose")}
                aria-label="返回输入"
              >
                <ChevronLeft className="w-5 h-5" />
                返回
              </Button>
              <span className="text-[15px] font-semibold text-foreground tracking-wide">
                生成结果{props.results.length > 0 ? ` · ${props.results.length}` : ""}
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
              recentRecords={records}
              onOpenRecent={handleSelectHistory}
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

      {/* 节点切换面板（移动端用底部面板，替代桌面下拉） */}
      <BottomSheet open={nodeOpen} onClose={() => setNodeOpen(false)} title="切换 API 节点">
        <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1">
          {props.profiles.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              尚未配置节点，请在设置中添加
            </p>
          )}
          {props.profiles.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setActiveId(p.id); setNodeOpen(false); }}
                className={`w-full flex items-center gap-3 px-3.5 py-3.5 rounded-2xl transition-base press ${
                  active ? "bg-primary/10 text-primary" : "hover:bg-accent/50 text-foreground"
                }`}
              >
                <Server className={`w-4 h-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="flex-1 text-left text-[15px] truncate">{p.name || "未命名节点"}</span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      </BottomSheet>

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
