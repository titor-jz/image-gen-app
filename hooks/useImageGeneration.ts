"use client";

/**
 * useImageGeneration - 核心生成流程 Hook（任务级状态模型）
 *
 * 每张图 = 一个独立 GenTask，独立 AbortController/进度/取消。
 *  - handleGenerate: 批次级 claimInFlight → 创建 N 个 submitting 任务
 *    → await Promise.allSettled(runTask×N) → 汇总 results/历史/缓存
 *  - runTask: 缓存命中/上游提交/指数退避轮询，单任务自决终态
 *  - cancelTask(id): abort 单个任务，不影响其他
 *  - results 跨批次累积；loading 由 tasks 派生
 *
 * 跨批次并发：handleGenerate 是 async，UI 不 await，故多次点击重叠并发。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildApiHeaders } from "@/lib/api-headers";
import { useApiConfig } from "@/lib/api-config-context";
import { saveSettings } from "@/lib/user-settings";
import { buildCacheKey } from "@/lib/cache-key";
import {
  addHistory,
  claimInFlight,
  getPromptCache,
  releaseInFlight,
  setPromptCache,
  updateInFlightStatus,
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
} from "@/lib/types";
import type { Quality, ReferenceImage } from "@/components/UnifiedInputCard";

const CACHE_TTL_MS = 60 * 1000;
const POLL_BASE_MS = 1000;
const POLL_MAX_MS = 10 * 1000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
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
}

export interface UseImageGenerationResult {
  /** 图库数据源，跨批次累积（仅历史回填整体替换） */
  results: GenerateResult[];
  /** 是否有任务进行中（由 tasks 派生，非独立 state） */
  loading: boolean;
  /** 前置校验错误（无提示词/无 key）；生成阶段错误改为每任务条+toast */
  error: string | null;
  /** 全部会话任务（进行中 + 终态淡出期内） */
  tasks: GenTask[];
  handleGenerate: () => Promise<void>;
  /** 取消单个任务（abort 其 AbortController） */
  cancelTask: (id: string) => void;
  setResults: React.Dispatch<React.SetStateAction<GenerateResult[]>>;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 解析提示词中的参考图引用
 * 优先级：
 *  1. "@名称" 显式引用
 *  2. "图1/图2" 序号引用
 *  3. 都没有 → 全部参考图
 */
function resolveReferencedImages(
  prompt: string,
  referenceImages: ReferenceImage[]
): ReferenceImage[] {
  // 1. @ 名称引用
  const mentionImgs = referenceImages.filter((img) =>
    prompt.includes(`@${img.name}`)
  );
  if (mentionImgs.length > 0) return mentionImgs;

  // 2. 图N 序号引用
  const imgPattern = /图(\d+)/g;
  const matches = [...prompt.matchAll(imgPattern)];
  if (matches.length > 0) {
    const order = [...matches]
      .map((m) => parseInt(m[1], 10) - 1)
      .filter((i) => i >= 0 && i < referenceImages.length);
    const unique = [...new Set(order)].map((i) => referenceImages[i]);
    if (unique.length > 0) return unique;
  }

  // 3. 全部参考图
  return [...referenceImages];
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
  const { prompt, referenceImages, model, size, quality, n } = options;

  // API 鉴权配置（响应式）：修改后下次 handleGenerate 自动使用最新值
  const { apiKey: apiKeyFromCtx, baseUrl, proxyUrl } = useApiConfig();
  const apiKeyRef = useRef(apiKeyFromCtx);
  useEffect(() => {
    apiKeyRef.current = apiKeyFromCtx;
  }, [apiKeyFromCtx]);

  const [tasks, setTasks] = useState<GenTask[]>([]);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 每个任务一个 AbortController，支持单张级取消
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());

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

  const handleGenerate = useCallback(async () => {
    const apiKey = apiKeyRef.current;
    if (!prompt.trim()) {
      setError(getErrorMessage("REQ_MISSING_PROMPT"));
      return;
    }
    if (!apiKey) {
      const msg = getErrorMessage("AUTH_MISSING_KEY");
      setError(msg);
      toast.error(msg);
      return;
    }
    setError(null);

    const referencedImages = resolveReferencedImages(prompt, referenceImages);
    const trimmedPrompt = prompt.trim();
    const batchId = genId("batch");

    // 批次级 cacheKey（不含 n，每个任务恒 n=1）
    const cacheKey = await buildCacheKey({
      prompt: trimmedPrompt,
      model,
      size,
      quality,
      referenceImages: referencedImages,
    });

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
      // 创建 N 个 cancelled 任务作为 UI 反馈（不发上游）
      const cancelledTasks: GenTask[] = Array.from({ length: n }, (_, i) => ({
        id: genId("task"),
        batchId,
        slot: i,
        prompt: trimmedPrompt,
        model,
        size,
        quality,
        status: "cancelled" as const,
        progress: 0,
        elapsedSec: 0,
        createdAt: Date.now(),
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

    // 解码参考图一次，N 个任务共享
    const refBlobs: Blob[] = [];
    for (const img of referencedImages) {
      const r = await fetch(img.base64);
      refBlobs.push(await r.blob());
    }

    // 创建 N 个 submitting 任务
    const newTasks: GenTask[] = Array.from({ length: n }, (_, i) => ({
      id: genId("task"),
      batchId,
      slot: i,
      prompt: trimmedPrompt,
      model,
      size,
      quality,
      status: "submitting" as const,
      progress: 0,
      elapsedSec: 0,
      createdAt: Date.now(),
    }));
    setTasks((prev) => [...prev, ...newTasks]);

    // 本批成功结果（闭包收集，allSettled 后无需读过期 state）
    const batchResults: GenerateResult[] = [];

    /**
     * 单任务流程：缓存命中 → success；否则 POST + 轮询 → success/failed/cancelled。
     * 内部全 catch，不向上 throw（allSettled 仅用于等待，状态已在内部更新）。
     */
    const runTask = async (task: GenTask): Promise<void> => {
      // 1. 60s 缓存命中（AC4）
      const cached = await getPromptCache(cacheKey);
      if (cached) {
        const result = cached.results[task.slot % cached.results.length];
        batchResults.push(result);
        markTerminal(task.id, { status: "success", result, progress: 1 });
        setResults((prev) => [...prev, result]);
        return;
      }

      // 2. 独立 AbortController
      const controller = new AbortController();
      abortMapRef.current.set(task.id, controller);

      try {
        const headers = buildApiHeaders({ apiKey, baseUrl, proxyUrl });
        const formData = new FormData();
        formData.append("prompt", trimmedPrompt);
        formData.append("model", model);
        formData.append("size", size);
        formData.append("quality", quality);
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
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();
          throw new ApiError("GEN_UPSTREAM_BAD_RESPONSE", text.slice(0, 200));
        }

        let result: GenerateResult;

        // 异步分支：提交成功 → 轮询
        if (data.task_id) {
          updateTask(task.id, { status: "polling", taskId: data.task_id });
          await updateInFlightStatus(inFlightId, { status: "polling" });
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
            model,
            size,
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
            model,
            size,
            createdAt: Date.now(),
          };
        } else {
          throw new ApiError("GEN_UPSTREAM_NO_TASK_ID");
        }

        batchResults.push(result);
        markTerminal(task.id, { status: "success", result, progress: 1 });
        setResults((prev) => [...prev, result]);
      } catch (err) {
        const isAbort =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (isAbort) {
          markTerminal(task.id, { status: "cancelled" });
        } else {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
              ? err.message
              : getErrorMessage("UNKNOWN");
          markTerminal(task.id, { status: "failed", error: msg });
          toast.error(`第 ${task.slot + 1} 张生成失败`, { description: msg });
        }
      } finally {
        abortMapRef.current.delete(task.id);
      }
    };

    // 3. 并发执行本批 N 个任务（await 本批，不阻塞 UI/其他批次）
    await Promise.allSettled(newTasks.map((t) => runTask(t)));

    // 4. 汇总：成功项写缓存/历史；释放 in-flight
    if (batchResults.length > 0) {
      setPromptCache(cacheKey, batchResults, CACHE_TTL_MS).catch(() => {});
      const record: HistoryRecord = {
        id: genId("hist"),
        params: { prompt: trimmedPrompt, model, size, quality, n },
        results: batchResults,
        createdAt: Date.now(),
      };
      addHistory(record).catch(() => {});
      saveSettings({
        defaultModel: model,
        defaultSize: size,
        defaultQuality: quality,
        defaultN: n,
      });
    }
    releaseInFlight(inFlightId).catch(() => {});
  }, [
    prompt,
    referenceImages,
    model,
    size,
    quality,
    n,
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

  // 组件卸载时释放所有 blob URL，避免内存泄漏
  useEffect(() => {
    return () => {
      revokeAllBlobUrls(results);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    results,
    loading,
    error,
    tasks,
    handleGenerate,
    cancelTask,
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
      // 仅在新旧数据不同时释放（避免重复 revoke）
      if (next !== prev) {
        revoke(prev);
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

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= POLL_TIMEOUT_MS) {
      throw new ApiError("TASK_TIMEOUT");
    }

    try {
      await backoffSleep(nextDelay, signal);
    } catch (err) {
      throw err;
    }

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    onProgress(elapsed / POLL_TIMEOUT_MS, elapsedSec);

    const taskResponse = await fetch(`/api/task/${taskId}`, {
      headers,
      signal,
    });
    if (!taskResponse.ok) {
      throw await toApiError(taskResponse, "TASK_POLL_FAILED");
    }
    const taskData: {
      status: string;
      image_url?: string;
      mime?: string;
      fail_reason?: string;
    } = await taskResponse.json();

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
