/**
 * inpaint-probe 纯函数库：合成底图 / 构造 mask / 量化区域差异 / 拼三联对比图。
 *
 * 为什么用合成底图而不是真实照片：几何化的大面积纯色把「蒙版区被改 / 保护区没被改」
 * 变成干净的像素信号。真实重绘图没法逐像素对齐，但「保护区是否逐像素保留」恰恰是
 * 判断上游有没有真的做 mask 合成（而不是整图重绘）的唯一硬证据。
 */

"use strict";

const sharp = require("sharp");

const DEFAULT_SIZE = 1024;

// 上下半区色相拉满的纯色：任何一条通道被改动都会直接体现在平均绝对差里。
const TOP_COLOR = [16, 48, 232]; // 饱和蓝
const BOTTOM_COLOR = [230, 30, 40]; // 饱和红
const PAINT_COLOR = [250, 214, 20]; // 模拟「重绘」用的亮黄：和蓝/红的差异都足够大

/** 联网判据阈值（README「阈值从哪来」一节有推导）。 */
const THRESHOLDS = Object.freeze({
  /** 未蒙版半区：低于此值认为「逐像素保留」；给有损重编码/抗锯齿留余量。 */
  unmaskedMax: 0.05,
  /** 蒙版半区差异至少是未蒙版半区的多少倍，才算「变化跟随 mask」。 */
  ratio: 2,
  /** 两半平均差都高于此值 → 认为整图被重绘（mask 被忽略）。 */
  globalMin: 0.15,
});

/** 自检阈值：合成数据没有压缩噪声，所以比联网判据更严，用来证明指标有足够区分度。 */
const SELFTEST_THRESHOLDS = Object.freeze({
  maskedMin: 0.15,
  unmaskedMax: 0.02,
  ratio: 5,
});

function splitAt(height) {
  return Math.max(1, Math.floor(height / 2));
}

/** 用纯色铺一块矩形；逐行 copy 比逐像素写快，且不依赖任何绘制库。 */
function fillRect(rgb, width, x, y, w, h, color) {
  const row = Buffer.alloc(w * 3);
  for (let dx = 0; dx < w; dx++) {
    row[dx * 3] = color[0];
    row[dx * 3 + 1] = color[1];
    row[dx * 3 + 2] = color[2];
  }
  for (let dy = 0; dy < h; dy++) row.copy(rgb, ((y + dy) * width + x) * 3);
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * 合成确定性测试底图（默认 1024×1024 PNG）。
 *
 * 布局：上半饱和蓝 + 白/黑方块标记，下半饱和红 + 白/黑方块标记。
 * 标记不是装饰：肉眼核对「保护区没动」时靠它，同时不对称的位置能暴露翻转/旋转。
 */
async function makeBaseImage({ size = DEFAULT_SIZE } = {}) {
  const width = size;
  const height = size;
  const half = splitAt(height);
  const rgb = Buffer.alloc(width * height * 3);

  fillRect(rgb, width, 0, 0, width, half, TOP_COLOR);
  fillRect(rgb, width, 0, half, width, height - half, BOTTOM_COLOR);

  const big = Math.round(size * 0.165);
  const small = Math.round(size * 0.115);
  const pad = Math.round(size * 0.07);
  fillRect(rgb, width, pad, pad, big, big, [255, 255, 255]); // 上半：左上白块
  fillRect(rgb, width, width - pad - small, pad, small, small, [0, 0, 0]); // 上半：右上黑块
  fillRect(rgb, width, pad, height - pad - big, big, big, [255, 255, 255]); // 下半：左下白块
  fillRect(rgb, width, width - pad - small, height - pad - small, small, small, [0, 0, 0]); // 下半：右下黑块

  return sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * 生成 OpenAI 语义的 RGBA mask PNG：alpha=0（透明）的区域可重绘，alpha=255 保护。
 *
 * 边界在 floor(height/2) 处硬切、不羽化：统计 diff 时按同一行号切半区，
 * 硬边保证「蒙版区」和「指标统计区」严格对齐，也不给模型边界渐变的发挥空间。
 *
 * transparentHalf 决定哪一半透明。除了 alpha，RGB 也同步给白（可改）/黑（保护）：
 * 对标准实现 RGB 无意义，但能兼容极少数按亮度而非 alpha 解读 mask 的中转。
 */
async function makeMask({ transparentHalf, size = DEFAULT_SIZE, width = size, height = size } = {}) {
  if (transparentHalf !== "top" && transparentHalf !== "bottom") {
    throw new Error(`transparentHalf 必须是 "top" 或 "bottom"，收到 ${String(transparentHalf)}`);
  }
  const half = splitAt(height);
  const raw = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const transparent = transparentHalf === "top" ? y < half : y >= half;
    const value = transparent ? 255 : 0;
    const alpha = transparent ? 0 : 255;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
      raw[i + 3] = alpha;
    }
  }

  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * 解码成 sRGB 三通道裸像素。
 * rotate() 统一 EXIF 方向：真实底图带方向信息时，和上游返回的「已转正」图才能对得上。
 */
async function decodeRgb(buf) {
  const { data, info } = await sharp(buf)
    .rotate()
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function imageDimensions(buf) {
  const { width, height } = await decodeRgb(buf);
  return { width, height };
}

/** 行区间 [y0, y1) 上的平均绝对差：逐像素三通道平均后归一化到 0~1。 */
function meanAbsDiff(a, b, width, y0, y1) {
  const rowBytes = width * 3;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    const off = y * rowBytes;
    const end = off + rowBytes;
    for (let i = off; i < end; i++) sum += Math.abs(a[i] - b[i]);
  }
  const samples = (y1 - y0) * rowBytes;
  return samples > 0 ? sum / (samples * 255) : 0;
}

/**
 * 量化原图与输出图的差异。
 *
 * 输出尺寸与输入不同时先 resize 回输入尺寸再比（dimsMatch=false 会如实记录）：
 * 上游若照官方尺寸档位出图，尺寸不一致本身就是异常信号，但 diff 仍有参考价值。
 */
async function diffMetrics(origBuf, outBuf) {
  const [orig, rawOut] = await Promise.all([decodeRgb(origBuf), decodeRgb(outBuf)]);

  let out = rawOut;
  const dimsMatch = rawOut.width === orig.width && rawOut.height === orig.height;
  if (!dimsMatch) {
    const { data, info } = await sharp(rawOut.data, {
      raw: { width: rawOut.width, height: rawOut.height, channels: 3 },
    })
      .resize(orig.width, orig.height, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    out = { data, width: info.width, height: info.height };
  }

  const half = splitAt(orig.height);
  return {
    dims: { width: rawOut.width, height: rawOut.height },
    inputDims: { width: orig.width, height: orig.height },
    dimsMatch,
    topDiff: round5(meanAbsDiff(orig.data, out.data, orig.width, 0, half)),
    bottomDiff: round5(meanAbsDiff(orig.data, out.data, orig.width, half, orig.height)),
    globalDiff: round5(meanAbsDiff(orig.data, out.data, orig.width, 0, orig.height)),
  };
}

/** 任意图 → 固定边长 RGB 面板 PNG buffer（三联图的一格）。 */
async function rgbPanel(buf, panelSize) {
  const { data, info } = await sharp(buf)
    .rotate()
    .toColourspace("srgb")
    .removeAlpha()
    .resize(panelSize, panelSize, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

/**
 * mask 可视化面板：透明区（可重绘）画成洋红，保护区压暗。
 * 直接把 alpha 当图看是「全透明」的，必须换成可见色才能放进对比图。
 */
async function maskPanel(buf, panelSize) {
  const { data, info } = await sharp(buf)
    .rotate()
    .ensureAlpha()
    .resize(panelSize, panelSize, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const rgb = Buffer.alloc(panelSize * panelSize * 3);
  for (let p = 0; p < panelSize * panelSize; p++) {
    const src = p * channels;
    const r = data[src];
    const g = data[src + 1];
    const b = data[src + 2];
    const a = channels > 3 ? data[src + 3] : 255;
    if (a < 128) {
      // 透明 = 允许重绘：洋红高亮
      rgb[p * 3] = Math.round(r * 0.25 + 255 * 0.75);
      rgb[p * 3 + 1] = Math.round(g * 0.25);
      rgb[p * 3 + 2] = Math.round(b * 0.25 + 255 * 0.75);
    } else {
      // 保护 = 重绘禁区：压暗成深灰，和洋红区、纯黑分隔缝都区分得开
      rgb[p * 3] = Math.round(42 + r * 0.35);
      rgb[p * 3 + 1] = Math.round(42 + g * 0.35);
      rgb[p * 3 + 2] = Math.round(42 + b * 0.35);
    }
  }

  return sharp(rgb, { raw: { width: panelSize, height: panelSize, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * 三联对比图：左=输入 / 中=mask（洋红=可重绘）/ 右=输出，中间 2px 黑缝。
 * 返回 PNG buffer，由调用方决定落盘路径（lib 保持纯函数，不碰文件系统）。
 */
async function contactSheet({ input, mask, output, panelSize = 512 } = {}) {
  const gap = 2;
  const [inputPanel, maskView, outputPanel] = await Promise.all([
    rgbPanel(input, panelSize),
    maskPanel(mask, panelSize),
    rgbPanel(output, panelSize),
  ]);

  return sharp({
    create: {
      width: panelSize * 3 + gap * 2,
      height: panelSize,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: inputPanel, left: 0, top: 0 },
      { input: maskView, left: panelSize + gap, top: 0 },
      { input: outputPanel, left: (panelSize + gap) * 2, top: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * 模拟「模型尊重蒙版」：只把 mask 透明的那一半平涂成另一个颜色，另一半逐像素不动。
 * 平涂会连标记一起盖掉——真实重绘本来也不会保留原标记，这样更接近真实输出的差异幅度。
 */
async function simulateRespected(baseBuf, { transparentHalf, color = PAINT_COLOR } = {}) {
  const { data, width, height } = await decodeRgb(baseBuf);
  const out = Buffer.from(data);
  const half = splitAt(height);
  const y0 = transparentHalf === "top" ? 0 : half;
  const y1 = transparentHalf === "top" ? half : height;
  fillRect(out, width, 0, y0, width, y1 - y0, color);
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * 模拟「模型忽略蒙版」：整图重新渲染——颜色映射全换 + 确定性噪声。
 * 加噪声是为了证明指标不是只能识别「纯色替换」这种假变化。
 */
async function simulateIgnored(baseBuf) {
  const { data, width, height } = await decodeRgb(baseBuf);
  const out = Buffer.from(data);
  const half = splitAt(height);
  let seed = 20261109;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let mapped;
      if (y < half) {
        // 上半：蓝→黄；白标→深灰；黑标→浅灰
        mapped = b > r && b > g ? [240, 200, 40] : r > 200 && g > 200 && b > 200 ? [40, 40, 40] : [200, 200, 200];
      } else {
        // 下半：红→绿；白标→深灰；黑标→浅灰
        mapped = r > g && r > b ? [30, 170, 90] : r > 200 && g > 200 && b > 200 ? [40, 40, 40] : [200, 200, 200];
      }
      for (let c = 0; c < 3; c++) {
        out[i + c] = clampByte(mapped[c] + (rnd() - 0.5) * 16);
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * 按两臂结果判定上游是否尊重 mask（纯函数，供 run.js 与自检共用同一套判据）。
 *
 * arms: [{ id, transparentHalf: 'top'|'bottom', metrics, error? }]
 * 返回 { verdict: 'MASK_RESPECTED'|'MASK_IGNORED'|'INCONCLUSIVE', reasons: string[] }
 */
function decideVerdict(arms) {
  const usable = (arms || []).filter((arm) => arm && arm.metrics && !arm.error);
  const armA = usable.find((arm) => arm.transparentHalf === "top");
  const armB = usable.find((arm) => arm.transparentHalf === "bottom");
  const reasons = [];

  if (!armA || !armB) {
    return {
      verdict: "INCONCLUSIVE",
      reasons: ["缺少可用的 A/B 两臂结果（需 A 臂 mask 透明区=上半、B 臂=下半，且两臂都成功取到输出图）"],
    };
  }

  const { unmaskedMax, ratio, globalMin } = THRESHOLDS;
  const a = armA.metrics;
  const b = armB.metrics;

  if (!a.dimsMatch) {
    reasons.push(
      `A 臂输出 ${a.dims.width}x${a.dims.height} ≠ 输入 ${a.inputDims.width}x${a.inputDims.height}（已 resize 后比较，未蒙版区差异会被重采样放大）`,
    );
  }
  if (!b.dimsMatch) {
    reasons.push(
      `B 臂输出 ${b.dims.width}x${b.dims.height} ≠ 输入 ${b.inputDims.width}x${b.inputDims.height}（已 resize 后比较，未蒙版区差异会被重采样放大）`,
    );
  }

  // 判据 1：变化只出现在 mask 透明的那半，另一半接近逐像素保留。
  const aFollowsMask = a.topDiff > ratio * a.bottomDiff && a.bottomDiff < unmaskedMax;
  const bFollowsMask = b.bottomDiff > ratio * b.topDiff && b.topDiff < unmaskedMax;

  if (aFollowsMask && bFollowsMask) {
    reasons.unshift(
      `A 臂：masked(top)=${a.topDiff} vs unmasked(bottom)=${a.bottomDiff}，变化跟随 mask；` +
        `B 臂：masked(bottom)=${b.bottomDiff} vs unmasked(top)=${b.topDiff}，变化跟随 mask`,
    );
    return { verdict: "MASK_RESPECTED", reasons };
  }

  // 判据 2：两臂两半都大幅变化 → 整图重绘，mask 参数被忽略。
  const bothHalvesChanged = [a, b].every((m) => m.topDiff > globalMin && m.bottomDiff > globalMin);
  if (bothHalvesChanged) {
    reasons.unshift(
      `两臂的上下半区差异都超过 ${globalMin}：` +
        `A 臂 top=${a.topDiff}/bottom=${a.bottomDiff}，B 臂 top=${b.topDiff}/bottom=${b.bottomDiff}，` +
        "整图被重绘、mask 未被尊重或未被透传",
    );
    return { verdict: "MASK_IGNORED", reasons };
  }

  reasons.unshift(
    `两臂均不满足「变化跟随 mask」，也不满足「两半都大幅变化」：` +
      `A 臂 top=${a.topDiff}/bottom=${a.bottomDiff}（未蒙版区需 < ${unmaskedMax}、masked 区需 > ${ratio}×未蒙版区），` +
      `B 臂 top=${b.topDiff}/bottom=${b.bottomDiff}`,
  );
  return { verdict: "INCONCLUSIVE", reasons };
}

module.exports = {
  DEFAULT_SIZE,
  THRESHOLDS,
  SELFTEST_THRESHOLDS,
  makeBaseImage,
  makeMask,
  diffMetrics,
  imageDimensions,
  contactSheet,
  simulateRespected,
  simulateIgnored,
  decideVerdict,
};
