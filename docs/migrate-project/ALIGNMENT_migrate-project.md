# ALIGNMENT - 项目迁移任务对齐文档

> 任务：将 `d:\jz\project\image-gen-app` 完整迁移到 `D:\jz` 目录

## 1. 项目特性规范

### 1.1 当前项目信息
| 项目属性 | 值 |
|---------|---|
| 项目名称 | image-gen-app |
| 技术栈 | Next.js 16.2.9 + React 19.2.4 + Electron 42 + Tailwind 4 + shadcn/ui |
| 包管理器 | npm（存在 package-lock.json） |
| 版本控制 | Git（存在 .git 目录） |
| 项目类型 | AI 图片生成桌面应用（Next.js + Electron 双形态） |
| 当前路径 | `d:\jz\project\image-gen-app` |
| 目标根目录 | `D:\jz` |

### 1.2 项目关键内容盘点
**源代码（必须迁移）**：
- `app/` - Next.js App Router 入口
- `components/` - React 组件
- `electron/` - Electron 主进程
- `lib/` - 业务工具库
- `public/` - 静态资源
- `scripts/` - 构建脚本
- `package.json` / `package-lock.json`
- 配置文件：`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`postcss.config.mjs`、`vercel.json`、`components.json`

**配置/环境（需特殊处理）**：
- `.env.example` / `.env.local.example` - 环境变量模板（不含密钥）
- `.git/` - Git 仓库（决定是否携带版本历史）
- `.trae/` - TRAE IDE 规范与计划文件

**构建产物与依赖（体积大，建议排除）**：
| 目录 | 用途 | 建议处理 |
|------|------|---------|
| `node_modules/` | npm 依赖 | ❌ 排除（在新位置重新安装） |
| `.next/` | Next.js 构建产物 | ❌ 排除（重新构建） |
| `dist2/` | Electron 打包输出 | ❌ 排除 |
| `build/` | Electron 构建资源 | ⚠️ 视情况 |
| `tsconfig.tsbuildinfo` | TS 增量编译缓存 | ❌ 排除 |

**临时/测试文件（建议排除）**：
- `test-*.js` / `test-*.json` / `test-output.png`
- `启动.bat`

## 2. 原始需求理解

用户明确需求：**将项目完整的迁移换到 D:\jz 目录下**

### 2.1 边界确认
- **任务范围**：仅迁移 `image-gen-app` 这一个项目，不涉及 `D:\jz` 下其他子项目（aff、finalshell、harness-anything、manage、ppt-master、project、案例）
- **"完整的迁移"** 含义：源代码、配置、Git 历史（待确认）、必要的元数据
- **目标位置**：在 `D:\jz` 下，**新建一个子目录** 存放该项目（子目录名待确认）

### 2.2 需求理解
| 维度 | 理解 | 备注 |
|------|------|------|
| 源路径 | `d:\jz\project\image-gen-app` | 明确 |
| 目标父目录 | `D:\jz` | 明确 |
| 目标子目录名 | 待确认 | 推断为 `image-gen-app` |
| 迁移方式 | 移动 vs 复制 vs 软链 | 待确认 |
| 源目录处置 | 删除 vs 保留 vs 重命名 | 待确认 |
| 排除项 | 哪些文件/目录不迁移 | 待确认 |

## 3. 疑问澄清（关键决策点）

### 3.1 目标子目录名
当前项目位于 `D:\jz\project\image-gen-app`，迁移到 `D:\jz` 后有两种理解：
- **方案 A**：`D:\jz\image-gen-app`（保持项目名作为子目录名）
- **方案 B**：`D:\jz\project\image-gen-app` 维持不变（任务理解为"整合到 jz 目录下"，实际已在此目录）

### 3.2 迁移方式与源目录处置
- **方案 A（移动）**：源目录移动到新位置后删除原目录（最干净）
- **方案 B（复制）**：新位置放一份副本，源目录保留（最安全，可回滚）
- **方案 C（Git 重置）**：在新目录 `git init` 后将源文件作为初始内容（丢失 Git 历史）

### 3.3 排除项策略
- `node_modules`（约几百 MB）：是否排除？在新位置重装
- `.next` / `dist2` / `build`（构建产物）：是否排除？
- `.env` / `.env.local`（可能含 API 密钥）：需用户确认
- `.git/`（Git 历史）：保留还是丢弃？
- `test-*` 测试文件、`启动.bat` 启动脚本：是否迁移？

## 4. 已确认的关键决策（用户已答复）

| 决策点 | 用户选择 | 备注 |
|--------|---------|------|
| 目标路径 | `D:\jz\image-gen-app` | 与 `D:\jz` 下其他项目同级 |
| 迁移方式 | 移动（先备份再剪切） | 源目录最终会消失 |
| node_modules | ❌ 排除 | 在新位置重新 `npm install` |
| .next / dist2 / build | ❌ 排除 | 构建产物，重新生成 |
| tsconfig.tsbuildinfo | ❌ 排除 | TS 缓存 |
| test-* / 启动.bat | ❌ 排除 | 临时文件 |
| .env / .env.local | ✅ 复制 | 含 API 密钥，需小心 |
| .env.example / .env.local.example | ✅ 复制 | 模板文件 |
| .git/ | ✅ 复制 | 保留版本历史 |
| .trae/ | ✅ 复制 | TRAE IDE 元数据 |

## 5. 任务边界限制
- ❌ 不修改 `D:\jz` 下其他子项目
- ❌ 不修改项目代码内容
- ❌ 不在迁移过程中执行 `npm install`（由用户后续决定）
- ✅ 仅做文件/目录层面的移动
- ✅ 保持文件权限与可执行性
- ✅ 完整保留 Git 历史

## 6. 验收标准
- 源目录 `d:\jz\project\image-gen-app` 不再存在（或仅含备份）
- 目标目录 `D:\jz\image-gen-app` 存在且包含所有需要的内容
- Git 仓库可用（`git status` 正常）
- `.env` 文件已迁移
- 排除项确实未迁移
- 项目可在新位置正常 `npm install && npm run dev`
