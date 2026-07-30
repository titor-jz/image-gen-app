# 图层拆分功能设计（本地 SAM 语义分割 → 透明 PNG 分层导出）

## 背景与目标

用户希望把上传的图片或生成的图片，按图中元素自动拆分成多个图层。每个图层：
- 保留元素在原图中的**原位置**（不移动、不裁剪到内容框）
- 其余区域为**真透明**（alpha = 0），不是白色/伪透明
- 导出后可在 PS 中作为独立图层使用

最终产物：分层透明 PNG 序列（打包为 ZIP 下载）。

## 关键决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 拆分依据 | AI 语义分割 | 自动拆出所有可识别元素，对创意/生成图友好 |
| 分割位置 | 本地模型 | 自用桌面应用，离线可用、零额外费用 |
| 模型方案 | SAM 自动分割（方案 A） | 类无关，任意图都能拆；碎片由"预览勾选"兜底 |
| 输出格式 | 分层 PNG 序列 | 不需要 PSD 库，canvas 像素操作即可 |
| 导出控制 | 预览 + 勾选再导出 | 分割不准时可剔除不需要的层 |
| 触发来源 | 所有图片都可拆 | ResultGrid / 展开预览 / 历史记录 |
| 模型加载 | 首次使用时下载 | 不占首屏资源，按需加载 |

## 技术栈

新增依赖：
- `@huggingface/transformers`（transformers.js v3）——浏览器/Electron renderer 跑 ONNX 模型
- `jszip`——导出时打包多张 PNG

模型：`Xenova/sam-vit-base`（ViT-B 变体，~358MB）。首次使用从 HuggingFace CDN 下载，缓存到 IndexedDB（transformers.js 默认机制），之后离线可用。

## 架构与模块

四个模块，单一职责、可独立理解：

### 1. `lib/sam-worker.ts`（分割引擎，Web Worker 内）
- 加载 `Xenova/sam-vit-base` 模型（懒加载，首次进入 worker 时加载）
- 接收 `ImageBitmap`，用 `RawImage` + `SamModel` 跑 automatic mask generation
- 输出 masks 数组：每个 mask = `Uint8Array`（W×H，1=该像素属于此元素，0=不属于）
- 放在 Web Worker 中：分割是 CPU 密集（10–30s），隔离后 UI 不冻结，且可 `terminate` 实现取消
- 进度通过 `postMessage` 回传（模型下载进度 / 分割进度）

### 2. `lib/layer-export.ts`（图层生成，纯函数）
- 入参：原图 `ImageData` + 选中 masks `Uint8Array[]`
- 出参：每层一个 PNG `Blob`
- 实现：用 OffscreenCanvas，对每个 mask：
  - 复制原图像素到新 canvas
  - 遍历像素，mask=0 处的 alpha 置 0（真透明），mask=1 处保留原 RGBA
  - `canvas.convertToBlob({ type: "image/png" })`
- 关键：保留原图尺寸，元素在原位，确保"不要改变位置"
- 关键：alpha 通道直接置 0，非白色填充，确保"真透明，不要伪透明度"

### 3. `hooks/useLayerSegment.ts`（状态管理）
状态机：
```
idle → loading-model → segmenting → ready → exporting → done
                                  ↘ error
```
- 协调 worker 生命周期（创建 / 复用 / terminate 取消）
- 持有 masks、选中集合、进度
- 暴露：`segment(image)`, `toggleLayer(i)`, `exportSelected()`, `cancel()`

### 4. `components/LayerSplitPanel.tsx`（UI 面板）
- 从右侧滑出的 Sheet/Dialog
- 三阶段 UI：
  - loading-model：模型下载进度条 + 百分比
  - segmenting：处理中 spinner（可取消）
  - ready：图层列表，每层 = 缩略图（该层透明 PNG 预览）+ 勾选框 + 面积占比 + 层名
  - exporting：导出中进度
- 底部：导出选中层按钮 + 取消按钮

## 数据流

```
LayerSplitPanel
  └─ useLayerSegment (state machine)
       ├─ sam-worker.postMessage(imageBitmap) → onMessage(masks[])
       └─ layer-export.applyMasks(imageData, selectedMasks) → PNG Blobs[]
            └─ JSZip → download
```

## 透明处理细节（核心需求）

"不要伪透明度"的实现保证：
1. 不用 CSS 透明 / 棋盘格背景伪装
2. PNG 的 alpha 通道直接写 0（完全透明）或原值（不透明）
3. 不做颜色填充——透明区域不写任何 RGB，仅 alpha=0
4. 导出 PNG 格式本身支持 alpha 通道，PS 打开即为真透明层

"不要改变位置"的实现保证：
1. 每层 PNG 尺寸 = 原图尺寸
2. 元素像素保持原坐标，不裁剪、不平移
3. PS 中把各层叠放即还原原图

## 触发入口

在所有图片出现处加"拆分图层"按钮（`Scissors` 图标）：
- `ResultGrid` 网格卡片 hover 工具栏（与下载按钮并列）
- `ResultGrid` 展开预览工具栏
- `HistoryDrawer` 历史项（可选，后续迭代）

点击后打开 `LayerSplitPanel`，传入该图的 src（blob URL 或 dataURL）。

## 错误处理

- 模型下载失败：提示重试按钮
- 分割超时/失败：提示错误 + 关闭面板
- 无检测到图层：空态提示"未检测到可分割元素"
- 导出失败：toast 提示

## 不做的事（YAGNI）

- 不做 PSD 导出（用户选了 PNG 序列）
- 不做手动 mask 修补（用户选了"预览勾选"）
- 不做模型预加载（用户选了"首次使用时下载"）
- 不做分割结果编辑/合并
- 不做云端分割 API 兼容

## 验收标准

- AC1：任意图（上传/生成/历史）点"拆分图层"可进入面板
- AC2：首次使用自动下载模型并显示进度，之后离线可用
- AC3：分割完成后列出所有检测层，每层有透明底缩略图
- AC4：勾选/取消层实时生效，可剔除不需要的层
- AC5：导出的 PNG 为真透明（alpha=0），元素在原位，尺寸=原图
- AC6：导出为 ZIP，内含多个 PNG，文件名含层序号
- AC7：分割期间 UI 不冻结，可取消
- AC8：类型检查通过，lint 无新 error
