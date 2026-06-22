# Tasks

- [x] Task 1: 修改图片存储方式 — 从文件改为 IndexedDB
  - [x] SubTask 1.1: 修改 `app/api/generate/route.ts`，返回 base64 数据而非写入 `public/generated/`
  - [x] SubTask 1.2: 修改 `lib/db.ts`，扩展表结构存储生成图片的 base64 数据（无需修改，HistoryRecord 已包含 results 中的 b64_json）
  - [x] SubTask 1.3: 修改 `components/ResultGrid.tsx`，从 IndexedDB 读取图片显示
  - [x] SubTask 1.4: 修改图片下载逻辑，从 base64 转为 Blob 下载

- [x] Task 2: 添加部署配置
  - [x] SubTask 2.1: 更新 `vercel.json` 配置（路由规则、环境变量）
  - [x] SubTask 2.2: 添加 `.env.example` 文件说明可选的环境变量
  - [x] SubTask 2.3: 确保 `next.config.ts` 兼容 Serverless 环境

- [x] Task 3: 清理 Electron 相关代码（不影响 Web 部署）
  - [x] SubTask 3.1: 从 `package.json` scripts 中分离 Electron 和 Web 脚本
  - [x] SubTask 3.2: 确保 `npm run build` 和 `npm run dev` 只构建 Web 部分

- [x] Task 4: 验证部署
  - [x] SubTask 4.1: 本地 `npm run build` 通过无错误
  - [x] SubTask 4.2: 验证图片生成、显示、下载全流程正常（代码审查通过）
  - [x] SubTask 4.3: 验证历史记录恢复图片正常（代码审查通过）

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] 可与 [Task 1] 并行
- [Task 4] depends on [Task 1], [Task 2], [Task 3]
