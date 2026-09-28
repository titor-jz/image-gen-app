/**
 * Capacitor 原生桥 mock 集成测试（APP 环境，移动端两态 IA）
 *
 * 前置：dev server 已启动（默认 http://localhost:3462，可用 CAP_TEST_URL 覆盖）
 * 运行：node scripts/test-capacitor-bridge.cjs
 * 依赖：playwright-core（devDep）+ 系统 Chrome（channel:"chrome"，无需下载浏览器）
 *
 * 覆盖：平台判定、首屏输入态、参数/历史底部面板与返回键接管、
 *       历史回填跳结果态、全屏预览保存到相册（含 albumIdentifier 原生契约）、
 *       返回键三态、监听器单次注册、状态栏随主题。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.CAP_TEST_URL || "http://localhost:3462";
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  const mock = fs.readFileSync(path.join(__dirname, "capacitor-bridge-mock.js"), "utf8");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.addInitScript({ content: mock });

  const results = [];
  const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} [${name}] ${detail ?? ""}`); };

  // 1) 平台判定
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const env = await page.evaluate(() => ({
    isNative: window.Capacitor?.isNativePlatform?.() ?? false,
    platform: window.Capacitor?.getPlatform?.() ?? "unknown",
  }));
  check("平台判定为 android", env.isNative === true && env.platform === "android", JSON.stringify(env));

  // 2) 首屏 = 输入态（无大标题，Composer + 参数摘要存在）
  const composePlaceholder = await page.locator("main textarea").isVisible().catch(() => false);
  check("首屏为输入态（Composer 可见）", composePlaceholder);
  const bigTitle = await page.evaluate(() => document.body.innerText.includes("AI 为你创造"));
  check("输入态无大标题（原生风首屏）", bigTitle === false);
  const paramBtn = await page.getByRole("button", { name: "生成参数" }).isVisible().catch(() => false);
  check("参数摘要条可见", paramBtn);
  const genBtn = await page.getByRole("button", { name: "生成", exact: true }).isVisible().catch(() => false);
  check("主 CTA 生成按钮可见", genBtn);

  // 3) 参数面板开关 + 返回键关闭面板
  await page.getByRole("button", { name: "生成参数" }).click();
  await page.waitForTimeout(500);
  const paramSheetOpen = await page.locator('[role="dialog"][aria-label="生成参数"]').isVisible().catch(() => false);
  check("参数底部面板打开", paramSheetOpen);
  await page.evaluate(() => window.__capMock.fireBackButton());
  await page.waitForTimeout(400);
  const paramSheetClosed = await page.locator('[role="dialog"][aria-label="生成参数"]').count();
  check("返回键关闭参数面板", paramSheetClosed === 0);

  // 4) 种历史 → 历史面板 → 回填 → 自动切结果态
  await page.evaluate(async (png) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("image-gen-db", 3); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => {
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").put({
        id: "hist-mock-test",
        params: { prompt: "mock 测试图", model: "gpt-image-2", size: "auto", quality: "1k", createdAt: Date.now() },
        results: [
          { id: "g1", b64_json: png, mime: "image/png", prompt: "mock 测试图", model: "gpt-image-2", size: "auto", createdAt: Date.now() },
          { id: "g2", b64_json: png, mime: "image/png", prompt: "mock 测试图2", model: "gpt-image-2", size: "auto", createdAt: Date.now() },
        ],
        createdAt: Date.now(),
      });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, TINY_PNG);
  await page.getByRole("button", { name: "历史记录" }).click();
  await page.waitForTimeout(600);
  const historySheetOpen = await page.locator('[role="dialog"][aria-label="历史记录"]').isVisible().catch(() => false);
  check("历史底部面板打开", historySheetOpen);
  await page.locator('[role="dialog"] .group').first().click();
  await page.waitForTimeout(800);
  const backBtn = await page.getByRole("button", { name: "返回输入" }).isVisible().catch(() => false);
  const cards = await page.locator(".aspect-square").count();
  check("历史回填后自动进入结果态", backBtn && cards >= 2, `cards=${cards}`);

  // 5) 全屏预览 + 保存到相册（原生契约）
  await page.locator(".aspect-square").first().click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(600);
  const previewOpen = await page.locator('[role="dialog"][aria-label="图片预览"]').isVisible().catch(() => false);
  check("点图进入全屏预览", previewOpen);
  const saveBtnCount = await page.getByRole("button", { name: "保存", exact: true }).count();
  const downloadInPreview = await page.getByRole("button", { name: "下载" }).count();
  check("APP 预览显示「保存」不显示「下载」", saveBtnCount >= 1 && downloadInPreview === 0, `save=${saveBtnCount} dl=${downloadInPreview}`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__capMock)));
  const mediaCalls = st.calls.filter((c) => c.pluginId === "Media").map((c) => c.methodName);
  const save1 = st.calls.find((c) => c.methodName === "savePhoto");
  check(
    "保存流程：查/建相册→savePhoto(带 albumIdentifier)",
    JSON.stringify(mediaCalls) === JSON.stringify(["getAlbums", "createAlbum", "getAlbums", "savePhoto"]) &&
      !!(save1 && save1.options && save1.options.albumIdentifier),
    JSON.stringify(mediaCalls)
  );
  const toastOk = await page.evaluate(() => document.body.innerText.includes("已保存到相册"));
  check("保存成功 toast", toastOk);

  // 6) 返回键三态：预览 → 结果态 → 输入态 → 退出
  await page.evaluate(() => window.__capMock.fireBackButton());
  await page.waitForTimeout(400);
  const previewClosed = await page.locator('[role="dialog"][aria-label="图片预览"]').count();
  const stillResults = await page.getByRole("button", { name: "返回输入" }).isVisible().catch(() => false);
  check("返回键先关预览、仍在结果态", previewClosed === 0 && stillResults);
  await page.evaluate(() => window.__capMock.fireBackButton());
  await page.waitForTimeout(400);
  const backToCompose = await page.getByRole("button", { name: "生成参数" }).isVisible().catch(() => false);
  const exitAfterTwo = await page.evaluate(() => window.__capMock.exitAppCount);
  check("再按返回键回输入态（未退出）", backToCompose && exitAfterTwo === 0, "exitApp=" + exitAfterTwo);
  await page.evaluate(() => window.__capMock.fireBackButton());
  await page.waitForTimeout(200);
  const exitFinal = await page.evaluate(() => window.__capMock.exitAppCount);
  check("输入态再按返回键退出应用", exitFinal === 1, "exitApp=" + exitFinal);

  // 7) 监听器单次注册
  const listenerCount = await page.evaluate(() => window.__capMock.backButtonCallbacks.size);
  check("返回键监听器单次注册（无泄漏）", listenerCount === 1, "监听器数=" + listenerCount);

  // 8) 状态栏随主题（移动顶栏主题按钮）
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.waitForTimeout(500);
  const st2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__capMock)));
  const bgCalls = st2.statusCalls.filter((c) => c.method === "setBackgroundColor");
  const lastBg = bgCalls[bgCalls.length - 1];
  check("状态栏随主题切换", !!(lastBg && lastBg.options && lastBg.options.color === "#0b121a"), JSON.stringify(st2.statusCalls));

  await page.screenshot({ path: path.join(__dirname, ".tmp-mobile-app.png") });
  await browser.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR:", e); process.exit(2); });
