# 设计文档：多图并发生成（Batch Image Generation）

- **日期**：2026-07-24
- **状态**：已通过 brainstorming，待用户审查
- **方案**：A - 批次抽象（Batch Abstraction）

---

## 1. 背景与目标

### 1.1 当前现状

项目 `image-gen-app` 当前每次"生成"按钮点击只能产出 1 张图。核心流程（[hooks/useImageGeneration.ts](../../../hooks/useImageGeneration.ts)）：

```
handleGenerate() → 校验 → resolveReferencedImages → buildCacheKey
→ claimInFlight → POST /api/generate (硬编码 n=1)
→ pollTaskResult → setResults([单图]) → setPromptCache → addHistory → releaseInFlight
```

### 1.2 上游能力探测结论（已实测）

对上游 `POST {baseURL}/images/generations/async`（kuaiaiapi.com）实测：

| 测试 | 响应 | 结论 |
|------|------|------|
| n=1 | 200，返回 task_id | 单任务正常 |
| n=2 | 400，`"model gpt-image-2 only supports n=1"` | **上游明确拒绝 n>1** |

**确定结论**：上游 gpt-image-2 模型不支持 `n` 参数，单次任务只能产出 1 张图。

### 1.3 目标

让用户一次点击"生成"按钮，**前端并发提交 N 个独立任务**，每个任务独立轮询、独立进度，最终汇总展示多张图。

### 1.4 需求确认清单

| 维度 | 决策 |
|------|------|
| 数量范围 | 1 / 2 / 3 / 4 张可选 |
| 提交方式 | 用户点 1 次，前端并发提交多个独立任务 |
| 失败处理 | 部分成功也展示，失败的占位（不进 results，只 toast） |
| 进度展示 | 每个任务独立进度条 |
| UI 位置 | 数量选择器与模型/比例/清晰度并排工具栏 |
| 缓存策略 | n 加入 cache key；批次内多任务共享单条 in-flight 占位 |
| 默认值 | defaultN = 1（向后兼容） |

---

## 2. 整体架构与数据流

### 2.1 核心思路

将 `useImageGeneration` 从"单任务流水线"升级为"批次调度器"：一次 `handleGenerate` 内部创建 N 个并发子任务，每个子任务独立走原流程（提交 → 轮询 → 取图），用 `Promise.allSettled` 汇总。

### 2.2 端到端数据流（n=3 为例）

```
用户点"生成"(n=3)
  │
  ├─ useImageGeneration.handleGenerate()
  │    ├─ 0. 校验 apiKey + prompt
  │    ├─ 1. resolveReferencedImages()           （不变）
  │    ├─ 2. buildCacheKey({..., n:3})            ← n 加入 key
  │    ├─ 3. 检查 prompt_cache → 命中直接 setResults(缓存数组)
  │    ├─ 4. claimInFlight(cacheKey)              ← 批次级单条占位
  │    ├─ 5. 初始化 taskSlots: BatchTaskSlot[3]
  │    ├─ 6. setBatchProgress(taskSlots)           ← UI 立即显示 3 个进度槽
  │    ├─ 7. 解码参考图 blobs（只一次，N 任务共享）
  │    ├─ 8. 并发提交：
  │    │      const submissions = Array.from({length:3}, (_,i) =>
  │    │        runOneTask(i, { onProgress, onSubmitted, signal })
  │    │      )
  │    ├─ 9. const settled = await Promise.allSettled(submissions)
  │    ├─ 10. 汇总：成功的进 results，失败的标记槽位
  │    ├─ 11. setResults(成功图数组)
  │    ├─ 12. setPromptCache(cacheKey, 成功results)
  │    ├─ 13. addHistory({params:{...,n:3}, results: 成功results})
  │    └─ 14. releaseInFlight(inFlightId)
  │
  └─ UI
       ├─ UnifiedInputCard: 3 个独立进度条（batchProgress 数组）
       └─ ResultGrid: 展示成功的图（已支持多图，无需改动）
```

### 2.3 关键架构决策

1. **不改造上游 API 层**：`/api/generate`、`/api/task/[id]`、`/api/task/[id]/content` 完全不动。前端复用现有 `pollTaskResult` 函数。
2. **批次级单条 in-flight 占位**：整批只占一条记录（按 cacheKey），避免 N 条记录互相干扰；批次内子任务不再单独 claim。
3. **缓存粒度**：n 加入 cache key；缓存存"成功的图数组"，失败的不缓存。

---

## 3. 核心类型与状态结构

### 3.1 新增类型（`lib/types.ts` 扩展）

```typescript
/** 单个批次内的子任务槽位状态 */
export interface BatchTaskSlot {
  /** 槽位序号 0..n-1 */
  index: number;
  /** 当前状态 */
  status: "pending" | "submitting" | "polling" | "success" | "failed" | "cancelled";
  /** 进度 0~1（仅 polling 阶段有意义） */
  progress: number;
  /** 已轮询秒数 */
  elapsedSec: number;
  /** 成功后的结果（status==="success" 时存在） */
  result?: GenerateResult;
  /** 失败原因（status==="failed" 时存在） */
  error?: string;
  /** 关联的上游 taskId（submitting 后存在） */
  taskId?: string;
}
```

### 3.2 `AppSettings` 扩展

```typescript
export interface AppSettings {
  apiKey: string;
  defaultModel: ModelId;
  defaultSize: AspectRatio;
  defaultQuality: "1k" | "2k" | "4k";
  proxyUrl?: string;
  defaultN?: 1 | 2 | 3 | 4;   // 新增，默认 1
}
```

### 3.3 `UseImageGenerationOptions` 扩展

```typescript
export interface UseImageGenerationOptions {
  prompt: string;
  referenceImages: ReferenceImage[];
  model: ModelId;
  size: AspectRatio;
  quality: Quality;
  n: 1 | 2 | 3 | 4;        // 新增
}
```

### 3.4 `UseImageGenerationResult` 扩展

```typescript
export interface UseImageGenerationResult {
  results: GenerateResult[];
  loading: boolean;
  error: string | null;
  /** @deprecated 改用 batchProgress[0]?.progress */
  pollProgress: number;
  /** @deprecated 改用 batchProgress[0]?.elapsedSec */
  pollElapsedSec: number;
  /** 新增：批次内每个子任务的实时状态（n=1 时长度为1） */
  batchProgress: BatchTaskSlot[];
  handleGenerate: (n?: 1 | 2 | 3 | 4) => Promise<void>;
  cancel: () => void;
  setResults: React.Dispatch<React.SetStateAction<GenerateResult[]>>;
}
```

### 3.5 状态设计原则

- **`batchProgress` 数组**为 UI 进度唯一数据源，通过 `setBatchProgress(prev => prev.map(...))` 更新单槽位
- **`results` 只存成功图**，与现有 ResultGrid 契约一致；失败通过 `batchProgress[i].error` 展示
- **`loading`**：批次开始 true，所有子任务 settle 后 false
- **`error`**：仅整批都失败时设置全局 error；部分失败靠槽位 + toast

---

## 4. 核心流程算法

### 4.1 `handleGenerate` 改造（伪代码）

```typescript
const handleGenerate = useCallback(async (overrideN?) => {
  const n = overrideN ?? options.n;

  // 0. 校验
  if (!apiKeyRef.current) { toast.error(...); return; }
  if (!prompt.trim()) { toast.error(...); return; }

  // 1. 解析参考图
  const referencedImages = resolveReferencedImages(prompt, referenceImages);

  // 2. cache key 含 n
  const cacheKey = await buildCacheKey({ prompt, model, size, quality, referenceImages, n });

  // 3. 缓存命中
  const cached = await getPromptCache(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    setResults(cached.results);
    setBatchProgress(cached.results.map((r, i) => ({
      index: i, status: "success", progress: 1, elapsedSec: 0, result: r
    })));
    return;
  }

  // 4. 批次级 in-flight 占位
  const claim = await claimInFlight(cacheKey, prompt.slice(0, 60));
  if (claim.result === "busy") {
    toast.warning(getErrorMessage("CLIENT_INFLIGHT"), {
      description: `${Math.round((Date.now()-claim.existing.startedAt)/1000)}s 前发起，请等待`
    });
    return;
  }
  let inFlightId = claim.entry.id;

  // 5. 初始化批次槽位
  const slots: BatchTaskSlot[] = Array.from({ length: n }, (_, i) => ({
    index: i, status: "submitting", progress: 0, elapsedSec: 0
  }));
  setBatchProgress(slots);
  setLoading(true); setError(null); setResults([]);

  // 6. 解码参考图 blobs（只一次，N 任务共享）
  const refBlobs = await Promise.all(
    referencedImages.map(async img => {
      const r = await fetch(img.base64); return await r.blob();
    })
  );

  // 7. 并发提交 + 轮询
  const abortController = new AbortController();
  abortRef.current = abortController;

  const submissions = slots.map((_, i) => runOneTask(i, {
    cacheKey, refBlobs, signal: abortController.signal,
    onProgress: (p, sec) => updateSlot(i, { progress: p, elapsedSec: sec }),
    onSubmitted: (taskId) => updateSlot(i, { status: "polling", taskId }),
  }));

  // 8. 等待全部 settle
  const settled = await Promise.allSettled(submissions);

  // 9. 汇总
  const okResults: GenerateResult[] = [];
  let failCount = 0;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      okResults.push(s.value);
      updateSlot(i, { status: "success", result: s.value, progress: 1 });
    } else {
      if (s.reason?.name === "AbortError") {
        updateSlot(i, { status: "cancelled" });
      } else {
        failCount++;
        const msg = s.reason instanceof ApiError ? s.reason.message : String(s.reason);
        updateSlot(i, { status: "failed", error: msg });
      }
    }
  });

  // 10. 写缓存 + 历史（只存成功图）
  if (okResults.length > 0) {
    await setPromptCache(cacheKey, { results: okResults, createdAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS });
    await addHistory({
      id: `batch-${Date.now()}`,
      params: { prompt, model, size, quality, n },
      results: okResults,
      createdAt: Date.now(),
    });
    setResults(okResults);
    saveSettings({ defaultModel: model, defaultSize: size, defaultQuality: quality, defaultN: n });
  }

  // 11. 提示
  if (failCount === n) {
    setError("全部任务失败");
  } else if (failCount > 0) {
    toast.warning(`${okResults.length}/${n} 成功`, { description: `${failCount} 张失败` });
  }

  // 12. 清理
  await releaseInFlight(inFlightId);
  setLoading(false);
  abortRef.current = null;
}, [options, /* deps */]);
```

### 4.2 `runOneTask` 单任务函数

抽取原有"提交 + 轮询"逻辑，复用现有 `pollTaskResult`：

```typescript
async function runOneTask(index: number, ctx: {
  cacheKey: string;
  refBlobs: Blob[];
  signal: AbortSignal;
  onSubmitted: (taskId: string) => void;
  onProgress: (p: number, sec: number) => void;
}): Promise<GenerateResult> {
  const headers = buildApiHeaders({
    apiKey: apiKeyRef.current, baseUrl, proxyUrl,
  });

  // 提交
  const formData = new FormData();
  formData.append("prompt", prompt.trim());
  formData.append("model", model);
  formData.append("size", size);
  formData.append("quality", quality);
  formData.append("n", "1");  // 单任务仍 n=1
  for (const blob of ctx.refBlobs) {
    formData.append("images", blob, `input_${index}.png`);
  }

  const response = await fetch("/api/generate", {
    method: "POST", headers, body: formData, signal: ctx.signal,
  });
  if (!response.ok) throw await toApiError(response, "GEN_UPSTREAM_FAILED");
  const data = await response.json();

  // 异步任务
  if (data.task_id) {
    ctx.onSubmitted(data.task_id);
    const pollResult = await pollTaskResult(
      data.task_id, headers, ctx.signal, ctx.onProgress
    );
    return {
      id: `gen-${Date.now()}-${index}`,
      b64_json: pollResult.b64,
      imageUrl: pollResult.imageUrl,
      mime: pollResult.mime,
      prompt: prompt.trim(), model, size, quality,
      createdAt: Date.now(),
    };
  }

  // 同步分支（保留原有兼容，处理 data.images）
  if (data.images?.length) {
    const img = data.images[0];
    const blob = await base64ToBlob(img.b64_json, img.mime);
    return {
      id: `gen-${Date.now()}-${index}`,
      b64_json: img.b64_json,
      imageUrl: URL.createObjectURL(blob),
      mime: img.mime,
      prompt: prompt.trim(), model, size, quality,
      createdAt: Date.now(),
    };
  }
  throw new ApiError("GEN_UPSTREAM_NO_TASK_ID");
}
```

### 4.3 并发控制与取消

- **并发数**：直接 `Promise.allSettled` 全并发（n≤4，上游 QPS 可承受）
- **取消**：单一 `abortController`，`cancel()` 调 `abortRef.current?.abort()`，所有子任务的 `fetch` + `backoffSleep` 都监听该 signal，立即 reject
- **取消后槽位状态**：catch AbortError → `updateSlot(i, {status:"cancelled"})`
- **StrictMode 双调用防护**：保留原有 `claimInFlight` 原子占位，批次级单条占位天然防重

### 4.4 `updateSlot` 辅助函数

```typescript
const updateSlot = useCallback((index: number, patch: Partial<BatchTaskSlot>) => {
  setBatchProgress(prev => prev.map(s =>
    s.index === index ? { ...s, ...patch } : s
  ));
}, []);
```

---

## 5. UI 层改动

### 5.1 `UnifiedInputCard` 加数量选择器

工具栏新增第 4 个 `SelectChip`，与模型/比例/清晰度并列。

新增 props：
```typescript
selectedN: 1 | 2 | 3 | 4;
onNChange: (n: 1 | 2 | 3 | 4) => void;
batchProgress?: BatchTaskSlot[];
```

新增选项：
```typescript
const COUNTS = [
  { value: 1, label: "1张" },
  { value: 2, label: "2张" },
  { value: 3, label: "3张" },
  { value: 4, label: "4张" },
];
```

工具栏渲染：
```tsx
<SelectChip value={selectedN} onChange={onNChange} options={COUNTS} />
```

### 5.2 每任务独立进度条

当 `batchProgress.length > 1` 时，在生成按钮下方显示 N 个迷你进度条：

```tsx
{batchProgress && batchProgress.length > 1 && (
  <div className="flex gap-1 mt-2">
    {batchProgress.map(slot => (
      <div key={slot.index} className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            slot.status === "failed" && "bg-destructive",
            slot.status === "success" && "bg-green-500",
            (slot.status === "polling" || slot.status === "submitting") && "bg-primary",
            slot.status === "cancelled" && "bg-muted-foreground/30"
          )}
          style={{ width: `${slot.status === "success" ? 100 : slot.progress * 100}%` }}
        />
      </div>
    ))}
  </div>
)}
```

n=1 时不渲染（保持原有单进度条逻辑）。

### 5.3 `page.tsx` 新增 state

```typescript
const [selectedN, setSelectedN] = useState<1 | 2 | 3 | 4>(1);

useEffect(() => {
  const settings = getSettings();
  if (settings.defaultN) setSelectedN(settings.defaultN);
}, []);

const { batchProgress, ...rest } = useImageGeneration({
  ..., n: selectedN,
});

<UnifiedInputCard
  ...
  selectedN={selectedN}
  onNChange={setSelectedN}
  batchProgress={batchProgress}
/>
```

### 5.4 `ResultGrid` 无需改动

现有 `results.map` 已支持多图网格 + 批量下载 + 展开预览。

---

## 6. 缓存与去重改造

### 6.1 `buildCacheKey` 加 n

[lib/cache-key.ts](../../../lib/cache-key.ts) 修改：

```typescript
interface CacheKeyInput {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  referenceImages: ReferenceImage[];
  n: number;  // 新增
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
    String(input.n),  // 新增
  ].join("\u0001");
  return hashString(composite);
}
```

### 6.2 in-flight 去重保持不变

批次级单条占位（按 cacheKey，已含 n）。同一 (prompt+参数+n) 批次只能有一个在跑。批次内 N 个子任务共享这条占位，**不单独 claim**。

### 6.3 `useInFlightRecovery` 恢复策略

批次场景下刷新页面恢复时**只清理 in-flight 记录，不尝试恢复轮询**（因为子任务 taskId 没持久化）。toast 提示"上次有未完成批次，已清理"。

---

## 7. 错误处理与边界

| 场景 | 处理 |
|------|------|
| 全部失败 | `error` 全局展示，results 清空 |
| 部分失败 | toast.warning("x/n 成功")，槽位红色，成功的图正常展示 |
| 取消 | 所有槽位 cancelled，results 清空，无 toast |
| 单任务超时 | 该槽位 failed，其他继续 |
| 网络抖动 | 每子任务独立退避，由现有 pollTaskResult 负责 |
| n=1 兼容 | 单槽位，行为与改造前完全一致 |
| StrictMode 双调用 | claimInFlight 原子占位防护 |
| 参考图引用解析失败 | 批次级前置校验，整批不提交 |

---

## 8. 测试策略

### 8.1 单元测试

- `buildCacheKey` 含 n 的哈希：不同 n 产生不同 key
- `runOneTask` mock fetch：成功/失败/取消三种路径
- `Promise.allSettled` 汇总：部分成功场景

### 8.2 集成测试

- mock `/api/generate` 返回不同 taskId，验证并发提交
- mock `/api/task/[id]` 不同状态序列，验证独立进度更新
- 模拟取消，验证所有槽位变 cancelled

### 8.3 手动测试

- n=2/3/4 实际跑，观察进度条独立推进
- 模拟部分失败（断网某次），观察部分成功展示
- 取消按钮，验证立即停止
- n=1 回归，验证与改造前一致

---

## 9. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `lib/types.ts` | 新增 | `BatchTaskSlot` 接口；`AppSettings` 加 `defaultN` |
| `lib/cache-key.ts` | 修改 | `CacheKeyInput` 加 `n`，composite 加入 `String(n)` |
| `lib/user-settings.ts` | 修改 | 读写 `defaultN` |
| `hooks/useImageGeneration.ts` | 重构 | `handleGenerate` 批次化；新增 `runOneTask`、`updateSlot`、`batchProgress` state |
| `components/UnifiedInputCard.tsx` | 修改 | 加数量选择器 props + 渲染；加每任务进度条 |
| `app/page.tsx` | 修改 | 新增 `selectedN` state 与传递 |
| `hooks/useInFlightRecovery.ts` | 微调 | 批次场景只清理不恢复轮询 |

**不改动的文件**：
- `app/api/generate/route.ts`
- `app/api/task/[taskId]/route.ts`
- `app/api/task/[taskId]/content/route.ts`
- `components/ResultGrid.tsx`
- `lib/db.ts`
- `lib/http-client.ts`

---

## 10. 非目标（YAGNI）

明确不做的事：

- 不引入 Worker 线程并发
- 不实现自动重试失败的子任务（手动重试由用户重新点生成）
- 不实现批次队列排队（n≤4 直接全并发）
- 不改造上游 API 层（保持 `/api/generate` 原样）
- 不持久化子任务的 taskId（刷新即丢弃批次上下文）
- 不实现"失败的图重新生成"单独按钮（失败走整体重新生成）
