# REVIEW: prompt-optimize（独立评审 + 处置）

评审对象：工作区未提交的 prompt-optimize 全部改动（HEAD `13ff07d`）。
评审方式：独立 reviewer（只读、未改文件），对照 `FINAL_prompt-optimize.md` 与仓库既有不变量；本文记录结论与处置。

## 结论

**修复前：Not ready（1 Critical / 4 Important）。** 修复后：关键项已全部处理，纯函数测试 37→57 条，路由六条路径与幂等性实机复验通过。

## Critical（已修复）

**C1. “换一版”永久失效**（`hooks/usePromptOptimize.ts`）
- 现象：第二次点击时 `base` 是原文，而竞态守卫却拿 `promptRef.current.trim() !== base` 比较——输入框里是上一版结果，恒不相等，结果 100% 被丢弃；请求已发出（白花额度），用户只看到“提示词已改动”。
- 同时误伤首轮：`base` 未 trim，带尾随换行/空格的粘贴文本首轮也会被丢弃。
- 修复：抽出纯函数 `lib/prompt-optimizer.ts` 的 `planOptimize()`，把「基底 / 竞态期望文本 / avoid / variant」分开建模；守卫改为比较 `plan.requestText`（点击瞬间框里的内容）。
- 验证：单测覆盖首次/换版/用户改动/原始文本丢失四种情形；浏览器实机连点两次，第二次产出带「（第2版）」标记（mock 上游），mock 日志确认 `avoid=true`；带 `\n\n` 尾随空白的首轮也正常应用。

## Important（已修复）

**I1. 空结果被误报为 `OPT_NO_CHAT_MODEL`**（`app/api/optimize/route.ts`）
- 模型返回 2xx 但内容不可用（空/非 JSON）时，最终却报“该节点没有可用的对话模型”，把用户引向错误的排查方向。
- 修复：失败按 `no-model` / `bad-response` / `upstream` 三类建模，分别映射 `OPT_NO_CHAT_MODEL` / `OPT_BAD_RESPONSE` / `OPT_UPSTREAM_FAILED`。
- 验证：mock 四种模式（正常 / 全 404 / 非 JSON / 空内容）逐一命中预期错误码。

**I2. 切换优化节点后仍沿用旧节点的模型名**（`hooks/usePromptOptimize.ts`）
- `modelRef` 无节点维度，切节点后首次请求会发上一节点的模型名 → 404 → 误报“该节点没有对话模型”，且要再点一次才恢复。
- 修复：`apiKey/baseUrl/proxyUrl` 变化时重置 `modelRef`；`catch` 分支同样清空（与 HTTP 失败路径一致）。

**I3. 自动挑中的模型超时即终止，fallback 候选形同虚设**（`app/api/optimize/route.ts`）
- 超时被当作整条链路失败，导致“自动挑错模型”时永远失败（实测 `Agents-A1` 场景）。
- 修复：超时（`TimeoutError`/`AbortError`）视为该候选失败并继续下一个；DNS/TLS 等换模型无救的失败仍立即返回。新增总预算 `OPT_TOTAL_BUDGET_MS`（50s）与 `/models` 探测超时（8s），避免多个候选各等 45s 撞上平台 60s 上限。
- 验证：mock `slowfirst` 模式下首选模型挂起 6s（请求超时 2.5s），第二个候选成功返回。

**I4. 测试缺口放过 C1**（`scripts/check-prompt-optimizer.mts`）
- 修复：新增 `planOptimize`、`normalizeSize`、版本化模型 id、`isChatModel`、英文引导语前缀/围栏外解释等断言；测试总数 57。

## Minor（按需处理）

已处理：
- `/api/optimize` 增加 `content-length` 上限（`OPT_MAX_BODY_MB`，默认 1MB）。
- `size` 经 `normalizeSize()` 白名单收敛后才拼进 system prompt（防注入）。
- 日志中的上游错误文本截断到 200 字符（避免回显用户输入）。
- 清洗器支持 `Here is the optimized prompt:` 前缀与“围栏外解释”抽取。
- 偏好模型匹配支持版本化 id（`gpt-4o-mini-2024-07-18`），并先用 `isChatModel` 排除 `*-tts`。
- 设置里切换节点时，旧节点的模型列表不再短暂可用（列表按节点 id 归属）。
- 外部保存不再覆盖正在输入的模型草稿（仅在打开弹窗/切换节点时同步）。
- `/api/models?type=chat` 兼容裸数组响应。
- 超时默认值与文档同步（45s；FINAL 原写 25/30）。

未处理（记录在案）：
- 失败 toast 的“用本地规则”不做竞态校验（它是显式操作，覆盖当前文本符合预期）。
- 公开部署的零鉴权中继、Vercel 4.5MB / 60s 平台限制：既有设计取舍，非本功能引入。
- Android WebView 上的触控/键盘细节：当前环境无法实机验证。

## 仍然存在的客观风险

- 用户提供的对话节点（推理模型）延迟波动大：实测 6s / 10s / 20s / 30s+ / 45s 超时均出现过。45s 已是 Vercel 60s 上限下的合理上限；自托管可用 `OPT_TIMEOUT_MS` 放宽。建议优先选更快的小模型。
