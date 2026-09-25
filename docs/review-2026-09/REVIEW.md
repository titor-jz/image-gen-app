# REVIEW：整体评审（2026-09）

对"安卓 PWA + Capacitor APK 交付物"与"项目整体健康度"的一次全面评审。方法：两个并行只读审查代理（逐文件核对源码与插件实现）+ 人工复核关键文件。范围决定（用户确认）：**B 档 = 修复安卓交付缺陷 + 服务端安全加固**；暴露面为"只有自己用"，安全项按"消除地雷"处理；服务端是否配置 `OPENAI_API_KEY` 未确认——按"潜在雷"处理（收口后无论是否配置均安全）。

处置状态说明：✅ 本次修复 ｜ ⏸ 遗留（未纳入 B 档）｜ ❓ 待用户确认/真机验证

## 一、安卓交付物缺陷

| # | 级别 | 问题 | 证据 | 影响 | 状态 |
|---|---|---|---|---|---|
| A-1 | P0 | CI 装 JDK 17，但 Capacitor 8 工程强制 Java 21，首次构建必报 `invalid source release: 21` | `.github/workflows/android-apk.yml`（java-version 17）；`android/app/capacitor.build.gradle:5-6`（VERSION_21）；`@capacitor/cli/dist/tasks/migrate.js`（"requires JDK 21+"） | 用户第一次 Run workflow 即红 | ✅ 改 JDK 21 + gradle Xmx 2048m |
| A-2 | P0 | 「保存到相册」缺 Android 必填 `albumIdentifier`，原生层直接 reject（"Album identifier required"） | `components/ResultGrid.tsx`（仅传 path）；`@capacitor-community/media` 插件 `MediaPlugin.java:337-352` | 功能 100% 不可用，英文报错直出 | ✅ getAlbums→createAlbum→savePhoto |
| A-3 | P0 | 兜底页「重试」reload 本地错误页，断网后成单向陷阱 | `cap-www/index.html:46`；`BridgeWebViewClient.java`（errorPath 展开为本地地址） | 断网恢复后必须杀进程 | ✅ 改跳远程站点 |
| A-4 | P1 | 返回键监听器按 `showHistory` 重挂：cleanup 与 await 竞态可累积监听器（旧闭包捕获旧状态） | `app/page.tsx`（listener 赋值在 await 后，removed 检查在 await 前） | 快速开关抽屉后「开抽屉按返回却退出」 | ✅ ref + 单次注册 |
| A-5 | P1 | APK WebView 是独立存储分区：Chrome 里配的 Key/历史在 APP 内不可见，文档从未提及 | API 配置存 localStorage、历史存 IndexedDB；capacitor TODO 写"无缺少的配置" | 首次打开 APK 即"未配置 Key"、历史为空 | ✅ 已写入文档口径（代码层面无解，属 WebView 语义） |
| A-6 | P1 | in-flight TTL（5min）与轮询窗口（5min）等长：杀进程 >5 分钟后任务静默丢失且占位被标 abandoned | `hooks/useInFlightRecovery.ts`、`lib/db.ts:12`、`useImageGeneration.ts:51` | 超时任务无任何提示；同 prompt 重发会直接提交（潜在二次扣费） | ⏸ 遗留（见"未纳入"清单 3） |
| A-7 | P2 | 不可恢复条目（无 taskId）占位不释放，toast 建议重发但重发会撞 CLIENT_INFLIGHT"请等待"，文案互相矛盾 | `useImageGeneration.ts`（releasedIds 仅在恢复成功时 push）；`useInFlightRecovery.ts:53-57` | 用户困惑；占位锁满 5 分钟 | ⏸ 遗留（同上） |
| A-8 | P2 | 状态栏 `setBackgroundColor` 在 Android 15+（targetSdk 36 强制 edge-to-edge）是 no-op，而 ACCEPTANCE 写成已交付能力 | `@capacitor/status-bar` README/源码；`android/variables.gradle`（targetSdk 36） | 真机只有图标明暗生效 | ✅ 文档口径修正（代码保留：旧系统有效） |
| A-9 | P2 | Manifest 相册权限声明与插件实际需求不符（非 gallery 模式不需要任何权限） | `MediaPlugin.java:145-161`；插件 README 明示可删除 | 上架触发 Play 权限申报；gallery 模式下还缺 READ_MEDIA_VIDEO | ✅ 权限收敛 |
| A-10 | P3 | `overrides.sharp="$sharp"` 全局强制，波及 miniflare/next 的 sharp 依赖 | `package.json`；package-lock 解析记录 | 跨大版本强制，将来报错难定位 | ⏸ 遗留（现状可用） |
| A-11 | P3 | dev 下 StrictMode 双挂载会重复恢复同一任务（二次轮询） | `useInFlightRecovery` 无幂等保护 | 生产构建不受影响 | ⏸ 遗留 |
| A-12 | P2 | 「本地构建链 ✅」「CI ✅」等验收口径夸大：Android 从未编译过，CI 从未真跑（dev 分支 9 个提交未推送） | 全仓无 APK；`android/app/build/` 仅 `.npmkeep`；GitHub Actions 无运行记录 | 验收结论不可信 | ✅ 口径已修正 |

## 二、项目级安全与健壮性

| # | 级别 | 问题 | 证据 | 影响 | 状态 |
|---|---|---|---|---|---|
| S-1 | P0 | 服务端 Key 外泄：env Key 回落 + `x-base-url` 客户端可控 → 服务端把 env Key 以 Bearer 发往调用方指定主机 | `app/api/generate/route.ts:43-49,103-108`；同模式 task/content/balance | 一旦配置 env Key 即"凭据公开"（比 README 描述的"额度开放"更严重） | ✅ Key/BaseURL 同源不变式 |
| S-2 | P0 | 可读 SSRF：base/proxy 零校验；同步分支服务端抓取上游返回的任意 URL 并回传内容 | `generate/route.ts:49,203-222`；`lib/http-client.ts` | 探测内网/云元数据（169.254.169.254 等） | ✅ url-guard 基线（不含 DNS rebinding，已注明） |
| S-3 | P0 | 零鉴权/零限流：知道 URL 即可把站点当免费中继 | 无 middleware；grep 无 rate-limit | 公开部署即开放中继 | ⏸ 代码不做（个人用），README 补平台级保护指引（Vercel Deployment Protection / CF Access） |
| S-4 | P1 | 体积上限 20MB 与 Vercel 平台 4.5MB 矛盾：平台先拒，用户看到"未知错误" | `generate/route.ts:58` vs README/AGENTS | 大参考图必踩，报错误导 | ✅ 上限 4MB + 客户端压缩阈值 512KB |
| S-5 | P1 | 同步回落超时 120s > Vercel maxDuration 60s：必被平台先杀 | `lib/http-client.ts:85` vs `vercel.json` | 同步分支必然异常断连 | ✅ 55s |
| S-6 | P1 | taskId 未编码直接拼进上游 URL，`..%2F` 可越出路径前缀 | `task/[taskId]/route.ts:28`、`content/route.ts:37` | 放大 SSRF 面 | ✅ encodeURIComponent + 长度上限 |
| S-7 | P1 | 错误码契约破坏 + 内部信息外泄：balance 旧格式；UNKNOWN details 携带内部异常原文（含 URL） | `balance/route.ts:8`；三路由 `errorResponse("UNKNOWN", message)` | 前端解析成 UNKNOWN；内部 URL 泄给 UI | ✅ 已修（balance 死端点保留，见"未纳入"） |
| S-8 | P2 | 客户端 provided base/proxy 在 models/test-key 路由同样无校验（SSRF 同源问题） | `models/route.ts`、`test-key/route.ts` | 同 S-2 | ✅ 一并接入 url-guard |
| S-9 | P2 | 无 Web CI、无测试 | `.github/` 仅 android-apk.yml | 回归全靠手工 | ⏸ 遗留 |
| S-10 | P2 | 历史记录全量 base64 无上限无淘汰，写失败静默 `.catch(()=>{})`，无 storage.persist | `useImageGeneration.ts:717-733` | 配额满时"生成成功但历史丢失" | ⏸ 遗留 |
| S-11 | P2 | CF Workers 形态未验证：http-client 强依赖 undici+ProxyAgent，Workers 下代理很可能不可用 | `wrangler.jsonc`、`lib/http-client.ts:1` | "双形态部署"名不副实 | ⏸ 遗留 |
| S-12 | P3 | ProxyAgent 每请求 new 且不 close；content 路由无响应体上限 | `lib/http-client.ts:20,52,88` | 连接/内存放大 | ⏸ 遗留 |
| S-13 | P3 | `.trae/specs` 有"纸面完成"记录（声称交付的 chat/ChatPanel 代码从未存在） | `.trae/specs/add-ai-chat/checklist.md` | 历史可信度 | ⏸ 遗留 |

## 三、文档与实现不一致（已在阶段 0 修正口径）

1. capacitor-apk/ACCEPTANCE「本地构建链 ✅ / CI ✅」→ 实际从未编译 Android、CI 从未真跑（A-12）。
2. 「保存到相册 ✅」→ 实际缺 albumIdentifier 不可用（A-2）。
3. DESIGN「无节点快照条目 → 标记 abandoned」→ 代码只跳过不释放（A-7）。
4. CONSENSUS「触控目标 ≥44px」→ 实际核心 44px、次要 36px/28px，三处文档口径不一。
5. 状态栏「setStyle + setBackgroundColor ✅」→ Android 15+ 仅 setStyle 生效（A-8）。
6. README「请求体 20MB 校验可拦截」→ 平台 4.5MB 先拒（S-4）。
7. 全篇未提「APK 内需重新配置 Key、历史为空」（A-5）。

## 四、历史遗留（非本次引入）

- `docs/migrate-project/TODO`：源空壳目录待删、`D:\jz\.backup\image-gen-app-20260708-223447`（2.05GB）备份早已过期、6 个一次性迁移脚本仍在库中。
- `docs/archify/`：8 个文件约 1.4MB 未跟踪（git status 唯一脏项）。
- `docs/superpowers/plans/`：计划文档 checkbox 未回填（能力已落地，仅文档问题）。

## 五、本次范围（B 档）与明确不做

**做**：A-1~A-5、A-8~A-9、A-12（文档口径）；S-1、S-2、S-4~S-8（含 models/test-key 一并收口）；S-3 以文档指引替代代码。

**不做（遗留清单，供后续任务）**：A-6/A-7（in-flight 语义与 TTL 对齐）、A-10（overrides 收窄）、A-11（StrictMode 幂等）、S-3 代码级鉴权/限流、S-9 Web CI、S-10 历史容量治理、S-11 CF 验证、S-12 连接/流式治理、S-13 .trae 清理、Release 签名、设置弹窗返回键、死码清理（serverActions 死配置、REQ_PARSE_FAILED/GEN_INVALID_RESPONSE 无消费方、balance 死端点）。

## 六、待用户确认/验证

- ❓ Vercel/CF 是否配置了 `OPENAI_API_KEY`（本次收口后配置也安全，但建议确认并评估是否还需要）。
- ❓ 推送 dev → Actions 真跑（JDK 21 修复后应绿）→ APK 真机验收（启动屏、APP 内配 Key、生成、保存相册、返回键、状态栏、断网兜底页重试）。
- ❓ PWA「添加到主屏幕」在真机上呈现为"安装应用"还是"快捷方式"（Chrome 对无 SW 的安装ability 政策，影响 AC1 措辞）。
