# ACCEPTANCE: review-2026-09

对照已批准规划（B 档）逐阶段记录执行与验证结果。

## 阶段 0：真相固化 ✅

- `docs/review-2026-09/REVIEW.md`：A-1~A-12 + S-1~S-13 全量问题清单（证据/影响/处置状态）。
- 修正验收口径：capacitor-apk ACCEPTANCE（构建链/CI/相册/状态栏四处夸大表述）、TODO（JDK 21、APP 内独立存储）、android-pwa ACCEPTANCE（触控目标口径）。
- `docs/review-2026-09/TODO_review.md`：用户侧待办与遗留清单。

## 阶段 1：安卓交付缺陷修复 ✅（编译级验证；CI 真跑待用户）

- A1 ✅ workflow JDK 17→21、gradle `-Xmx2048m`。
- A2 ✅ 保存相册补 `albumIdentifier`（getAlbums→createAlbum→savePhoto，失败 toast 中文化）；已核对插件 d.ts（createAlbum 返回 void，需重建列表取 identifier）。
- A3 ✅ 兜底页「重试」改 `location.replace(<远程站点>)`。
- A4 ✅ 返回键监听改 ref + 单次注册（含 await 后 disposed 复查）。
- A5 ✅ Manifest 权限收敛（删 READ_MEDIA_IMAGES/READ_EXTERNAL_STORAGE，保留 WRITE maxSdk 29）。
- **未验证项**：Android 侧真跑（CI 出包 + 真机）——本机无 SDK，交用户闭环。

## 阶段 2：服务端安全加固 ✅

- B1 ✅ `lib/upstream-config.ts` 同源不变式；generate/task/content/models/test-key 全部接入；models 在 env Key 模式下不代拉列表（与原行为一致）；balance 修错误契约。
- B2 ✅ `lib/url-guard.ts` SSRF 基线；客户端 base/proxy 与同步分支代取 URL 全部受限；新增错误码 `REQ_INVALID_UPSTREAM_URL`（400）。
- B3 ✅ taskId `encodeURIComponent` + 200 字符上限。
- B4 ✅ 体积上限 4MB；客户端压缩阈值 512KB；`REQ_BODY_TOO_LARGE` 文案同步。
- B5 ✅ `httpJsonPost` 120s→55s。
- B6 ✅ 三路由 UNKNOWN 不再透出内部异常原文。
- B7 ✅ README 安全章节重写（含平台级保护指引与"为何不做 middleware Basic Auth"）。
- 附带：tsconfig exclude `scripts`（直测脚本属独立 Node 工具，不参与应用类型检查）。

## 阶段 3：验证结果 ✅

| 验证项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| `npm run lint` | 0 错误（5 个存量警告） |
| `npm run build` | 通过（manifest.webmanifest 正常预渲染） |
| url-guard 直测 | **29/29 通过**（私网/回环/元数据/CGNAT/IPv6/映射地址/协议/合法放行全覆盖） |
| curl ① base-url 内网 | REQ_INVALID_UPSTREAM_URL（400）✅ |
| curl ② proxy-url 私网 | REQ_INVALID_UPSTREAM_URL ✅ |
| curl ③ 请求体 >4MB | REQ_BODY_TOO_LARGE（413，中文）✅ |
| curl ④ 超长 taskId | REQ_BAD_FORMAT ✅ |
| curl ⑤ test-key 内网 base | REQ_INVALID_UPSTREAM_URL ✅ |
| curl ⑥ 无 Key models 回归 | 兜底模型正常 ✅ |
| **不变式判别测试（端到端）** | env Key 模式：客户端注入 `/clientbase` 被忽略，实际请求打到 env 指定的 `/envbase` ✅；BYO 模式：`x-api-key`+`x-base-url` 正常到达 `/byobase` ✅（用本地监听器记录路径判别） |

## 阶段 3.5：安卓端模拟测试 ✅（2026-09-26 追加，用户授权）

**方法**：Playwright 注入 Capacitor 原生桥 mock——mock 契约逐一镜像真实源码（平台判定按 core 的 `getPlatformId` 检查 `androidBridge`；方法分发按 core 的 `PluginHeaders` rtype 走 `nativePromise/nativeCallback`；Media 行为镜像 `MediaPlugin.java`，含"savePhoto 缺 albumIdentifier 必须 reject"）。真实桥代码（@capacitor/core 分发层）跑在假原生层上，非纯函数级模拟。

**结果：11/11 通过**（`node scripts/test-capacitor-bridge.cjs`，需 dev server）：

| 验证项 | 结果 |
|---|---|
| 平台判定 android + isNativePlatform | ✅ |
| APP 环境渲染「保存到相册」按钮 | ✅ |
| 保存流程 getAlbums→createAlbum→getAlbums→savePhoto | ✅ 调用序列精确匹配 |
| savePhoto 满足原生契约（albumIdentifier 必填） | ✅ 传了 album-1 |
| 保存成功 toast + 二次保存不重复建相册 | ✅ |
| 返回键：关抽屉→退出 / 开抽屉→仅关抽屉 / 再按→退出 | ✅ 三态全对 |
| 快速开关抽屉 3 次后监听器仍单次注册（无竞态泄漏） | ✅ |
| 状态栏：挂载亮色(#ffffff)→切换暗色(#0b121a/DARK) | ✅ 序列正确 |

**过程中抓到并修正的测试侧偏差**（app 代码无误）：mock 的 addListener 曾在注册瞬间调用事件回调（真实桥只存储不调用），导致"启动即 exitApp"假象——修正后语义与真实桥一致。

**边界**：此层验证的是 Web 代码与原生契约的对接；APK 内真实插件行为（MediaStore 落盘、系统返回键事件）仍需 CI 出包 + 真机/模拟器确认。

## 未验证项（交用户闭环）

- Android CI 真跑出包 + 真机验收（见 TODO_review）。
- Vercel/CF 控制台确认是否配置过 `OPENAI_API_KEY`。
