# FINAL: mobile-redesign

## 交付内容（提交 1bf4376 + 4906455）

**新组件（components/mobile/）**
- `MobileHome.tsx`：两态状态机（compose/results）+ 顶栏随态切换 + 面板/预览编排 + 返回键接管 API（onNavApi）
- `Composer.tsx`：输入态（参考图行 + 触屏文案 textarea + 底部固定区：参数摘要/迷你进度/全宽 CTA）
- `ParamSheet.tsx`：生成参数底部面板（行式，对比相关渐进披露）
- `ResultsView.tsx`：结果态（TaskList 置顶 + 2 列网格 + 对比组并排）
- `FullscreenPreview.tsx`：全屏预览（左右滑切换/下滑关闭/可见切换钮/按环境保存或下载）

**原语与共享件**：`ui/bottom-sheet.tsx`（自绘：遮罩/Esc/顶部把手下拉关闭/safe-area）；抽取 `SelectChip`、`TaskList`、`HistoryList`、`ResultCard`+`FadeInImage`、`lib/image-actions.ts`、`lib/result-groups.ts`、`lib/reference-image.ts`、`hooks/useIsMobile|useTheme|useNodeBModels|useHistoryRecords`、`NodeSwitcher`。

**集成**：`page.tsx` 按 `useIsMobile()` 分支（桌面分支原样）；安卓返回键四层接管（page listener → mobileNavRef → MobileHome.handleBack）。**桌面路径零替换**，仅共享件被纯搬移。

## 验证结果

| 验证项 | 结果 |
|---|---|
| `tsc --noEmit` / `lint` | 0 错误（6 个存量类别警告） |
| `npm run build` | 通过 |
| APP mock 全链路（`test-capacitor-bridge.cjs`）| **18/18**：首屏输入态/无大标题/CTA；参数面板开关+返回键关闭；历史面板+回填进结果态；全屏预览保存流程（albumIdentifier 契约）；返回键四层（预览→结果→输入→退出 exitApp=1）；监听器单次注册；状态栏随主题 |
| 浏览器双视口（`test-browser-mode.cjs`）| **7/7**：桌面 1280 保留大标题/全部下载/下载系按钮无保存；移动 360 新 IA + 全屏预览下载 |
| 视觉抽查 | 截图确认：紧凑顶栏、无标题输入首屏、底部参数摘要+CTA、toast 覆盖层正常 |

## 与方案的偏差（记录）

1. 主题切换按原计划应"移入设置弹窗"——实际保留为移动顶栏图标（4 项仍放得下，减少一个组件的联动改造面）；
2. M2/M3/M4 合并为一个提交（同一批代码一次成型，测试覆盖完整）；
3. 移动 Composer 不实现桌面版 `@提及`（触屏无拖拽/多图精细引用场景低；生成时默认携带全部参考图，与桌面兜底路径行为一致）。

## 第二轮：视觉重构（打消"网页感"）

**问题**（用户实机截图）：白底白卡、细灰边、13-16px 全同号的灰字——无层级焦点、无深度、默认值堆叠；且节点下拉在左缘溢出被裁。

**方向**（uicraft bolder 主工作流 + apple-design HIG 移植）：影像工具的"暗房/工作室"质感——输入是唯一主角、CTA 是唯一浓烈时刻、中性与背景带品牌色偏、深度用大范围柔和投影而非边框；避开 bolder.md 的"通用 AI 风"警告（品牌蓝紫渐变是图标资产而非通用配色，仅用于 CTA，不铺满）。

**落地**：移动端专属样式层 m-*（m-ambient 环境光晕/暗角、m-stage 主角舞台、m-dock 悬浮操作坞、cta-brand 品牌渐变+彩色投影、m-micro 微标签、m-iconcluster 浮起图标组、m-shot 图像卡）；节点切换改底部面板（同时修复左缘溢出 bug）；结果栅格修正为单一容器 2 列（对比组 col-span-2，修复此前 singles 各自成容器导致的全竖排）；全屏预览底部控制收进浮起胶囊。桌面全部不受影响（m-* 仅移动组件使用）。

**验证**：浅/深色四视角截图自检 + 双测试回归 18/18 + 7/7。

## 遗留与风险

- **软键盘行为未实测**（Capacitor adjustResize 预期 CTA 随键盘上移）；真机验收项。
- 全屏预览手势仅点按/滑动基础阈值，未做惯性动画（后续可打磨）。
- 桌面版仍用 ResultGrid 的行内展开预览（设计如此，未统一为全屏）。
- 真机验收清单见 TODO_mobile-redesign.md。
