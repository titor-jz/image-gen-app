# ACCEPTANCE: capacitor-apk

对照 CONSENSUS 验收标准逐条记录执行结果。

## AC1 本地构建链 ✅

- `npx cap sync android` 成功，识别 3 个插件（app / status-bar / community-media）。
- `npx tsc --noEmit` 0 错误；`npm run lint` 0 错误（5 个存量警告）；`npm run build` 生产构建通过。

## AC2 CI workflow ✅（语法与结构；真跑待用户推送后触发）

- `.github/workflows/android-apk.yml`：workflow_dispatch 手动触发；checkout → Node 22（npm 缓存）→ JDK 17 → `npm ci` → `npx cap sync android` → `android/gradlew assembleDebug --no-daemon` → upload-artifact（app-debug.apk，`if-no-files-found: error`）。
- `android/gradle/wrapper/gradle-wrapper.jar` 已确认入库（未被 android/.gitignore 排除），CI 无需本地 wrapper。

## AC3 浏览器/PWA 零影响 ✅（Playwright 冒烟，360×800）

- `window.Capacitor` 为 undefined；「保存到相册」按钮不在 DOM；主页正常渲染；0 个页面错误——`isCapacitor()` 门控下动态 import 全部未发生。

## AC4 APP 环境行为 ✅（代码路径审查，真机验证留 TODO）

- 返回键：`page.tsx` 按 `showHistory` 重挂 `backButton` 监听——开抽屉先关抽屉，否则 `App.exitApp()`。
- 保存相册：预览头按钮仅 `canSaveToGallery`（mounted 门控）为真时渲染；`Media.savePhoto({ path: dataURL })`（v9 API 字段名为 `path`，已按 d.ts 校正）；权限已在 AndroidManifest 声明（READ_MEDIA_IMAGES / 旧版本兼容项）。
- 状态栏：`applyTheme` 内 `isCapacitor()` 门控后 setStyle + setBackgroundColor（`#0b121a`/`#ffffff`），主题切换与挂载时均触发。

## AC5 图标与启动屏 ✅

- `scripts/generate-cap-assets.js`（sharp）从与 PWA 同源的 SVG 生成 `assets/`（icon-only 1024、splash 2732 亮/暗）；`@capacitor/assets` 生成 android res 38 项（含 night 变体）。

## 已知边界（记入 TODO）

- Debug 签名 APK：可侧载，不可上架；release 签名另行配置。
- 设置弹窗打开时按返回键会退出应用（弹窗状态在 Dialog 内部，未打通）。
- 本机未跑 Android 模拟器，APK 真机行为（加载远程站点/返回键/相册保存/状态栏色）待用户验收。
- 站点需部署含 C2 代码的版本（dev → 生产）后 APK 才有完整功能。
