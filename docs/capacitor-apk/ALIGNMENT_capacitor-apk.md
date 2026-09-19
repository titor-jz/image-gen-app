# ALIGNMENT: capacitor-apk

## 原始需求

在已完成 PWA 化（`docs/android-pwa/`）的基础上，产出**可分发、可安装的真 APK**。用户确认"按推荐来"：Capacitor 远程加载模式 + GitHub Actions 云构建 + 保存到相册。

## 边界确认

**做：**
1. Capacitor 壳（远程加载生产站点 `https://image-gen-app-rho.vercel.app`），native 工程入库
2. Web 端 APP 环境增强：Android 返回键手势、保存到相册按钮、状态栏颜色随主题
3. GitHub Actions workflow 云端出 APK artifact（本机零 Android SDK）
4. 图标/启动屏复用 PWA 视觉资产派生

**不做：**
- 本地打包模式（客户端直连上游、CORS/代理改造）——升级路径见 DESIGN
- 上架 Google Play（签名 keystore、隐私政策等另行任务）
- React Native 重写（已明确否决）

## 需求理解（对现有项目）

- UI 数据全客户端、无路由跳转，远程加载模式下 WebView 加载站点即完整功能；PWA 阶段的移动适配全部生效。
- 生产域名 `image-gen-app-rho.vercel.app`（dev 分支需部署后 APK 才有完整功能）。
- Web 代码需环境自适应：仅在 Capacitor 环境激活原生逻辑，浏览器/PWA 行为不变。

## 疑问澄清（已决）

| 问题 | 决定 |
|---|---|
| 加载模式 | 远程加载（B1）：改网页即时生效，APK 永不重建 |
| APK 构建位置 | GitHub Actions（repo 在 GitHub；runner 预装 Android SDK） |
| APK 签名 | Debug 签名（个人侧载够用；release 签名留 TODO） |
| 保存相册插件 | 优先 `@capacitor-community/media`（直存）；与安装的 Capacitor 大版本不兼容则降级 `@capacitor/share`（官方，走系统分享面板） |
| 状态栏颜色 | `@capacitor/status-bar` 随主题切换（已内建 safe-area/viewport-fit 兜底，双保险） |
