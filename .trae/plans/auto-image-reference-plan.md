# 自动图片引用方案

## 概要

修改图片发送逻辑，支持按优先级自动识别提示词中引用的参考图片，无需用户手动 `@`。

## 当前状态

目前 `app/page.tsx` 中的 `handleGenerate`（第 83-90 行）只检查 `@图片名` 模式，只有被 `@` 的图片才会传给 API。

## 变更

### 改动范围

仅修改 `app/page.tsx` 中 `handleGenerate` 的图片筛选逻辑（第 83-90 行）。

### 优先级逻辑（三段式）

```
1. @ 提及（最高优先级）
   提示词含 `@图片名` → 仅发送被 @ 的图片（保持现有行为）

2. 图N 自然语言引用
   提示词不含 @，但含 `图1`、`图2`、`图3`...
   → 按数字匹配上传顺序（图1 = 第1张上传的图）

3. 全部发送（兜底）
   提示词既无 @ 也无 图N
   → 所有已上传的图片按顺序全部发送
```

### 具体代码改动

**文件**: `app/page.tsx`

将以下代码（第 83-90 行）:
```javascript
// Collect referenced images (those mentioned in prompt with @)
const referencedImages: ReferenceImage[] = [];
for (const img of referenceImages) {
  const tag = `@${img.name}`;
  if (prompt.includes(tag)) {
    referencedImages.push(img);
  }
}
```

替换为:
```javascript
// 按优先级识别提示词中引用的图片
let referencedImages: ReferenceImage[] = [];

// Priority 1: @ 提及（最高优先级）
const hasAtMentions = referenceImages.some(img => prompt.includes(`@${img.name}`));
if (hasAtMentions) {
  for (const img of referenceImages) {
    if (prompt.includes(`@${img.name}`)) {
      referencedImages.push(img);
    }
  }
} else {
  // Priority 2: 图N 自然语言引用
  const imgPattern = /图(\d+)/g;
  const matches = [...prompt.matchAll(imgPattern)];
  if (matches.length > 0) {
    const indices = new Set<number>();
    for (const match of matches) {
      const idx = parseInt(match[1]) - 1; // 图1 → index 0
      if (idx >= 0 && idx < referenceImages.length) {
        indices.add(idx);
      }
    }
    referencedImages = referenceImages.filter((_, i) => indices.has(i));
    // 按出现顺序排序
    const order = [...matches].map(m => parseInt(m[1]) - 1).filter(i => i >= 0 && i < referenceImages.length);
    referencedImages = [...new Set(order)].map(i => referenceImages[i]);
  } else {
    // Priority 3: 无引用 → 全部发送
    referencedImages = [...referenceImages];
  }
}
```

## 不变的部分

- API 路由 `app/api/generate/route.ts` — 无需修改，已正确接收多图
- `components/PromptInput.tsx` — @ 提及 UI 保持不变
- 所有其他组件 — 无影响

## 验证

1. 运行 `npm run dev` 测试三种场景：
   - 提示词含 `@图片名` → 仅发 @ 的图
   - 提示词含 `图1 图2` → 发对应序号的图
   - 提示词不含任何引用 → 发全部图
2. 运行 `npm run build` 确保无编译错误
