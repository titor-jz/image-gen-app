# FINAL: capacitor-apk

## 项目总结

在 PWA 化（`docs/android-pwa/`）之上交付可分发 APK：Capacitor 8 远程加载壳 + GitHub Actions 云构建 + 三项 APP 环境原生增强。Web 代码零回归（浏览器/PWA 行为不变），服务端零改动。

## 交付内容

**C1 Capacitor 工程**（bd2df57）
- `capacitor.config.ts`：appId `me.titorjz.imagegen`、加载生产站点、`server.errorPath` 离线兜底、WebView 调试开启
- `cap-www/index.html`：断网兜底页（亮暗自适应 + 重试按钮）
- `android/` 原生工程入库（含 38 项图标/启动屏资源、相册权限）
- `assets/` + `scripts/generate-cap-assets.js`：与 PWA 同源星芒设计的资产派生（sharp，可重复执行）
- 依赖：`@capacitor/core/android/cli/app/status-bar/assets` + `@capacitor-community/media`（v9，Cap 8 兼容）

**C2 Web 端 APP 环境增强**（9e84ef6）
- `lib/capacitor-env.ts`：SSR 安全的 `isCapacitor()`
- 返回键手势（关抽屉/退出应用）；「保存到相册」按钮（仅 APP 环境渲染，`Media.savePhoto` 直存，数据取自本地 b64 离线可用）；状态栏颜色随主题
- 全部动态 import + 门控：浏览器/PWA 包不引入插件代码路径

**C3 CI**（同 bd2df57 后独立提交）
- `.github/workflows/android-apk.yml`：手动触发，云端出 Debug APK artifact

## 质量评估

- 门禁：tsc / lint / build / cap sync 全过；浏览器冒烟确认零影响。
- 依赖健康：`@capacitor/cli` 与 `@capacitor/assets` 安装时遇到 npmjs TLS 故障与老版 sharp 二进制下载问题，分别以 npmmirror 镜像与 `overrides.sharp=$sharp` 解决（已固化在 package.json，可复现）。
- 架构边界：未触碰 API 路由、错误码契约；无服务端改动。

## 升级路径（留档）

远程加载（当前）→ 本地打包（B2）：去掉 `server.url`、`webDir` 指向静态导出产物、新增客户端直连上游的 API 层（提交/轮询逻辑搬入客户端，CORS 用 CapacitorHttp 绕过，详见 DESIGN）。Capacitor 工程与全部 Web 增强原样保留。
