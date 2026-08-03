# 多模型对比功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"对比模式",一次点击同时用 2 个模型各生成 1 张图,结果并排成组展示。

**Architecture:** 复用现有并发任务机制。对比模式下创建 2 个 GenTask(共享 batchId + compareGroup),各自独立模型。数据层 GenTask.model/GenerateResult.model 已存在,只需新增 compareGroup 字段。UI 加对比开关 + 模型B选择器,ResultGrid 按 compareGroup 聚合并排展示。

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript / Tailwind / sonner

---

## 文件结构

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `lib/types.ts` | 类型定义 | 修改:GenTask + GenerateResult 加 compareGroup |
| `app/page.tsx` | 顶层状态编排 | 修改:持有 compareMode/modelB 状态,下传 |
| `components/UnifiedInputCard.tsx` | 输入区 UI | 修改:对比开关 + 模型B选择器 + 隐藏数量 |
| `hooks/useImageGeneration.ts` | 生成逻辑 | 修改:options 加 compareMode/modelB,handleGenerate 分支创建对比任务 |
| `components/ResultGrid.tsx` | 结果展示 | 修改:按 compareGroup 聚合,对比组并排+横幅,每图标模型名 |

无需新建文件。cache-key/db/api 路由无需改。

---

## Task 1: 类型层加 compareGroup 字段

**Files:**
- Modify: `lib/types.ts:14-28` (GenerateResult)
- Modify: `lib/types.ts:61-82` (GenTask)

- [ ] **Step 1: 给 GenerateResult 加 compareGroup**

在 `lib/types.ts` 的 `GenerateResult` 接口,`favorite` 字段后加:

```typescript
  /** 对比组标识:同值表示这组图是一次多模型对比产生的,用于并排分组展示。单模型生成留空 */
  compareGroup?: string;
```

- [ ] **Step 2: 给 GenTask 加 compareGroup**

在 `lib/types.ts` 的 `GenTask` 接口,`createdAt` 字段前加:

```typescript
  /** 对比组标识(同 GenerateResult.compareGroup),单模型任务留空 */
  compareGroup?: string;
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): GenTask 与 GenerateResult 新增 compareGroup 字段"
```

---

## Task 2: useImageGeneration 支持对比模式

**Files:**
- Modify: `hooks/useImageGeneration.ts:51-59` (UseImageGenerationOptions)
- Modify: `hooks/useImageGeneration.ts:220-303` (handleGenerate 任务创建段)
- Modify: `hooks/useImageGeneration.ts:312-330` (runTask 缓存命中段)
- Modify: `hooks/useImageGeneration.ts:387-410` (result 赋值段)
- Modify: `hooks/useImageGeneration.ts:443-449` (历史记录段)

- [ ] **Step 1: options 加对比字段**

在 `hooks/useImageGeneration.ts` 的 `UseImageGenerationOptions` 接口,`n` 字段后加:

```typescript
  /** 对比模式开关:开启时用 model + modelB 各出1张 */
  compareMode?: boolean;
  /** 对比模式下的第二个模型(compareMode=true 时生效) */
  modelB?: ModelId;
```

- [ ] **Step 2: handleGenerate 开头解构新字段**

在 `handleGenerate` 函数内,找到 `const batchId = genId("batch");` 这行(约 236 行),在其**前面**加对比模式的分支判断。把任务创建逻辑改成根据 compareMode 走不同路径。

定位 `const batchId = genId("batch");`(约236行),替换为:

```typescript
    const batchId = genId("batch");
    // 对比模式:2 个任务各用不同模型,共享 batchId + compareGroup
    const isCompare = compareMode && modelB && modelB !== model;
    const compareGroup = isCompare ? batchId : undefined;
    // 对比模式固定 2 任务(每模型1张),非对比走原 n
    const taskCount = isCompare ? 2 : n;
```

- [ ] **Step 3: 修改任务创建,对比模式每个任务带自己的 model**

定位创建任务的 `Array.from({ length: n }` 段(约 290 行),替换为:

```typescript
    // 创建 taskCount 个 submitting 任务
    // 对比模式:任务0用 model,任务1用 modelB;非对比:全部用 model
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
    }));
    setTasks((prev) => [...prev, ...newTasks]);
```

- [ ] **Step 4: runTask 内 result 赋值时带 compareGroup**

runTask 函数内,task 的 model 不再恒等于闭包的 model(对比模式任务1用 modelB)。需要用 `task.model` 而非闭包 `model`。

定位缓存命中段 `const result: GenerateResult = { ...src,` (约 322 行),在对象里 `imageUrl` 后加一行:

```typescript
          compareGroup,
```

定位异步分支 result 赋值(约 387 行),把 `model,` 改成 `model: task.model,`,并在 `createdAt` 前加:

```typescript
            compareGroup,
```

定位同步分支 result 赋值(约 401 行),同样把 `model,` 改成 `model: task.model,`,并在 `createdAt` 前加:

```typescript
            compareGroup,
```

- [ ] **Step 5: cacheKey 改为每模型独立(对比模式 2 个 key)**

对比模式两个任务 model 不同,不能用单一批次 cacheKey。定位 `const cacheKey = await buildCacheKey(...)` (约 239 行),替换为按任务维度算 key:

```typescript
    // cacheKey 按模型维度:对比模式两个任务各自独立 key
    const buildKeyForModel = async (m: string) =>
      buildCacheKey({
        prompt: trimmedPrompt,
        model: m,
        size,
        quality,
        referenceImages: referencedImages,
      });
```

然后 runTask 内原来用 `cacheKey` 的地方(缓存命中 `getPromptCache(cacheKey)`、缓存写入 `setPromptCache(cacheKey,...)`)改为用 `await buildKeyForModel(task.model)`。in-flight 抢占同理:对比模式每任务独立 claim。

> 注意:runTask 内多次调用 buildKeyForModel 会有重复哈希开销,但 buildCacheKey 是纯计算(SHA-256 on small string),开销可忽略,优先保证正确性。

- [ ] **Step 6: 历史记录 params.model 取模型A,results 自带 model**

定位历史记录创建(约 445 行),`params: { prompt: trimmedPrompt, model, size, quality, n }` 不变(model 取闭包值即模型A)。`results: batchResults` 已自带每项 model + compareGroup,无需改。

- [ ] **Step 7: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add hooks/useImageGeneration.ts
git commit -m "feat(gen): useImageGeneration 支持对比模式双模型并发"
```

---

## Task 3: UnifiedInputCard 加对比开关与模型B选择器

**Files:**
- Modify: `components/UnifiedInputCard.tsx:18-36` (Props)
- Modify: `components/UnifiedInputCard.tsx:345-359` (模型/数量选择区)

- [ ] **Step 1: Props 加对比相关字段**

在 `components/UnifiedInputCard.tsx` 的 `UnifiedInputCardProps` 接口,`onNChange` 后加:

```typescript
  /** 对比模式开关 */
  compareMode: boolean;
  onCompareModeChange: (on: boolean) => void;
  /** 对比模式第二个模型 */
  modelB: string;
  onModelBChange: (m: string) => void;
```

- [ ] **Step 2: 加对比开关 + 模型B选择器,对比模式隐藏数量**

定位模型选择区(约 345 行 `<SelectChip value={selectedModel}...`),在该 SelectChip 后插入对比开关;数量 SelectChip 用 compareMode 条件渲染。替换 345-359 整段为:

```tsx
          {/* 模型 A 选择 */}
          <SelectChip value={selectedModel} onChange={onModelChange} options={models.map((m) => ({ value: m.id, label: m.name }))} />

          {/* 对比开关 */}
          <Button
            variant={compareMode ? "default" : "outline"}
            size="sm"
            className="press transition-base"
            onClick={() => onCompareModeChange(!compareMode)}
            aria-pressed={compareMode}
          >
            对比
          </Button>

          {/* 模型 B 选择:仅对比模式显示 */}
          {compareMode && (
            <SelectChip value={modelB} onChange={onModelBChange} options={models.map((m) => ({ value: m.id, label: m.name }))} />
          )}

          {/* 比例选择 */}
          <SelectChip value={selectedSize} onChange={onSizeChange} options={SIZES} />

          {/* 清晰度 */}
          <SelectChip value={selectedQuality} onChange={onQualityChange} options={QUALITIES} />

          {/* 生成数量:对比模式隐藏(固定每模型1张) */}
          {!compareMode && (
            <SelectChip
              value={String(selectedN)}
              onChange={(v) => onNChange(Number(v) as 1 | 2 | 3 | 4)}
              options={COUNTS}
            />
          )}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 可能报 page.tsx 未传新 props(下个 Task 修),先确认本文件无语法错

- [ ] **Step 4: Commit**

```bash
git add components/UnifiedInputCard.tsx
git commit -m "feat(ui): UnifiedInputCard 加对比开关与模型B选择器"
```

---

## Task 4: page.tsx 持有对比状态并下传

**Files:**
- Modify: `app/page.tsx:47-86` (状态声明 + hook 调用)
- Modify: `app/page.tsx` 的 UnifiedInputCard 使用处

- [ ] **Step 1: 加对比状态**

在 `app/page.tsx` 的 `selectedN` state 后(约 53 行)加:

```typescript
  // 多模型对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [modelB, setModelB] = useState<ModelInfo["id"]>("gpt-image-2");
```

- [ ] **Step 2: hook options 传入对比字段**

定位 `useImageGeneration({...})` 调用(约 79 行),在 `n: selectedN,` 后加:

```typescript
    compareMode,
    modelB: modelB as ModelId,
```

- [ ] **Step 3: UnifiedInputCard 传入对比 props**

找到 `<UnifiedInputCard` 使用处,在 `onNChange={setSelectedN}` 后加:

```tsx
          compareMode={compareMode}
          onCompareModeChange={setCompareMode}
          modelB={modelB}
          onModelBChange={setModelB}
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(page): page.tsx 持有对比模式状态并下传"
```

---

## Task 5: ResultGrid 按 compareGroup 聚合并排展示

**Files:**
- Modify: `components/ResultGrid.tsx:119-150` (网格渲染段)

- [ ] **Step 1: 写分组工具函数**

在 `components/ResultGrid.tsx` 的 `ResultGrid` 函数体内,`return` 前加分组逻辑。把扁平 results 按 compareGroup 聚合成"渲染项"数组:有 compareGroup 的两两成组,无的单独成项。

```typescript
  // 按 compareGroup 聚合:同组两项并排,无组单独成项
  type RenderItem =
    | { type: "single"; result: GenerateResult; index: number }
    | { type: "compare"; a: GenerateResult; b: GenerateResult; indexA: number; indexB: number };

  const renderItems: RenderItem[] = [];
  const consumed = new Set<number>();
  results.forEach((r, i) => {
    if (consumed.has(i)) return;
    if (r.compareGroup) {
      const pairIdx = results.findIndex((r2, j) => j > i && r2.compareGroup === r.compareGroup);
      if (pairIdx > -1) {
        consumed.add(i); consumed.add(pairIdx);
        renderItems.push({ type: "compare", a: r, b: results[pairIdx], indexA: i, indexB: pairIdx });
        return;
      }
    }
    renderItems.push({ type: "single", result: r, index: i });
  });
```

- [ ] **Step 2: 网格按 renderItems 渲染**

定位 `<div className="grid grid-cols-2 gap-3">` 内的 `results.map(...)` (约 120 行),替换为 `renderItems.map(...)`,分 single/compare 两种渲染:

```tsx
      <div className="grid grid-cols-2 gap-3">
        {renderItems.map((item) => {
          if (item.type === "compare") {
            // 对比组:占整行两列,顶部横幅标 A vs B
            return (
              <div key={item.a.compareGroup} className="col-span-2 space-y-1 animate-fade-up">
                <div className="text-xs text-muted-foreground px-1">
                  模型对比 · {item.a.model} vs {item.b.model}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[item.a, item.b].map((result, idx) => (
                    <ResultCard
                      key={result.id}
                      result={result}
                      index={idx === 0 ? item.indexA : item.indexB}
                      showModelLabel
                      onExpand={(i) => { setExpandedIndex(i); setZoom(1); }}
                      onDownload={handleDownload}
                      getImageSrc={getImageSrc}
                    />
                  ))}
                </div>
              </div>
            );
          }
          return (
            <ResultCard
              key={item.result.id}
              result={item.result}
              index={item.index}
              showModelLabel
              onExpand={(i) => { setExpandedIndex(i); setZoom(1); }}
              onDownload={handleDownload}
              getImageSrc={getImageSrc}
            />
          );
        })}
      </div>
```

- [ ] **Step 3: 抽取 ResultCard 子组件**

在 `ResultGrid.tsx` 文件内(`ResultGrid` 函数外)新增一个 `ResultCard` 组件,封装单张图卡渲染(含模型名标签),避免重复代码:

```tsx
function ResultCard({
  result, index, showModelLabel, onExpand, onDownload, getImageSrc,
}: {
  result: GenerateResult;
  index: number;
  showModelLabel?: boolean;
  onExpand: (index: number) => void;
  onDownload: (r: GenerateResult) => void;
  getImageSrc: (r: GenerateResult) => string;
}) {
  return (
    <div
      className="group relative aspect-square rounded-xl overflow-hidden bg-muted cursor-pointer ring-1 ring-border/50 press-sm animate-fade-up"
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={() => onExpand(index)}
    >
      <FadeInImage
        src={getImageSrc(result)}
        alt={result.prompt}
        className="w-full h-full object-cover transition-slow group-hover:scale-105"
      />
      {/* 模型名标签 */}
      {showModelLabel && (
        <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 transition-base">
          {result.model}
        </span>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-base flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
        <Button variant="secondary" size="icon" className="press"
          onClick={(e) => { e.stopPropagation(); onDownload(result); }} aria-label="下载">
          <Download className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 确认 FadeInImage/Download/Button 已 import**

检查文件顶部 import 是否已含 `FadeInImage`(若有)、`Download`、`Button`。若 FadeInImage 是本文件内定义的组件则无需 import。

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: lint 检查**

Run: `npm run lint`
Expected: 无 error(warning 可接受)

- [ ] **Step 7: Commit**

```bash
git add components/ResultGrid.tsx
git commit -m "feat(ui): ResultGrid 按 compareGroup 聚合并排展示,每图标模型名"
```

---

## Task 6: 手动验证与边界检查

**Files:** 无代码改动,纯验证

- [ ] **Step 1: 启动 dev server**

Run: `npm run dev`
确认 http://localhost:3000 可访问

- [ ] **Step 2: 验证单模型生成未受影响**

关闭对比开关 → 选模型A → 设数量2 → 生成。预期:2 张图流入网格,行为与改动前一致。

- [ ] **Step 3: 验证对比模式生成**

打开对比开关 → 确认数量选择器消失 → 选模型B(与A不同) → 生成。预期:2 张图并排成组,顶部显示"A vs B",每张右下角 hover 显示模型名。

- [ ] **Step 4: 验证相同模型拦截**

对比模式选 B = A → 点生成。预期:生成不执行或提示(由 useImageGeneration 内 isCompare 判断,modelB===model 时 isCompare=false,会退化为单模型2张——需确认是否符合预期,若要硬拦在 UI 层加 disabled)。

- [ ] **Step 5: 验证单独取消**

对比模式生成中 → 取消其中一个任务。预期:另一个继续,取消的不阻塞。

- [ ] **Step 6: 验证历史回填**

生成一组对比 → 打开历史 → 选中该记录。预期:结果区按对比组并排展示。

- [ ] **Step 7: 最终 lint + tsc**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 error

---

## 自审检查

- **spec 覆盖:** 触发UI(Task3)✓、任务编排(Task2)✓、结果展示(Task5)✓、历史持久化(Task2 Step6 + GenerateResult 自带字段)✓、错误处理(Task2 复用现有 per-task catch + Task6 Step5 验证)✓、范围边界(最多2模型,compareMode 关闭走原逻辑)✓
- **占位符:** 无 TODO/TBD
- **类型一致:** compareGroup: string | undefined 贯穿 GenTask/GenerateResult/renderItems;ResultCard props 一致
- **注意点:** Task2 Step5 cacheKey 改动是本计划最复杂处,需确保 runTask 内所有原 cacheKey 引用都替换为 buildKeyForModel(task.model);in-flight claim 同理按模型独立
