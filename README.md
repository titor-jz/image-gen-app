# AI Image Gen（智能生图）

个人 AI 图片生成工具：输入提示词（可附参考图），通过上游图像 API 异步生图。
支持 Web（Vercel / Cloudflare Workers）两种部署形态，用户自带 API Key（BYO Key）。

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

## 安全注意事项

- **Key 与 BaseURL 同源不变式（2026-09 安全收口）**：API 路由按请求来源配对——
  - 请求头带 `x-api-key`（BYO）：base/proxy 同样取自请求头；
  - 未带 Key（服务端 env Key 模式）：base/proxy **只取服务端** `OPENAI_BASE_URL` / `OPENAI_PROXY_URL`，**客户端传入的 `x-base-url` / `x-proxy-url` 被忽略**。
  该不变式消灭了"服务端 Key 被发往调用方指定主机"的凭据外泄路径。即使如此，公开部署仍不建议配置 `OPENAI_API_KEY`（配置即把额度开放给所有访问者）。
- **SSRF 基线防护**：所有客户端提供的 `x-base-url` / `x-proxy-url` 会经 `lib/url-guard.ts` 校验——仅允许 http/https，拒绝 localhost / `*.internal` 与私网、回环、链路本地（含云元数据 169.254.169.254）等保留地址；同步分支对上游返回图片 URL 的服务端代取同样受限。注意这是基线（不含 DNS rebinding 防护）。
- **零鉴权/零限流（设计取舍）**：知道 URL 即可把站点当免费中继。个人使用建议在平台层加保护，**不要用自写 middleware Basic Auth**（Android WebView 对 401 的处理不可靠，会弄坏 APK）：
  - Vercel：Deployment Protection（密码保护），WebView 可正常登录一次后保持会话；
  - Cloudflare：Zero Trust Access 策略。
- 请求体上限 **4MB**（低于 Vercel 平台限 4.5MB，超限返回明确的 `REQ_BODY_TOO_LARGE` 中文提示）；客户端对 >512KB 的参考图自动压缩。
- 上游 `taskId` 经编码与长度校验后拼接，防路径穿越；错误响应不透出内部异常原文。
