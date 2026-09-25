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

## 未验证项（交用户闭环）

- Android CI 真跑出包 + 真机验收（见 TODO_review）。
- Vercel/CF 控制台确认是否配置过 `OPENAI_API_KEY`。
