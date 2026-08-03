# 多模型对比功能设计

日期: 2026-08-03
状态: 设计已确认,待写实现计划

## 背景与目标

当前应用一次生成只支持单模型:模型选择器为单选下拉,整个批次的 N 张图都用同一个 model。用户想直观对比不同模型在同一 prompt + 参考图 + 参数下的出图差异,现有流程需切两次模型分别生成,且结果散落在历史里难以对照。

目标:新增"对比模式",一次点击同时用 2 个模型各生成 1 张图,结果并排展示,方便对照风格差异。

## 核心决策(经用户确认)

- **触发:** 模型选择器旁新增"对比"开关。关 = 单模型(现状不变);开 = 对比模式
- **模型数量:** 最多 2 个模型对比,不做 3+
- **每模型出图数:** 固定各 1 张(对比模式隐藏数量选择器)
- **参数:** prompt、参考图、尺寸、质量两模型共用,只模型不同
- **展示:** 并排分组 + 模型标签(对比批次两张图相邻成组,顶部标"A vs B")

## 数据层现状(利好)

探查确认,数据层已天然支持每图记录模型来源,无需大改:

- `GenTask.model: string` 已存在([lib/types.ts:69](file:///d:/jz/image-gen-app/lib/types.ts#L69)),生成时赋值([useImageGeneration.ts:290-302](file:///d:/jz/image-gen-app/hooks/useImageGeneration.ts#L290-L302))
- `GenerateResult.model: string` 已存在([lib/types.ts:23](file:///d:/jz/image-gen-app/lib/types.ts#L23))
- cacheKey 已含 model([lib/cache-key.ts:26](file:///d:/jz/image-gen-app/lib/cache-key.ts#L26)),不同模型同 prompt 天然产生不同 cacheKey,互不干扰

## 设计详情

### 1. 触发与 UI

**对比开关:** 在 `UnifiedInputCard` 现有模型选择器旁加一个 toggle(复用 Button 或 Switch)。状态 `compareMode: boolean`,由 `page.tsx` 持有并下传。

**模型选择:**
- 开关关:现状不变,单选下拉 `selectedModel: string`
- 开关开:现有选择器变"模型 A",下方新增"模型 B"选择器,均为单选下拉(复用 `SelectChip`)。状态 `modelB: string`。默认选一个与 A 不同的模型;用户硬选成相同则前端提示"请选不同模型",生成按钮 disabled

**参数共用:** prompt、参考图、尺寸、质量两模型共用,这部分 UI 完全不动。

**数量选择器:** 对比模式下隐藏(每模型固定 1 张)。开关关闭恢复显示。

### 2. 任务编排

**对比生成流程:**
1. 点生成时,若 `compareMode === true`,创建 2 个 `GenTask`
2. 两个任务**共享同一 batchId**(UI 分组用),但各自 `model` 不同(A/B)
3. 新增 `compareGroup?: string` 字段到 `GenTask` 和 `GenerateResult`,值相同表示"这是一组对比"。生成时用 `batchId` 作为 `compareGroup` 值
4. 2 个任务并发执行,复用现有 `Promise.allSettled` + `runTask` 机制,各自独立 `AbortController`,可单独取消

**单模型生成:** `compareMode === false` 时完全走现有逻辑,`compareGroup` 留空,不受影响。

**缓存:** A/B 两个任务天然走各自 cacheKey(已含 model),互不干扰。in-flight 去重同理按 (prompt, model) 维度,无需改。

### 3. 结果展示

**ResultGrid 改造:**
- 现有 2 列网格保留
- 对比批次(`compareGroup` 相同且非空)的两张图作为一组并排渲染:占用网格相邻两列,顶部一条窄横幅标"模型 A vs 模型 B"
- 单模型批次(`compareGroup` 为空)照旧逐张流入网格
- 每张图右下角小字标模型名(对比和非对比统一显示来源)
- 展开大图预览:对比组两张图可单独点击展开,展开预览里也标模型

**分组实现:** `results` 仍是扁平数组,渲染时按 `compareGroup` 聚合——同 `compareGroup` 的两张并排成组,无 `compareGroup` 的单独成项。

### 4. 历史与持久化

- `HistoryRecord.params.model` 保持单值(取模型 A)。`results[]` 每项自带 `model` + `compareGroup`,天然记录来源
- 历史回填时,有 `compareGroup` 的结果按并排分组展示;无则普通流式
- IndexedDB store 结构不变(`history`/`prompt_cache`/`in_flight`),只在记录里多存 `compareGroup` 字段。旧记录无此字段按单模型展示,兼容

### 5. 错误处理

- 对比组中一个失败、一个成功:成功的正常展示并标"对方失败",失败位显示错误占位但不阻塞成功图。用户可单独重试失败的
- 两个都失败:两位置都显示错误,可各自重试
- 取消:可单独取消某个模型的任务,另一个继续

### 6. 范围边界

- 最多 2 模型对比,不做 3+
- 对比模式不影响普通单模型生成的任何现有行为
- 不做"对比模板保存""对比结果导出"等附加功能

## 影响面清单

| 文件 | 改动 |
|---|---|
| `lib/types.ts` | `GenTask` + `GenerateResult` 新增 `compareGroup?: string` |
| `components/UnifiedInputCard.tsx` | 新增对比开关 + 模型 B 选择器;对比模式隐藏数量选择器 |
| `app/page.tsx` | 持有 `compareMode` + `modelB` 状态,下传给 UnifiedInputCard 和 useImageGeneration |
| `hooks/useImageGeneration.ts` | `handleGenerate` 支持对比模式:创建 2 个任务带 `compareGroup`;`GenerateResult` 赋值 `compareGroup` |
| `components/ResultGrid.tsx` | 渲染时按 `compareGroup` 聚合分组;每张图标模型名;对比组顶部横幅 |

`lib/cache-key.ts`、`lib/db.ts`、`app/api/*` 无需改。
