# FINAL: review-2026-09

## 项目总结

对安卓 PWA/Capacitor 交付物与项目整体做了全面评审（两个并行只读审查代理 + 人工复核），确认并修复了 B 档范围内的全部问题：3 个"必炸"级交付缺陷、6 个路由的安全收口（Key 外泄路径 + SSRF + 路径穿越 + 体积/超时链）、以及全部被夸大的验收口径。修复经 29 项纯函数断言、6 条 HTTP 守卫用例与不变式端到端判别测试验证。

## 交付内容（4 个提交）

| 提交 | 内容 |
|---|---|
| 阶段 0 | REVIEW.md 全量问题清单 + 三份文档验收口径修正 |
| a33c6e6 | 安卓缺陷修复：CI JDK 21、相册 albumIdentifier、兜底页重试、返回键竞态、权限收敛 |
| 8024106 | 服务端安全：同源不变式、url-guard 基线、taskId 编码、4MB 上限、超时链、README |
| （本次收尾提交） | review 任务文档、url-guard 直测脚本、tsconfig scripts 排除 |

## 关键设计决策留档

1. **Key/BaseURL 同源不变式**（`lib/upstream-config.ts`）：env Key 模式下客户端 base/proxy 被忽略（不是校验，是直接不采用）——这使"服务端 Key 发往任意主机"在构造上不可能，而非依赖校验正确性。
2. **SSRF 基线的边界**（`lib/url-guard.ts`）：IP 字面量 + 保留主机名黑名单；不做 DNS 解析校验（rebinding 不设防，已在代码与 README 注明）。个人使用场景下是成本/收益最优解。
3. **平台级保护替代代码级鉴权**（S-3）：暴露面为个人使用，选择 README 指引 Vercel Deployment Protection / CF Access 而非 middleware Basic Auth——后者在 Android WebView 的 401 处理上不可靠，会破坏 APK。
4. **tsconfig 排除 `scripts/`**：独立 Node 工具目录不参与应用类型检查（与 eslint 既有约定一致）。

## 质量评估

- 修复全部对既有模式最小侵入：错误码按契约加一行、路由层仅替换配置解析入口；无新依赖。
- 验证覆盖了"守卫是否真的拦"（curl）、"守卫逻辑本身对不对"（29 断言）、"不变式在端到端是否成立"（判别监听器）三层。
- 诚实口径：Android 侧修复未编译验证（本机无 SDK），CI/真机闭环交用户；相关 ACCEPTANCE 已如实标注。

## 后续任务入口

见 `REVIEW.md` 第五节"不做清单"与 `TODO_review.md`——最优先建议：in-flight TTL 语义对齐（A-6/A-7）、Web CI 门禁（S-9）、历史容量治理（S-10）。
