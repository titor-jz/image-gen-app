# ALIGNMENT: android-pwa

## 原始需求

把现有 AI 生图 Web 应用做成"安卓手机上能用的 APP"。经澄清收敛为：先 PWA 化（安装到主屏、独立窗口运行），并补齐移动端体验；不做 APK/原生重写。

## 边界确认（任务范围）

**做：**
1. PWA 安装能力：manifest、图标、viewport/themeColor
2. 移动端适配：360×800 基准，核心流程单手可用
3. 跨会话任务恢复：杀进程后凭 taskId 续轮询，防"重新发起"导致的重复扣费

**不做：**
- Service worker / 离线壳（生图必须联网；SW 只增加缓存陈旧风险，Chrome 安装已不强制 SW）
- 推送通知、Capacitor/APK、React Native、任何服务端（API 路由）行为变更

## 需求理解（对现有项目）

- 数据全在客户端（IndexedDB `image-gen-db` + localStorage），服务端无状态透传 → PWA 化零服务端改动。
- 已有 in-flight 机制：`lib/db.ts` 的 `in_flight` store（claim/release/status 更新），但 `hooks/useInFlightRecovery.ts` 启动时**只弹 toast 提示重新发起**，不恢复任务 → 重复提交即重复扣费（计费发生在提交时）。
- `hooks/useImageGeneration.ts` 已有 `resumeTask`（内存内超时续轮询）与 `pollTaskResult`，恢复逻辑可复用。
- UI 为桌面优先：全仓仅 12 处响应式类；无 manifest/viewport 配置；Toaster 固定 bottom-right。

## 疑问澄清（已决）

| 问题 | 决定 |
|---|---|
| 目标形态 | PWA（用户网络对部署域名可达，不做 APK） |
| Electron 移除原因是否影响本次 | 不影响（本次不走套壳路线） |
| 恢复增强是否纳入 | 纳入：手机杀进程是常态，且现有文案引导"重新发起"有二次扣费风险 |
