# FINAL: prompt-optimize（AI 优化提示词）

## 需求与方向变更

- 2026-10-15：先做本地规则扩写看效果（零成本）。
- 2026-10-15 亲测反馈：「跟需要的效果不太搭」——确认两类问题：**补的内容与用户已表达的风格/情绪打架**、**补的内容与要画的画面无关**。
- 2026-10-16 调研主流做法（Ideogram / Leonardo / Venice / 豆包 / Fooocus），结论：主流全部是 LLM 改写，差异在"给用户控制权"；并且 **gpt-image 系模型不会自己改写提示词**（官方 SDK：`revised_prompt` "Not returned by GPT image models"）。
- 2026-10-17：用户定 **走 LLM**，并要求对话模型可以用其他节点。

## 架构

```
浏览器 → POST /api/optimize（无状态透传）→ 上游 /chat/completions → 改写后的提示词
                     ↓
        模型自动挑选：客户端指定 > OPT_MODEL > /models 挑选 > 常见型号探测
```

- **不落任何数据**：Key 与 BaseURL 沿用 `resolveUpstream`（BYO 请求头 / 服务端 env，同源不变式 + SSRF 基线）。
- **独立接口配置**：设置里「提示词优化接口」自己填 Base URL / Key / 模型 / 代理（`image-gen-optimize-config`），**不占用生图节点列表**、也不需要「启用」；生图节点保持不动。两者都没填时才回落到当前生图节点。旧版「优化节点」配置会在首次加载时自动迁移成该独立配置并删除旧键。
- **优化模型可钉死**：同一表单里的「模型」（`OptimizeConfig.model`），下拉选项来自该接口的 `/api/models?type=chat`（只列非图像/向量/语音模型），也允许手填——中转的模型名不常见（如 `deepseek-v4-flash-0731`）时务必填写，自动挑只能按名单/排除法猜，猜错会挑到无关模型（实测某节点列表首个 `Agents-A1` 会超时）。
- **模型挑选**：客户端/节点指定 > `OPT_MODEL` > `/models` 优先名单（gpt-4o-mini / gpt-4.1-mini / deepseek-chat…）→ 第一个非图像/非向量/非语音模型；列表为空或全不可用（不少中转对普通 token 隐藏 `/models`）时，按常见对话模型逐个探测（400/404/422 才继续，401/403 立即终止）。
- **只发 `model` + `messages`**：不同厂商对 `max_tokens` / `temperature` 的兼容性不一，少发一个参数少一类失败。
- **超时与预算**：单次改写 `OPT_TIMEOUT_MS`（默认 45s，推理系模型延迟波动大）；整请求 `OPT_TOTAL_BUDGET_MS`（默认 50s，须低于平台 60s）；`/models` 探测 8s；请求体 `OPT_MAX_BODY_MB`（默认 1MB）。失败返回稳定 `OPT_*` 错误码。

## 交互（对齐行业范式）

1. **改写可见**：结果直接回填输入框，toast 提供「撤销」（目标始终是优化前原文）。
2. **fail-open**：AI 改写失败 → **不改动原文**，toast 说明原因（`OPT_NO_CHAT_MODEL` 时提示去设置里配置优化接口）。
3. **可选兜底**：失败 toast 里提供「用本地规则」按钮——是否退回模板输出由用户决定，**不静默降级**到已知不贴合的产物。
4. **连点换一版**：以原文为基底重写，并把上一版作为 `avoid` 交给模型避免雷同。
5. **竞态保护**：请求期间用户改了文本 → 丢弃本次结果，不覆盖刚敲的字。
6. **节点记忆**：节点里钉死的「优化模型」优先；未钉死时用上次成功的模型（`model` 字段），下次免探测，失败后自动解除。
7. **预填自测**：`/?prompt=<文本>` 会把提示词预填进输入框（URL 编码），方便分享与自测。

## 改写指令的七条约束

`lib/prompt-optimizer.ts` 的 system prompt 是质量关键，对应此前实测问题：

1. 守住意图（主体/风格/情绪/色调/画幅/文字不动，不许写成相反方向）；
2. 只补画面（主体特征、环境、光线、视角构图、材质）；
3. 不许编造（不新增与主旨无关的道具/人物/文字）；
4. 不许空话（禁 8K、超高清、大师作品等）；
5. 长度 1.5~2.5 倍、中文 30~120 字；原文超 200 字只精炼；
6. 只输出提示词本身（去引号/围栏/前缀由 `sanitizeOptimizedPrompt` 兜底）；
7. 语言跟随输入。

另带上下文：画幅比例、是否带参考图（图生图要求"保留主体改风格"而非重画）。

## 交付文件

- `lib/prompt-optimizer.ts`：指令构造、输出清洗、模型挑选（纯函数；`isChatModel` 同时供模型列表接口复用）。
- `lib/optimize-endpoint.ts`：优化接口解析（纯函数：独立配置优先，未配置回落当前节点）。
- `app/api/optimize/route.ts`：透传路由 + 模型探测 + 错误码映射。
- `app/api/models/route.ts`：新增 `?type=chat`，给「优化模型」下拉返回对话模型（失败返回空列表，不回退假模型）。
- `hooks/usePromptOptimize.ts`：异步交互（loading、撤销、竞态、本地兜底入口）。
- `lib/api-config-context.tsx`：新增 `optimizeId` / `setOptimizeId`（含跨标签页同步、删节点时清理悬空指针）。
- `components/SettingsDialog.tsx`：新增「提示词优化接口」独立表单（Base URL / Key / 模型 / 代理 + 保存；模型下拉取自该接口 `/models?type=chat`）。
- `components/UnifiedInputCard.tsx` / `components/mobile/Composer.tsx` / `MobileHome.tsx` / `app/page.tsx`：按钮 loading 态与接线。
- `lib/http-client.ts`：`httpJsonPost` 支持按场景覆盖超时。
- `lib/error-messages.ts`：新增 `OPT_NO_CHAT_MODEL` / `OPT_UPSTREAM_FAILED` / `OPT_BAD_RESPONSE`。
- 本地规则引擎保留：`lib/prompt-enhancer.ts`，仅作为用户主动选择的兜底。

## 输入规则与创作须知（2026-10-18）

- 提示词上限 `MAX_PROMPT_CHARS = 2000`（`lib/prompt-rules.ts`）：输入框 `maxLength`、界面计数、`/api/generate` 与 `/api/optimize` 校验**同源**；超限返回 `REQ_PROMPT_TOO_LONG`，不做静默截断（`?prompt=` 预填除外，按上限截断）。
- 输入卡（桌面/移动）把「字数 / 2000」「创作须知」与「优化提示词」并到同一行元信息里（原优化按钮独占一行，已移除）。
- 创作须知通过统一组件 `components/PromptGuide.tsx` 展示：写什么（主体 + 动作/环境 + 风格/光线/画幅）、长度、八类常见禁止内容，并明确说明上游可能另有审核词表。
- 移动端补齐 @ 提及参考图（此前仅桌面支持），交互与桌面一致：输入 @ 弹出图片列表，点选插入 `@图片名`。
- 移动端交互修正（2026-10-18）：点「生成」**不再自动跳到结果页**——进度条（聚合百分比）、失败提示与「已生成 N 张 · 查看」入口都在主界面底部坞；结果页改为手动进入。同时补上移动端的生成错误提示（此前桌面有横幅、移动端完全看不到），与桌面共用同一份 `error` 状态。
- 模型名同步（2026-10-18）：`/api/models` 走 `lib/model-list.ts` 统一解析上游列表，兼容 `{data:[{id}]}`、裸数组、Google 风格 `{models:[{name:"models/xxx"}]}`（自动去 `models/` 前缀、保留 `supported_endpoint_types`）。节点不实现 `/models` 时仍回落兜底 GPT-Image2——此时必须在节点设置的「自定义模型」里手动补上服务商真实支持的生图模型 id，否则上游会报 "not supported model"。

## 验证

- `node scripts/check-prompt-optimizer.mts` → **59/59**：清洗（围栏/中英前缀/引号/换行/超长截断）、模型挑选（偏好顺序、厂商前缀、版本化 id、图像/TTS 排除、全图像时返回 null）、对话模型判定（`isChatModel`）、改写计划（首次/换版/用户改动/原文丢失）、画幅白名单、指令（图生图/画幅/换版/超长截断）、优化接口解析（独立配置优先/只填一半视为未配置/回落当前节点/无节点时 null）。
- `node scripts/check-prompt-enhancer.mts` → **46/46**（本地兜底引擎回归）。
- `npx tsc --noEmit` 0 错误；`npm run lint` 0 错误（6 条既有 `<img>` 警告）。
- 路由端到端（本地 mock 上游，`REVIEW.md` 有完整处置记录）：正常改写 / `/models` 为空时探测候选 / 对话端点全 404 → `OPT_NO_CHAT_MODEL` / 非 JSON 与空内容 → `OPT_BAD_RESPONSE` / 首个候选超时 → 自动换下一个成功 / 上游不可达 → `OPT_UPSTREAM_FAILED`，全部符合预期；模型自动跳过图像模型选中 `gpt-4o-mini`。
- 交互幂等（mock 上游）：连点两次，第二次请求带 `avoid` 且结果正常回填（修复前会因竞态守卫被 100% 丢弃）；带尾随空换行的首轮也正常应用。
- 浏览器实机：点击 → 回填 AI 改写结果 + toast「撤销」；切到无对话模型时 → 原文不变 + 错误 toast（含原因与节点提示）+ 点「用本地规则」可退回本地扩写；设置里「提示词优化」区块的节点/模型下拉正常，模型下拉能从该节点拉到 11 个对话模型并持久化到节点。
- **真实节点端到端（2026-10-17）**：用户提供的对话节点（`deepseek-v4-flash-0731`）——`/?prompt=忧郁的少女` 预填 → 点优化 → 回填「忧郁的少女，低垂着眼眸，坐在昏暗房间的窗边，灰蓝冷色调，细雨朦胧，柔光勾勒出侧脸轮廓，安静而伤感。」：守住了「忧郁」（冷色调/伤感），补的是画面内容而非摄影术语，长度约 45 字。附带结论：该节点 `/models` 可列出 11 个模型，但**自动挑**会选中列表首个 `Agents-A1` 并超时，因此「优化模型」设置项是必要的。
- 旧的 `.env` 中转 Key 仍返回 `401 Invalid token`（与本次验证无关，生图节点未改）。

## 已知边界

- 需要一个支持 `/chat/completions` 的节点；纯图像中转会报 `OPT_NO_CHAT_MODEL`（已在 UI 引导去设置换节点）。
- 中转的模型命名不标准（如 `deepseek-v4-flash-0731`）时，**自动挑可能挑错**；在节点设置里填「优化模型」钉死。
- 每次点击消耗少量对话额度；不做缓存（同一提示词重复点会重新改写）。
- 模型兼容性：只发 `model` + `messages`，避免 `max_tokens`/`temperature` 差异；若节点只提供推理系模型（o 系/gpt-5），响应可能偏慢但应可用。
- 不做"自动判断是否需要改写"；用户点一次就改写一次。
- 桌面端 `@` 提及弹窗在输入框自动长高时不会实时跟随（下一次输入/滚动/resize 重新锚定）。
