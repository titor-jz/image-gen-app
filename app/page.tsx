"use client";

/**
 * Home Page - 智能生图主界面
 *
 * 负责 UI 组装，所有业务逻辑已下沉到 hooks/：
 *  - useModels: 加载模型列表
 *  - useInFlightRecovery: 启动时检测未完成任务
 *  - useImageGeneration: 核心生成 + 轮询 + 缓存 + IndexedDB
 *
 * 本组件只做：
 *  1. 状态（提示词、参考图、模型/尺寸/质量）
 *  2. 拼装 <Header/> <UnifiedInputCard/> <ResultGrid/>
 *  3. 错误提示与历史选择后的回填
 *
 * 注意：默认模型/尺寸/质量需要从 localStorage 同步，但 localStorage
 * 只在客户端存在。直接用 useState lazy init 会导致 SSR/CSR 不一致
 * (hydration mismatch)，所以采用 useEffect 异步同步。
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { HistoryDrawerSkeleton } from "@/components/drawer-skeleton";
import {
  UnifiedInputCard,
  type Quality,
  type ReferenceImage,
} from "@/components/UnifiedInputCard";
import { ResultGrid } from "@/components/ResultGrid";
import { getSettings } from "@/lib/user-settings";
import { useModels } from "@/hooks/useModels";
import { useInFlightRecovery } from "@/hooks/useInFlightRecovery";
import { useImageGeneration } from "@/hooks/useImageGeneration";
import type { AspectRatio, HistoryRecord, ModelInfo } from "@/lib/types";

const HistoryDrawer = dynamic(
  () => import("@/components/HistoryDrawer").then((m) => m.HistoryDrawer),
  {
    ssr: false,
    loading: () => <HistoryDrawerSkeleton />,
  }
);

export default function Home() {
  // 1. 输入状态（默认与 SSR 一致，hydrate 后由 useEffect 从 localStorage 同步）
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo["id"]>("gpt-image-2");
  const [selectedSize, setSelectedSize] = useState<AspectRatio>("auto");
  const [selectedQuality, setSelectedQuality] = useState<Quality>("1k");
  // 单次并发生成数量（1~4），默认 1 保持向后兼容；SSR/CSR 一致由 useState 初值保证
  const [selectedN, setSelectedN] = useState<1 | 2 | 3 | 4>(1);
  // 多模型对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [modelB, setModelB] = useState<string>("gpt-image-2");

  // 2. 挂载后从 localStorage 同步用户上次的选择
  // 必须用 useEffect（而非 useState lazy init），因为 localStorage 在 SSR 时不存在，
  // 否则会导致 hydration mismatch。
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const settings = getSettings();
    if (settings.defaultModel) setSelectedModel(settings.defaultModel);
    if (settings.defaultSize) setSelectedSize(settings.defaultSize);
    if (settings.defaultQuality)
      setSelectedQuality(settings.defaultQuality as Quality);
    if (settings.defaultN) setSelectedN(settings.defaultN);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // 3. 数据：模型列表
  const { models } = useModels();

  // 模型 → 单张价格映射：ResultGrid 结果卡片显示每张图花费时使用
  const modelPrices = useMemo(
    () => Object.fromEntries(models.map((m) => [m.id, m.costPerImage])),
    [models]
  );

  // 4. 启动时检测未完成的任务
  useInFlightRecovery();

  // 5. 核心生成流程（任务级状态：并发 + 单张取消）
  const {
    results, loading, error, tasks,
    handleGenerate, cancelTask, setResults,
  } = useImageGeneration({
    prompt,
    referenceImages,
    model: selectedModel,
    size: selectedSize,
    quality: selectedQuality,
    n: selectedN,
    compareMode,
    modelB: modelB as ModelInfo["id"],
  });

  // 6. 历史抽屉
  const [showHistory, setShowHistory] = useState(false);

  // 7. 从历史记录回填
  // 7. 从历史记录回填（参考图不再恢复，需用户重新上传）
  const handleSelectRecord = useCallback((record: HistoryRecord) => {
    setPrompt(record.params.prompt);
    setSelectedModel(record.params.model);
    setSelectedSize(record.params.size || "auto");
    setSelectedQuality((record.params.quality || "1k") as Quality);
    setResults(record.results);
    // 历史记录不再保存参考图原始 base64（避免 IDB 存储膨胀），
    // 旧记录兼容：params.images 仍可能存在，但不再回填到参考图区。
    const hadReferenceImages = Array.isArray(record.params.images) && record.params.images.length > 0;
    setReferenceImages([]);
    setShowHistory(false);
    if (hadReferenceImages) {
      toast.info("已恢复提示词和参数", {
        description: "历史记录未保存参考图，请重新上传",
      });
    }
  }, [setResults]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header onShowHistory={() => setShowHistory(true)} />

      {showHistory && (
        <HistoryDrawer
          onClose={() => setShowHistory(false)}
          onSelectRecord={handleSelectRecord}
        />
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 pt-10 space-y-8">
          {/* 大标题 */}
          <div className="text-center space-y-2 animate-fade-up">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              智能生图
            </h1>
            <p className="text-sm text-muted-foreground">
              输入提示词，AI 为你创造独特的图像
            </p>
          </div>

          {/* 一体化输入卡片 */}
          <div className="animate-fade-up [animation-delay:60ms]">
            <UnifiedInputCard
              prompt={prompt}
              onPromptChange={setPrompt}
              referenceImages={referenceImages}
              onReferenceImagesChange={setReferenceImages}
              models={models}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              selectedSize={selectedSize}
              onSizeChange={setSelectedSize}
              selectedQuality={selectedQuality}
              onQualityChange={setSelectedQuality}
              selectedN={selectedN}
              onNChange={setSelectedN}
              compareMode={compareMode}
              onCompareModeChange={setCompareMode}
              modelB={modelB}
              onModelBChange={setModelB}
              tasks={tasks}
              onCancelTask={cancelTask}
              onGenerate={handleGenerate}
            />
          </div>

        </div>

        {/* 错误提示 + 输出图库：使用更宽容器，图片多时不会挤在窄栏里 */}
        <div className="max-w-6xl mx-auto px-6 pt-6 pb-10 space-y-6">
          {/* 错误提示 */}
          {error && (
            <div className="animate-fade-in p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
              <span className="font-medium shrink-0">提示：</span>
              <span>{error}</span>
            </div>
          )}

          {/* 输出图库 */}
          <div className="animate-fade-up [animation-delay:120ms] input-card p-5">
            <ResultGrid results={results} hasRunning={loading} modelPrices={modelPrices} />
          </div>
        </div>
      </main>
    </div>
  );
}