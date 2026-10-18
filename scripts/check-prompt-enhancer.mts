/**
 * lib/prompt-enhancer.ts 纯函数直测（无测试框架，断言计数即退出码）
 * 运行：node scripts/check-prompt-enhancer.mts
 */
import { enhancePrompt, detectGenre, type Genre } from "../lib/prompt-enhancer.ts";

let total = 0;
let failed = 0;

function check(note: string, cond: boolean, extra = "") {
  total++;
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"} [${note}]${cond ? "" : ` → ${extra}`}`);
}

/** 断言返回值中出现/不出现某片段 */
function checkIncludes(note: string, text: string, frag: string, want: boolean) {
  check(note, text.includes(frag) === want, `期望${want ? "含" : "不含"}「${frag}」，实际：${text}`);
}

// ============================================================
// 1. 题材识别（覆盖移动端灵感池真实语料 + 易误判用例）
// ============================================================
const GENRE_CASES: [string, Genre][] = [
  ["雨夜霓虹下的赛博朋克街道", "scifi"],
  ["赛博朋克城市夜景", "scifi"],
  ["太空电梯概念图", "scifi"],
  ["蒸汽朋克机械鸟", "scifi"],
  ["水彩风动物插画", "art"],
  ["国风水墨山水", "art"],
  ["像素艺术场景", "art"],
  ["吉卜力风童年夏天", "art"],
  ["动漫风格的人物插画", "art"], // 「人物」不该抢走插画
  ["甜品店菜单插画", "art"], // 「甜品」不该抢走插画
  ["宠物头像 · 卡通化", "art"],
  ["极简产品海报", "stilllife"],
  ["咖啡杯电商主图", "stilllife"],
  ["治愈系咖啡馆一角", "stilllife"],
  ["汉服写真", "portrait"],
  ["复古胶片人像", "portrait"],
  ["街头潮流人像", "portrait"], // 「街」不该抢走人像
  ["电影感人物特写", "portrait"],
  ["一只猫", "portrait"],
  ["晨雾山间公路", "landscape"],
  ["海边黄昏剪影", "landscape"],
  ["雪夜小镇街灯", "city"],
  ["老上海弄堂黄昏", "city"],
  ["温馨的卧室一角", "city"],
  ["梦境超现实场景", "fantasy"],
  ["手机壁纸 · 极简渐变", "default"],
  ["深夜书桌", "default"],
  ["a cozy reading corner", "default"],
  ["anime girl with umbrella", "art"],
  ["a cyberpunk street at night", "scifi"],
];

for (const [text, want] of GENRE_CASES) {
  const got = detectGenre(text);
  check(`题材「${text}」`, got === want, `期望 ${want}，实际 ${got}`);
}

// ============================================================
// 2. 扩写行为
// ============================================================
{
  const input = "雨夜霓虹下的赛博朋克街道";
  const r = enhancePrompt(input, 0);
  check("短中文提示词被扩写", r.added >= 3, `added=${r.added}`);
  check("原句原样保留在开头", r.text.startsWith(input + "，"), r.text);
  check("未编造主体内容（只追加不重写）", r.text.slice(0, input.length) === input, r.text);
}

{
  // 用户已写光影维度 → 该维度整体跳过，不与用户要求打架
  const r = enhancePrompt("夕阳下的海边", 0);
  checkIncludes("已写时段/光线则不补光影", r.text, "黄金时段", false);
  check("其余维度照常补", r.added >= 2, JSON.stringify(r));
}

{
  const r = enhancePrompt("雨夜霓虹下的赛博朋克街道，广角低角度仰拍", 0);
  checkIncludes("已写镜头则不补镜头", r.text, "广角低角度仰拍，强调空间的巨大尺度与压迫感", false);
  check("其余维度照常补", r.added >= 2, JSON.stringify(r));
}

{
  // 幂等：对自身输出再扩写不应翻倍（说明跳过词覆盖了自家短语）
  const once = enhancePrompt("海边黄昏剪影", 0);
  const twice = enhancePrompt(once.text, 1);
  check("对自身输出幂等", twice.added === 0, JSON.stringify(twice));
}

{
  // 确定性 & 版本轮换
  const a1 = enhancePrompt("一只猫", 0);
  const a2 = enhancePrompt("一只猫", 0);
  const b1 = enhancePrompt("一只猫", 1);
  check("同 (输入, variant) 结果确定", a1.text === a2.text, `${a1.text} ≠ ${a2.text}`);
  check("换 variant 得到不同版本", a1.text !== b1.text, a1.text);
}

{
  // 英文输入 → 英文扩写
  const r = enhancePrompt("a girl reading by the window", 0);
  check("英文输入英文扩写", !/[\u4e00-\u9fff]/.test(r.text) && r.added >= 3, JSON.stringify(r));
  check("英文使用逗号分隔", r.text.includes(", "), r.text);
}

{
  // 边界：空 / 纯空白 / 已含标点
  const empty = enhancePrompt("   ", 0);
  check("空输入原样返回", empty.text === "" && empty.added === 0, JSON.stringify(empty));
  const padded = enhancePrompt("  一只猫  ", 0);
  check("首尾空白被裁剪", padded.text.startsWith("一只猫，"), padded.text);
}

{
  // 已很详尽的长提示词：不再叠床架屋
  const long = "一幅画。".repeat(80); // 320 字
  const r = enhancePrompt(long, 0);
  check("超长提示词不再追加", r.added === 0 && r.text === long, `added=${r.added} len=${r.text.length}`);
}

{
  // 长度软上限：任何输入的扩写结果都不超过上限
  let worst = 0;
  for (const s of ["一只猫", "雨夜霓虹街拍", "老上海弄堂黄昏", "a girl reading by the window"]) {
    worst = Math.max(worst, enhancePrompt(s, 0).text.length, enhancePrompt(s, 1).text.length);
  }
  check("扩写结果长度受控", worst <= 400, `最长 ${worst}`);
}

// ============================================================
// 3. 抽样目视（人工判断效果用）
// ============================================================
console.log("\n—— 抽样输出 ——");
for (const s of [
  "雨夜霓虹下的赛博朋克街道",
  "一只猫",
  "汉服写真",
  "极简产品海报",
  "国风水墨山水",
  "a girl reading by the window",
]) {
  console.log(`\n输入：${s}\n版本0：${enhancePrompt(s, 0).text}\n版本1：${enhancePrompt(s, 1).text}`);
}

console.log(`\n${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
