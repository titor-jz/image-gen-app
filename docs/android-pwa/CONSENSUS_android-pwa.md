# CONSENSUS: android-pwa

## 需求描述

在不改动服务端行为、不新增依赖的前提下，让应用在 Android Chrome 上具备"可安装、独立窗口、像 App"的体验，并使生成任务在页面被杀后可恢复，避免重复扣费。

## 验收标准

1. Android Chrome 打开站点可"添加到主屏幕"，以 standalone 全屏运行，图标/名称/主题色正确。
2. 360×800 视口下：无横向滚动；输入提示词、传参考图、生成、查看结果、历史、设置全部可用，触控目标 ≥44px，输入聚焦不触发页面缩放。
3. 生成中杀掉页面 → 重新打开后自动续轮询（凭已持久化的 taskId + 节点快照），成功图入库历史，全程**不重复提交**；不可恢复时提示明确且不引导重复提交。
4. 桌面端行为无回归。
5. `npx tsc --noEmit`、`npm run lint` 通过。

## 技术方案

- `app/manifest.ts`（MetadataRoute.Manifest）+ `public/icons/` 下 192/512 图标（purpose 含 maskable，全出血设计规避透明角问题）+ `layout.tsx` 增加 `export const viewport`（themeColor 按 light/dark 媒体查询、viewportFit cover）。
- 移动适配逐组件调整（Tailwind 响应式类 + `env(safe-area-inset-*)`）。
- `InFlightEntry` 扩展任务快照与节点快照字段（IndexedDB 无 schema，无需升 DB_VERSION）；启动恢复路径复用 `pollTaskResult`，恢复任务注入现有 `tasks[]` 走既有 UI。

## 约束

- 遵守仓库架构边界：API Key 等仍走 `x-api-key` 透传；不引入服务端存储；错误文案仍走 `lib/error-messages.ts` 契约（新增 toast 提示属 UI 文案，随恢复逻辑放 hook 内，与现有 toast 文案做法一致）。
- Next 16 API 以 `node_modules/next/dist/docs/` 为准（已核对 manifest 与 generate-viewport，无破坏性变化）。
- 图标从 SVG 经浏览器截图派生，产物提交 git，不引入新依赖。

## 任务边界

见 TASK 文档 T1–T4。超出范围的原生能力（相册直存/推送/APK 分发）留待后续独立任务。
