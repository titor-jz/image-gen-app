/**
 * Capacitor 原生桥 mock 集成测试（安卓端模拟测试）
 *
 * 前置：dev server 已启动（默认 http://localhost:3462，可用 CAP_TEST_URL 覆盖）
 * 运行：node scripts/test-capacitor-bridge.cjs
 * 依赖：playwright-core（devDep）+ 系统 Chrome（channel:"chrome"，无需下载浏览器）
 *
 * 覆盖：平台判定、保存到相册（含 albumIdentifier 原生契约）、
 *       返回键三态与单次注册、状态栏随主题。浏览器/PWA 无桥场景的
 *       负向验证见 docs/review-2026-09/ACCEPTANCE_review.md。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.CAP_TEST_URL || "http://localhost:3462";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${name}] ${detail ?? ""}`);
}

(async () => {
  const mock = fs.readFileSync(path.join(__dirname, "capacitor-bridge-mock.js"), "utf8");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.addInitScript({ content: mock });

  // 1) 平台判定：core 应把注入的桥识别为 android
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const env = await page.evaluate(() => ({
    isNative: window.Capacitor?.isNativePlatform?.() ?? false,
    platform: window.Capacitor?.getPlatform?.() ?? "unknown",
  }));
  check("平台判定为 android", env.isNative === true && env.platform === "android", JSON.stringify(env));

  // 2) 种入历史记录（1x1 PNG）→ reload → 从历史回填 results
  await page.evaluate(async (png) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("image-gen-db", 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").put({
        id: "hist-mock-test",
        params: { prompt: "mock 测试图", model: "gpt-image-2", size: "auto", quality: "1k", createdAt: Date.now() },
        results: [
          {
            id: "gen-mock",
            b64_json: png,
            mime: "image/png",
            prompt: "mock 测试图",
            model: "gpt-image-2",
            size: "auto",
            createdAt: Date.now(),
          },
        ],
        createdAt: Date.now(),
      });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, TINY_PNG);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "历史记录" }).click();
  await page.waitForTimeout(600);
  await page.locator('[role="dialog"] .group').first().click();
  await page.waitForTimeout(800);

  // 3) 展开预览 → 「保存到相册」按钮可见（仅 APP 环境渲染）。
  //    点卡片左上角：中心是常驻下载按钮（带 stopPropagation），点中心不会展开
  await page.locator(".aspect-square").first().click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(600);
  // APP 环境 a[download] 无处理器：预览头与卡片操作钮都应是「保存到相册」，不出现「下载」
  const saveButtons = await page.getByRole("button", { name: "保存到相册" }).count();
  check("APP 环境保存入口齐全（卡片+预览头）", saveButtons >= 2, "数量=" + saveButtons);
  const downloadVisible = await page
    .getByRole("button", { name: "下载", exact: true })
    .isVisible()
    .catch(() => false);
  check("APP 环境下不显示「下载」（无功能按钮已移除）", downloadVisible === false);
  const cardSaveCount = await page.locator('button[aria-label="保存到相册"]').count();
  check("卡片操作钮在 APP 环境为保存到相册", cardSaveCount >= 1, "数量=" + cardSaveCount);
  // 预览头的保存按钮（DOM 中靠后，带文字）
  const saveHeaderBtn = page.getByRole("button", { name: "保存到相册" }).last();

  // 4) 第一次保存：getAlbums → createAlbum → getAlbums → savePhoto(带 albumIdentifier)
  await saveHeaderBtn.click();
  await page.waitForTimeout(800);
  let st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__capMock)));
  const mediaCalls1 = st.calls.filter((c) => c.pluginId === "Media").map((c) => c.methodName);
  const save1 = st.calls.find((c) => c.methodName === "savePhoto");
  check(
    "保存流程：查/建相册→savePhoto",
    JSON.stringify(mediaCalls1) === JSON.stringify(["getAlbums", "createAlbum", "getAlbums", "savePhoto"]),
    JSON.stringify(mediaCalls1)
  );
  check(
    "savePhoto 满足原生契约（albumIdentifier 必填）",
    !!(save1 && save1.options && save1.options.albumIdentifier),
    JSON.stringify(save1 && save1.options)
  );
  const toastOk = await page.evaluate(() => document.body.innerText.includes("已保存到相册"));
  check("保存成功 toast", toastOk);

  // 5) 第二次保存：不重复建相册
  await saveHeaderBtn.click();
  await page.waitForTimeout(600);
  st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__capMock)));
  const createAlbumCount = st.calls.filter((c) => c.methodName === "createAlbum").length;
  check("第二次保存不重复建相册", createAlbumCount === 1, "createAlbum 次数=" + createAlbumCount);

  // 6) 返回键：关抽屉/退出 + 单次注册
  const preFire = await page.evaluate(() => ({
    size: window.__capMock.backButtonCallbacks.size,
    exit: window.__capMock.exitAppCount,
    appCalls: window.__capMock.calls.filter((c) => c.pluginId === "App").map((c) => c.methodName),
  }));
  console.log("fire 前:", JSON.stringify(preFire));
  await page.evaluate(() => window.__capMock.fireBackButton());
  const exit1 = await page.evaluate(() => window.__capMock.exitAppCount);
  await page.getByRole("button", { name: "历史记录" }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__capMock.fireBackButton());
  await page.waitForTimeout(300);
  const drawerOpen = await page.evaluate(
    () => !!document.querySelector('[role="dialog"][aria-label="历史记录"]')
  );
  const exit2 = await page.evaluate(() => window.__capMock.exitAppCount);
  await page.evaluate(() => window.__capMock.fireBackButton());
  const exit3 = await page.evaluate(() => window.__capMock.exitAppCount);
  check("返回键：抽屉关着→退出应用", exit1 === preFire.exit + 1, `exitApp=${exit1}（fire 前=${preFire.exit}）`);
  check("返回键：抽屉开着→关抽屉不退出", drawerOpen === false && exit2 === exit1, `drawer=${drawerOpen}, exitApp=${exit2}`);
  check("返回键：抽屉关后再按→退出", exit3 === exit2 + 1, "exitApp=" + exit3);

  // 快速开关抽屉 3 次 → 监听器仍为 1（单次注册，无竞态泄漏）。
  // 移动端全宽抽屉会盖住头部按钮，用 Esc 关闭
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "历史记录" }).click();
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  const listenerCount = await page.evaluate(() => window.__capMock.backButtonCallbacks.size);
  check("返回键监听器单次注册（无泄漏）", listenerCount === 1, "监听器数=" + listenerCount);

  // 7) 状态栏随主题：挂载时应用初始主题（亮色），点击后切换到暗色——
  //    断言取最后一次调用（挂载 + 切换各一次属预期行为）
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.waitForTimeout(500);
  st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__capMock)));
  const bgCalls = st.statusCalls.filter((c) => c.method === "setBackgroundColor");
  const lastBg = bgCalls[bgCalls.length - 1];
  const styleCalls = st.statusCalls.filter((c) => c.method === "setStyle");
  const lastStyle = styleCalls[styleCalls.length - 1];
  check(
    "状态栏随主题切换（挂载亮色→切换暗色）",
    !!(
      lastBg && lastBg.options && lastBg.options.color === "#0b121a" &&
      lastStyle && lastStyle.options && lastStyle.options.style === "DARK"
    ),
    JSON.stringify(st.statusCalls)
  );
  if (st.exitAppStacks) console.log("exitApp 调用栈:", JSON.stringify(st.exitAppStacks, null, 1));

  await page.screenshot({ path: path.join(__dirname, ".tmp-mock-test.png") });
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(2);
});
