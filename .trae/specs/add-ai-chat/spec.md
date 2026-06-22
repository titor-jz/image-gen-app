# AI 对话助手 Spec

## Why
用户在生成图片前往往不确定如何写提示词，或者想先和 AI 讨论创意方向。当前应用缺少一个交互式对话功能来帮助用户头脑风暴、优化提示词，再一键应用到图片生成。

## What Changes
- 新增 AI 对话面板，支持多轮对话
- 对话中可引用已上传的参考图
- 对话结果可一键填入提示词输入框
- 复用现有的 API 配置（Base URL、Key、代理）

## Impact
- Affected specs: 图片生成流程
- Affected code:
  - `app/api/chat/route.ts` — 新增对话 API
  - `components/ChatPanel.tsx` — 新增对话面板组件
  - `app/page.tsx` — 集成对话面板
  - `lib/openai.ts` — 复用现有 OpenAI 客户端

## ADDED Requirements

### Requirement: AI 对话面板
系统 SHALL 在页面右侧提供一个可展开的 AI 对话面板，用户可以和 AI 进行多轮对话，讨论创意方向、优化提示词。

#### Scenario: 打开对话面板
- **WHEN** 用户点击页面右上角的对话图标
- **THEN** 右侧滑出对话面板，显示欢迎语和输入框

#### Scenario: 发送消息
- **WHEN** 用户在对话输入框输入内容并发送
- **THEN** 消息显示在对话列表中，AI 回复以流式方式逐字显示

#### Scenario: 引用参考图
- **WHEN** 用户已上传参考图，在对话中输入 `@`
- **THEN** 弹出参考图选择列表，选中后以标签形式插入对话

#### Scenario: 应用到提示词
- **WHEN** AI 回复中包含优化后的提示词，用户点击"应用到提示词"按钮
- **THEN** 提示词内容自动填入主界面的提示词输入框

#### Scenario: 新建对话
- **WHEN** 用户点击"新对话"按钮
- **THEN** 清空当前对话历史，重新开始

### Requirement: 对话 API
系统 SHALL 提供 `/api/chat` 接口，复用现有的 API 配置（Base URL、Key、代理），支持流式响应。

#### Scenario: 发送对话请求
- **WHEN** 前端发送包含消息历史和参考图的请求
- **THEN** 后端调用 OpenAI 兼容 API，返回流式文本响应

## MODIFIED Requirements

### Requirement: 提示词输入框
提示词输入框 SHALL 支持从对话面板接收内容，填入时高亮闪烁提示用户。
