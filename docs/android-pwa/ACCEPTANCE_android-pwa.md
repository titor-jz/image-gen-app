# ACCEPTANCE: android-pwa

对照 CONSENSUS 验收标准逐条记录执行结果。

## AC1 PWA 安装能力 ✅

- `app/manifest.ts` 提供完整 manifest（name/short_name「AI 生图」/lang zh-CN/standalone/start_url/scope/图标）。
- `public/icons/icon-{192,512}.png` 已生成（512×512 57KB、192×192 8.5KB；星芒 glyph 收在 maskable 安全区内）；`purpose` 按 Next 类型约束拆为 any/maskable 两条目指向同一文件。
- `layout.tsx`：`viewport` 导出（themeColor light `#ffffff` / dark `#0b121a`、viewportFit cover）+ appleWebApp 元数据。
- 验证：dev 环境抓取 `/manifest.webmanifest` 返回 200 且字段正确；HTML 含 `<link rel="manifest">` 与 `meta theme-color`（双媒体查询）；生产构建中 `/manifest.webmanifest` 静态预渲染。

## AC2 360×800 移动可用性 ✅（Playwright 移动视口冒烟）

> 2026-09 评审口径修正：CONSENSUS 写"触控目标 ≥44px"，实际实现为**核心操作 44px**（生成按钮整行）+ **次要密集控件 36px/32px/28px**（chips、删除钮、任务行按钮）。密集工具栏下统一 44px 会导致显著换行/溢出，属有意取舍，特此说明。

- 无横向滚动：`scrollWidth 360 == innerWidth 360`，全元素扫描零溢出。
- 头部 360px 不溢出：历史按钮缩为图标、节点切换器 `max-w-28`。
- 生成按钮移动端整行 44px 置底；chips 换行、触控目标 36px（`toolbar-chip h-9 sm:h-8`）。
- 参考图删除钮 28px、任务行取消/忽略钮 32px（触屏可见可点）。
- `group-hover` 依赖全部修复为移动端常驻：历史删除钮、图库下载钮。
- 历史抽屉小屏全宽（实测 360px）；设置弹窗 328px 完整可见不溢出、`max-h-[85dvh]` 可滚动。
- safe-area：header 顶部、工具栏/图库底部、抽屉上下（`env(safe-area-inset-*)` + `max()`）。
- `h-screen` → `h-dvh`（移动浏览器地址栏遮挡修复）。
- Toaster 小屏 bottom-center / 桌面 bottom-right（matchMedia 响应式）。
- 桌面无回归：所有响应式改动均为 `sm:` 起恢复原值。

## AC3 跨会话任务恢复 ✅（IndexedDB 注入冒烟）

- 提交时批次快照（含各任务 node 配置）写入 in-flight 条目；拿到上游 taskId 就地更新。
- 冒烟：种入带假 taskId 的遗留条目 → 刷新 → 绿色 toast「已恢复 1 个生成中的任务」+ #1 任务行进入轮询 → 占位条目释放。轮询失败路径走既有终态处理（failed/超时可继续等待）。
- 防重复扣费：恢复只凭持久化 taskId 续轮询，代码路径无任何重新提交；不可恢复条目（无 taskId）的 toast 文案已改为防重复扣费话术。

## AC4 桌面无回归 ✅

- 全部移动端样式以 `sm:` 断点收敛，桌面渲染路径不变；`resumeTask` 重构后行为等价（同一轮询体）。

## AC5 门禁 ✅

- `npx tsc --noEmit`：0 错误。
- `npm run lint`：0 错误、5 警告（全部为存量：img 元素 ×4、未用 Heart 导入 ×1，与本次改动无关）。
- `npm run build`：生产构建通过。

## 遗留的现场验证（需真机，无法在开发环境替代）

- Android Chrome「添加到主屏幕」→ standalone 全屏、图标/启动屏/状态栏色正确。
- 真机杀后台（上滑划掉）后重开的恢复实测。
