<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Image Gen（智能生图）

个人 AI 生图工具（BYO Key）：输入提示词（可附参考图），经上游图像 API 异步生图。
同一套 Next.js 16 (App Router) + React 19 + TS strict 代码，部署为 Web 两种形态：

- **Vercel**（`vercel.json` 锁 hkg1、API maxDuration 60s）
- **Cloudflare Workers**（OpenNext 适配，`wrangler.jsonc`）

## 常用命令

```bash
npm run dev            # Web 开发
npm run lint           # eslint（flat config，eslint.config.mjs）
npx tsc --noEmit       # 类型检查（无独立 test 套件）
npm run deploy:cf      # Cloudflare 部署
```

## 架构边界

```
浏览器 → app/api/* 路由（无状态透传代理）→ 上游图像 API
  POST /api/generate          → /images/generations/async 提交任务
  GET  /api/task/[taskId]     → 轮询；/content 取图
  POST /api/optimize          → /chat/completions 提示词改写（可走独立节点）
```

- **服务端不存任何数据**。API Key / Base URL / 代理在浏览器 localStorage，经 `x-api-key` / `x-base-url` / `x-proxy-url` 头透传（`lib/api-headers.ts`）。新增 API 路由也必须走透传模式，不得引入服务端存储。
- **提示词优化是独立接口配置**：设置里「提示词优化接口」自己填 Base URL / Key / 模型 / 代理（`image-gen-optimize-config`），不占用生图节点列表，也不需要「启用」；留空时才回落到当前生图节点。`/api/optimize` 自动挑对话模型（`/models` 为空时按常见型号探测），失败保留原文、不静默降级。
- **历史图存 IndexedDB**（`lib/db.ts`，用 `idb`）；设置存 localStorage（`lib/user-settings.ts`）。
- **上游 HTTP 统一走 `lib/http-client.ts`**（双运行时自适应：Node/Vercel 用 undici——连接池 + ProxyAgent 代理；Cloudflare Workers 用全局 fetch，`proxyUrl` 在该运行时被忽略），不要绕过它自行选 fetch 实现。
- **SVG 矢图输出**：2.6 全家族（基础版/flare 实测均出真矢量）经 `output_format:"svg"` 透传生成，响应为 `<svg>` XML 文本（非位图）。路由 `sniffImageMime` 识别 `<?xml`/`<svg` 文本头返回 `image/svg+xml`；下载后缀经 `extOf` 映射（`svg+xml`→`svg`）；结果卡 SVG 角标。UI「格式」选 SVG：模型过滤 ≥2.6（全家族），画幅可选且有意义（viewBox 跟随请求尺寸），无尺寸/质量限制（与 GIF 相反）。**SVG 仅限纯文生图（官方模型限制，非中转问题）**：官方 edits 端点不支持 SVG 输出、SVG 生成不接受参考图（gpt-image-2.6 无法矢量化已有图片）；中转实测与官方一致（output_format=svg 必现 422 No account completed，去掉参数即成功）。即：SVG+参考图组合在模型层面不可用，422 报错不扣费。另：官方 background=transparent（配 png/webp）在 gpt-image-2 上为 preview 支持——当前中转忽略该参数（实测 alpha≈240 不透明），中转支持后可加「透明背景」开关。
- **动图支持**：gpt-image 2.6 系可返回 GIF 动图，generate 路由按魔数嗅探 `mime`（`sniffImageMime`），下载后缀与结果卡 GIF 角标都依赖它；不要把 mime 写死回 `image/png`。动图由提示词驱动：UI「格式」选 GIF 后模型下拉只留实测能出动画的型号（`supportsAnimation`——**基础版 2.6 实测只出静图，仅 flare/sunburst 可靠**）。服务端注入两段指令（`format` 字段，历史/回填仍存用户原文）：前缀「生成无缝循环的GIF动图：」+ 尾部「，画面包含持续的循环动态动作，帧与帧之间连续变化」——**缺尾部指令时，静态描述类提示词（如「XX形象的卡通图」）模型会回静图（W1/W2 对照实测）**。提示词里写「循环时长/帧率」类字眼实测会让动画失效变静图，均不要加。**上游动图管线对 size 挑剔**：1024x1024 / 2048x1152 实测出动画；"auto" 与 3072x3072（4K 档）静默回退静图（E/F/I/J 组对照）；quality 无关（low/high 均动）。GIF 模式下路由统一送 1024x1024（`upstreamSize`），UI 画幅选择器禁用——动图输出画幅本就由模型自定（请求 2048x1152 实际回 505x337）。官方其实有结构化参数 `output_format="gif"` / `frame_count`（2~64）/ `frame_duration_ms`（20~2000ms），但中转实测忽略（返回默认 9 帧 @200ms）——中转透传该参数后，在格式区加帧数/时长控件并随 form 透传即可（管道已预留）。
- **中转无异步端点时同步生成必须流式保活**：async 404 回落同步后，整个生成期（flare 实测 38~41s）挂住连接，手机蜂窝网络会掐断长请求（报 failed to fetch 但上游已扣费）。generate 路由的同步回退分支返回 ndjson 流（`streamSyncGeneration`）：每 10s 一行心跳保活，最后一行 result/error 是载荷；客户端 `useImageGeneration` 按行解析。Workers 上游超时放宽到 95s（CF 边缘 100s 截断内），Vercel 维持 55s。
- **节点异步能力记忆**：探测结果按节点 id 存 localStorage（`lib/node-capability.ts`，7 天过期自动重探）。同步型节点（无端点/假异步——task_id 超 15s 才返回）生成时带 `asyncMode=skip` 直接走流式同步，省探测往返且免假异步挂死；中转升级出真异步后一周内自动纠正。
- **错误处理契约**：API 路由只返回稳定 error code，用户文案统一在 `lib/error-messages.ts` 映射（命名 `<域>_<场景>`）。新增错误只加一行，不改 UI。
- 任务编排（并发、单张取消、指数退避轮询）在 `hooks/useImageGeneration.ts`；多节点/模型状态在 `lib/api-config-context.tsx`。

## 已知坑

- **Workers 运行时检测勿用 `WorkerGlobalScope`**：workerd 不暴露该构造器（浏览器才有），typeof/instanceof 检测部署后恒为假，http-client 会误走 undici 分支报 `MessagePort is not defined`。用 `navigator.userAgent === "Cloudflare-Workers"`（http-client.ts 的 `IS_WORKERS`）。注意 `/api/models` 失败会静默回落兜底模型列表，测不出这类崩溃——验证上游调用要看 `/api/generate`。
- **禁止在 Vercel/CF 公开部署的环境变量里配 `OPENAI_API_KEY`**：客户端未带 `x-api-key` 时路由会回落到服务端环境变量，等于把额度开放给所有访问者。且 BYO 端点架构本身即开放中继（`x-base-url` 可指向任意上游），公开部署需自行加鉴权/限流。
- `scripts/**` 运行在 Node CommonJS 上下文，必须用 `require()`（已在 eslint 中豁免 no-require-imports），不要改成 ESM。
- **multipart 的中文提示词必须声明 charset，否则被上游吞掉**：NewAPI 系中转对没有 `Content-Type` 的表单字段按 latin-1 解码，中文提示词变乱码 → 模型完全忽略提示词（表现为返回与提示词无关的内容、或多出一个杯子）。**undici 的 `FormData` 给文本字段只发 `Content-Disposition`、不带 charset**，所以图生图（走 multipart `/images/edits`）对中文提示词必然失效。修法是手写 multipart：`lib/http-client.ts` 的 `httpMultipartRequest`（文本部件默认带 `text/plain; charset=utf-8`）。纯文生图走 JSON 不受影响。**改这条链路时不要退回 `FormData`**，否则中文提示词静默失效（RFC 无错、只是语义丢了，最难查）。浏览器 → 自家 `/api/generate` 那一段不受影响：真实浏览器的 FormData 经 Next `request.formData()` 解析中文无损（curl 的 `-F` 反而不行，**用 curl 打在自家路由上测中文会得到假阴性**）。
- **该中转不尊重 `mask`（局部重绘）**：`/images/edits` 接受 mask 并返回 200，但实测完全不按 mask 约束 —— 同一 prompt、互为补集的两张 mask 输出几乎相同（差异 0.0097）；全局提示词配局部 mask 时整张图都变；mask 指定 A 处、提示词说改 B 处时，改的是 B。**局部重绘功能已下线**（2026-11-09，模型重绘立体中文大字质量不达标），但这条事实仍然成立：将来若重做，局部性只能靠客户端合成兜底，不能指望上游。详见 `docs/inpaint/PLAN.md`。
- 验证生成结果**必须看画面内容**，不能只看 HTTP 200 / 尺寸 / mime：该中转曾返回与提示词完全无关的图。定量指标（区域 diff）+ 肉眼缩略图两条都要过。
- Vercel serverless 请求体上限约 4.5MB，大参考图可能被平台直接拒。
- **本地代理（127.0.0.1:789x）曾经整条路是废的**：SSRF 基线把 `x-proxy-url` 和 `x-base-url` 用同一套「禁一切内网」规则校验，而桌面代理天然就监听在 127.0.0.1，于是本地开发填了代理反而报「上游地址不合法」。现在 `lib/url-guard.ts` 的 `proxyUrlError()` 对**代理**单独放宽回环地址（localhost / 127/8 / ::1），仍拒绝链路本地与云元数据（169.254/16）和其他私网段。改这块时不要图省事把两者合并回一个函数。另：Clash 系默认端口是 **7897**（不是 7890），端口填错表现为 502「无法连接到上游 API」。
- 尺寸/质量映射在 `lib/size-map.ts`（1K/2K/4K 三档各自的像素表 + `upstreamSizeFor`），**服务端路由与输入卡共用同一份**——改档位只改这一处，别在界面里另抄一份（曾经的 bug：2K 档落回 1K 表，选 2K 仍出 1024×1024；界面也曾硬编码过 GIF 的 1024×1024）。实际像素尺寸显示在输入卡的「画幅」后面，换质量档时跟着变。
- **节点×清晰度档能力记忆**（`lib/node-size-capability.ts`，7 天 TTL）：被动学习每次真实生成的「请求尺寸 vs 实际像素」，标记 supported / degraded（出图偏小）/ unsupported。含**单调推断**——高档可用则低档也标记可用（可覆盖低档那些矛盾的旧实测），低档给不到则高档也标给不到（不覆盖新鲜实测）。推断值一律带 `inferred`，UI 文案必须与实测分开说（「推断可用至 X」vs「实测可用至 X」），否则就是在替上游背书。

## 文档

- `README.md`：功能、部署、安全注意事项（改部署/安全相关代码前先读）。
- `docs/<任务名>/`：按 6A 工作流沉淀的 ALIGNMENT / CONSENSUS / DESIGN / TASK / ACCEPTANCE / FINAL / TODO 文档。
