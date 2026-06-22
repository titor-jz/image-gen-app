# 公开部署 Spec

## Why
用户希望将 AI 图片生成应用部署到公网，让其他人也能通过浏览器访问使用。需要选择一个免费方案，并解决 Serverless 环境下的文件存储问题。

## What Changes
- 生成图片从本地文件存储改为 IndexedDB 存储（base64）
- 移除 Electron 打包相关依赖和配置（部署到公网不需要桌面应用）
- 添加部署配置文件（Vercel / Cloudflare Pages）
- 确保 API 路由在 Serverless 环境正常工作（代理、超时等）

## Impact
- Affected specs: 图片生成流程、历史记录
- Affected code:
  - `app/api/generate/route.ts` — 返回 base64 而非写入文件
  - `lib/db.ts` — 扩展存储生成的图片
  - `components/ResultGrid.tsx` — 从 IndexedDB 读取图片
  - `package.json` — 清理 Electron 依赖
  - 新增 `vercel.json` / 部署配置

## ADDED Requirements

### Requirement: 图片存储
系统 SHALL 将生成的图片以 base64 形式存储在 IndexedDB 中，不再写入 `public/generated/` 目录。

#### Scenario: 生成图片
- **WHEN** 图片生成成功
- **THEN** base64 数据存入 IndexedDB，页面通过 blob URL 显示

#### Scenario: 查看历史
- **WHEN** 用户点击历史记录
- **THEN** 从 IndexedDB 读取图片数据并显示

### Requirement: 公开部署
系统 SHALL 支持部署到 Vercel 或 Cloudflare Pages，无需修改代码即可运行。

#### Scenario: Vercel 部署
- **WHEN** 项目推送到 GitHub 并连接 Vercel
- **THEN** 自动构建部署，API 路由正常工作

### Requirement: 用户自带 API Key
系统 SHALL 保持用户自带 API Key 的模式，Key 存储在浏览器 localStorage，不上传到服务器。

#### Scenario: 首次使用
- **WHEN** 新用户打开网站
- **THEN** 提示配置 API Key、Base URL，配置后方可使用

## MODIFIED Requirements

### Requirement: 图片下载
图片下载 SHALL 从 IndexedDB 读取 base64 数据，转换为 Blob 后触发浏览器下载。

## REMOVED Requirements

### Requirement: Electron 桌面应用
**Reason**: 部署到公网后不需要桌面应用版本
**Migration**: 保留 `electron/` 目录代码但不影响 Web 部署，从 package.json 主入口移除 Electron 相关脚本
