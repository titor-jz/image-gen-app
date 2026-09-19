/**
 * 生成 Capacitor 原生资源（assets/）
 *
 * 与 PWA 图标同源设计：蓝紫渐变 + 白色星芒。
 * - icon-only.png     1024×1024  应用图标（全出血，capacitor-assets 裁切）
 * - splash.png        2732×2732  亮色启动屏（白底 + 渐变星芒）
 * - splash-dark.png   2732×2732  暗色启动屏（深蓝黑底 + 渐变星芒）
 *
 * 用法：node scripts/generate-cap-assets.js
 * 重新生成后执行：npx @capacitor/assets generate --android
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const GRAD_DEFS =
  '<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#3287ff"/><stop offset="1" stop-color="#9090ff"/>' +
  "</linearGradient></defs>";

const STAR_WHITE =
  '<path d="M256 106 C 273 213 299 239 406 256 C 299 273 273 299 256 406 ' +
  "C 239 299 213 273 106 256 C 213 239 239 213 256 106 Z\" fill=\"#ffffff\"/>" +
  '<circle cx="392" cy="120" r="18" fill="#ffffff" opacity="0.9"/>';

const STAR_GRAD =
  '<path d="M256 146 C 270 226 290 246 370 256 C 290 266 270 286 256 366 ' +
  'C 242 286 222 266 142 256 C 222 246 242 226 256 146 Z" fill="url(#g)"/>' +
  '<circle cx="368" cy="152" r="12" fill="url(#g)"/>';

const ICON_1024 =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">${GRAD_DEFS}` +
  `<rect width="512" height="512" fill="url(#g)"/>${STAR_WHITE}</svg>`;

const SPLASH_LIGHT =
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 512 512">${GRAD_DEFS}` +
  `<rect width="512" height="512" fill="#ffffff"/>${STAR_GRAD}</svg>`;

const SPLASH_DARK =
  `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 512 512">${GRAD_DEFS}` +
  `<rect width="512" height="512" fill="#0b121a"/>${STAR_GRAD}</svg>`;

const TARGETS = [
  ["icon-only.png", ICON_1024],
  ["splash.png", SPLASH_LIGHT],
  ["splash-dark.png", SPLASH_DARK],
];

const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const [name, svg] of TARGETS) {
    const out = path.join(outDir, name);
    await sharp(Buffer.from(svg)).png().toFile(out);
    const meta = await sharp(out).metadata();
    console.log(`${name}: ${meta.width}x${meta.height}`);
  }
})();
