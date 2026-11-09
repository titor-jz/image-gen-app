# PLAN · 局部重绘（Mask Inpainting）

> 状态：**V1 已实现**（2026-11-09）—— 验证结论见 §0；实现落地见 §10
> 关联：`AGENTS.md`（架构边界 / 已知坑）、`docs/model-routing/PLAN.md`（同套写法）
> 证据图：`design-demos/probe-2026-11-09/`（8 张，编号对应 §0）· 探针工具：`scripts/inpaint-probe/`

## 0. 结论（2026-11-09 实测 · 节点 kuaiai.69069.xyz · gpt-image-2）

| # | 断言 | 结果 |
|---|---|---|
| 1 | 节点恢复、文生图内容与提示词相符 | ✅ 恢复（`01-base-t2i.png` 白棚/深棕木桌/红苹果/蓝杯，逐项相符） |
| 2 | 上游尊重 `mask` | ❌ **不尊重**（§0.1） |
| 3 | 中文提示词在 multipart 下生效 | ❌ → ✅ **修复后生效**（§0.2） |

### 0.1 mask 不被尊重 —— 两条独立判别式

| 实验 | 设计 | 结果 | 图 |
|---|---|---|---|
| A/B 互为空集 | 同一 prompt，mask 互为补集（可重绘区 11.3% vs 88.7%） | 两臂输出几乎相同，**全图差异仅 0.0097** | — |
| 全局提示词 × 局部 mask | mask=杯子，prompt=「全图转黑白」 | 整张图都变黑白，mask 外照变 | `02` |
| 提示词目标与 mask 相错 | mask=杯子，prompt=「红苹果变绿梨」 | **苹果变绿梨、杯子一动不动** | `03` |

结论：变化区域只跟**提示词**走，与 mask 无关。中转对 mask 的处置属于「接受参数但忽略语义」——HTTP 200 完全不能作为能力证据。

### 0.2 中文提示词被吞（已修复）

| 场景 | 结果 | 图 |
|---|---|---|
| 中文 prompt + multipart 无 charset（直连中转） | ❌ 忽略提示词：黑白指令不动图 / 凭空多出一个杯子 | `04` `07` |
| 英文 prompt + multipart 无 charset | ✅ 完全正常（红苹果→绿梨，其余不动） | `05` |
| 中文 prompt + prompt 部件声明 `charset=utf-8` | ✅ 完全正常 | `06` |
| 经自家 `/api/generate`（真实浏览器 FormData，修复后） | ✅ 完全正常 | `08` |

**根因**：undici 的 `FormData` 给文本字段只发 `Content-Disposition`、**不发 Content-Type**（用本地 echo server 抓原始字节确认）；中转对没有 charset 的字段按 latin-1 解码 → 模型收到乱码。
**修复**：`lib/http-client.ts` 新增 `httpMultipartRequest`（手写 multipart，文本部件默认 `text/plain; charset=utf-8`），`/api/generate` 的两处 multipart 调用点改用它。

> **这条不止影响本功能**：图生图（参考图）本来就跑 multipart `/images/edits`，所以**参考图生图对中文提示词此前是整体失效的**（英文正常，故不易察觉）。纯文生图走 JSON，不受影响。

> **排查陷阱**：用 `curl -F "prompt=中文"` 打**自家** `/api/generate` 会得到假阴性 —— curl 的 `-F` 也不带 charset，中文在「client→app」这一段就被 Next 解坏了。真实浏览器不会（实测 `request.formData()` 解析中文无损）。自测中文链路要用浏览器，或给 curl 补 `;type=text/plain;charset=utf-8`。

## 1. 需求

用户原话：「我才听说支持局部编辑或者局部重绘功能是吗，我想要的」。

要的能力：拿一张已生成的图（或自己上传的图），**只改其中一块区域**，其余部分保持不变。
典型用法：换背景的某一块、去掉画面里的杂物、改某个物体的颜色/材质。

## 2. 现状盘点

| 项 | 状态 | 说明 |
|---|---|---|
| 上游 `POST /images/edits` 接受 `mask` | ✅ 已通 | multipart 带 `image` + `mask` 返回 200 与 PNG |
| **mask 是否被真正尊重** | ❌ **不尊重** | 见 §0.1：参数被接受、语义被忽略（200 不等于能力） |
| 应用内 `mask` 透传 | ❌ 未接 | `app/api/generate/route.ts` 只转发 `images`，无 `mask` 字段 |
| mask 绘制 UI | ❌ 未做 | 按结论推迟：不验证就做 UI 是浪费 |
| 参考图压缩管线 | ✅ 存量 | `lib/reference-image.ts` 的 `validateAndCompress` 决定最终上传 blob 的像素尺寸 |

### 上次测试为什么不算数

`design-demos/inpaint-compare.png` 留了对照：输入是一张**模糊的麻雀照**，输出是一张**清晰的麻雀照**。
提示词要求「把下半部分背景换成海边日落」，输出既没换背景、也没动下半部分 —— 上游返回的内容与提示词无关。
在这种图的基础上比较「上下半区差异」没有任何意义：**污染扩散**，不能作为证据。

## 3. 为什么必须验证「尊重」而不是只看 200

HTTP 200 + 返回 PNG 只能证明**参数被接受**，不能证明**语义被实现**。三种可能的现实：

| 现实 | 表现 | 后果 |
|---|---|---|
| A 真尊重 | mask 外像素几乎不变，mask 内按提示词变化 | 功能成立，可直接建 UI |
| B 忽略 mask、按普通图生图重画 | 全图都变，提示词生效 | 需 §6 的兜底方案 |
| C 忽略一切（本次事故） | 全图都变，提示词也不生效 | 节点不可用，先修节点 |

A/B/C 的区分只能靠**「哪里变了」的定量指标**，不能靠肉眼「看着差不多」。

## 4. 验证协议（单变量 A/B）

工具：`scripts/inpaint-probe/`（Node + sharp，自带 `--selftest` 证明指标本身能区分 A/B 两场景）。

### 4.1 设计

| 要素 | 取值 |
|---|---|
| 底图 | 合成图 1024×1024：上半区纯色 A + 标记，下半区纯色 B + 标记 |
| mask | 与底图同尺寸 RGBA；**alpha=0 = 可重绘区**（OpenAI 语义），alpha=255 = 保护 |
| A 臂 | mask 透明区 = **上半**，prompt 相同 |
| B 臂 | mask 透明区 = **下半**，prompt 相同 |
| 指标 | `topDiff` / `bottomDiff` = 各半区平均绝对差（归一化 0~1） |

用合成图而不是照片：大面积纯色让 diff 信号干净，不被模型重绘的纹理噪声淹没。用「同一 prompt 换 mask」而不是「同一 mask 换 prompt」：唯一变量是 mask，变化区域跟随 mask 才说明 mask 起作用。

### 4.2 判据

```
MASK_RESPECTED  ⟺  A臂 topDiff > 2×bottomDiff
                ∧  B臂 bottomDiff > 2×topDiff
                ∧  两臂 unmasked 半区 diff < 0.05
MASK_IGNORED    ⟸  两臂都接近全图变化
INCONCLUSIVE    ⟸  其余（含尺寸不符、报错、内容与提示词无关）
```

### 4.3 附加断言（防重演麻雀事件）

1. **内容核对**：先跑一次普通文生图，提示词写死可核对的几何内容，缩略图肉眼确认内容相符 —— 不通过则整轮作废，不往下测（避免污染扩散）
2. **尺寸核对**：输出宽高必须等于输入宽高；不等则记 `dimsMatch=false`，判 `INCONCLUSIVE`
3. **错误体原样留档**：422/400 的响应体完整存进报告，便于向中转投诉

## 5. 若验证通过 · Mask UI 设计

### 5.1 交互

```
参考图区（恰好 1 张图时）出现「局部重绘」入口
  → 点开蒙版编辑弹层：图片铺满 + 画笔/橡皮/笔刷大小/撤销/清空
  → 确认 → 生成 mask PNG（客户端 canvas，与上传 blob 同尺寸）
  → 返回主界面，参考图区显示「已标注重绘区域」状态 + 可重新编辑
  → 生成：FormData 带 images + mask
```

作图语义：**画笔 = 抹掉 alpha（destination-out）= 标记要重绘**，这是最直接的映射 —— 用户「涂抹」的地方就是会被改的地方。

### 5.2 可用条件（同时满足才显示入口）

| 条件 | 理由 |
|---|---|
| `referenceImages.length === 1` | 多图 + mask 语义上游不一定支持，先锁单图 |
| `format === "static"` | SVG 只能纯文生图（官方限制）；GIF 由提示词驱动，与局部位掩冲突 |
| 图片已解码完成 | 需要自然尺寸建 mask 画布 |

不满足时不显示入口（而不是显示后禁用），减少无效信息。

### 5.3 关键约束：mask 尺寸必须等于上传图尺寸

参考图会经 `validateAndCompress` 压缩后才上传。mask 必须按**压缩后 blob 的自然尺寸**生成，否则像素级不对齐。
做法：mask 编辑弹层直接用该 blob 作为 `<img>` 源，离屏 canvas 取 `naturalWidth/naturalHeight`，导出同尺寸 PNG。

### 5.4 数据流与代码改动点

```
MaskEditor（新组件，canvas）
  └─ toBlob() → maskBlob
       ↓
UnifiedInputCard 持有 maskBlob 状态
       ↓
useImageGeneration.runTask → FormData.append("mask", maskBlob, "mask.png")
       ↓
app/api/generate/route.ts
  └─ 有 mask ⇒ 跳过 /generations/async 探测，直接走 edits 分支
     └─ streamSyncGeneration 增加 mask 参数，editForm.append("mask", …)
       ↓
上游 POST /images/edits  (model/prompt/size/image/mask)
```

| 文件 | 改动 |
|---|---|
| `components/MaskEditor.tsx` | 新增：canvas 绘制 + 撤销 + 导出 mask PNG |
| `components/UnifiedInputCard.tsx` | 新增 mask 状态、入口按钮、「已标注」状态、可用条件判断 |
| `hooks/useImageGeneration.ts` | `runTask` 里条件性 append `mask` |
| `app/api/generate/route.ts` | 接收 `mask`；有 mask 时直走 edits；`streamSyncGeneration` 透传 |
| `lib/error-messages.ts` | 新增 1~2 个错误码（见 §5.5） |

**不新增依赖**：canvas 是浏览器原生能力，撤销用「笔画列表重绘」实现，无需库。

### 5.5 错误码

按项目契约（路由只回稳定 code，文案统一在 `lib/error-messages.ts`）：

| code | 场景 | 文案方向 |
|---|---|---|
| `REQ_MASK_WITHOUT_IMAGE` | 只有 mask 没有图 | 「局部重绘需要一张参考图」 |
| `GEN_MASK_SIZE_MISMATCH` | 尺寸不符被上游拒 | 「蒙版与图片尺寸不一致，请重新标注」 |

### 5.6 视觉

沿用仪器面板语言（`design-demos/direction-approved.md`）：`inst-*` 令牌、单色 + 仪器橙、无圆角堆叠。
画笔光标用 CSS `cursor: crosshair`；笔刷大小用滑杆（复用参数区控件样式）。

### 5.7 移动端

触屏绘制用 Pointer Events（`pointerdown/move/up`），已统一鼠标与触摸，无需分别处理。
弹层在窄屏全屏化，工具栏贴底。注意 `touch-action: none` 防止画的同时滚页面。

## 6. 兜底方案（§0.1 已确认必需 —— 上游不认 mask）

**不要把功能判死**。mask 的「只改这一块」可以在客户端保证：

> **本地合成兜底**：上游出图后，用 canvas 把 **mask 外区域从原图逐像素盖回来**，只有 mask 内用上游结果。
> 代价是 mask 边缘可能有接缝（可对 mask 做 2~4px 羽化渐变过渡）；收益是不依赖上游是否尊重 mask。

因此 §4 的结论只影响**实现档次**，不影响功能是否可做：

| §4 结论 | 实现 |
|---|---|
| `MASK_RESPECTED` | 直接透传，上游保证局部性（质量最好，无缝） |
| `MASK_IGNORED` | 透传 + 客户端合成兜底（保局部性，边缘需羽化） |
| `INCONCLUSIVE` | 先修节点/换节点，功能不进入建设 |

## 7. 风险与边界

1. **mask 参数被静默忽略**：最危险的一种 —— 200 + 看起来像样的图，但全图都变了。§4 的定量判据专治此病
2. **`gpt-image-2` 系对 mask 的支持度未知**：官方文档的 mask 说明主要针对 `gpt-image-1`；2.5/2.6 行为需实测。不同型号可能结论不同，报告要按型号记录
3. **计费**：一次验证 = 1 次文生图 + 2 次 edits ≈ 3 次调用。失败也可能扣费
4. **4MB 请求体上限**：mask PNG（1024 级）通常 <100KB，与图片合计远低于上限；但 4K 图的 mask 体积上升，需留意
5. **上游已实测不透传的参数**：`background:transparent`、`frame_count` —— mask 是否也属此类，靠 §4 回答

## 8. 分期与工作量

| 期 | 内容 | 前置 | 工作量 |
|---|---|---|---|
| V0 | 验证探针（已完成工具）+ 跑验证出结论 | 节点可用 | 半天 |
| V1 | 后端透传 mask + 错误码 | V0 通过 | 半天 |
| V2 | MaskEditor + 参考图区入口 | V1 | 1 天 |
| V3 | 结果卡「局部重绘」入口（拿结果图当底图） | V2 | 半天 |
| V4（视 V0） | 本地合成兜底 + 羽化 | V0 判 IGNORED | 半天 |

## 9. 测试清单

- [ ] 探针 `--selftest` 通过（指标能区分「尊重」与「忽略」两种假输出）
- [ ] 节点恢复：文生图内容与提示词相符（肉眼核对）
- [ ] A/B 两臂：变化区域跟随 mask，判 `MASK_RESPECTED`
- [ ] 输出尺寸 == 输入尺寸
- [ ] mask 只画一半时不报错；完全不画时不发 mask（退回普通图生图）
- [ ] mask + 多图 / mask + SVG / mask + GIF 三组合被正确挡住
- [ ] 移动端触屏能画、能撤销、不滚页
- [ ] 导出的 mask PNG 尺寸 == 上传图 blob 尺寸
- [ ] 回归：普通图生图、GIF、SVG、对比模式、流式保活均不受影响

## 10. V1 实现记录（2026-11-09）

按 §6 的 `MASK_IGNORED` 分支落地：**上游照传 mask（将来支持时自动生效）+ 客户端合成兜底**（局部性由我们自己保证）。

| 文件 | 改动 |
|---|---|
| `lib/mask-composite.ts` | 新增：canvas 合成 `结果 = 底图×(1−maskA) + 上游×maskA`，交界羽化 3px；尺寸以底图为准（保证 mask 逐像素对齐） |
| `app/api/generate/route.ts` | 接收 `mask` 字段；**有 mask 直接走同步 edits**（不探测异步端点）；`REQ_MASK_NEEDS_SINGLE_IMAGE`（mask 必须配恰好 1 张图） |
| `hooks/useImageGeneration.ts` | 参考图=1 张时 formData 带 mask；出图后调用合成；**局部重绘不走 60s 缓存**（换蒙版就是另一张图，命中旧图会让人以为蒙版没生效），缓存键加 `#mask` 区分 |
| `components/UnifiedInputCard.tsx` | 参考图行新增「局部重绘 / 已标注」入口；`onOpenMaskEditor` 传 undefined = 不渲染（可用条件由调用方判断） |
| `components/MaskEditor.tsx` | 蒙版绘制弹层（已存在，本次接线） |
| `app/page.tsx` | 编排：三个入口（参考图行 / 结果卡 / 历史项）→ 统一回填成「参考图区唯一那张 + 蒙版」；参考图或格式变化时自动丢弃旧蒙版 |
| `components/ResultCard.tsx` / `ResultGrid.tsx` | 结果卡新增「局部重绘」动作（可选 prop，不传则外观逐字节不变） |
| `components/HistoryList.tsx` / `HistoryDrawer.tsx` | 历史项新增「局部重绘」动作（仅当该记录有 `b64_json`） |
| `lib/error-messages.ts` | 新增 `REQ_MASK_NEEDS_SINGLE_IMAGE` |

验证：`tsc --noEmit` / `eslint` / `npm run build` 全绿；`lib/mask-composite` 用编译后的真实模块在浏览器跑像素断言 **4/4**（蒙版外取底图、蒙版内取上游、羽化后远端不变）；API 层「只给 mask 不给图」返回 400 该错误码、带 mask 的请求 200 出图。

**未做**：§8 的 V3（结果卡入口已在，但「以编辑结果为新图、原图保留」的对比视图未做）、移动端全屏预览里的入口。
