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
```

- **服务端不存任何数据**。API Key / Base URL / 代理在浏览器 localStorage，经 `x-api-key` / `x-base-url` / `x-proxy-url` 头透传（`lib/api-headers.ts`）。新增 API 路由也必须走透传模式，不得引入服务端存储。
- **历史图存 IndexedDB**（`lib/db.ts`，用 `idb`）；设置存 localStorage（`lib/user-settings.ts`）。
- **上游 HTTP 统一走 `lib/http-client.ts`**（undici，为支持 ProxyAgent 代理），不要换成全局 fetch。
- **错误处理契约**：API 路由只返回稳定 error code，用户文案统一在 `lib/error-messages.ts` 映射（命名 `<域>_<场景>`）。新增错误只加一行，不改 UI。
- 任务编排（并发、单张取消、指数退避轮询）在 `hooks/useImageGeneration.ts`；多节点/模型状态在 `lib/api-config-context.tsx`。

## 已知坑

- **禁止在 Vercel/CF 公开部署的环境变量里配 `OPENAI_API_KEY`**：客户端未带 `x-api-key` 时路由会回落到服务端环境变量，等于把额度开放给所有访问者。且 BYO 端点架构本身即开放中继（`x-base-url` 可指向任意上游），公开部署需自行加鉴权/限流。
- `scripts/**` 运行在 Node CommonJS 上下文，必须用 `require()`（已在 eslint 中豁免 no-require-imports），不要改成 ESM。
- Vercel serverless 请求体上限约 4.5MB，大参考图可能被平台直接拒。
- 尺寸/质量映射（`SIZE_MAP` / `SIZE_4K_MAP` / `QUALITY_MAP`）在 `app/api/generate/route.ts`，与 gpt-image-2 档位绑定。

## 文档

- `README.md`：功能、部署、安全注意事项（改部署/安全相关代码前先读）。
- `docs/<任务名>/`：按 6A 工作流沉淀的 ALIGNMENT / CONSENSUS / DESIGN / TASK / ACCEPTANCE / FINAL / TODO 文档。
