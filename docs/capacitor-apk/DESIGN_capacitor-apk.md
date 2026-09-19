# DESIGN: capacitor-apk

## 架构图

```mermaid
graph TD
  subgraph Android APK (Capacitor 壳)
    MA[MainActivity WebView] -->|server.url 远程加载| SITE[已部署 Next.js 站点]
    LO[离线兜底页 cap-www/index.html] -.加载失败 errorPath.-> MA
  end
  subgraph Web 代码（部署站点内，环境自适应）
    ENV[lib/capacitor-env.ts isCapacitor] --> BB[page.tsx: backButton 监听]
    ENV --> SG[ResultGrid: 保存到相册按钮]
    ENV --> SB[Header: 状态栏色同步]
  end
  BB -->|App.exitApp / 关抽屉| CAP[Capacitor App 插件]
  SG --> MEDIA[Media/Share 插件]
  SB --> ST[StatusBar 插件]
  CAP & MEDIA & ST --> NATIVE[Android 原生层]
  CI[GitHub Actions] -->|npm ci → cap sync → gradlew assembleDebug| APK[APK artifact]
```

## 关键设计

### 环境检测与渐进增强

- `lib/capacitor-env.ts`：`isCapacitor()` 基于 `window.Capacitor?.isNativePlatform?.()`，SSR 返回 false。
- 所有原生增强 = 动态 `import('@capacitor/app' 等)` + `isCapacitor()` 门控 + mounted 门控（防 hydration 不一致）。浏览器/PWA 包体基本不引入插件代码路径。

### 返回键（Android 硬件返回）

- `page.tsx` useEffect 按 `showHistory` 重挂监听：抽屉开 → 关闭；否则 `App.exitApp()`。
- 已知取舍：设置弹窗打开时按返回会退出应用（弹窗状态在 Dialog 内部，跨组件打通成本 > 收益，记入 TODO）。

### 保存到相册

- 首选 `@capacitor-community/media`（savePhoto 直存 MediaStore，b64 数据源现成）；安装时校验与 Capacitor 大版本 peer 兼容，不兼容降级 `@capacitor/share`（系统分享面板选"保存到图片"）。
- 入口：结果预览头「保存到相册」按钮（与既有「下载」并列），仅 APP 环境渲染；失败 toast 报错。

### 状态栏

- `@capacitor/status-bar`：applyTheme 时 `setBackgroundColor`（`#0b121a`/`#ffffff`）+ 图标明暗（Style.Light/Dark）。若 Capacitor 新版默认 edge-to-edge，则本项自动退化为网页自绘（已有 safe-area 兜底），双保险成立。

### CI（.github/workflows/android-apk.yml）

- `workflow_dispatch` 手动触发；ubuntu-latest（runner 自带 Android SDK）+ Node 22 + JDK 17。
- 步骤：checkout → setup-node → npm ci → `npx cap sync android` → `android/gradlew assembleDebug` → upload-artifact。
- Debug 签名自动生成，可直接侧载。

## 异常处理

- 离线/站点不可达：WebView 加载失败 → `server.errorPath` 指向 cap-www 兜底页（含重试按钮）。
- 插件调用失败（权限拒绝等）：toast 报错，不阻塞主流程。
- 远程站点版本落后于 APK 无兼容问题：壳与站点解耦，站点独立演进。

## 测试策略

- 本地：tsc/lint/build + `npx cap sync android` 配置有效性 + Playwright 浏览器冒烟（AC3）。
- CI/workflow 与真机行为：用户推送后触发与验收（TODO 文档给操作指引）。
