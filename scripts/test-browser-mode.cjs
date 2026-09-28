/**
 * 浏览器模式回归（无 Capacitor 桥）
 *
 * 前置：dev server 已启动（默认 http://localhost:3462，CAP_TEST_URL 覆盖）
 * 运行：node scripts/test-browser-mode.cjs
 *
 * 两组：
 *  - 桌面 1280：旧结构保留（输入卡与结果同屏、行内展开预览、下载系按钮）
 *  - 移动 360：新两态 IA（Composer 首屏 → 历史回填进结果态 → 全屏预览下载系按钮）
 */
const { chromium } = require("playwright-core");
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const BASE_URL = process.env.CAP_TEST_URL || "http://localhost:3462";

const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} [${name}] ${detail ?? ""}`); };

async function seedHistory(page) {
  await page.evaluate(async (png) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("image-gen-db", 3); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => {
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").put({
        id: "hist-browser-check",
        params: { prompt: "PC 对照图", model: "gpt-image-2", size: "auto", quality: "1k", createdAt: Date.now() },
        results: [
          { id: "g1", b64_json: png, mime: "image/png", prompt: "PC 对照图", model: "gpt-image-2", size: "auto", createdAt: Date.now() },
          { id: "g2", b64_json: png, mime: "image/png", prompt: "PC 对照图 2", model: "gpt-image-2", size: "auto", createdAt: Date.now() },
        ],
        createdAt: Date.now(),
      });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, TINY_PNG);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  // ---------- 桌面 1280（结构不变） ----------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const isNative = await page.evaluate(() => (window.Capacitor?.isNativePlatform?.() ?? false));
    check("[桌面] 无 Capacitor", isNative === false);
    const hasTitle = await page.evaluate(() => document.body.innerText.includes("智能生图"));
    check("[桌面] 保留大标题", hasTitle);

    await seedHistory(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "历史记录" }).click();
    await page.waitForTimeout(600);
    await page.locator('[role="dialog"] .group').first().click();
    await page.waitForTimeout(800);
    const allDownload = await page.getByRole("button", { name: "全部下载" }).isVisible().catch(() => false);
    check("[桌面] 多图显示「全部下载」", allDownload);
    await page.locator(".aspect-square").first().click({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(600);
    const dlCards = await page.locator('button[aria-label="下载"]').count();
    const saveCards = await page.locator('button[aria-label="保存到相册"]').count();
    const previewDownload = await page.getByRole("button", { name: "下载", exact: true }).last().isVisible().catch(() => false);
    const previewSave = await page.getByRole("button", { name: "保存到相册" }).count();
    check("[桌面] 卡片与预览为下载系按钮、无保存", dlCards >= 1 && saveCards === 0 && previewDownload && previewSave === 0,
      `dlCards=${dlCards} saveCards=${saveCards} preview=${previewDownload}/${previewSave}`);
    await page.close();
  }

  // ---------- 移动 360（新两态 IA） ----------
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const compose = await page.locator("main textarea").isVisible().catch(() => false);
    check("[移动] 首屏为输入态", compose);

    await seedHistory(page);
    await page.getByRole("button", { name: "历史记录" }).click();
    await page.waitForTimeout(600);
    await page.locator('[role="dialog"] .group').first().click();
    await page.waitForTimeout(800);
    const backBtn = await page.getByRole("button", { name: "返回输入" }).isVisible().catch(() => false);
    check("[移动] 历史回填进结果态", backBtn);

    await page.locator(".aspect-square").first().click({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(600);
    const previewOpen = await page.locator('[role="dialog"][aria-label="图片预览"]').isVisible().catch(() => false);
    const previewDownload = await page.getByRole("button", { name: "下载" }).count();
    const previewSave = await page.getByRole("button", { name: "保存" }).count();
    check("[移动] 全屏预览为下载（浏览器无保存）", previewOpen && previewDownload >= 1 && previewSave === 0,
      `open=${previewOpen} dl=${previewDownload} save=${previewSave}`);
    await page.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERR", e); process.exit(2); });
