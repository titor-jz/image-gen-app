# TODO: capacitor-apk

## 需要你做的事

1. **部署 Web 端**：dev 分支需发布到生产（`image-gen-app-rho.vercel.app`），APK 加载的远程站点才有 PWA 适配与保存相册按钮。推送 dev / 合并 main 后 Vercel 自动部署。

2. **构建 APK**（二选一）：
   - **GitHub Actions（推荐，本机零环境）**：推送本分支到 GitHub → 仓库 Actions 页 → 「Android APK」→ Run workflow → 完成后在 Artifacts 下载 `imagegen-debug-apk`（首次构建约 5~10 分钟）；
   - 本地构建：装 JDK 21 + Android SDK 后 `cd android && ./gradlew assembleDebug`（Capacitor 8 要求 JDK 21+，JDK 17 会报 invalid source release）。

3. **真机验收**：
   - 安装 APK（允许未知来源）→ 启动应为星芒启动屏 → 进入全屏应用；
   - **APP 内为独立存储：首次使用需在 APP 设置中重新配置 API Key**（浏览器里的配置与历史在 APP 内不可见，属 WebView 语义）；
   - 生成一张图 → 展开预览 → 应出现「保存到相册」按钮 → 点击后系统相册可见（首次会自动创建「AI 生图」相册）；
   - 按系统返回键：历史抽屉开着时先关抽屉，再按则退出应用；
   - 切换深色模式：状态栏颜色应跟随（若 Android 15 edge-to-edge 下状态栏仍为网页自绘，属预期，双保险已生效）。

## 可选后续

4. **Release 签名**（上架/正式分发需要）：生成 keystore → `android/key.properties` + build.gradle 签名配置 → CI 改 `assembleRelease`。需要时可开任务。
5. **设置弹窗的返回键**：目前设置弹窗打开时按返回键会退出应用（弹窗状态在 Dialog 内部）。若在意可开小任务打通。
6. **改 APK 名称/包名/加载地址**：编辑 `capacitor.config.ts`（appName / appId / server.url）后重新跑一次 CI。

## 无缺少的配置

- 无新环境变量、无新密钥。Debug 签名由 CI 自动生成。`overrides.sharp` 已固化，`npm ci` 可复现安装。
