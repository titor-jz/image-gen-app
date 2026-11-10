"use client";

/**
 * Home Page - 智能生图主界面
 *
 * 负责 UI 组装，所有业务逻辑已下沉到 hooks/：
 *  - useModelCatalog: 跨节点模型目录聚合（模型优先自动路由）
 *  - useInFlightRecovery: 启动时检测未完成任务
 *  - useImageGeneration: 核心生成 + 轮询 + IndexedDB
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

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { HistoryDrawerSkeleton } from "@/components/drawer-skeleton";
import {
  UnifiedInputCard,
  SIZES,
  type Quality,
  type RefQuality,
  type ReferenceImage,
} from "@/components/UnifiedInputCard";
import { ResultGrid } from "@/components/ResultGrid";
import { getSettings } from "@/lib/user-settings";
import { MAX_PROMPT_CHARS } from "@/lib/prompt-rules";
import { suggestPromptFixes } from "@/lib/prompt-fix-suggestions";
import { classifyErrorCode } from "@/lib/error-origin";
import { useModelCatalog } from "@/hooks/useModelCatalog";
import { DEFAULT_SIZES } from "@/lib/custom-models";
import { useApiConfig } from "@/lib/api-config-context";
import { resolveOptimizeEndpoint } from "@/lib/optimize-endpoint";
import { useInFlightRecovery } from "@/hooks/useInFlightRecovery";
import { useImageGeneration } from "@/hooks/useImageGeneration";
import { getNodeSizeCapability, type NodeSizeCapability } from "@/lib/node-size-capability";
import { probeMaxTier } from "@/lib/probe-size";
import { usePromptOptimize } from "@/hooks/usePromptOptimize";
import { isCapacitor } from "@/lib/capacitor-env";
import { useIsMobile } from "@/hooks/useIsMobile";
import { FullscreenPreview } from "@/components/mobile/FullscreenPreview";
import type { AspectRatio, GenerateResult, HistoryRecord, ModelInfo, OutputFormat } from "@/lib/types";

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
  // 参考图清晰度（自动/高清/原图），挂载后从用户设置同步
  const [refQuality, setRefQuality] = useState<RefQuality>("auto");
  // 输出格式（静图/GIF 动图）；动图时模型下拉只留 2.6 系
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("static");
  // 多模型对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [modelB, setModelB] = useState<string>("gpt-image-2");
  // 对比模式 B 侧节点（null = 跟随当前激活节点,即同节点对比）
  const [nodeBId, setNodeBId] = useState<string | null>(null);

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
    if (settings.refQuality) setRefQuality(settings.refQuality);
    if (settings.defaultOutputFormat) setOutputFormat(settings.defaultOutputFormat);
    // ?prompt=xxx 预填（分享链接 / 自测用）：必须在挂载后读，SSR 首帧保持空串
    const initialPrompt = new URLSearchParams(window.location.search).get("prompt");
    // 分享链接可能超长：按输入上限截断，保证与服务端校验一致
    if (initialPrompt) setPrompt(initialPrompt.slice(0, MAX_PROMPT_CHARS));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // 2.5 API 节点配置（多套配置,当前激活项用于生成;对比模式可选第二节点）
  const { profiles, activeId, optimizeConfig } = useApiConfig();
  const activeNode = profiles.find((p) => p.id === activeId) ?? null;
  const nodeB = compareMode && nodeBId
    ? profiles.find((p) => p.id === nodeBId) ?? null
    : null;

  // 2.6 提示词优化：走独立配置的对话接口（/api/optimize 透传，失败时保留原文）
  //     没配置时才回落到当前节点；画幅与是否带参考图一并交给模型
  const optimizeEndpoint = resolveOptimizeEndpoint(optimizeConfig, profiles, activeId);
  const { optimize: handleOptimizePrompt, loading: optimizeLoading } = usePromptOptimize({
    prompt,
    onPromptChange: setPrompt,
    apiKey: optimizeEndpoint?.apiKey ?? "",
    baseUrl: optimizeEndpoint?.baseUrl ?? "",
    proxyUrl: optimizeEndpoint?.proxyUrl ?? "",
    size: selectedSize,
    hasReference: referenceImages.length > 0,
    optimizeModel: optimizeEndpoint?.optimizeModel ?? "",
  });

  // 3. 数据：跨节点模型目录聚合（模型优先路由的数据源）
  const {
    catalog,
    loading: modelsLoading,
    hasError: catalogHasError,
    reload: reloadCatalog,
  } = useModelCatalog(profiles);

  // 目录 → ModelInfo 形状（supportedSizes 在 UI 无逻辑消费，给默认值）
  const models: ModelInfo[] = useMemo(
    () =>
      catalog.map((e) => ({
        id: e.modelId,
        name: e.name,
        supportedSizes: DEFAULT_SIZES,
      })),
    [catalog]
  );
  // 模型行重试提示（任一节点拉取失败时显示）
  const modelsError = catalogHasError ? "部分节点模型列表获取失败" : null;

  // 节点切换后、新列表返回前，上次选中的模型可能不存在于新节点。
  // 渲染期派生为列表内第一个可用模型，避免拿过期模型名发起生成。
  const effectiveModel = models.some((m) => m.id === selectedModel)
    ? selectedModel
    : models[0]?.id ?? selectedModel;

  // 模型优先路由：选中模型在激活节点缺失时，按目录优先级自动切换到有它的节点。
  // 返回 undefined = 用激活节点（目录缺失/激活节点就有该模型）。
  const routedNode = useMemo(() => {
    const entry = catalog.find((e) => e.modelId === effectiveModel);
    if (!entry) return undefined;
    if (entry.nodes.includes(activeId)) return undefined;
    const nodeId = entry.nodes.find((id) =>
      profiles.some((p) => p.id === id && p.apiKey)
    );
    return nodeId ? profiles.find((p) => p.id === nodeId) : undefined;
  }, [catalog, effectiveModel, activeId, profiles]);

  // 失败时的渠道提示：该模型的其他可用渠道（排除本次失败的）
  const getChannelHint = useCallback(
    (modelId: string, excludeNodeId?: string) => {
      const entry = catalog.find((e) => e.modelId === modelId);
      if (!entry) return null;
      const names = entry.nodes
        .filter((id) => id !== excludeNodeId)
        .map((id) => profiles.find((p) => p.id === id)?.name || id);
      return names.length > 0 ? `其他可用渠道：${names.join("、")}` : null;
    },
    [catalog, profiles]
  );

  // 4. 核心生成流程（任务级状态：并发 + 单张取消）
  const {
    results, loading, error, errorCode, tasks,
    handleGenerate, cancelTask, resumeTask, recoverInFlight, dismissTask, setResults,
  } = useImageGeneration({
    prompt,
    referenceImages,
    model: effectiveModel,
    size: selectedSize,
    quality: selectedQuality,
    n: selectedN,
    compareMode,
    modelB: modelB as ModelInfo["id"],
    refQuality,
    outputFormat,
    overrideNode: routedNode
      ? {
          id: routedNode.id,
          name: routedNode.name,
          baseUrl: routedNode.baseUrl,
          apiKey: routedNode.apiKey,
          proxyUrl: routedNode.proxyUrl,
        }
      : undefined,
    getChannelHint,
    activeNodeId: activeNode?.id,
    activeNodeName: activeNode?.name,
    nodeB: nodeB && nodeB.id !== activeNode?.id ? {
      id: nodeB.id,
      name: nodeB.name,
      baseUrl: nodeB.baseUrl,
      apiKey: nodeB.apiKey,
      proxyUrl: nodeB.proxyUrl,
    } : null,
  });

  // 提示词被上游拒绝（审核/长度）时，给出具体改法；并标明错误来源（本地配置/网络/上游服务）
  const promptFix = suggestPromptFixes(error ?? "");
  const errorOrigin = classifyErrorCode(errorCode);

  // 5. 启动时检测并恢复未完成的任务：凭持久化快照的 taskId 续轮询，
  //    不重新提交（重复提交 = 重复扣费）
  useInFlightRecovery({ onRecover: recoverInFlight });

  // 6. 历史抽屉
  const [showHistory, setShowHistory] = useState(false);

  // 6.0 全屏预览（手机/触屏：点图全屏、可左右滑、Capacitor 内直接存相册）
  //     桌面仍用 ResultGrid 内置的展开预览，不额外套全屏层。
  const isMobile = useIsMobile();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Capacitor 壳内全屏预览显示「保存到相册」（a[download] 无效）；挂载后检测
  const [canSaveToGallery, setCanSaveToGallery] = useState(false);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setCanSaveToGallery(isCapacitor());
  }, []);

  // 6.1 Android 硬件返回键（仅 Capacitor 壳内生效）：
  //     全屏预览 → 历史抽屉 → 退出应用（SPA 无浏览历史可回退）。
  //     状态经 ref 读取、监听器只在挂载时注册一次——
  //     按依赖重挂会在 cleanup 与 await 之间产生竞态、累积监听器（见评审 A-4）。
  const showHistoryRef = useRef(showHistory);
  useEffect(() => {
    showHistoryRef.current = showHistory;
  }, [showHistory]);
  const previewRef = useRef(previewIndex);
  useEffect(() => {
    previewRef.current = previewIndex;
  }, [previewIndex]);

  useEffect(() => {
    if (!isCapacitor()) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const l = await App.addListener("backButton", () => {
          if (previewRef.current !== null) {
            setPreviewIndex(null);
            return;
          }
          if (showHistoryRef.current) {
            setShowHistory(false);
          } else {
            void App.exitApp();
          }
        });
        if (disposed) {
          // 注册完成前组件已卸载：立即移除，避免泄漏
          void l.remove();
        } else {
          listener = l;
        }
      } catch {
        // 原生插件缺失（理论不可达，isCapacitor 已门控）：静默
      }
    })();
    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, []);

  // 7. 从历史记录回填（参考图不再恢复，需用户重新上传）
  const handleSelectRecord = useCallback((record: HistoryRecord) => {
    setPrompt(record.params.prompt);
    setSelectedModel(record.params.model);
    if (record.params.modelB) setModelB(record.params.modelB);
    setSelectedSize(record.params.size || "auto");
    setSelectedQuality((record.params.quality || "1k") as Quality);
    // 历史里的 imageUrl 是上次会话的 blob: URL，跨会话必已失效；
    // 置空让 getImageSrc 走 b64_json 的 data URL 兜底，
    // 否则 <img> 加载失败且无 onError，卡片会渲染成永久透明的空块
    setResults(
      record.results.map((r) => ({
        ...r,
        imageUrl: r.imageUrl?.startsWith("blob:") ? undefined : r.imageUrl,
      }))
    );
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


  /** 从图库移除单张：只影响当前展示，历史记录不动（历史里那条仍可回填） */
  const handleRemoveResult = useCallback((target: GenerateResult) => {
    setResults((prev) => prev.filter((r) => r.id !== target.id));
  }, [setResults]);

  // 当前节点各清晰度档的实测能力（被动学习，见 lib/node-size-capability）。
  // 必须走 state + effect：localStorage 在 SSR 不存在，直接在 render/useMemo 里读会让
  // 服务端（无标记）与客户端首帧（有标记）的选项文案不一致 → hydration mismatch。
  const [sizeCapability, setSizeCapability] = useState<NodeSizeCapability | null>(null);
  const [capVersion, setCapVersion] = useState(0);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setSizeCapability(activeNode?.id ? getNodeSizeCapability(activeNode.id) : null);
  }, [activeNode?.id, results, capVersion]);

  // 探测该节点最高可用档位：二次点击才真跑（最多 3 次生成，会扣费）
  const [probeState, setProbeState] = useState<"idle" | "confirm" | "running">("idle");
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setProbeState("idle");
  }, [activeNode?.id]);
  const handleProbeSize = useCallback(() => {
    if (!activeNode || probeState === "running") return;
    if (probeState === "idle") {
      setProbeState("confirm");
      return;
    }
    setProbeState("running");
    void (async () => {
      const best = await probeMaxTier({
        nodeId: activeNode.id,
        apiKey: activeNode.apiKey,
        baseUrl: activeNode.baseUrl,
        proxyUrl: activeNode.proxyUrl,
        model: effectiveModel,
      });
      setProbeState("idle");
      setCapVersion((v) => v + 1);
      if (best) {
        toast.success(`该节点最高可用 ${best.tier.toUpperCase()}`, {
          description: `实测出图 ${best.width}×${best.height}`
        });
      } else {
        toast.error("三档都没跑通", { description: "该节点可能不可用，或模型不支持" });
      }
    })();
  }, [activeNode, probeState, effectiveModel]);

  return (
    /* ui-instrument：仪器面板视觉层（见 globals.css）。手机与桌面用同一套结构与背景，
       只在触屏上额外挂一层全屏预览。 */
    <div className="ui-instrument flex flex-col h-dvh bg-background">
      <Header onShowHistory={() => setShowHistory(true)} />

      {showHistory && (
        <HistoryDrawer
          onClose={() => setShowHistory(false)}
          onSelectRecord={handleSelectRecord}
        />
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1320px] px-6 lg:px-10 pt-7">
          {/* 一体化控制台：提示词 / 参数 / 生成 三栏 */}
          <div className="animate-fade-up">
            <UnifiedInputCard
              prompt={prompt}
              onPromptChange={setPrompt}
              referenceImages={referenceImages}
              onReferenceImagesChange={setReferenceImages}
              models={models}
              selectedModel={effectiveModel}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              onReloadModels={reloadCatalog}
              onModelChange={setSelectedModel}
              selectedSize={selectedSize}
              onSizeChange={setSelectedSize}
              selectedQuality={selectedQuality}
              onQualityChange={setSelectedQuality}
              selectedN={selectedN}
              onNChange={setSelectedN}
              refQuality={refQuality}
              onRefQualityChange={setRefQuality}
              outputFormat={outputFormat}
              onOutputFormatChange={setOutputFormat}
              compareMode={compareMode}
              onCompareModeChange={setCompareMode}
              modelB={modelB}
              onModelBChange={setModelB}
              profiles={profiles}
              activeNodeId={activeId}
              nodeBId={nodeB?.id ?? null}
              onNodeBChange={setNodeBId}
              tasks={tasks}
              onCancelTask={cancelTask}
              onResumeTask={resumeTask}
              onDismissTask={dismissTask}
              onGenerate={handleGenerate}
              onOptimizePrompt={handleOptimizePrompt}
              optimizeLoading={optimizeLoading}
              sizeCapability={sizeCapability}
              onProbeSize={activeNode ? handleProbeSize : undefined}
              probeState={probeState}
            />
          </div>

          {/* 状态行：本次参数的一次读数，替代原来的大标题副标 */}
          <div className="inst-state animate-fade-up [animation-delay:60ms]">
            <span>模型 <b>{effectiveModel}</b></span>
            <span className="sep" aria-hidden="true" />
            <span>{SIZES.find((s) => s.value === selectedSize)?.label ?? selectedSize}</span>
            <span className="sep" aria-hidden="true" />
            <span>
              {selectedQuality.toUpperCase()}
            </span>
            <span className="sep" aria-hidden="true" />
            <span>{outputFormat === "gif" ? "GIF 动图" : "静图"}</span>
            <span className="sep" aria-hidden="true" />
            <span>{compareMode ? "对比 · 每模型 1 张" : `${selectedN} 张`}</span>
            <span className="sep" aria-hidden="true" />
            <span>节点 {routedNode?.name ?? activeNode?.name ?? "未配置"}</span>
            <span className="ml-auto">提示词 {prompt.length} / {MAX_PROMPT_CHARS}</span>
          </div>
        </div>

        {/* 错误提示（提示词被上游拒绝时，附上具体改法） */}
        {error && (
          <div className="mx-auto w-full max-w-[1320px] px-6 lg:px-10 pt-4">
            <div className="animate-fade-in p-3.5 rounded-[3px] bg-destructive/8 border border-destructive/35 text-destructive text-sm">
              {errorOrigin && (
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-[2px] bg-destructive/12 px-2 py-0.5 text-xs font-medium">
                    来源：{errorOrigin.label}
                  </span>
                  <span className="text-xs text-destructive/80">{errorOrigin.advice}</span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <span className="font-medium shrink-0">提示：</span>
                <span>{error}</span>
              </div>
              {promptFix && (
                <div className="mt-2 pl-6 text-xs text-destructive/85">
                  <p className="font-medium">{promptFix.title}，可以这样改：</p>
                  <ul className="mt-1 space-y-0.5">
                    {promptFix.tips.map((tip) => (
                      <li key={tip}>· {tip}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 输出图库：直接铺在面板底色上，图自己带画框 */}
        <div className="mx-auto w-full max-w-[1320px] px-6 lg:px-10 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <div className="animate-fade-up [animation-delay:120ms]">
            <ResultGrid
              results={results}
              hasRunning={loading}
              // 触屏：点图走全屏预览（可左右滑、Capacitor 内直接存相册）
              onPreviewRequest={isMobile ? setPreviewIndex : undefined}
              onRemove={handleRemoveResult}
            />
          </div>
        </div>
      </main>

      {/* 全屏预览层：只在触屏点图后挂载 */}
      {isMobile && previewIndex !== null && results[previewIndex] && (
        <FullscreenPreview
          results={results}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          appMode={canSaveToGallery}
        />
      )}
    </div>
  );
}