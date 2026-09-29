# REVIEW（第二轮）：移动端重构后的整体复审

- **范围**：对今日"移动端两态推拉 + 视觉三轮重构 + 死代码清理"后的当前状态做整体复审（代码 + 文档 + 工程卫生），并核对第一轮 REVIEW 的存量问题。
- **方法**：两个并行只读审查代理（移动端新代码专项 / 存量与卫生复核），逐文件核对；**按用户要求未运行任何消耗上游额度的功能测试**，全部结论为静态代码级证据。
- **基线**：HEAD `8b57cc0`；dev = main = origin（0/0 差异）。

## 一、结论总览

- 第一轮 B 档的安全收口（S-1/2/4/5/6/8）与安卓 P0/P1（A-1~A-5）**全部闭环且有代码级证据**；
- 移动端新代码**无 P0**（无数据丢失/重复扣费路径），但有 **2 个 P1、11 个 P2**——其中 P1 均为"新交互层没有接进返回键契约"这一类，属后续提交（参数二级选择、设置弹窗）引入；
- 文档滞后从 capacitor 文档蔓延到 README 与 mobile-redesign（今天最后 6 个提交未入档）；
- 工程卫生整体良好（分支同步、构建产物未误提交、gitignore 到位），有 5 处待决小项。

## 二、新增问题（移动端专项）

### P1

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| M1 | **参数二级选择面板（PickerSheet）未进返回键链**：返回关闭父面板后 picker 仍悬浮，再按返回直接退出应用 | `mobile/ParamSheet.tsx:99-108`（picker 状态在内部，独立于父 open）；`MobileHome.tsx:157-169` handleBack 无 picker 分支 | 违反 CONSENSUS 承诺的"四层接管"；用户被卡在无父级的二级面板；测试未覆盖（picker 是 863c2cd 新增） |
| M2 | **设置弹窗打开时按返回键退出整个 APP**（上轮已记录，仍未修） | `MobileHome.tsx:214` 渲染 `<SettingsDialog/>`，其 open 状态不外露；`page.tsx:155` 兜底 exitApp | 设置里按返回=退出应用，未保存的节点编辑丢失 |

### P2

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| M3 | 预览左右滑后 `FadeInImage` 失败态不复位 | `ResultCard.tsx:31-57`（failed/loaded 不随 src 重置）+ `FullscreenPreview.tsx` 跨 index 复用实例 | 任意一张图加载失败后，滑到的后续图全部显示"加载失败"占位 |
| M4 | BottomSheet 的 Esc 是全局多播：参数面板+二级面板同开时，一次 Esc 双关 | `bottom-sheet.tsx:40-47` 每个实例都挂 window keydown | 与安卓返回"只关一层"语义相反 |
| M5 | `useNodeBModels` 因 `modelB` 进依赖数组重复拉取；自动校正固定触发双请求 | `useNodeBModels.ts:32-67` | 对比模式下每换一次 B 模型重拉一次 `/api/models` |
| M6 | 首屏挂载即全量读历史（含全部 base64）渲染 12 张缩略图；且生成完成后"最近生成"轨不刷新 | `MobileHome.tsx:98-103`；`Composer.tsx:259-279` | 冷启动内存/CPU 峰值；内容陈旧 |
| M7 | 软键盘与底部 dock 的布局假设仅在 Capacitor 成立；浏览器/PWA 键盘可能盖住生成按钮 | `Composer.tsx:148-150,300-335`；layout viewport 未设 `interactiveWidget` | PWA/浏览器路径体验差（真机未实测，属已知验收项，但代码上可先修） |
| M8 | 全屏预览拖动未关过渡：`transition-slow` 与 `transition-opacity 300ms` 叠加，跟手差 | `FullscreenPreview.tsx:109-117`；`ResultCard.tsx:53`（BottomSheet 已示范正确写法） | 滑动橡皮感 |
| M9 | 预览无 `touch-action/overscroll-behavior` 与 Esc | `FullscreenPreview.tsx:49-65` | 浏览器中滑动可能触发页面回退手势；键盘用户无法关闭 |
| M10 | 无障碍缺口三处：textarea 无程序化标签；BottomSheet/全屏预览无焦点管理（aria-modal 未兑现）；结果卡不可聚焦（移动端唯一预览入口） | `Composer.tsx:152-166`；`bottom-sheet.tsx:51-97`、`FullscreenPreview.tsx:43-66`；`ResultCard.tsx:87-91` | 读屏/键盘用户可用性受损 |
| M11 | 品牌渐变 CTA 白字对比度不足 AA（#6ea0ff 段 ≈2.6:1、#2f7bf6 ≈4.0:1）；placeholder 对比也偏低 | `globals.css` cta-brand；`Composer.tsx:164` | 亮环境下可读性差（深色模式无此问题） |

### P3（摘要）

- 选中态无 ARIA（picker/节点面板）；模型列表为空时 picker 无空态；
- 重复的加图入口（虚线块 + 文字链同时出现）；`confirmingClear` 关面板不复位；
- 死代码：`contentClassName` 无调用方、`MobileView` 导出未用、`MAX_COUNT` 双份、accept 字符串硬编码未用 `ACCEPTED_TYPES`；
- **分层倒置**：mobile/ 从桌面组件 value-import 常量；`page.tsx` 静态导入两套 UI（移动端 bundle 含桌面组件，条件渲染不参与 tree-shaking）→ 建议常量下沉 lib/、桌面组件改 dynamic；
- 触屏下非对比卡模型名永久隐藏（与操作钮的移动适配不一致）；
- `sticky + relative` 类冲突（sticky 因滚动在 main 内实际无效）；
- 移动端不展示 `error` 状态（桌面有横幅）；生成失败后仍会切到结果态；
- 光团 blur(46px)+scale 动画在低端机的重复栅格化风险（未实测）；主题/断点首帧闪变（存量模式）。

## 三、第一轮存量问题状态（核对结论）

| 状态 | 条目 |
|---|---|
| ✅ 已闭环 | A-1 CI JDK21、A-2 相册契约、A-3 兜底页、A-4 返回键竞态、A-5/A-8/A-12 文档口径、A-9 权限、S-1 Key 同源、S-2 SSRF 基线、S-4 体积、S-5 超时、S-6 taskId、S-8 test-key/models、死码清理（本轮完成）；**Release 签名（超出上轮计划，已交付）** |
| ⚠️ 仍存在 | A-6（TTL 与轮询窗口等长、超时无 UI 提示）、A-7（无 taskId 占位仍锁 5 分钟；文案已改）、A-10（overrides.sharp 全局强制，现被 @capacitor/assets/next/miniflare 共用 0.35.4）、A-11（恢复路径无幂等；生成路径已由 claimInFlight 防重）、S-7 残留（GEN_UPSTREAM_NETWORK details 仍含 err.message）、S-9（**无 Web CI**）、S-10（历史无上限无 persist）、S-11（CF 未验证）、S-12（ProxyAgent 每请求新建、content 无响应体上限）、S-13（.trae 纸面 spec） |

## 四、文档一致性

1. **README**：未提移动端两态/灵感池/最近生成；"@提及"未标注仅桌面；未提 APK 内需重配 Key；环境变量表缺 `OPENAI_*` 三个（安全章节有提）；
2. **docs/capacitor-apk/**：TODO/FINAL/ACCEPTANCE 仍写"Release 签名待开任务/无新密钥"，与实际（已签名 + 4 个 Secrets）矛盾；
3. **docs/android-pwa/TODO**："相册直存需 Capacitor（本次不做）"已过时；
4. **docs/mobile-redesign/FINAL**：停在 `0bc7b64`，其后 6 个提交（灵感池/最近生成/二级选择/材质/可见度/溢出修复）未入档；
5. `docs/migrate-project/TODO` 乱码且任务早已完成；`docs/superpowers/plans` checkbox 未回填（存量）。

## 五、工程卫生

- **良好**：三分支同步；构建产物/密钥均未入库；gitignore 覆盖 .env/.next/android keystore 等；
- **待决**：`docs/archify/`（1.4MB 未跟踪，建议 gitignore 或删除，不要长期挂 git status）；`.zcodeignore` 是否入库（本人决定）；`scripts/` 下两个 .tmp 截图可删；`scripts/migrate/*.ps1` + `docs/migrate-project/` 可归档；`D:\jz\.backup\...20260708`（约 2GB）仍在；`shadcn` 在 dependencies 但零 import（建议移 devDeps）；测试脚本无 npm script 入口（建议加 `npm run test:mobile`）。

## 六、建议处置分档

**建议现在处理（一个批次可完成）**
1. **返回键契约补全**：M1（picker 上提 MobileHome 或回调上报）+ M2（SettingsDialog 受控化）——这两条直接违反已承诺的交互契约，优先级最高；顺手把测试脚本补两条断言（picker 层级、设置弹窗层级）。
2. **M3 预览失败态复位**（`key={index}` 一行修复）+ M4 Esc 单层关闭。
3. **M11 对比度**：CTA 渐变加深端点色或字号提升到 ≥18.66px 粗体；placeholder 提亮。
4. **M8 拖动关过渡** + M9 `touch-action/overscroll-behavior/Esc`（全屏预览一轮打磨）。
5. **M7**：`viewport` 增加 `interactiveWidget: "resizes-content"`（一行，浏览器/PWA 键盘路径立即改善）。
6. **文档四份修正**（README / capacitor-apk / android-pwa / mobile-redesign）。
7. **S-9 Web CI**：`.github/workflows/web-ci.yml`（lint + tsc + build + check-url-guard），push 触发——移动端已大改且无自动回归，性价比最高的一项基建。

**可以接受（记录在案）**
- A-6/A-7（TTL 语义重构，涉及计费语义，建议单独任务仔细做）；A-10（保留但建议收窄或注释原因）；M5/M6（性能优化，个人使用可容忍）；M10（无障碍深化，可随下次移动端任务做）；S-10/S-12/S-13；`shadcn` 依赖位置。

**只是记录**
- S-11（若不用 CF 形态则无影响）；S-7 残留 details；主题/断点首帧闪变；光团 blur 性能（真机观察后再定）。

---

**附：本轮未做的事**（按用户要求）：未运行任何生图/上游请求；未复跑 Playwright 套件（脚本数字 18/7 基于 21:51 前的代码，最后 6 个提交无自动回归证据——这也正是 S-9 建议的动因）。
