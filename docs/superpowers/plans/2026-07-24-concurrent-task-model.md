# 并发任务模型实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"单批单 loading"模型重构为"每张图一个独立 GenTask"，实现跨批次并发生成与单张级取消。

**Architecture:** `useImageGeneration` 以 `tasks: GenTask[]` 为单一数据源，每个任务独立 `AbortController`；`handleGenerate` 批次级 `claimInFlight` + `await Promise.allSettled(runTask×N)`，async 不阻塞 UI 故跨批次并发；`results` 跨批次累积；`loading` 由 tasks 派生。

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript / IndexedDB(idb) / sonner toast。项目无单元测试框架，验证手段为 `tsc --noEmit` + `eslint` + 浏览器手动验证 AC1-AC6。

**验证命令：**
- 类型检查：`npx tsc --noEmit`
- Lint：`npm run lint`
- 手动验证：`npm run dev` → http://localhost:3000

**重要：** Task 1-5 互相依赖，中间状态 `tsc` 会报错（types 改了 hook/UI 还没跟上）。**不要在中间 Task 单独 commit**。全部完成、Task 6 `tsc` 通过后一次性 commit。

---

## 文件结构

| 文件 | 责任 | 改动类型 |
|---|---|---|
| lib/types.ts | 类型定义：新增 `GenTask`，移除 `BatchTaskSlot` | 改 |
| lib/cache-key.ts | 缓存键：移除 `n` 字段 | 改 |
| hooks/useImageGeneration.ts | 核心生成流程：任务级状态/取消/累积 | 重写 |
| components/UnifiedInputCard.tsx | 输入卡片：常驻生成按钮 + 任务进度列表(带X) | 改 |
| components/ResultGrid.tsx | 图库：移除 loading 骨架，空态加"生成中…" | 改 |
| app/page.tsx | 页面：适配新 hook 返回值与 props | 改 |
| lib/db.ts | 无改动（in-flight 接口不变） | 不动 |

---

## Task 1: 类型与缓存键（lib/types.ts + lib/cache-key.ts）

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/cache-key.ts`

- [ ] **Step 1: 在 lib/types.ts 用 GenTask 替换 BatchTaskSlot**

把 `lib/types.ts` 中现有的 `BatchTaskSlot` 接口（约 47-69 行的整块注释+接口）替换为下面的 `GenTask`。其余类型（`GenerateResult`/`HistoryRecord`/`AppSettings` 等）保持不变。

替换为：

```ts
/**
 * 单个图像生成任务（任务级状态模型）
 *
 * 一次"生成"点击创建 N 个独立 GenTask（每个上游 n=1），并发执行。
 * 每个任务独立追踪状态/进度/取消，是 UI 进度列表与取消按钮的唯一数据源。
 * 跨批次并发：多次点击产生多批任务，共存于 tasks[]，互不阻塞。
 */
export type GenTaskStatus =
  | "submitting" // 已创建，正在 POST /api/generate
  | "polling" // 已拿到 task_id，指数退避轮询中
  | "success" // 成功，result 已就绪
  | "failed" // 上游/轮询/下载失败
  | "cancelled"; // 用户主动取消

export interface GenTask {
  /** 任务唯一 id，格式 task-{ts}-{rand} */
  id: string;
  /** 同一次"生成"点击的任务共享，仅用于 UI 分组展示 */
  batchId: string;
  /** 槽位序号（仅用于该批次内显示 #1/#2…），不影响逻辑 */
  slot: number;
  prompt: string;
  model: string;
  size: string;
  quality: string;
  status: GenTaskStatus;
  /** 进度 0~1（polling 阶段有意义，success 后置 1） */
  progress: number;
  /** 已轮询秒数 */
  elapsedSec: number;
  result?: GenerateResult;
  error?: string;
  /** 上游异步任务 id（submitting 完成后存在） */
  taskId?: string;
  createdAt: number;
}
```

- [ ] **Step 2: lib/cache-key.ts 移除 n 字段**

`CacheKeyInput` 接口删除 `n: number` 字段及其注释；`buildCacheKey` 的 composite 数组删除 `String(input.n),` 这一项。改后完整文件：

```ts
import type { ReferenceImage } from "@/components/UnifiedInputCard";

export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface CacheKeyInput {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  referenceImages: ReferenceImage[];
}

export async function buildCacheKey(input: CacheKeyInput): Promise<string> {
  const imageFingerprint = input.referenceImages
    .map((img) => `${img.base64.length}:${img.base64.slice(0, 64)}`)
    .join("|");
  const composite = [
    input.prompt.trim(),
    input.model,
    input.size,
    input.quality,
    imageFingerprint,
  ].join("\u0001");
  return hashString(composite);
}
```

- [ ] **Step 3: 暂不验证（types 改动会让 hook/UI 编译报错，Task 6 统一验证）**

---

## Task 2: 核心 Hook 重写（hooks/useImageGeneration.ts）

**Files:**
- Rewrite: `hooks/useImageGeneration.ts`

保留不变的辅助函数：`resolveReferencedImages`、`backoffSleep`、`ApiError`、`toApiError`、`pollTaskResult`、`arrayBufferToBase64`、`base64ToBlob`、`revokeAwareSetResults`。重写 hook 主体与导出接口。

- [ ] **Step 1: 替换文件顶部的 import 与常量段**

把现有 import/常量段（第 1-69 行左右，从 `"use client"` 到 `UseImageGenerationOptions` 之前）替换为：

```ts
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
```

- [ ] **Step 2: 替换导出接口（UseImageGenerationOptions / UseImageGenerationResult）**

替换为：

```ts
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
```

- [ ] **Step 3: 重写 hook 主体（从 `export function useImageGeneration` 到 `return` 之前）**

保留 `resolveReferencedImages` / `backoffSleep` / `ApiError` / `toApiError` 四个模块级函数不变。把 `export function useImageGeneration(options)...` 整个函数体替换为：

```ts
export function useImageGeneration(
  options: UseImageGenerationOptions
): UseImageGenerationResult {
  const { prompt, referenceImages, model, size, quality, n } = options;

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
      tasks.some(
        (t) => t.status === "submitting" || t.status === "polling"
      ),
    [tasks]
  );

  /** 更新指定任务（按 id 合并 patch） */
  const updateTask = useCallback(
    (id: string, patch: Partial<GenTask>) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
    },
    []
  );

  /** 标记终态并安排淡出移除（仅 UI 层，results 不受影响） */
  const markTerminal = useCallback(
    (id: string, patch: Partial<GenTask>) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
      setTimeout(() => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
      }, TERMINAL_FADE_MS);
    },
    []
  );

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

    /**
     * 单任务流程：缓存命中 → success；否则 POST + 轮询 → success/failed/cancelled。
     * 内部全 catch，不向上 throw（allSettled 仅用于等待，状态已在内部更新）。
     */
    const runTask = async (task: GenTask): Promise<void> => {
      // 1. 60s 缓存命中（AC4）
      const cached = await getPromptCache(cacheKey);
      if (cached) {
        const result = cached.results[task.slot % cached.results.length];
        markTerminal(task.id, {
          status: "success",
          result,
          progress: 1,
        });
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
          // 同步分支：直接返回 base64
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
    const batchResults = newTasks
      .map((t) => tasks.find((x) => x.id === t.id))
      .filter(
        (t): t is GenTask => !!t && t.status === "success" && !!t.result
      )
      .map((t) => t.result!);
    // 注：上面闭包 tasks 可能过期，改用函数式读取最新
    setTasks((prev) => {
      const ok = prev.filter(
        (t) =>
          t.batchId === batchId && t.status === "success" && t.result
      );
      if (ok.length > 0) {
        const okResults = ok.map((t) => t.result!);
        setPromptCache(cacheKey, okResults, CACHE_TTL_MS).catch(() => {});
        const record: HistoryRecord = {
          id: genId("hist"),
          params: { prompt: trimmedPrompt, model, size, quality, n },
          results: okResults,
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
      return prev;
    });
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

  const revokeAllBlobUrls = (list: GenerateResult[]) => {
    list.forEach((r) => {
      if (r.imageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(r.imageUrl);
      }
    });
  };

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
```

> **注意 Step 3 中的汇总逻辑**：`batchResults` 那段（基于闭包 `tasks`）是冗余的、会读到过期值，实际写历史用的是下面 `setTasks((prev) => {...})` 函数式读取。实现时**删除 `batchResults` 那几行**，只保留 `setTasks((prev)=>{...})` 块与 `releaseInFlight`。这是计划层为说明意图留下的注释，实现时按此修正。

- [ ] **Step 4: 确认保留的模块级函数仍在文件中**

`resolveReferencedImages`、`backoffSleep`、`ApiError`、`toApiError`、`pollTaskResult`、`PollResult`、`arrayBufferToBase64`、`base64ToBlob`、`revokeAwareSetResults` 这些函数保持原样不动，位于 hook 函数之后。

- [ ] **Step 5: 暂不验证（依赖 UI 改动，Task 6 统一验证）**

---

## Task 3: 输入卡片改造（components/UnifiedInputCard.tsx）

**Files:**
- Modify: `components/UnifiedInputCard.tsx`

- [ ] **Step 1: 修正 import，改导入 GenTask**

把第 5 行：
```ts
import type { AspectRatio, BatchTaskSlot, ModelInfo } from "@/lib/types";
```
改为：
```ts
import type { AspectRatio, GenTask, ModelInfo } from "@/lib/types";
```

- [ ] **Step 2: 替换 Props 接口**

把 `interface UnifiedInputCardProps`（约 17-43 行）整体替换为：

```ts
interface UnifiedInputCardProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  referenceImages: ReferenceImage[];
  onReferenceImagesChange: (imgs: ReferenceImage[]) => void;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (m: string) => void;
  selectedSize: AspectRatio;
  onSizeChange: (s: AspectRatio) => void;
  selectedQuality: Quality;
  onQualityChange: (q: Quality) => void;
  selectedN: 1 | 2 | 3 | 4;
  onNChange: (n: 1 | 2 | 3 | 4) => void;
  /** 全部会话任务（进行中 + 终态淡出期），用于渲染进度列表 */
  tasks: GenTask[];
  /** 取消单个任务 */
  onCancelTask: (id: string) => void;
  onGenerate: () => void;
  loading: boolean;
}
```

- [ ] **Step 3: 替换函数签名解构**

把 `export function UnifiedInputCard({...}: UnifiedInputCardProps)` 的解构参数替换为：

```ts
export function UnifiedInputCard({
  prompt, onPromptChange, referenceImages, onReferenceImagesChange,
  models, selectedModel, onModelChange, selectedSize, onSizeChange,
  selectedQuality, onQualityChange, selectedN, onNChange, tasks, onCancelTask,
  onGenerate, loading,
}: UnifiedInputCardProps) {
```

- [ ] **Step 4: 替换"右侧按钮 + 进度条"整块**

找到现有"右侧：生成 / 取消按钮"注释起、到组件最外层 `</div>` 之前的整块（含旧的 loading 切换按钮和旧进度条区域），替换为：

```tsx
        {/* 右侧：生成按钮（常驻可用，不再因 loading 切换成取消） */}
        <Button
          onClick={onGenerate}
          disabled={!prompt.trim()}
          className="h-9 px-5 gap-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 press transition-base shadow-sm hover:shadow-md disabled:opacity-50 disabled:hover:bg-primary"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            生成
          </span>
        </Button>
      </div>

      {/* 任务进度列表：按 batchId 分组，每条带 X 取消按钮。
          进行中/刚终态(淡出期)的任务都显示；终态 1.5s 后由 hook 移除。 */}
      {tasks.length > 0 && (
        <div className="px-4 pb-3 flex flex-col gap-1.5 animate-fade-in">
          {Object.entries(
            tasks.reduce<Record<string, GenTask[]>>((acc, t) => {
              (acc[t.batchId] ??= []).push(t);
              return acc;
            }, {})
          ).map(([batchId, group]) => (
            <div key={batchId} className="flex flex-col gap-1">
              {group.map((slot) => {
                const running =
                  slot.status === "submitting" || slot.status === "polling";
                const barColor =
                  slot.status === "failed"
                    ? "bg-destructive"
                    : slot.status === "cancelled"
                    ? "bg-muted-foreground/40"
                    : slot.status === "success"
                    ? "bg-emerald-500"
                    : "bg-primary";
                const label =
                  slot.status === "success"
                    ? "完成"
                    : slot.status === "failed"
                    ? "失败"
                    : slot.status === "cancelled"
                    ? "取消"
                    : slot.elapsedSec
                    ? `${slot.elapsedSec}s`
                    : "等待";
                return (
                  <div key={slot.id} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">
                      #{slot.slot + 1}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ease-out ${barColor}`}
                        style={{
                          width: `${slot.status === "success" || slot.status === "failed" || slot.status === "cancelled"
                            ? 100
                            : Math.min(100, Math.round((slot.progress || 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
                      {label}
                    </span>
                    {running ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-5 h-5 shrink-0 press hover:bg-accent/60"
                        onClick={() => onCancelTask(slot.id)}
                        aria-label={`取消第 ${slot.slot + 1} 张`}
                      >
                        <X className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    ) : (
                      <span className="w-5 h-5 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 确认 `Sparkles`/`X` 仍在第 4 行的 lucide-react import 中**

第 4 行 import 已含 `Sparkles` 和 `X`，无需改。`StopCircle` 现已不用，可从 import 中删除以避免 lint 警告（若 lint 报 unused）。把第 4 行的 `StopCircle` 删掉：

```ts
import { Upload, X, Image as ImageIcon, Eraser, AtSign, Sparkles, ChevronDown, Check } from "lucide-react";
```

- [ ] **Step 6: 暂不验证（依赖 page.tsx 传新 props，Task 6 统一验证）**

---

## Task 4: 图库改造（components/ResultGrid.tsx）

**Files:**
- Modify: `components/ResultGrid.tsx`

- [ ] **Step 1: 移除 loading 骨架分支，空态加"生成中…"**

把 `ResultGrid` 函数开头的 props 与 loading 分支：

```ts
export function ResultGrid({ results, loading }: ResultGridProps) {
```
改为（移除 loading 参数与骨架分支，新增可选 hasRunning 参数用于空态文案）：

```ts
interface ResultGridProps {
  results: GenerateResult[];
  /** 是否有任务在跑（仅用于空态时显示"生成中…"） */
  hasRunning?: boolean;
}

export function ResultGrid({ results, hasRunning }: ResultGridProps) {
```

删除原 `if (loading) { return (...4格骨架...) }` 整个分支。

把原 `if (results.length === 0)` 空态分支改为：

```tsx
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-up">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
          <Heart className="w-7 h-7 text-primary" />
        </div>
        <p className="text-base font-medium text-foreground">
          {hasRunning ? "生成中…" : "开始创作"}
        </p>
        <p className="text-xs mt-1 text-muted-foreground/80">
          {hasRunning ? "任务进行中，完成后将在此展示" : "在上方输入提示词，AI 将为你生成图像"}
        </p>
      </div>
    );
  }
```

其余（grid / 全部下载 / 展开预览）保持不变。

- [ ] **Step 2: 暂不验证（Task 6 统一验证）**

---

## Task 5: 页面适配（app/page.tsx）

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: 替换 useImageGeneration 解构与调用**

把现有的：
```ts
  const {
    results, loading, error, pollProgress, pollElapsedSec, batchProgress,
    handleGenerate, cancel, setResults,
  } = useImageGeneration({
    prompt,
    referenceImages,
    model: selectedModel,
    size: selectedSize,
    quality: selectedQuality,
    n: selectedN,
  });
```
替换为：
```ts
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
  });
```

- [ ] **Step 2: 替换 UnifiedInputCard 调用的 props**

把现有的：
```tsx
              selectedN={selectedN}
              onNChange={setSelectedN}
              batchProgress={batchProgress}
              onGenerate={handleGenerate}
              onCancel={cancel}
              loading={loading}
              pollProgress={pollProgress}
              pollElapsedSec={pollElapsedSec}
```
替换为：
```tsx
              selectedN={selectedN}
              onNChange={setSelectedN}
              tasks={tasks}
              onCancelTask={cancelTask}
              onGenerate={handleGenerate}
              loading={loading}
```

- [ ] **Step 3: 替换 ResultGrid 调用，传入 hasRunning**

把现有的：
```tsx
            <ResultGrid results={results} loading={loading} />
```
替换为：
```tsx
            <ResultGrid results={results} hasRunning={loading} />
```

- [ ] **Step 4: 暂不验证（Task 6 统一验证）**

---

## Task 6: 验证与提交

**Files:** 无（仅验证 + commit）

- [ ] **Step 1: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 退出码 0，无输出。若有错误，按报错修复（常见：遗漏 import、`tasks` 闭包过期已按 Task2 Step3 注释修正、`StopCircle` 残留引用）。

- [ ] **Step 2: 运行 lint（仅看本次改动文件）**

Run: `npm run lint`
Expected: 本次改动的 6 个文件（types/cache-key/useImageGeneration/UnifiedInputCard/ResultGrid/page）不出现在 error 列表。预先存在的 error（Header/HistoryDrawer/SettingsDrawer 的 set-state-in-effect、electron require）与本次无关，忽略。

- [ ] **Step 3: 启动 dev server 手动验证 AC1-AC6**

Run: `npm run dev`（先 `Get-Process node | Stop-Process -Force` 清理占用）

浏览器 http://localhost:3000 逐项验证：
- AC1：选 3 张生成 → 不等完成，改提示词再点 2 张 → 两组进度条共存，图库不清空。
- AC2：3 张中点第 2 条 X → 仅 #2 变"取消"，#1/#3 继续。
- AC3：制造一张失败（如断网/超时）→ 该条红"失败"+toast，其余进图库。
- AC4：60s 内同参数再点 → 任务直接"完成"，不请求上游，结果追加图库。
- AC5：同参数任务进行中再点 → 新任务"取消"+toast"已发起相同任务"。
- AC6：tsc 已通过；lint 无新 error。

- [ ] **Step 4: 提交**

```bash
git add lib/types.ts lib/cache-key.ts hooks/useImageGeneration.ts components/UnifiedInputCard.tsx components/ResultGrid.tsx app/page.tsx
git commit -m "feat: 并发任务模型(跨批次并发生成 + 单张级取消)"
```

---

## Self-Review 记录

- **Spec 覆盖**：N1→Task2 handleGenerate 创建N任务+allSettled；N2→Task2 cancelTask+abortMapRef；N3→Task3 按钮常驻；N4→Task2 results累积+Task4 图库；N5→Task2 claimInFlight busy 分支(AC5)；N6→Task2 缓存/历史/blob释放保留。全覆盖。
- **Placeholder**：Task2 Step3 有一处冗余 `batchResults` 已在注释中明确要求实现时删除。无 TBD。
- **类型一致**：`GenTask`/`GenTaskStatus`、`cancelTask`、`tasks`、`onCancelTask`、`hasRunning` 跨 Task 命名一致。
- **已知实现注意**：Task2 Step3 汇总段用 `setTasks((prev)=>{...})` 函数式读取最新 tasks 来判断本批成功项（闭包 tasks 过期）；在该回调内副作用调用 setPromptCache/addHistory/saveSettings 是可接受的（与原代码模式一致）。
