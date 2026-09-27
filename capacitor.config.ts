import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 配置——远程加载模式（B1）
 *
 * APK 是薄壳：WebView 直接加载已部署的 Web 站点。
 * - 改网页部署即生效，APK 永不因功能更新而重建；
 * - `cap-www/` 仅作离线兜底页（server.errorPath），不承载应用代码；
 * - 升级到本地打包模式（B2）时：去掉 server.url、把 webDir 指向
 *   静态导出产物、并新增客户端直连上游的 API 层（见 docs/capacitor-apk/DESIGN）。
 */
const config: CapacitorConfig = {
  appId: "me.titorjz.imagegen",
  appName: "AI 生图",
  webDir: "cap-www",
  server: {
    // 生产站点（dev 分支需部署后 APK 才有完整功能）
    url: "https://image-gen-app-rho.vercel.app",
    // 站点加载失败（断网等）时显示的兜底页，相对 webDir
    errorPath: "index.html",
  },
  android: {
    // 正式版关闭 WebView 远程调试（chrome://inspect 无法读取应用数据）；
    // 排查问题时临时改回 true 重新构建
    webContentsDebuggingEnabled: false,
  },
};

export default config;
