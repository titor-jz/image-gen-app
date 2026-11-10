"use client";

/**
 * useImageGeneration - 核心生成流程 Hook（任务级状态模型）
 *
 * 每张图 = 一个独立 GenTask，独立 AbortController/进度/取消。
 *  - handleGenerate: 批次级 claimInFlight → 创建 N 个 submitting 任务
 *    → await Promise.allSettled(runTask×N) → 汇总 results、历史入库
 *  - runTask: 上游提交/指数退避轮询，单任务自决终态（**不做结果缓存**，见 runTask 顶部）
 *  - cancelTask(id): abort 单个任务，不影响其他
 *  - results 跨批次累积；loading 由 tasks 派生
 *
 * 跨批次并发：handleGenerate 是 async，UI 不 await，故多次点击重叠并发。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildApiHeaders } from "@/lib/api-headers";
import { getNodeCapability, setNodeCapability } from "@/lib/node-capability";
import { useApiConfig } from "@/lib/api-config-context";
import { saveSettings } from "@/lib/user-settings";
import { buildCacheKey } from "@/lib/cache-key";

import { imageDimsFromB64 } from "@/lib/image-dims";
import { pixelSizeFor } from "@/lib/size-map";
import { recordSizeOutcome, type SizeTier } from "@/lib/node-size-capability";
import {
  addHistory,
  claimInFlight,
  releaseInFlight,
  updateInFlightStatus,
  updateInFlightTasks,
  type InFlightEntry,
  type InFlightTaskSnapshot,
} from "@/lib/db";
import {
  getErrorMessage,
  parseErrorResponse,
  type ErrorCode,
} from "@/lib/error-messages";
import type {
  AspectRatio,
  GenerateResult,
  GenTask,
  HistoryRecord,
  ModelId,
  OutputFormat,
} from "@/lib/types";
import type { Quality, ReferenceImage } from "@/components/UnifiedInputCard";


const POLL_BASE_MS = 1000;
const POLL_MAX_MS = 10 * 1000;
/** 单轮轮询窗口。4K/高质量图常需 3 分钟以上，超时后可点「继续等待」再续一轮 */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
/** 轮询连续失败容忍次数（网络抖动/serverless 冷启动 5xx 不应判死任务） */
const MAX_POLL_FAILURES = 3;
/** 终态任务在进度列表中保留展示的时长，过后淡出移除 */
const TERMINAL_FADE_MS = 1500;

export interface UseImageGenerationOptions {
  prompt: string;
  referenceImages: ReferenceImage[];
  model: ModelId;
  size: AspectRatio;
  quality: Quality;
  /** 单次点击并发生成的图片数量（1~4），由 UI 数量选择器驱动 */
  n: 1 | 2 | 3 | 4;
  /** 对比模式开关:开启时用 model + modelB 各出1张 */
  compareMode?: boolean;
  /** 对比模式下的第二个模型(compareMode=true 时生效) */
  modelB?: ModelId;
  /** 当前激活节点的 id 与名称（用于判定对比是否跨节点、结果标注） */
  activeNodeId?: string;
  activeNodeName?: string;
  /**
   * 对比模式的 B 侧节点。缺省或与激活节点相同时，行为退化为同节点双模型对比。
   * 不同时，任务 B 用该节点的 Key/URL 提交与轮询（模型 B 应存在于该节点）。
   */
  nodeB?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    proxyUrl: string;
  } | null;
  /** 参考图清晰度模式（生成时持久化到用户设置） */
  refQuality?: "auto" | "hd" | "original";
  /** 输出格式（static=静图 / gif=动图）；gif 时服务端会在提示词前注入动图指令 */
  outputFormat?: OutputFormat;
  /** 模型优先路由：目录解析出的节点（选中模型在激活节点缺失时由页面传入）。
   *  提供时 nodeA 整体替换为该节点（含 Key），能力记忆/缓存/结果标注随之跟随 */
  overrideNode?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    proxyUrl: string;
  };

  /** 生成失败时的渠道提示：返回该模型的其他可用渠道描述（拼接进失败信息） */
  getChannelHint?: (modelId: string, excludeNodeId?: string) => string | null;
}

export interface UseImageGenerationResult {
  /** 图库数据源，跨批次累积（仅历史回填整体替换） */
  results: GenerateResult[];
  /** 是否有任务进行中（由 tasks 派生，非独立 state） */
  loading: boolean;
  /** 错误文案（前置校验 + 任务失败都写这里，保证移动端也能看到） */
  error: string | null;
  /** 与 error 同步的错误码，用于区分"本地配置 / 网络 / 上游服务" */
  errorCode: ErrorCode | null;
  /** 全部会话任务（进行中 + 终态淡出期内） */
  tasks: GenTask[];
  handleGenerate: () => Promise<void>;
  /** 取消单个任务（abort 其 AbortController） */
  cancelTask: (id: string) => void;
  /** 超时任务续一轮轮询（保留的 taskId 仍可能返回结果） */
  resumeTask: (id: string) => void;
  /**
   * 跨会话恢复：把上一会话未完成批次（页面被杀）凭持久化快照复活，
   * 只续轮询、绝不重新提交（防重复扣费）。返回实际恢复的任务数。
   */
  recoverInFlight: (entries: InFlightEntry[]) => number;
  /** 从任务列表移除一条（仅用于超时/终态残留） */
  dismissTask: (id: string) => void;
  setResults: React.Dispatch<React.SetStateAction<GenerateResult[]>>;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 解析提示词中的参考图引用
 * 优先级：
 *  1. "图1/图2" 序号引用（序号唯一，不会被文件名重名/互为前缀干扰）
 *  2. "@名称" 显式引用（兼容 2026-11-10 之前插入文件名的老提示词）
 *  3. 都没有 → 全部参考图
 */
function resolveReferencedImages(
  prompt: string,
  referenceImages: ReferenceImage[]
): ReferenceImage[] {
  // 1. 序号引用优先。@ 现在插入的就是「图N」，且老提示词里的「图N」也走这条；
  //    放在名字匹配之前，否则混用时 @图N 会被「@文件名」分支整段忽略
  const imgPattern = /图(\d+)/g;
  const matches = [...prompt.matchAll(imgPattern)];
  if (matches.length > 0) {
    const order = [...matches]
      .map((m) => parseInt(m[1], 10) - 1)
      .filter((i) => i >= 0 && i < referenceImages.length);
    const unique = [...new Set(order)].map((i) => referenceImages[i]);
    if (unique.length > 0) return unique;
  }

  // 2. 老提示词的 @文件名：要求 @ 后面是**完整名字且有边界**，
  //    否则「@产品图.png」会把「产品图2.png」也算命中
  const mentionImgs = referenceImages.filter((img) =>
    new RegExp(`@${escapeRegExp(img.name)}(?![\\w.\\u4e00-\\u9fa5])`).test(prompt)
  );
  if (mentionImgs.length > 0) return mentionImgs;

  // 3. 全部参考图
  return [...referenceImages];
}

/** 正则转义：文件名会直接拼进 RegExp */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 指数退避 sleep，支持 AbortController 立即中断
 */
function backoffSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * API 错误异常 - 携带 error code 用于 i18n 消费
 */
class ApiError extends Error {
  code: ErrorCode;
  details?: string;
  constructor(code: ErrorCode, details?: string) {
    super(getErrorMessage(code, details));
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/**
 * 解析 fetch 错误响应 → ApiError
 */
async function toApiError(
  response: Response,
  defaultCode: ErrorCode
): Promise<ApiError> {
  try {
    const json = await response.json();
    const { code, details } = parseErrorResponse(json);
    return new ApiError(code, details);
  } catch {
    return new ApiError(defaultCode, `HTTP ${response.status}`);
  }
}

export function useImageGeneration(
  options: UseImageGenerationOptions
): UseImageGenerationResult {
  const {
    prompt, referenceImages, model, size, quality, n, compareMode, modelB,
    activeNodeId, activeNodeName, nodeB, refQuality, outputFormat,
    overrideNode, getChannelHint,
  } = options;

  // API 鉴权配置（响应式）：修改后下次 handleGenerate 自动使用最新值
  const { apiKey: apiKeyFromCtx, baseUrl, proxyUrl } = useApiConfig();
  const apiKeyRef = useRef(apiKeyFromCtx);
  useEffect(() => {
    apiKeyRef.current = apiKeyFromCtx;
  }, [apiKeyFromCtx]);

  const [tasks, setTasks] = useState<GenTask[]>([]);
  /** 本批次是否已就「上游没按请求尺寸出图」告警过（避免 N 张图刷 N 条） */
  const sizeWarnedRef = useRef(false);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 错误来源用的错误码（与 error 同步设置；null = 无错误） */
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);

  // 每个任务一个 AbortController，支持单张级取消
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());

  // 跟踪最新 results，供卸载时释放。
  // 卸载 effect 依赖数组为 []，若直接闭包捕获 results 会拿到首次渲染的空数组，
  // 导致卸载时什么都没释放；用 ref 同步最新值可规避该陈旧闭包问题。
  // 注意：ref.current 不能在 render 阶段赋值（react-hooks/refs），故用 effect 同步。
  const resultsRef = useRef<GenerateResult[]>([]);
  useEffect(() => {
    resultsRef.current = results;
  });

  // 最新任务列表（resumeTask/dismissTask 由事件触发，需读取当前值）
  const tasksRef = useRef<GenTask[]>([]);
  useEffect(() => {
    tasksRef.current = tasks;
  });

  // loading 派生：只要有非终态任务即为 true
  const loading = useMemo(
    () =>
      tasks.some((t) => t.status === "submitting" || t.status === "polling"),
    [tasks]
  );

  /** 更新指定任务（按 id 合并 patch） */
  const updateTask = useCallback((id: string, patch: Partial<GenTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  /** 标记终态并安排淡出移除（仅 UI 层，results 不受影响） */
  const markTerminal = useCallback((id: string, patch: Partial<GenTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }, TERMINAL_FADE_MS);
  }, []);

  /** 取消单个任务：abort 其 controller，runTask 会 catch 并标记 cancelled */
  const cancelTask = useCallback((id: string) => {
    abortMapRef.current.get(id)?.abort();
  }, []);

  /** 从任务列表移除一条（超时残留的清理，不做任何网络操作） */
  const dismissTask = useCallback((id: string) => {
    abortMapRef.current.get(id)?.abort();
    abortMapRef.current.delete(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * 按任务快照执行一轮完整轮询直到终态（resumeTask 与跨会话恢复共用）。
   * 节点配置取自任务快照（跨节点对比时各任务节点不同）。
   */
  const pollToCompletion = useCallback((task: GenTask) => {
    const id = task.id;
    const taskNode = task.node;
    const controller = new AbortController();
    abortMapRef.current.set(id, controller);

    void (async () => {
      try {
        const headers = buildApiHeaders({
          apiKey: taskNode?.apiKey ?? apiKeyRef.current,
          baseUrl: taskNode?.baseUrl ?? baseUrl,
          proxyUrl: taskNode?.proxyUrl ?? proxyUrl,
        });
        const pollResult = await pollTaskResult(
          task.taskId as string,
          headers,
          controller.signal,
          (p, elapsed) => updateTask(id, { progress: p, elapsedSec: elapsed })
        );
        const result: GenerateResult = {
          id: `gen-${Date.now()}-${task.slot}`,
          b64_json: pollResult.b64,
          imageUrl: pollResult.imageUrl,
          mime: pollResult.mime,
          prompt: task.prompt,
          model: task.model,
          nodeName: taskNode?.name,
          size: task.size as AspectRatio,
          compareGroup: task.compareGroup,
          createdAt: Date.now(),
        };
        markTerminal(id, { status: "success", result, progress: 1 });
        setResults((prev) => [...prev, result]);
        // 恢复出来的任务只补历史（没有结果缓存这回事，见 runTask 顶部说明）
        addHistory({
          id: genId("hist"),
          params: {
            prompt: task.prompt,
            model: task.model,
            size: task.size as AspectRatio,
            quality: task.quality as Quality,
            n: 1,
          },
          results: [{ ...result, imageUrl: undefined }],
          createdAt: Date.now(),
        }).catch(() => {});
      } catch (err) {
        const isAbort =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (isAbort) {
          markTerminal(id, { status: "cancelled" });
        } else if (err instanceof ApiError && err.code === "TASK_TIMEOUT") {
          // 又超时：保留任务行，可再次继续等待
          updateTask(id, { status: "timeout", error: err.message });
          toast.info("上游仍在生成，可稍后再次「继续等待」");
        } else {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
              ? err.message
              : getErrorMessage("UNKNOWN");
          markTerminal(id, { status: "failed", error: msg });
          // 同时写入全局错误：移动端底部坞 / 桌面横幅会常驻显示，
          // 提示词被审核拒绝时还能附上具体改法（toast 几秒就消失）
          setError(msg);
          setErrorCode(err instanceof ApiError ? err.code : "UNKNOWN");
          toast.error("生成失败", { description: msg });
        }
      } finally {
        abortMapRef.current.delete(id);
      }
    })();
  }, [baseUrl, proxyUrl, updateTask, markTerminal]);

  /**
   * 超时任务续一轮轮询：上游任务可能已经完成，用保留的 taskId 再查一轮。
   */
  const resumeTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task?.taskId) return;
    updateTask(id, { status: "polling", progress: 0, elapsedSec: 0, error: undefined });
    pollToCompletion(task);
  }, [updateTask, pollToCompletion]);

  /**
   * 跨会话恢复：页面被杀后，凭 in-flight 快照里持久化的 taskId 续轮询。
   * 只查结果，不重新提交（重复提交 = 重复扣费）。
   * 恢复即释放占位：后续生死由任务行接管（超时可「继续等待」）。
   */
  const recoverInFlight = useCallback((entries: InFlightEntry[]): number => {
    const revived: GenTask[] = [];
    const releasedIds: string[] = [];
    for (const entry of entries) {
      const snaps = (entry.tasks ?? []).filter((s) => s.taskId);
      if (snaps.length === 0) continue;
      for (const snap of snaps) {
        const task: GenTask = {
          id: snap.id,
          batchId: snap.batchId,
          slot: snap.slot,
          prompt: snap.prompt,
          model: snap.model,
          size: snap.size,
          quality: snap.quality,
          status: "polling",
          progress: 0,
          elapsedSec: 0,
          taskId: snap.taskId,
          compareGroup: snap.compareGroup,
          node: snap.node,
          createdAt: Date.now(),
        };
        revived.push(task);
        pollToCompletion(task);
      }
      releasedIds.push(entry.id);
    }
    if (revived.length > 0) {
      setTasks((prev) => [...prev, ...revived]);
      for (const id of releasedIds) {
        releaseInFlight(id).catch(() => {});
      }
    }
    return revived.length;
  }, [pollToCompletion]);

  const handleGenerate = useCallback(async () => {
    const apiKey = apiKeyRef.current;
    if (!prompt.trim()) {
      setError(getErrorMessage("REQ_MISSING_PROMPT"));
      setErrorCode("REQ_MISSING_PROMPT");
      return;
    }
    if (!apiKey) {
      const msg = getErrorMessage("AUTH_MISSING_KEY");
      setError(msg);
      setErrorCode("AUTH_MISSING_KEY");
      toast.error(msg);
      return;
    }
    setError(null);
    setErrorCode(null);

    const referencedImages = resolveReferencedImages(prompt, referenceImages);
    const trimmedPrompt = prompt.trim();
    const batchId = genId("batch");

    // 节点快照：A 侧 = 当前激活节点（提交时定格）；B 侧 = nodeB
    // 模型优先路由：页面传入的 overrideNode（目录解析出的节点）优先于激活节点——
    // 其余下游（能力记忆 key、缓存 key、结果 nodeName 标注、in-flight 快照）全部自动跟随
    const nodeA = overrideNode ?? {
      id: activeNodeId || "active",
      name: activeNodeName || "当前节点",
      baseUrl,
      apiKey,
      proxyUrl,
    };
    // 对比模式跨节点：B 侧选择了不同节点（同模型跨线路对比也成立）
    const crossNode = !!nodeB && nodeB.id !== (activeNodeId ?? "");
    // 对比模式:2 个任务各用不同模型/节点,共享 batchId + compareGroup
    const isCompare =
      compareMode && ((!!modelB && modelB !== model) || crossNode);
    const compareGroup = isCompare ? batchId : undefined;
    // 对比模式固定 2 任务(每侧1张),非对比走原 n
    const taskCount = isCompare ? 2 : n;

    const nodeForTask = (i: number) =>
      isCompare && i === 1 && crossNode && nodeB ? nodeB : nodeA;

    // cacheKey 按「节点+模型」维度:对比模式两个任务各自独立 key，
    // 同提示词同模型在不同节点间也不共享缓存
    const buildKeyForModel = async (m: string, nodeKey: string) =>
      buildCacheKey({
        prompt: trimmedPrompt,
        model: m,
        size,
        quality,
        nodeKey,
        referenceImages: referencedImages,
      });

    // 批次级 cacheKey（不含 n，每个任务恒 n=1）
    // 单模型即本批所有任务的 key;对比模式以 A 侧的 key 代表本批次做 in-flight claim
    const cacheKey = await buildKeyForModel(model, nodeA.baseUrl);

    // 批次级 in-flight 抢占：跨批次同参数去重（AC5）
    const claim = await claimInFlight(cacheKey, trimmedPrompt.slice(0, 60));
    if (claim.result === "busy") {
      const ageSec = Math.max(
        1,
        Math.round((Date.now() - claim.existing.startedAt) / 1000)
      );
      toast.warning(getErrorMessage("CLIENT_INFLIGHT"), {
        description: `${ageSec}s 前已发起相同任务，请等待完成`,
      });
      // 创建 taskCount 个 cancelled 任务作为 UI 反馈（不发上游）
      // 对比模式:任务0用 model,任务1用 modelB;非对比:全部用 model
      const cancelledTasks: GenTask[] = Array.from({ length: taskCount }, (_, i) => ({
        id: genId("task"),
        batchId,
        slot: i,
        prompt: trimmedPrompt,
        model: isCompare ? (i === 0 ? model : (modelB as string)) : model,
        size,
        quality,
        status: "cancelled" as const,
        progress: 0,
        elapsedSec: 0,
        createdAt: Date.now(),
        compareGroup,
      }));
      setTasks((prev) => [...prev, ...cancelledTasks]);
      cancelledTasks.forEach((t) => {
        setTimeout(
          () => setTasks((prev) => prev.filter((x) => x.id !== t.id)),
          TERMINAL_FADE_MS
        );
      });
      return;
    }
    const inFlightId = claim.entry.id;

    // 从抢占成功到释放之间的任何抛错都必须释放占位，
    // 否则同参数请求会被锁满 maxAge（5 分钟）
    try {
      // 解码参考图一次，N 个任务共享
      const refBlobs: Blob[] = [];
      for (const img of referencedImages) {
        const r = await fetch(img.base64);
        refBlobs.push(await r.blob());
      }

      // 创建 taskCount 个 submitting 任务
      // 对比模式:任务0用 model+节点A,任务1用 modelB+节点B;非对比:全部用当前配置
      const newTasks: GenTask[] = Array.from({ length: taskCount }, (_, i) => ({
        id: genId("task"),
        batchId,
        slot: i,
        prompt: trimmedPrompt,
        model: isCompare ? (i === 0 ? model : (modelB as string)) : model,
        size,
        quality,
        status: "submitting" as const,
        progress: 0,
        elapsedSec: 0,
        createdAt: Date.now(),
        compareGroup,
        node: nodeForTask(i),
      }));
      setTasks((prev) => [...prev, ...newTasks]);

      // 批次任务快照入库：跨会话恢复的数据源。
      // 提交成功拿到上游 taskId 时就地更新对应项（见 runTask 异步分支）。
      const taskSnapshots: InFlightTaskSnapshot[] = newTasks.map((t) => ({
        id: t.id,
        batchId: t.batchId,
        slot: t.slot,
        prompt: t.prompt,
        model: t.model,
        size: t.size,
        quality: t.quality,
        compareGroup: t.compareGroup,
        node: t.node,
      }));
      updateInFlightTasks(inFlightId, taskSnapshots).catch(() => {});

      // 本批成功结果（闭包收集，allSettled 后无需读过期 state）
      const completed: GenerateResult[] = [];

      /**
       * 单任务流程：POST + 轮询 → success/failed/cancelled（无结果缓存，每次都会真的请求上游）。
       * 内部全 catch，不向上 throw（allSettled 仅用于等待，状态已在内部更新）。
       */
      const runTask = async (task: GenTask): Promise<void> => {
        const taskNode = task.node ?? nodeA;
        // 这里**不做结果缓存**：以前相同提示词 60 秒内再点「生成」会直接复用旧图，
        // 用户想重新出图却拿到同一张（且误以为是没生成）。防重复提交由批次级
        // in-flight 抢占负责（见上方 claimInFlight），不会重复扣费。

        // 1. 独立 AbortController
        const controller = new AbortController();
        abortMapRef.current.set(task.id, controller);

        // 节点异步能力记忆：已知同步型（无端点/假异步）的节点跳过 async 探测，
        // 服务端直接走同步流式保活；无记忆或已过期则让服务端探测并回写
        const nodeKey = taskNode.id;
        const capability = getNodeCapability(nodeKey);
        const startedAt = Date.now();

        try {
          // 每任务用自己节点的鉴权配置（跨节点对比时两任务走不同线路）
          const headers = buildApiHeaders({
            apiKey: taskNode.apiKey,
            baseUrl: taskNode.baseUrl,
            proxyUrl: taskNode.proxyUrl,
          });
          const formData = new FormData();
          formData.append("prompt", trimmedPrompt);
          // 对比模式任务1 用 modelB;用 task.model 而非闭包 model,单模型时两者相等
          formData.append("model", task.model);
          formData.append("size", size);
          formData.append("quality", quality);
          // 节点记忆为同步型时告诉服务端跳过 async 探测（省往返 + 免假异步挂死）
          if (capability && !capability.asyncCapable) {
            formData.append("asyncMode", "skip");
          }
          // 输出格式：gif 时服务端注入动图指令（gpt-image 2.6 的动图由提示词驱动）
          formData.append("format", outputFormat ?? "static");
          // 上游 gpt-image-2 仅支持 n=1，单任务永远 n=1；多张靠前端并发
          formData.append("n", "1");
          for (const blob of refBlobs) {
            formData.append("images", blob, `input_${task.slot}.png`);
          }

          const response = await fetch("/api/generate", {
            method: "POST",
            headers,
            body: formData,
            signal: controller.signal,
          });
          if (!response.ok) {
            throw await toApiError(response, "GEN_UPSTREAM_FAILED");
          }

          const contentType = response.headers.get("content-type") || "";
          let data: {
            task_id?: string;
            images?: Array<{ b64_json: string; mime: string }>;
            error?: string;
          };
          if (contentType.includes("application/x-ndjson")) {
            // 同步回退分支的流式响应：心跳行保活（忽略），最后一行 result/error 是有效载荷。
            // 心跳让手机网络不会掐断 40s+ 的长请求（实测 failed to fetch 但上游已扣费的根因）
            const reader = response.body!.getReader();
            const dec = new TextDecoder();
            let buf = "";
            let result: { images?: Array<{ b64_json: string; mime: string }> } | null = null;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                const msg = JSON.parse(line) as {
                  type: string;
                  images?: Array<{ b64_json: string; mime: string }>;
                  error?: string;
                };
                if (msg.type === "heartbeat") continue;
                if (msg.type === "result") {
                  result = msg;
                  continue;
                }
                if (msg.type === "error") {
                  // error 字段是 errorResponse 的 body（JSON 字符串），解析出稳定 code + 文案；
                  // code 来自自家 errorResponse，必然是合法 ErrorCode
                  let code: ErrorCode = "GEN_UPSTREAM_FAILED";
                  let message = msg.error ?? "上游生成失败";
                  try {
                    const parsed = JSON.parse(msg.error ?? "");
                    code = (parsed.error?.code ?? code) as ErrorCode;
                    message = parsed.error?.message ?? message;
                  } catch {
                    // body 非 JSON 时按原文展示
                  }
                  throw new ApiError(code, message);
                }
              }
            }
            if (!result) {
              throw new ApiError("GEN_UPSTREAM_BAD_RESPONSE", "流式响应缺少结果");
            }
            data = result;
          } else if (contentType.includes("application/json")) {
            data = await response.json();
          } else {
            const text = await response.text();
            throw new ApiError("GEN_UPSTREAM_BAD_RESPONSE", text.slice(0, 200));
          }

          // 回写节点异步能力记忆：
          //  - task_id 在 15s 内返回 = 真异步；超 15s 才回 = 假异步，记为同步型
          //  - 走了流式同步分支（data 无 task_id）= 无可用异步端点，记为同步型
          //  - 已记忆为同步型时不再回写（skip 生效，本次结果不构成新证据）
          const elapsedSec = (Date.now() - startedAt) / 1000;
          if (!capability || capability.asyncCapable) {
            setNodeCapability(nodeKey, Boolean(data.task_id) && elapsedSec < 15);
          }

          let result: GenerateResult;

          // 异步分支：提交成功 → 轮询
          if (data.task_id) {
            updateTask(task.id, { status: "polling", taskId: data.task_id });
            await updateInFlightStatus(inFlightId, { status: "polling" });
            // 快照补记 taskId：页面被杀后恢复轮询的依据
            const snap = taskSnapshots.find((s) => s.id === task.id);
            if (snap) {
              snap.taskId = data.task_id;
              updateInFlightTasks(inFlightId, taskSnapshots).catch(() => {});
            }
            const pollResult = await pollTaskResult(
              data.task_id,
              headers,
              controller.signal,
              (p, elapsed) => {
                updateTask(task.id, { progress: p, elapsedSec: elapsed });
              }
            );
          result = {
            id: `gen-${Date.now()}-${task.slot}`,
            b64_json: pollResult.b64,
            imageUrl: pollResult.imageUrl,
            mime: pollResult.mime,
            prompt: trimmedPrompt,
            model: task.model,
            nodeName: taskNode.name,
            size,
            compareGroup,
            createdAt: Date.now(),
          };
        } else if (data.images?.length) {
          // 同步分支：直接返回 base64 图片（转 blob: URL）
          const img = data.images[0];
          const blob = await base64ToBlob(img.b64_json, img.mime);
          result = {
            id: `gen-${Date.now()}-${task.slot}`,
            b64_json: img.b64_json,
            imageUrl: URL.createObjectURL(blob),
            mime: img.mime,
            prompt: trimmedPrompt,
            model: task.model,
            nodeName: taskNode.name,
            size,
            compareGroup,
            createdAt: Date.now(),
          };
          } else {
            throw new ApiError("GEN_UPSTREAM_NO_TASK_ID");
          }


          // 记录上游「实际」像素：中转/Key 不支持高分辨率档时会悄悄给个小图，
          // 结果里只有请求的画幅比例，不测真实尺寸就会拿 1K 冒充 4K。
          // 顺带把「该节点该档到底行不行」学下来（用户有多个 key，能力并不一致）
          {
            const dims = await imageDimsFromB64(result.b64_json, result.mime);
            if (dims) {
              result = { ...result, actualWidth: dims.width, actualHeight: dims.height };
              const want = pixelSizeFor(size, quality);
              const shrunk =
                want &&
                (dims.width < want.width * 0.9 || dims.height < want.height * 0.9);
              // 被动学习：成功=该档可用；明显缩水=该档基本不可用
              recordSizeOutcome(
                nodeKey,
                quality as SizeTier,
                shrunk ? "degraded" : "supported",
                dims
              );
              if (shrunk && !sizeWarnedRef.current) {
                sizeWarnedRef.current = true;
                toast.warning("上游没按请求尺寸出图", {
                  description: `请求 ${want.width}×${want.height}，实际返回 ${dims.width}×${dims.height}。该节点/Key 可能不支持这一档，可降到更低档再试`,
                });
              }
            }
          }

          completed.push(result);
          markTerminal(task.id, { status: "success", result, progress: 1 });
          setResults((prev) => [...prev, result]);
        } catch (err) {
          const isAbort =
            (err instanceof DOMException && err.name === "AbortError") ||
            (err instanceof Error && err.name === "AbortError");
          if (isAbort) {
            markTerminal(task.id, { status: "cancelled" });
          } else if (err instanceof ApiError && err.code === "TASK_TIMEOUT") {
            // 超时不判死：上游可能仍在生成，保留任务行（含 taskId）供「继续等待」
            updateTask(task.id, { status: "timeout", error: err.message });
            toast.info(`第 ${task.slot + 1} 张仍在生成中`, {
              description: "可点击「继续等待」找回结果",
            });
          } else {
            const msg =
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                ? err.message
                : getErrorMessage("UNKNOWN");
            // 尺寸档被上游拒绝：把「该节点该档不可用」学下来，下次在质量选择器旁提示
            if (/画幅档位|unsupported.*size|invalid.*size|size.*not supported/i.test(msg)) {
              recordSizeOutcome(nodeKey, quality as SizeTier, "unsupported");
            }
            // 模型优先路由的配套提示：该模型在其他渠道还可用时，告知用户可手动切换
            const hint = getChannelHint?.(task.model, taskNode.id) ?? null;
            const fullMsg = hint ? `${msg}（${hint}）` : msg;
            markTerminal(task.id, { status: "failed", error: fullMsg });
            // 同上：让失败原因常驻在主界面（审核/长度限制时附改法）
            setError(fullMsg);
            setErrorCode(err instanceof ApiError ? err.code : "UNKNOWN");
            toast.error(`第 ${task.slot + 1} 张生成失败`, { description: fullMsg });
          }
        } finally {
          abortMapRef.current.delete(task.id);
        }
      };

      // 2. 并发执行本批 N 个任务（await 本批，不阻塞 UI/其他批次）
      await Promise.allSettled(newTasks.map((t) => runTask(t)));

      // 3. 汇总：历史入库（不再写结果缓存，见 runTask 顶部说明）
      const batchResults = completed;
      if (batchResults.length > 0) {
        const record: HistoryRecord = {
          id: genId("hist"),
          params: {
            prompt: trimmedPrompt,
            model,
            size,
            quality,
            n,
            modelB: isCompare ? modelB : undefined,
            nodeBName: isCompare && crossNode ? nodeB?.name : undefined,
          },
          // 入库前剥掉内存态的 blob: URL —— 跨会话后必然失效，
          // 历史回填时由 b64_json 重建，避免裂图
          results: batchResults.map((r) => ({ ...r, imageUrl: undefined })),
          createdAt: Date.now(),
        };
        // 写失败必须让用户知道：历史里存的是全尺寸图，配额满时写入会失败，
        // 以前静默吞掉，表现为「刚生成的这张不在历史里」
        addHistory(record).catch((err) => {
          console.warn("[history] 写入失败:", err);
          toast.error(getErrorMessage("HISTORY_WRITE_FAILED"), {
            description: "浏览器存储空间不足时会出现；淘汰旧记录后会自动重试",
          });
        });
        saveSettings({
          defaultModel: model,
          defaultSize: size,
          defaultQuality: quality,
          defaultN: n,
          refQuality,
          defaultOutputFormat: outputFormat ?? "static",
        });
      }
    } finally {
      releaseInFlight(inFlightId).catch(() => {});
    }
  }, [
    prompt,
    referenceImages,
    model,
    size,
    quality,
    n,
    compareMode,
    modelB,
    activeNodeId,
    activeNodeName,
    nodeB,
    refQuality,
    outputFormat,
    overrideNode,
    getChannelHint,
    baseUrl,
    proxyUrl,
    updateTask,
    markTerminal,
  ]);

  // 释放所有 blob: URL（在 results 替换/清空前）
  const revokeAllBlobUrls = (list: GenerateResult[]) => {
    list.forEach((r) => {
      if (r.imageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(r.imageUrl);
      }
    });
  };

  // 组件卸载时：abort 所有进行中任务 + 释放当前 blob URL，避免内存泄漏与卸载后状态更新
  useEffect(() => {
    return () => {
      // cleanup 需读取"卸载那一刻"的最新 abort map 与 results，
      // 这正是 ref 作为可变容器的合法用途，无法在挂载时拷贝，故直接读 ref.current
      /* eslint-disable react-hooks/exhaustive-deps */
      abortMapRef.current.forEach((c) => c.abort());
      abortMapRef.current.clear();
      revokeAllBlobUrls(resultsRef.current);
      /* eslint-enable react-hooks/exhaustive-deps */
    };
  }, []);

  return {
    results,
    loading,
    error,
    /** 错误来源分类用（与 error 同步） */
    errorCode,
    tasks,
    handleGenerate,
    cancelTask,
    resumeTask,
    recoverInFlight,
    dismissTask,
    setResults: revokeAwareSetResults(revokeAllBlobUrls, setResults),
  };
}

/**
 * 包装 setResults：在替换/清空 results 时，释放旧数据中的 blob: URL
 */
function revokeAwareSetResults(
  revoke: (list: GenerateResult[]) => void,
  setResults: React.Dispatch<React.SetStateAction<GenerateResult[]>>
): React.Dispatch<React.SetStateAction<GenerateResult[]>> {
  return (updater) => {
    setResults((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next !== prev) {
        // diff 式释放：仅释放 prev 中已不在 next 的项。
        //  - 追加场景（next = [...prev, result]）：prev 的项都还在 next，不释放，避免误删旧 blob URL 导致裂图
        //  - 替换场景（历史回填/清空）：prev 的项都不在 next，全部释放
        const nextSet = new Set(next);
        revoke(prev.filter((r) => !nextSet.has(r)));
      }
      return next;
    });
  };
}

interface PollResult {
  imageUrl: string;
  b64: string;
  mime: string;
}

/**
 * 轮询任务直到完成 / 失败 / 超时 / 取消
 * - 使用指数退避：1s → 2s → 4s → 8s → 10s（上限）
 * - onProgress(0~1, 已等待秒数) 实时反馈 UI
 * - 支持 AbortSignal 立即中断
 */
async function pollTaskResult(
  taskId: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress: (progress: number, elapsedSec: number) => void
): Promise<PollResult> {
  const startTime = Date.now();
  let nextDelay = POLL_BASE_MS;
  let consecutiveFailures = 0;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= POLL_TIMEOUT_MS) {
      throw new ApiError("TASK_TIMEOUT");
    }

    await backoffSleep(nextDelay, signal);

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    onProgress(elapsed / POLL_TIMEOUT_MS, elapsedSec);

    // 轮询失败容忍：网络抖动 / serverless 冷启动导致的一次性 5xx
    // 不应判死上游仍在正常执行的任务，重试直到连续 MAX_POLL_FAILURES 次
    let taskData: {
      status: string;
      image_url?: string;
      mime?: string;
      fail_reason?: string;
    };
    try {
      const taskResponse = await fetch(`/api/task/${taskId}`, {
        headers,
        signal,
      });
      if (!taskResponse.ok) {
        throw await toApiError(taskResponse, "TASK_POLL_FAILED");
      }
      taskData = await taskResponse.json();
      consecutiveFailures = 0;
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof ApiError && err.code === "TASK_FAILED") throw err;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_POLL_FAILURES) {
        throw err instanceof ApiError
          ? err
          : new ApiError("TASK_POLL_FAILED", err instanceof Error ? err.message : undefined);
      }
      nextDelay = Math.min(nextDelay * 2, POLL_MAX_MS);
      continue;
    }

    if (taskData.status === "SUCCESS") {
      if (!taskData.image_url) {
        throw new ApiError("TASK_NO_IMAGE_URL");
      }
      const imgRes = await fetch(taskData.image_url, { headers, signal });
      if (!imgRes.ok) {
        throw await toApiError(imgRes, "TASK_DOWNLOAD_FAILED");
      }
      const mime =
        imgRes.headers.get("content-type") || taskData.mime || "image/png";
      const blob = await imgRes.blob();
      const imageUrl = URL.createObjectURL(blob);
      const arrayBuf = await blob.arrayBuffer();
      const b64 = arrayBufferToBase64(arrayBuf);
      return { imageUrl, b64, mime };
    }
    if (taskData.status === "FAILURE" || taskData.status === "FAILED") {
      throw new ApiError("TASK_FAILED", taskData.fail_reason);
    }

    // 仍在进行中 → 退避：下次间隔翻倍，封顶 10s
    nextDelay = Math.min(nextDelay * 2, POLL_MAX_MS);
  }
}

/**
 * ArrayBuffer → base64 字符串（用于 IndexedDB 持久化）
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * base64 → Blob（仅用于同步接口的返回数据）
 */
async function base64ToBlob(b64: string, mime: string): Promise<Blob> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
