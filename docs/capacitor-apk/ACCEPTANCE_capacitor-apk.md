# ACCEPTANCE: capacitor-apk

对照 CONSENSUS 验收标准逐条记录执行结果。

## AC1 本地构建链 ⚠️（2026-09 评审修正：原标 ✅ 系夸大）

- 实际验证范围：`npx cap sync android` 成功（识别 3 个插件）+ Web 侧 tsc/lint/build。**Android 从未编译过**（本机无 SDK，`android/app/build/` 仅 `.npmkeep`）。
- 评审补充发现：当时 workflow 装 JDK 17，而 Capacitor 8 工程强制 Java 21（`capacitor.build.gradle` 的 VERSION_21）——CI 真跑必失败。已在 review-2026-09 修复为 JDK 21，待 CI 真跑验证。

## AC2 CI workflow ⚠️（结构就绪；JDK 修正后待真跑）

- `.github/workflows/android-apk.yml`：workflow_dispatch 手动触发；checkout → Node 22（npm 缓存）→ JDK → `npm ci` → `npx cap sync android` → `android/gradlew assembleDebug --no-daemon` → upload-artifact（app-debug.apk，`if-no-files-found: error`）。
- `android/gradle/wrapper/gradle-wrapper.jar` 已确认入库（未被 android/.gitignore 排除），CI 无需本地 wrapper。
- **评审发现原 JDK 17 与 Capacitor 8 冲突（首次构建必失败），已改 21 并补 gradle 内存余量；workflow 从未真跑过（dev 分支未推送），真实可构建性以首次 CI 为准。**

## AC3 浏览器/PWA 零影响 ✅（Playwright 冒烟，360×800）

- `window.Capacitor` 为 undefined；「保存到相册」按钮不在 DOM；主页正常渲染；0 个页面错误——`isCapacitor()` 门控下动态 import 全部未发生。

## AC4 APP 环境行为 ✅（代码路径审查，真机验证留 TODO）

- 返回键：`page.tsx` 按 `showHistory` 重挂 `backButton` 监听——开抽屉先关抽屉，否则 `App.exitApp()`。
- 保存相册：预览头按钮仅 `canSaveToGallery`（mounted 门控）为真时渲染；`Media.savePhoto({ path: dataURL })`（v9 API 字段名为 `path`）。**评审发现：缺 Android 必填 `albumIdentifier`，原实现 100% 被插件原生层 reject；已在 review-2026-09 修复（getAlbums→createAlbum→savePhoto），真机待验。**
- 状态栏：`applyTheme` 内 `isCapacitor()` 门控后 setStyle + setBackgroundColor（`#0b121a`/`#ffffff`）。**评审修正口径：Android 15+（targetSdk 36 强制 edge-to-edge）下 setBackgroundColor 为 no-op，仅图标明暗（setStyle）生效，底色由网页自绘。**

## AC5 图标与启动屏 ✅

- `scripts/generate-cap-assets.js`（sharp）从与 PWA 同源的 SVG 生成 `assets/`（icon-only 1024、splash 2732 亮/暗）；`@capacitor/assets` 生成 android res 38 项（含 night 变体）。

## 已知边界（记入 TODO）

- **APP 内为独立存储分区**：Chrome/PWA 里配置的 API Key 与历史在 APK 内不可见，首次使用需在 APP 设置中重新配置（WebView 语义，无法共享）。
- Debug 签名 APK：可侧载，不可上架；release 签名另行配置。
- 设置弹窗打开时按返回键会退出应用（弹窗状态在 Dialog 内部，未打通）。
- 本机未跑 Android 模拟器，APK 真机行为（加载远程站点/返回键/相册保存/状态栏色）待用户验收。
- 站点需部署含 C2 代码的版本（dev → 生产）后 APK 才有完整功能。
