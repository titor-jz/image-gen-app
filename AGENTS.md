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
- **动图支持**：gpt-image 2.6 系可返回 GIF 动图，generate 路由按魔数嗅探 `mime`（`sniffImageMime`），下载后缀与结果卡 GIF 角标都依赖它；不要把 mime 写死回 `image/png`。动图由提示词驱动：UI「格式」选 GIF 后模型下拉只留实测能出动画的型号（`supportsAnimation`——**基础版 2.6 实测只出静图，仅 flare/sunburst 可靠**），且服务端在提示词前注入「生成无缝循环的GIF动图：」指令（`format` 字段，历史/回填仍存用户原文）。提示词里写「循环时长/帧率」类字眼实测会让动画失效变静图，帧数/时长参数中转也不透传——均不要加。
- **中转无异步端点时同步生成必须流式保活**：async 404 回落同步后，整个生成期（flare 实测 38~41s）挂住连接，手机蜂窝网络会掐断长请求（报 failed to fetch 但上游已扣费）。generate 路由的同步回退分支返回 ndjson 流（`streamSyncGeneration`）：每 10s 一行心跳保活，最后一行 result/error 是载荷；客户端 `useImageGeneration` 按行解析。Workers 上游超时放宽到 95s（CF 边缘 100s 截断内），Vercel 维持 55s。
- **错误处理契约**：API 路由只返回稳定 error code，用户文案统一在 `lib/error-messages.ts` 映射（命名 `<域>_<场景>`）。新增错误只加一行，不改 UI。
- 任务编排（并发、单张取消、指数退避轮询）在 `hooks/useImageGeneration.ts`；多节点/模型状态在 `lib/api-config-context.tsx`。

## 已知坑

- **Workers 运行时检测勿用 `WorkerGlobalScope`**：workerd 不暴露该构造器（浏览器才有），typeof/instanceof 检测部署后恒为假，http-client 会误走 undici 分支报 `MessagePort is not defined`。用 `navigator.userAgent === "Cloudflare-Workers"`（http-client.ts 的 `IS_WORKERS`）。注意 `/api/models` 失败会静默回落兜底模型列表，测不出这类崩溃——验证上游调用要看 `/api/generate`。
- **禁止在 Vercel/CF 公开部署的环境变量里配 `OPENAI_API_KEY`**：客户端未带 `x-api-key` 时路由会回落到服务端环境变量，等于把额度开放给所有访问者。且 BYO 端点架构本身即开放中继（`x-base-url` 可指向任意上游），公开部署需自行加鉴权/限流。
- `scripts/**` 运行在 Node CommonJS 上下文，必须用 `require()`（已在 eslint 中豁免 no-require-imports），不要改成 ESM。
- Vercel serverless 请求体上限约 4.5MB，大参考图可能被平台直接拒。
- 尺寸/质量映射（`SIZE_MAP` / `SIZE_4K_MAP` / `QUALITY_MAP`）在 `app/api/generate/route.ts`，与 gpt-image-2 档位绑定。

## 文档

- `README.md`：功能、部署、安全注意事项（改部署/安全相关代码前先读）。
- `docs/<任务名>/`：按 6A 工作流沉淀的 ALIGNMENT / CONSENSUS / DESIGN / TASK / ACCEPTANCE / FINAL / TODO 文档。
