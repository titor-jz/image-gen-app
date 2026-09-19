# CONSENSUS: capacitor-apk

## 需求描述

用 Capacitor 将现有 Web 应用打包为 Android APK（远程加载模式），可通过 GitHub Actions 云端构建产出；在 APP 环境下提供返回键手势、保存到相册、状态栏随主题三项原生增强；浏览器/PWA 行为零变化。

## 验收标准

1. `npx cap sync android` 本地成功；`npm run build`（web）与 `npx tsc --noEmit`、`npm run lint` 通过。
2. GitHub Actions workflow 语法正确、步骤完整（Node 22 → npm ci → cap sync → gradlew assembleDebug → 上传 APK artifact），推送后可手动触发（真跑由用户推送后验证）。
3. 浏览器/PWA 下：无保存相册按钮、无返回键监听副作用、无 Capacitor 相关报错（Playwright 冒烟确认 `window.Capacitor` 不存在时逻辑全跳过）。
4. APP 环境下（代码路径审查）：返回键关闭历史抽屉否则退出应用；保存到相册按钮仅 APP 环境渲染；状态栏颜色随主题。
5. 图标与启动屏：由 PWA 视觉资产派生（1024 图标、2732 启动屏亮/暗），生成进 android res。

## 技术方案

- 依赖：`@capacitor/core`+`@capacitor/android`（deps）、`@capacitor/cli`+`@capacitor/assets`（dev）；原生插件 `@capacitor/app`、`@capacitor/status-bar`、`@capacitor-community/media`（或降级 `@capacitor/share`）。
- `capacitor.config.ts`：appId `me.titorjz.imagegen`、appName「AI 生图」、`webDir: 'cap-www'`（含离线兜底页，配 `server.errorPath`）、`server.url` 指生产站点、`webContentsDebuggingEnabled: true`。
- `android/` 原生工程入库（Capacitor 标准做法），排除 `.gradle`/`build`。
- Web 增强：`lib/capacitor-env.ts` 环境检测（SSR 安全）；`page.tsx` 注册 `backButton`；`ResultGrid` 预览头加"保存到相册"（仅 APP 环境渲染，mounted 门控防 hydration 不一致）；`Header.applyTheme` 同步状态栏色（均动态 import，浏览器不加载插件代码路径）。

## 约束

- 不改 API 路由/服务端行为；错误码契约不动；toast 文案随功能就近放置（与既有做法一致）。
- 不推送远端：workflow 触发验证由用户完成。

## 任务边界

C1 工程 → C2 Web 增强 → C3 CI → C4 验证收尾。真机构建与安装验证属用户 TODO。
