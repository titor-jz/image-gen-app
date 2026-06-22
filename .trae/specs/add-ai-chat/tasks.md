# Tasks

- [ ] Task 1: 创建对话 API 路由 `app/api/chat/route.ts`
  - [ ] SubTask 1.1: 读取现有 `lib/openai.ts` 和 `lib/proxy-fetch.ts`，复用 API 配置逻辑
  - [ ] SubTask 1.2: 实现流式对话接口，支持多轮消息 + 参考图（base64）
  - [ ] SubTask 1.3: 复用 `x-api-key`、`x-base-url`、`x-proxy-url` header 传递配置

- [ ] Task 2: 创建对话面板组件 `components/ChatPanel.tsx`
  - [ ] SubTask 2.1: 实现右侧滑出面板，包含消息列表、输入框、发送按钮
  - [ ] SubTask 2.2: 支持多轮对话，AI 回复流式逐字显示
  - [ ] SubTask 2.3: 支持在对话中输入 `@` 引用参考图（复用 ReferenceImages 数据）
  - [ ] SubTask 2.4: 每条 AI 回复下方显示"应用到提示词"按钮
  - [ ] SubTask 2.5: 支持"新对话"按钮清空历史

- [ ] Task 3: 集成到主页面 `app/page.tsx`
  - [ ] SubTask 3.1: 在 Header 中添加对话图标按钮
  - [ ] SubTask 3.2: 点击图标切换 ChatPanel 显示/隐藏
  - [ ] SubTask 3.3: 将 referenceImages 状态传递给 ChatPanel
  - [ ] SubTask 3.4: 接收 ChatPanel 的"应用到提示词"回调，填入 PromptInput 并高亮闪烁

- [ ] Task 4: 验证与测试
  - [ ] SubTask 4.1: 测试对话面板打开/关闭
  - [ ] SubTask 4.2: 测试发送消息和流式回复
  - [ ] SubTask 4.3: 测试 @ 引用参考图
  - [ ] SubTask 4.4: 测试"应用到提示词"功能

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
