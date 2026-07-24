# 并发任务模型设计：并发生成 + 单张级取消

- 日期：2026-07-24
- 状态：已确认（待实现）
- 关联：`2026-07-24-multi-image-generation-design.md`（前置：多图批量生成已上线）

## 1. 背景与动机

多图生成已上线，采用"单批单 loading + 单 AbortController"模型。用户反馈两个问题：

1. **取消按钮一次取消全部任务**：当前 `cancel()` 调用一个全局 `abortRef`，整批所有子任务（含已完成轮询的）瞬间全部中止，无法只取消某一张。
2. **生成中无法再点生成**：当前 `loading` 为 true 时，生成按钮被禁用/替换为取消，无法在等待期间发起其他任务。

根本原因：状态模型是"整批一个生命周期"。要同时满足"并发"与"单张取消"，必须把状态模型下沉到**每张图一个独立任务**。

## 2. 需求与验收标准

### 需求
- N1：一次"生成"点击创建 N（1~4）个独立任务；同一会话内允许多次点击，新旧批次并发执行、互不阻塞。
- N2：每个任务可单独取消（不影响同批其他任务、不影响其他批次）。
- N3：生成按钮在任意时刻只要有提示词即可点击（不再因 loading 禁用）。
- N4：成功结果跨批次累积展示在图库；单任务失败不影响其他任务结果展示。
- N5：相同参数（提示词+模型+比例+清晰度+参考图）的任务若已有进行中，则去重跳过，不重复消耗上游配额。
- N6：60s 软缓存、历史记录、blob URL 释放等既有机制保持正确。

### 验收标准
- AC1：点击"生成"选择 3 张后，不等待完成，修改提示词再次点击"生成"2 张 → 两组进度条同时出现在卡片底部，图库不闪烁/不清空。
- AC2：3 张中点第 2 条进度条的 X → 仅 #2 变为"取消"，#1/#3 继续直到完成/失败。
- AC3：某张上游失败 → 该条变红"失败"并 toast，其余成功的图照常进入图库。
- AC4：以相同参数在 60s 内连续点两次"生成" → 第二次命中缓存，对应任务直接"完成"且不发起上游请求；缓存结果追加进图库（可能与既有图重复，属预期）。
- AC5：相同参数在任务进行中再次点击"生成" → 新任务标记"取消"并提示"与进行中任务重复"，不发上游请求。
- AC6：`tsc --noEmit` 通过；本次改动文件不引入新的 lint error。

## 3. 数据模型

新增 `GenTask`，取代当前的 `batchProgress: BatchTaskSlot[]`。

```ts
type GenTaskStatus =
  | "submitting"   // 已创建，正在 POST /api/generate
  | "polling"      // 已拿到 task_id，指数退避轮询中
  | "success"      // 成功，result 已就绪
  | "failed"       // 上游/轮询/下载失败
  | "cancelled";   // 用户主动取消

interface GenTask {
  /** 任务唯一 id，格式 `task-{ts}-{rand}` */
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

`BatchTaskSlot` 接口（lib/types.ts）保留兼容性说明后移除（见 §10）。`GenerateParams.n` / `AppSettings.defaultN` 保留不变（一次点击仍选 N 张，只是 N 张现在是 N 个独立任务）。

## 4. 架构

```mermaid
flowchart LR
  subgraph UI[UnifiedInputCard / page]
    Btn[生成按钮 常驻可用]
    TL[任务进度列表 按 batchId 分组 每条带X]
    Grid[ResultGrid 跨批次累积]
  end

  subgraph Hook[useImageGeneration]
    Tasks[tasks: GenTask[] 全部会话任务]
    Res[results: GenerateResult[] 跨批次累积]
    Abort[abortMapRef Map id,AbortController]
    Gen[handleGenerate]
    Cancel[cancelTask id]
  end

  subgraph Persist[lib/db.ts]
    Cache[60s 缓存 按任务级 cacheKey]
    Inflight[任务级 in-flight 去重]
    Hist[历史记录]
  end

  Btn --> Gen
  Gen -->|创建N个GenTask| Tasks
  Gen -->|解码参考图一次共享| RunN[并发执行N个 runTask]
  RunN --> Cache
  RunN --> Inflight
  RunN -->|成功 push| Res
  Res --> Grid
  Tasks --> TL
  TL -->|点X| Cancel
  Cancel -->|abort对应controller| RunN
```

## 5. 模块设计

### 5.1 lib/cache-key.ts
- `CacheKeyInput.n` 字段**移除**：每个任务恒为 n=1，key 不再依赖张数。
- composite 仍含 prompt/model/size/quality/参考图指纹。
- 影响：旧多图缓存（含 n）无法命中——可接受（软缓存仅 60s，且语义已变）。

### 5.2 hooks/useImageGeneration.ts（核心重构）

状态：
```ts
const [tasks, setTasks] = useState<GenTask[]>([]);      // 全部会话任务
const [results, setResults] = useState<GenerateResult[]>([]); // 跨批次累积
// loading 派生：const loading = tasks.some(t => 终态外)
const abortMapRef = useRef<Map<string, AbortController>>(new Map());
```
> `loading` 不再是独立 state，改为 `useMemo` 派生，避免与 tasks 不一致。

`handleGenerate()` 流程：
1. 前置校验（提示词/apiKey）；失败设全局 `error` 并 return。
2. 解析参考图、解码 blob 一次（N 个任务共享）。
3. 生成 `batchId = batch-{ts}`。
4. 创建 N 个 submitting 任务追加 tasks（不预查缓存——缓存检测下沉到 runTask，保持单任务自驱、逻辑单一）。
5. 对每个任务 `runTask(task)` 并发执行（不 await 整批，逐任务自驱，互不阻塞）。

`runTask(task)` 单任务流程（缓存/in-flight/上游三态自决）：
1. 60s 缓存命中检测（任务级 cacheKey，不含 n）；命中 → 更新该任务 success + 把缓存结果 push 到 results（与上游成功路径一致；累积模式下可能与既有图重复，属预期行为），直接 return。
2. in-flight 任务级去重：若相同 cacheKey 已有"非终态"任务（本会话 tasks 检查 + IDB claimInFlight），该任务标记 cancelled，提示"与进行中任务重复"，return。
3. 创建独立 `AbortController` 存入 `abortMapRef`。
4. POST /api/generate（n=1）→ 拿 task_id → 指数退避轮询 → 成功下载 → push results + 更新 success；失败更新 failed + toast；abort → cancelled。
5. finally：从 `abortMapRef` 删除自身 controller；释放 in-flight 占位。

`cancelTask(id)`：
```ts
abortMapRef.current.get(id)?.abort();
// 对应 runTask 的轮询/退避立即 reject(AbortError)，runTask catch 后标记 cancelled
```

全局 `error`：仅前置校验用。生成阶段失败改为每任务条上显示 + toast。

### 5.3 lib/db.ts
- in-flight 去重粒度：批次级 → 任务级（每个 cacheKey 独立 claimInFlight）。
- `claimInFlight` / `releaseInFlight` / `updateInFlightStatus` 接口不变，仅调用方从"每批一次"改为"每任务一次"。
- 历史记录：一次点击的 N 张作为一条 HistoryRecord（results 含 N 张），在批次全部终态后写入（用 batchId 收集成功结果）。

### 5.4 components/UnifiedInputCard.tsx
- Props 变化：
  - 移除 `onCancel` / `pollProgress` / `pollElapsedSec` / `batchProgress`。
  - 新增 `tasks: GenTask[]`、`onCancelTask: (id: string) => void`。
  - `loading` 改为派生值（仍传入，用于按钮样式）。
- 生成按钮：**永远显示"生成"**，disabled 仅当无提示词；不再因 loading 切换成取消。
- 进度区：渲染 `tasks.filter(非终态 或 刚终态需保留短暂展示)`，按 `batchId` 分组；每条进度条右侧加 X 按钮 → `onCancelTask(id)`。终态任务保留 ~1.5s 后淡出移除（成功/失败/取消统一处理，避免列表残留）。
- 进度条样式沿用现有：主色进行中/绿色成功/红色失败/灰色取消，标签 `#slot 等待/{sec}s/完成/失败/取消`。

### 5.5 components/ResultGrid.tsx
- 移除 `loading` 时的 4 格骨架（因为结果累积、loading 已下沉到每任务）。
- `results.length === 0` 且有任务在跑 → 显示"生成中…"文案；否则保持"开始创作"占位。
- 其余（grid / 全部下载 / 展开预览）不变。

### 5.6 app/page.tsx
- `selectedN` state 保留（驱动每次点击创建几个任务）。
- `useImageGeneration` 返回 `tasks` / `results` / `loading` / `cancelTask` / `handleGenerate`。
- 传给 UnifiedInputCard：`tasks`、`onCancelTask={cancelTask}`、`loading`。

### 5.7 lib/user-settings.ts
- 无需改动（`defaultN` 已支持）。

## 6. 数据流

- 成功：`runTask` → `setResults(prev => [...prev, result])` + `setTasks` 更新该任务 success。
- 取消：UI 点 X → `cancelTask(id)` → abort → `runTask` catch AbortError → `setTasks` 更新 cancelled。
- 跨批次累积：`results` 只增不减，直到被历史回填覆盖（此时 revoke 旧 blob URL）。
- 终态淡出：`setTasks` 维护一个"待移除"逻辑——终态任务 setTimeout 1.5s 后从 tasks 移除（仅 UI 层，results 不受影响）。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 无提示词/apiKey | 全局 `error`，不创建任务 |
| 单任务上游 4xx/5xx | 该任务 failed + toast（含错误码文案），其余继续 |
| 单任务轮询超时(3min) | 该任务 failed(TASK_TIMEOUT) + toast |
| 用户取消 | 该任务 cancelled，已成功的不受影响，不写缓存/历史 |
| 相同参数已在跑 | 新任务 cancelled + toast"与进行中任务重复" |
| 缓存命中 | 任务直接 success，不跑上游 |
| 部分成功 | 成功的进 results/历史/缓存；失败的仅 toast，results 不含失败项 |

历史记录写入时机：批次内所有任务终态后，若该批有 ≥1 成功，写一条 HistoryRecord（results=该批成功项）。缓存：每个成功任务独立写缓存（key 不含 n）。

## 8. 边界与取舍

- **并发上限**：不做硬性限流（YAGNI）。n≤4、用户点击节奏自然受限；如日后需要可加"最多 M 并发"信号量。
- **整批取消**：不加（用户明确要单张级）；如日后需要可在批次分组标题加"全部取消"。
- **blob URL 释放**：累积模式下，仅当 results 被历史回填整体替换时 revoke 旧 URL；进行中任务的 URL 不动。
- **终态淡出时长**：1.5s，平衡"看到结果"与"列表不残留"。可调。
- **旧 BatchTaskSlot / 旧 n 缓存**：BatchTaskSlot 移除；旧 n 缓存自然过期（60s）。
- **多标签页 in-flight**：仍靠 IDB claimInFlight 跨标签页去重，逻辑不变，只是粒度到任务。

## 9. 涉及文件

| 文件 | 改动 |
|---|---|
| lib/types.ts | 新增 GenTask；移除 BatchTaskSlot |
| lib/cache-key.ts | 移除 CacheKeyInput.n 及其在 composite 中的项 |
| hooks/useImageGeneration.ts | 核心重构：tasks/abortMapRef/runTask/cancelTask；loading 派生；results 累积 |
| lib/db.ts | in-flight 调用方改任务级（接口不变） |
| components/UnifiedInputCard.tsx | 移除旧进度 props；新增 tasks/onCancelTask；按钮常驻；进度条带 X |
| components/ResultGrid.tsx | 移除 loading 骨架；空态增加"生成中…" |
| app/page.tsx | 适配新 hook 返回值与 props |
| lib/user-settings.ts | 无改动 |

## 10. 兼容性

- `defaultN`、`selectedN`、数量选择器 UI 保持不变。
- 历史记录结构不变（HistoryRecord.results 仍是数组），旧记录可正常回填。
- 60s 缓存语义微变（去 n），旧条目自然过期，无迁移成本。

## 11. 测试要点（手动验证）

对应 AC1~AC6，见 §2 验收标准。重点：
- 并发两批进度条共存、互不干扰。
- 单张 X 只取消该张。
- 相同参数重复点击的去重与缓存两条路径。
- 累积模式下图库不清空、历史正确写入、blob 无泄漏。
