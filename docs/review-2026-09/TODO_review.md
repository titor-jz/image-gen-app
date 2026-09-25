# TODO：review-2026-09（需要你做的事 / 后续可选）

## 需要你做的事

1. **推送 dev 分支**：本次修复全部在本地 dev 分支。推送后 Vercel 自动部署（生产站点才会包含安全收口与安卓修复），且 Actions 才能真跑。
2. **确认部署环境变量**：登录 Vercel（或 CF）控制台看是否配了 `OPENAI_API_KEY`。本次修复后即使配置了也不会再外泄（env Key 模式下忽略客户端 base-url），但请顺手确认——若你从来只用 BYO 请求头，建议直接删掉它，少一份风险面。
3. **跑一次 Android CI**：仓库 Actions → 「Android APK」→ Run workflow。JDK 已修正为 21，首次应能绿；产物 `imagegen-debug-apk` 下载安装。
4. **真机验收清单**：
   - 启动屏（星芒）→ 全屏应用；**首次使用需在 APP 内重新配置 API Key**（APP 的存储与浏览器隔离，这是 WebView 语义，历史记录同理为空）；
   - 生成 → 展开预览 → 「保存到相册」（本次补了相册必填参数，应能成功；失败会有中文提示）；
   - 断网打开 APP → 兜底页 → 恢复网络点「重试」应能回到站点；
   - 返回键：历史抽屉开着先关抽屉，再按退出应用；
   - 深色模式状态栏图标明暗随主题（Android 15+ 底色由页面自绘，属预期）；
   - PWA「添加到主屏幕」入口形态（安装 or 快捷方式），顺手看一眼。

## 可选后续（评审遗留，按需开任务）

- in-flight 语义与 TTL 对齐（超时任务 >5 分钟静默丢失 + 占位矛盾，见 REVIEW 一/A-6、A-7）
- Web CI 门禁（lint/tsc/build）
- 历史容量治理（上限/淘汰/storage.persist/写失败提示）
- CF Workers 形态验证（undici+ProxyAgent 在 Workers 的可用性存疑）
- 仓库卫生：`D:\jz\.backup\image-gen-app-20260708-223447`（2.05GB，早已过期）删除；`docs/archify/`（1.4MB 未跟踪）决定提交/删除；migrate 一次性脚本归档；源空壳目录删除
- Release 签名（上架需要）、设置弹窗返回键、死码清理（详见 REVIEW 第五节"不做"清单）
