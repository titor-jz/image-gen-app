# inpaint-probe —— 验证中转是否尊重 `mask`（局部重绘 / inpainting）

> 现状：工具已就绪、`--selftest` 全绿；联网结论待拿到 API Key 后跑一条命令得出（见 §3.3）。

## 1. 它验证什么问题

图生图走 `POST {baseURL}/images/edits`（multipart）。OpenAI 的 inpainting 语义是：

- `mask` 是一张与输入图**同样尺寸**的 PNG；
- **alpha=0（透明）的区域 = 允许重绘的区域**；
- alpha=255 的区域 = 模型必须保持不动。

问题在于：不少中转（或模型接入层）会直接忽略 `mask`、把整图重新生成一遍。此前用真实图片测过一次，上游返回了与提示词完全无关的图（被污染的中间产物），导致「蒙版到底有没有被尊重」至今没有结论。

这个工具就是为了把这件事变成**可量化、可复跑**的判定：它不评价图好不好看，只回答「**输出图里，mask 保护区有没有被改**」。

## 2. 为什么这样设计

### 2.1 合成底图，而不是真实照片

`makeBaseImage()` 合成一张 1024×1024 的图：

```
┌─────────────────────────────┐
│ 饱和蓝 + 左上白方块 + 右上黑块 │  ← 上半区
├─────────────────────────────┤  ← 高度中线，硬切
│ 饱和红 + 左下白方块 + 右下黑块 │  ← 下半区
└─────────────────────────────┘
```

如果 mask 真被尊重，保护区应当是**逐像素拷贝**的，diff 理论值为 0。大面积纯色让这个信号不被「模型画得好不好」干扰；白/黑标记用于肉眼核对，不对称的标记位置还能暴露翻转/旋转。

真实照片做不到这一点：模型即便「尊重蒙版」，保护区也可能因为重编码/抗锯齿出现细微差异，而且无法判断差异是「没保留原图」还是「保留得不够完美」。合成底图把变量压到最小。

### 2.2 两臂 A/B，单变量隔离

只有一臂时，你只能看到「图变了」，无法证明「变化是 mask 造成的」。所以发两次请求：

| | A 臂 | B 臂 |
|---|---|---|
| prompt / model / size / 输入图 | 完全相同 | 完全相同 |
| mask 透明区（可重绘） | **上半** | **下半** |
| 期望（若 mask 生效） | 只有上半变，下半不动 | 只有下半变，上半不动 |

- 若上游尊重 mask：A 臂 `topDiff` 大、`bottomDiff≈0`；B 臂反过来。
- 若上游忽略 mask：两臂都是整图重绘，两个半区 diff 都大，A/B 的「跟随 mask」模式一个都不成立。
- 两臂交叉还能排除「模型恰好只改了上半」这种巧合：只有变化方向**随 mask 翻转**，才可能是 mask 生效。

默认 prompt 是中文的「把透明的那块区域改成明亮的黄色，其余部分保持完全不变」。判据不依赖模型是否听话——即使它把黄色画歪，只要「变化严格发生在透明半区、保护区逐像素不变」，就说明 mask 在协议层被真正执行了。

### 2.3 只用「半区平均绝对差」

要回答的是「保护区有没有被改」，不是画质/相似度。RGB 逐像素平均绝对差归一化到 0~1 就够了，阈值直观、不依赖模型生成质量。SSIM/感知哈希反而会把「整图风格变化但结构相同」算得偏高，不适合这个场景。

## 3. 怎么用

### 3.1 自检（离线，不联网、不读任何 Key）

```bash
node scripts/inpaint-probe/run.js --selftest
```

它本地合成两份「假输出」来证明指标有区分度：

- **场景 1「模拟尊重蒙版」**：mask 透明区=下半，只把下半涂成另一个颜色。
  断言 `bottomDiff > 0.15`、`topDiff < 0.02`、`bottomDiff > 5 × topDiff`。
- **场景 2「模拟忽略蒙版」**：整图重绘（颜色全换 + 确定性噪声）。
  断言两个半区 diff 都大，且**不满足**场景 1 的判据。
- 另外还校验：尺寸不一致时先 resize 对齐并标记 `dimsMatch=false`；
  用真实联网判据 `decideVerdict` 对合成数据做联调（→ `MASK_RESPECTED` / `MASK_IGNORED`）。

全部通过时退出码 `0`，任一失败退出码 `1`。每个断言都会打印实际数值与 `PASS/FAIL`。

产物落在 `scripts/inpaint-probe/out/<YYYYMMDD-HHmmss>/selftest/`：

- `input.png` / `mask-top.png` / `mask-bottom.png`
- `scenario1-output-*.png` / `scenario2-output-ignored.png`
- `scenario1-sheet.png` / `scenario2-sheet.png`（三联图：左=输入 / 中=mask / 右=输出）

### 3.2 先看请求计划（不发送、不落盘）

```bash
node scripts/inpaint-probe/run.js --dry-run --base-url https://example.com/v1 --key sk-x
```

会打印端点、两臂的 multipart 字段、image/mask 的字号、请求体字节数、超时与代理，并说明「唯一变量是 mask 透明半区」。Key 会脱敏。这个模式不需要真实 Key，也不会创建 `out/` 目录。

### 3.3 联网探针（拿到 Key 后一条命令出结论）

```bash
node scripts/inpaint-probe/run.js \
  --base-url https://<你的中转>/v1 \
  --key sk-xxxx \
  --model gpt-image-2
```

参数：

| 参数 | 说明 |
|---|---|
| `--base-url <url>` | 必填。中转的 OpenAI 兼容 Base URL，会拼接 `/images/edits` |
| `--key <key>` | 必填。上游 API Key（只用于 `Authorization: Bearer`） |
| `--model <name>` | 默认 `gpt-image-2` |
| `--input <path>` | 用真实图片代替合成底图；mask 会按该图尺寸生成 |
| `--prompt <text>` | 自定义提示词（默认中文「只改透明区域」） |
| `--size <WxH\|auto>` | multipart 的 `size` 字段，默认 `1024x1024`；真实图建议 `auto` |
| `--max-time <秒>` | 单请求超时，默认 `300`（生成 30~60s 很正常） |
| `--proxy <url>` | HTTP(S) 代理（走 `node_modules/undici` 的 ProxyAgent） |
| `--out <dir>` | 自定义报告目录 |
| `--response-format <v>` | `b64_json` 或 `url`；不传则不发送该字段（推荐，两种响应都能解析） |

产物结构：

```
scripts/inpaint-probe/out/<YYYYMMDD-HHmmss>/
  input.png                 # 实际发送的输入图（合成或 --input）
  mask-A-top.png            # A 臂 mask（透明区=上半）
  mask-B-bottom.png         # B 臂 mask（透明区=下半）
  arm-A-output.png          # 上游原始输出（按魔数定后缀，可能是 jpg/webp）
  arm-A-sheet.png           # 三联图：输入 | mask | 输出
  arm-B-output.png
  arm-B-sheet.png
  report.json               # 判据、指标、原始错误体
```

`out/` 已在 `scripts/inpaint-probe/.gitignore` 里，不会污染仓库（输出图可能包含你的图片/上游信息）。

## 4. 判据与阈值

`report.json` 的 `verdict` 由两臂的 diff 指标自动得出：

- **`MASK_RESPECTED`**：A 臂 `topDiff > 2 × bottomDiff` 且 `bottomDiff < 0.05`；B 臂 `bottomDiff > 2 × topDiff` 且 `topDiff < 0.05`。
  即「两臂的变化都严格跟随 mask 透明区，保护区接近逐像素保留」。
- **`MASK_IGNORED`**：两臂的上下半区 diff **都** > `0.15`（两臂都接近全图重绘，mask 没被尊重/没被透传）。
- **`INCONCLUSIVE`**：其余情况，`verdictReasons` 会说明卡在哪（例如某臂失败、保护区差异偏大、变化方向不随 mask 翻转等）。

阈值从哪来：

| 阈值 | 取值 | 理由 |
|---|---|---|
| 未蒙版区上界 `unmaskedMax` | `0.05` | mask 生效时理论值为 0（逐像素拷贝）。留 0.05 给上游做有损重编码（JPEG/WebP）、抗锯齿或 1px 边界处理。若保护区被实际重画，差异通常远超这个量级。 |
| 倍数 `ratio` | `2` | 已蒙版区理论上是「变化」，未蒙版区是「零」；取 2 倍容忍边界像素/整体轻微调色造成的非零底噪，仍能明确区分「变化跟随 mask」与「全图变化」。 |
| 全图重绘 `globalMin` | `0.15` | 0.15 的平均绝对差 ≈ 每通道平均 38/255，远超压缩噪声；两半都超过它基本只能是整图被重新生成。 |
| 自检更严（`0.15 / 0.02 / 5×`） | — | 合成数据没有压缩噪声，用更严的阈值证明指标区分度足够大，而不是「刚好压线通过」。 |

这些是工程判据，不是统计显著性检验。默认 prompt 要求的「亮黄」与底图红/蓝的差异在 0.3~0.77 量级，上游真做局部重绘会轻松越过阈值。

## 5. 结果怎么读

1. **先看两臂是否都成功**：`arms[].ok` / 终端里的 `HTTP 200`。任一臂失败 → 退出码 1，`INCONCLUSIVE`。
   失败原因原样记在 `arms[].error.body`（HTTP 状态、超时、无图字段等），可以直接贴给上游；`requestId` 有就一并带上。
2. **看三联图** `arm-*-sheet.png`：
   - 左 = 输入；中 = mask（**洋红 = 可重绘区，深灰 = 保护区**）；右 = 上游输出。
   - 尊重 mask 时，右图应当只有洋红那半被改成黄色，另一半连白/黑方块都原样保留。
3. **再看 `verdict` 与 `verdictReasons`**：
   - `MASK_RESPECTED`：中转认 mask，可以放心做局部重绘。
   - `MASK_IGNORED`：中转忽略/不透传 mask，整图重绘。
     ⚠️ **先肉眼确认输出图与输入有关**：如果上游返回的是完全无关的污染图（就是之前遇到过的情况），指标同样是「两半都大」，会被判成 `MASK_IGNORED`。这种情况应重跑或换节点，不能当作「mask 被忽略」的证据。三联图就是用来排除这一点的。
   - `INCONCLUSIVE`：看 `verdictReasons` 里的具体数值；常见原因是输出被改动得太乱但又不是全图变化、或某半区差异压线。
4. **注意 `dimsMatch`**：输出尺寸与输入不同时会先 resize 回输入尺寸再比，并记 `dimsMatch=false`。重采样会放大未蒙版区差异，结论要更谨慎；建议 `--size auto` 或与输入一致后重跑。
5. **退出码**：`0`=MASK_RESPECTED，`2`=MASK_IGNORED，`3`=INCONCLUSIVE，`1`=自检失败 / 参数或请求失败。脚本化时可直接用退出码分支。

`report.json` 主要字段：

```jsonc
{
  "endpoint": "...",            // POST 到哪
  "model": "gpt-image-2",
  "prompt": "...",              // 两臂相同
  "size": "1024x1024",
  "timeoutSec": 300,
  "input": { "source": "synthetic|file", "dims": { "width": 1024, "height": 1024 } },
  "thresholds": { "unmaskedMax": 0.05, "ratio": 2, "globalMin": 0.15 },
  "arms": [{
    "id": "A", "transparentHalf": "top",
    "httpStatus": 200, "requestId": null, "durationMs": 41234,
    "request": { "bytes": 41672, "fields": { "model": "...", "prompt": "...", "size": "..." },
                 "files": [{ "field": "image", "bytes": 18691 }, { "field": "mask", "bytes": 22307 }] },
    "response": { "source": "b64_json|url", "bytes": 17544, "usage": {}, "revisedPrompt": null },
    "metrics": { "topDiff": 0.77, "bottomDiff": 0, "globalDiff": 0.39,
                 "dims": { "width": 1024, "height": 1024 }, "dimsMatch": true },
    "error": null
  }],
  "verdict": "MASK_RESPECTED",
  "verdictReasons": ["..."]
}
```

## 6. 已知坑 / 注意事项

- **mask 是硬边、无羽化**：边界正好在 `floor(height/2)`，统计 diff 也按同一行号切半区，保证「蒙版区」与「统计区」严格对齐。OpenAI 语义只看 alpha；mask 的 RGB 同时给了白（可改）/黑（保护）作为双保险，兼容极少数按亮度解读 mask 的实现。
- **输出图可能被上游转成 JPEG/WebP**：保护区 diff 可能到 0.01~0.03，属正常压缩噪声，`unmaskedMax=0.05` 已留余量。
- **`response_format` 默认不发送**：gpt-image 系列通常总是返回 `b64_json`，部分中转不认该字段会报 400；工具两种响应都支持（`data[0].b64_json` 或 `data[0].url`，url 会再下载一次）。
- **两臂 = 两次生成 = 双倍费用**：先 `--dry-run` 确认参数再跑。
- **`--input` 真实图建议配 `--size auto`**：官方尺寸档位有限，强行 `1024x1024` 会让非方图输出尺寸与输入不一致（`dimsMatch=false`）。
- **`--proxy` 依赖 `node_modules/undici`**（项目已有）；没有代理需求就不用管。
- **超时**：每个请求独立计时（默认 300s），用 `AbortController` 中断并记录，不会让长请求无限挂住。
- **自检不访问网络、不读环境变量**，可放心在 CI/无网环境跑。`--dry-run` 同样不联网、不落盘。
- **Windows**：路径用 `/` 或 `\` 均可（Node 处理）；输出目录时间戳用本机本地时区。
- 本目录遵守项目约定：`scripts/**` 是 Node CommonJS，用 `require()`，不是 ESM/TypeScript。

## 7. 文件说明

| 文件 | 作用 |
|---|---|
| `lib.js` | 纯函数：合成底图、构造 mask、区域 diff 指标、三联图、A/B 判据（`decideVerdict`） |
| `run.js` | CLI：`--selftest` / `--dry-run` / 联网探针，落盘报告与对比图 |
| `README.md` | 本文件 |

依赖只有项目已有的 `sharp`（图像处理）和 Node 22 自带的 `fetch`/`undici`，没有新增任何依赖。
