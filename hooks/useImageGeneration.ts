// 临时 useImageGeneration.ts
"use client";

/**
 * useImageGeneration - 核心生成流程 Hook
 *
 * 封装了从用户点击"生成"到图片展示的完整流程：
 *  1. 校验 API Key / 提示词
 *  2. 解析参考图（@名称 / 图N 序号 / 全部）
 *  3. 60s 软缓存命中检测（IndexedDB）
 *  4. in-flight 去重（IndexedDB 原子操作）
 *  5. POST /api/generate 提交异步任务（可中断）
 *  6. 指数退避轮询 /api/task/[id]（1s→2s→4s→8s→10s 上限）
 *  7. 写缓存 + 写历史 + 清理 in-flight
 *  8. 失败/取消时友好提示（通过 i18n 错误码）
 *
 * API Key 来源：
 *  - 通过 useApiConfig() 订阅 Context（响应式）
 *  - apiKeyRef 在 useCallback 闭包内同步最新值（避免依赖 apiKey 触发重建）
 *
 * 暴露给 UI 的：
 *  - results / loading / error / pollProgress
 *  - handleGenerate(): 开始生成
 *  - cancel(): 取消进行中的任务（中止轮询 + AbortController）
 *  - setResults: 供历史回填使用
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  HistoryRecord,
  ModelId,
} from "@/lib/types";
import type { Quality, ReferenceImage } from "@/components/UnifiedInputCard";

const CACHE_TTL_MS = 60 * 1000; // 60s 软缓存
const POLL_BASE_MS = 1000; // 起始轮询间隔 1s
const POLL_MAX_MS = 10 * 1000; // 退避上限 10s
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 总超时 3 分钟

export interface UseImageGenerationOptions {
  prompt: string;
  referenceImages: ReferenceImage[];
  model: ModelId;
  size: AspectRatio;
  quality: Quality;
}

export interface UseImageGenerationResult {
  results: GenerateResult[];
  loading: boolean;
  error: string | null;
  pollProgress: number;
  pollElapsedSec: number;
  handleGenerate: () => Promise<void>;
  cancel: () => void;
  setResults: React.Dispatch<React.SetStateAction<GenerateResult[]>>;
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
 * 指数退避 sleep
 * - 第 1 次：1s
 * - 第 2 次：2s
 * - 第 3 次：4s
 * - 第 4 次：8s
 * - 第 5 次及之后：10s（上限）
 * 支持 AbortController 立即中断
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
async function toApiError(response: Response, defaultCode: ErrorCode): Promise<ApiError> {
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
  const { prompt, referenceImages, model, size, quality } = options;

  // API 鉴权配置（响应式）：修改后下次 handleGenerate 自动使用最新值
  const { apiKey: apiKeyFromCtx, baseUrl, proxyUrl } = useApiConfig();
  // 用 ref 同步最新值：避免 handleGenerate useCallback 依赖 apiKey 频繁重建
  const apiKeyRef = useRef(apiKeyFromCtx);
  useEffect(() => {
    apiKeyRef.current = apiKeyFromCtx;
  }, [apiKeyFromCtx]);

  const [results, setResults] = useState<GenerateResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollProgress, setPollProgress] = useState(0);
  const [pollElapsedSec, setPollElapsedSec] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    if (!loading) return;
    cancelledRef.current = true;
    abortRef.current?.abort();
    toast.info(getErrorMessage("CLIENT_CANCELLED"));
  }, [loading]);

  const handleGenerate = useCallback(async () => {
    // 每次调用都从 ref 读取最新的 apiKey（避免闭包陷阱）
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

    const referencedImages = resolveReferencedImages(prompt, referenceImages);

    setLoading(true);
    setError(null);
    setResults([]);
    setPollProgress(0);
    setPollElapsedSec(0);
    cancelledRef.current = false;

    const abortController = new AbortController();
    abortRef.current = abortController;
    let inFlightId: string | null = null;
    let cancelled = false;

    try {
      // 1. 软缓存
      const cacheKey = await buildCacheKey({
        prompt: prompt.trim(),
        model,
        size,
        quality,
        referenceImages: referencedImages,
      });
      const cached = await getPromptCache(cacheKey);
      if (cached) {
        const ageSec = Math.max(
          1,
          Math.round((Date.now() - cached.createdAt) / 1000)
        );
        toast.success(`复用 ${ageSec}s 前的结果`, {
          description: "相同提示词 + 参数命中 60s 软缓存",
        });
        setResults(cached.results);
        saveSettings({ defaultModel: model, defaultSize: size, defaultQuality: quality });
        return;
      }

      // 2. 原子抢占 in-flight（readwrite transaction 内"检查+插入"）
      //    多标签页/快速连点/StrictMode 第二次调用都只能有一个赢家
      const claim = await claimInFlight(
        cacheKey,
        prompt.trim().slice(0, 60)
      );
      if (claim.result === "busy") {
        const ageSec = Math.max(
          1,
          Math.round((Date.now() - claim.existing.startedAt) / 1000)
        );
        toast.warning(getErrorMessage("CLIENT_INFLIGHT"), {
          description: `${ageSec}s 前发起，请等待当前任务完成`,
        });
        return;
      }
      inFlightId = claim.entry.id;
      inFlightIdRef.current = inFlightId;

      // 3. 提交生成请求
      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      formData.append("model", model);
      formData.append("size", size);
      formData.append("quality", quality);
      formData.append("n", "1");
      for (const img of referencedImages) {
        const response = await fetch(img.base64);
        const blob = await response.blob();
        formData.append("images", blob, img.name);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: buildApiHeaders({ apiKey, baseUrl, proxyUrl }),
        body: formData,
        signal: abortController.signal,
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

      // 4. 轮询或直接拿结果
      let newResults: GenerateResult[] = [];
      if (data.task_id) {
        const taskId = data.task_id;
        await updateInFlightStatus(inFlightId, { status: "polling", taskId });
        const pollResult = await pollTaskResult(
          taskId,
          buildApiHeaders({ apiKey, baseUrl, proxyUrl }),
          abortController.signal,
          (p, elapsed) => {
            setPollProgress(p);
            setPollElapsedSec(elapsed);
          }
        );
        newResults = [
          {
            id: `gen-${Date.now()}-0`,
            b64_json: pollResult.b64,
            imageUrl: pollResult.imageUrl,
            mime: pollResult.mime,
            prompt: prompt.trim(),
            model,
            size,
            createdAt: Date.now(),
          },
        ];
      } else {
        // 同步接口返回的图片仍为 base64，转换为 blob URL 以保持一致体验
        newResults = await Promise.all(
          (data.images || []).map(
            async (img: { b64_json: string; mime: string }, i: number) => {
              const blob = await base64ToBlob(img.b64_json, img.mime);
              return {
                id: `gen-${Date.now()}-${i}`,
                b64_json: img.b64_json,
                imageUrl: URL.createObjectURL(blob),
                mime: img.mime,
                prompt: prompt.trim(),
                model,
                size,
                createdAt: Date.now(),
              };
            }
          )
        );
      }

      if (cancelledRef.current) {
        return;
      }

      setResults(newResults);
      setPromptCache(cacheKey, newResults, CACHE_TTL_MS).catch(() => {});

      // 5. 写历史
      const record: HistoryRecord = {
        id: `hist-${Date.now()}`,
        params: {
          prompt: prompt.trim(),
          model,
          size,
          quality,
          images:
            referencedImages.length > 0
              ? referencedImages.map((img) => img.base64)
              : undefined,
        },
        results: newResults,
        createdAt: Date.now(),
      };
      await addHistory(record);
      saveSettings({ defaultModel: model, defaultSize: size, defaultQuality: quality });
      await releaseInFlight(inFlightId);
      inFlightId = null;
      inFlightIdRef.current = null;
    } catch (err) {
      // 主动取消
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        cancelled = true;
        if (inFlightId) {
          await updateInFlightStatus(inFlightId, { status: "cancelled" });
        }
        return;
      }
      // ApiError - 直接使用 i18n 文案
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error("生成失败", { description: err.message });
      } else {
        const message = err instanceof Error ? err.message : getErrorMessage("UNKNOWN");
        setError(message);
        toast.error("生成失败", { description: message });
      }
      if (inFlightId) {
        await updateInFlightStatus(inFlightId, { status: "failed" });
      }
    } finally {
      setLoading(false);
      setPollProgress(0);
      setPollElapsedSec(0);
      abortRef.current = null;
      inFlightIdRef.current = null;
      if (inFlightId && !cancelled) {
        releaseInFlight(inFlightId).catch(() => {});
      }
    }
  }, [prompt, referenceImages, model, size, quality, baseUrl, proxyUrl]);

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
    pollProgress,
    pollElapsedSec,
    handleGenerate,
    cancel,
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

/**
 * 轮询任务直到完成 / 失败 / 超时 / 取消
 * - 使用指数退避：1s → 2s → 4s → 8s → 10s（上限）
 * - onProgress(0~1, 已等待秒数) 实时反馈 UI
 * - 支持 AbortSignal 立即中断
 *
 * 返回值：
 *  - imageUrl: blob: URL（当前会话高效显示用）
 *  - b64: base64 数据（持久化到 IndexedDB 用）
 *  - mime: 图像 mime
 */
interface PollResult {
  imageUrl: string;
  b64: string;
  mime: string;
}

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
      const mime = imgRes.headers.get("content-type") || taskData.mime || "image/png";
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
 * 使用一次 buffer 复用，避免大字符串拼接
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
