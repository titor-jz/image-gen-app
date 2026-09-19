# FINAL: android-pwa

## 项目总结

在不改服务端行为、不新增运行时依赖的前提下，将应用 PWA 化并补齐移动端体验与跨会话任务恢复。服务端 API 路由零改动，BYO Key 透传架构不变。

## 交付内容

**T1 PWA 壳**
- 新增 `app/manifest.ts`（standalone、zh-CN、any+maskable 图标）
- 新增 `public/icons/icon-192.png`、`icon-512.png`（SVG→浏览器截图派生，蓝紫渐变星芒）
- `app/layout.tsx`：`Viewport` 导出（themeColor 双媒体、viewportFit cover）+ appleWebApp 元数据

**T2 移动适配**（`app/page.tsx`、`app/globals.css`、`components/Header.tsx`、`HistoryDrawer.tsx`、`UnifiedInputCard.tsx`、`ResultGrid.tsx`、`SettingsDialog.tsx`、`components/ui/sonner.tsx`）
- 360×800 无横向滚动；核心触控目标 ≥36px（主操作 44px）；触屏无 hover 的按钮改为移动端常驻
- safe-area 全链路（状态栏/手势条）；`h-dvh`；历史抽屉小屏全宽；设置弹窗自适应；Toaster 小屏居中

**T3 跨会话任务恢复**（`lib/db.ts`、`hooks/useImageGeneration.ts`、`hooks/useInFlightRecovery.ts`、`app/page.tsx`）
- in-flight 条目扩展批次任务快照（`InFlightTaskSnapshot[]`，含 taskId 与节点配置；无需升 DB_VERSION）
- 新增 `updateInFlightTasks`；提交时写快照、拿到 taskId 就地补记
- `resumeTask` 抽出共用轮询体 `pollToCompletion`；新增 `recoverInFlight`：凭快照 taskId 续轮询、恢复即释放占位、结果照常入库历史
- 恢复 toast「已恢复 N 个生成中的任务」；不可恢复场景文案改为防重复扣费话术（不再引导直接重发）

## 质量评估

- 代码：全部改动复用既有模式（任务快照/节点快照早已有同类结构；轮询体抽取为等价重构）；无新增依赖。
- 测试：仓库无测试套件，按现状以 tsc/lint/生产构建 + Playwright 移动视口冒烟 + IndexedDB 注入恢复冒烟验证，全过。
- 文档：ALIGNMENT/CONSENSUS/DESIGN/TASK/ACCEPTANCE/FINAL/TODO 齐备。
- 架构边界：未触碰 `app/api/*`、`lib/http-client.ts`、错误码契约；无服务端存储引入。

## 风险与边界

- 恢复依赖 in-flight 条目 5 分钟 TTL：超 TTL 的遗留任务会被标记 abandoned（与既有语义一致）。
- 极端场景「恢复轮询期间再次被杀」：占位已释放，结果无法找回（上游已计费）——与既有超时任务跨会话语义一致，未恶化。
- 提交阶段（POST 未返回 task_id）被杀：taskId 未知，无法恢复，属架构固有限制。
