/**
 * 浏览器模式回归（无 Capacitor 桥 → PC/浏览器行为）
 *
 * 前置：dev server 已启动（默认 http://localhost:3462，CAP_TEST_URL 覆盖）
 * 运行：node scripts/test-browser-mode.cjs
 *
 * 断言要点：PC 端按钮为「下载」系（a[download] 有处理器），
 * 不出现 APP 专属的「保存到相册」；多图显示「全部下载」。
 * 与 test-capacitor-bridge.cjs（APP 环境）配对，保证两端互不干扰。
 */
const { chromium } = require("playwright-core");
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const BASE_URL = process.env.CAP_TEST_URL || "http://localhost:3462";

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const results = [];
  const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} [${name}] ${detail ?? ""}`); };

  const isNative = await page.evaluate(() => (window.Capacitor?.isNativePlatform?.() ?? false));
  check("浏览器环境（无 Capacitor）", isNative === false);

  // 种历史 → 回填 → 展开预览
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
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "历史记录" }).click();
  await page.waitForTimeout(600);
  await page.locator('[role="dialog"] .group').first().click();
  await page.waitForTimeout(800);

  const allDownload = await page.getByRole("button", { name: "全部下载" }).isVisible().catch(() => false);
  const allSave = await page.getByRole("button", { name: "全部保存" }).isVisible().catch(() => false);
  check("PC：多图显示「全部下载」", allDownload);
  check("PC：不出现「全部保存」", allSave === false);

  await page.locator(".aspect-square").first().click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(600);
  const dlCards = await page.locator('button[aria-label="下载"]').count();
  const saveCards = await page.locator('button[aria-label="保存到相册"]').count();
  check("PC：卡片操作钮为下载", dlCards >= 1, "下载钮=" + dlCards);
  check("PC：无「保存到相册」按钮", saveCards === 0, "保存钮=" + saveCards);

  const previewDownload = await page.getByRole("button", { name: "下载", exact: true }).last().isVisible().catch(() => false);
  const previewSave = await page.getByRole("button", { name: "保存到相册" }).isVisible().catch(() => false);
  check("PC：预览头显示「下载」", previewDownload);
  check("PC：预览头无「保存到相册」", previewSave === false);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERR", e); process.exit(2); });
