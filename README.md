# AI Image Gen（智能生图）

个人 AI 图片生成工具：输入提示词（可附参考图），通过上游图像 API 异步生图。
支持 Web（Vercel / Cloudflare Workers）与 Electron 桌面端三种形态，用户自带 API Key（BYO Key）。

## 功能

- 文生图 / 参考图（拖拽、粘贴、`@提及` 引用，大图自动压缩）
- 每张图独立任务：并发生成、单张取消、指数退避轮询、进度展示
- 多模型对比模式（两个模型并排出图）
- 60s 结果缓存 + IndexedDB 历史（仅存本地，不经服务端持久化）
- 统一错误码 → 用户文案映射（`lib/error-messages.ts`）

## 架构

```
浏览器 → Next.js API 路由（透传鉴权头）→ 上游图像 API
         POST /api/generate            → /images/generations/async 提交任务
         GET  /api/task/[taskId]       → /images/tasks/{id} 轮询状态
         GET  /api/task/[id]/content   → /images/tasks/{id}/content 取图
```

服务端不存储任何数据；API Key 存在浏览器 localStorage，经 `x-api-key` / `x-base-url` / `x-proxy-url` 请求头透传。

## 开发

```bash
npm install
npm run dev
```

## 部署

- **Vercel**：连接仓库即可（`vercel.json` 已配置 hkg1 区域、函数 maxDuration 60s）。
- **Cloudflare Workers**：`npm run deploy:cf`（OpenNext 适配，见 `wrangler.jsonc`）。
- **Electron 桌面版**：`npm run electron:build`。脚本内部以 `NEXT_OUTPUT=standalone` 构建，
  并把 `public/` 与 `.next/static/` 拷入 `.next/standalone`（`scripts/copy-public.js`）后打包——
  standalone 输出默认不含这两类资源，缺了会白屏/无样式。

## 安全注意事项

- **不要在公开部署（Vercel/CF）的环境变量里配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL`**：
  API 路由在客户端未带 `x-api-key` 时会回退到服务端环境变量，配置了等于把你的额度开放给所有访问者。
- API 路由按设计透传 `x-base-url` 到任意上游（BYO 端点架构），公开部署即开放中继；如需对外开放请自行加鉴权/限流。
- Vercel serverless 请求体上限约 4.5MB：带大参考图的生成请求可能被平台直接拒绝（桌面端无此限制，单图上限 8MB）。
