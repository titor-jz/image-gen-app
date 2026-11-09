#!/usr/bin/env node
/**
 * inpaint-probe：验证「中转到底认不认 images/edits 的 mask 参数」（局部重绘 / inpainting）。
 *
 * 为什么这么做：gpt-image 系模型经常（或中转经常）忽略 mask 直接整图重绘。之前用真实图
 * 测过一次，上游返回了和提示词无关的图，结果被污染、无法判定。这里改成：
 *   - 合成底图 + 半区纯色，把「保护区有没有被改」变成可量化的像素差；
 *   - 两臂 A/B，唯一变量是 mask 的透明半区。若 mask 生效，变化区域必须跟着 mask 走；
 *     若忽略 mask，两臂都会全图变化，指标能明确区分。
 *
 * 用法（自检离线、不读 Key）：
 *   node scripts/inpaint-probe/run.js --selftest
 * 拿到 Key 后联网：
 *   node scripts/inpaint-probe/run.js --base-url https://xxx/v1 --key sk-xxx --model gpt-image-2
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const lib = require("./lib");

const DEFAULT_PROMPT = "把透明的那块区域改成明亮的黄色，其余部分保持完全不变";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_TIMEOUT_SEC = 300;

const BOOL_FLAGS = new Set(["selftest", "dry-run", "help"]);
const VALUE_FLAGS = new Set([
  "base-url",
  "key",
  "model",
  "input",
  "proxy",
  "prompt",
  "max-time",
  "out",
  "size",
  "response-format",
]);

const USAGE = `inpaint-probe —— 验证中转是否尊重 gpt-image 系 images/edits 的 mask 参数

自检（离线，不联网、不读 Key）：
  node scripts/inpaint-probe/run.js --selftest

先看请求计划（不发送任何请求）：
  node scripts/inpaint-probe/run.js --dry-run --base-url https://xxx/v1 --key sk-xxx

联网探针（拿到 Key 后一条命令出结论）：
  node scripts/inpaint-probe/run.js --base-url https://xxx/v1 --key sk-xxx --model gpt-image-2

可选参数：
  --input <path>          用真实图片代替合成底图（mask 按该图尺寸生成）
  --prompt <text>         自定义提示词（默认中文，要求只改透明区域）
  --size <WxH>            multipart 的 size 字段，默认 1024x1024（真实图可用 auto）
  --max-time <秒>         单请求超时，默认 300
  --proxy <url>           走 HTTP(S) 代理（依赖 node_modules 里的 undici）
  --out <dir>             自定义报告目录（默认 scripts/inpaint-probe/out/<YYYYMMDD-HHmmss>/）
  --response-format <v>   b64_json 或 url；不传则该字段不发送（两种响应都能解析）

退出码：
  0 MASK_RESPECTED   2 MASK_IGNORED   3 INCONCLUSIVE
  1 自检失败 / 参数或配置错误 / 任一臂请求失败
`;

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new Error(`布尔参数 --${name} 不接受取值`);
      args[camel(name)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`未知参数 --${name}`);
    let value;
    if (eq >= 0) {
      value = token.slice(eq + 1);
    } else {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`参数 --${name} 缺少取值`);
    }
    args[camel(name)] = value;
  }
  return args;
}

function printUsage() {
  console.log(USAGE);
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function resolveOutDir(args) {
  return args.out ? path.resolve(args.out) : path.join(__dirname, "out", stamp());
}

function relativeToCwd(target) {
  return path.relative(process.cwd(), target) || ".";
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function redactKey(key) {
  const s = String(key);
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 5)}…${s.slice(-3)}`;
}

function redactProxy(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<无法解析的代理地址>";
  }
}

function joinUrl(baseUrl, suffix) {
  if (!baseUrl) return null;
  return `${String(baseUrl).trim().replace(/\/+$/, "")}${suffix}`;
}

function parsePositiveInt(value, fallback, flag) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} 需要正整数，收到 ${String(value)}`);
  return Math.round(n);
}

function mimeOfExt(ext) {
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      svg: "image/svg+xml",
    }[ext] || "application/octet-stream"
  );
}

function sniffImageExt(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("latin1", 0, 3) === "GIF") return "gif";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return "avif";
  const head = buf.toString("utf8", 0, 256).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return null;
}

/**
 * 手写 multipart：不依赖 fetch/undici 对 FormData 实例的跨版本互认，
 * 同时让 dry-run 能精确报出请求体字节数。
 */
function buildMultipart(fields, files) {
  const boundary = `----inpaint-probe-${crypto.randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"),
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mime}\r\n\r\n`,
        "utf8",
      ),
    );
    parts.push(file.buffer);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function createFetch(proxyUrl) {
  let undici = null;
  try {
    undici = require("undici");
  } catch {
    // 老环境没有 undici 时退回全局 fetch（Node 18+）
  }
  if (proxyUrl) {
    if (!undici || typeof undici.ProxyAgent !== "function") {
      throw new Error("--proxy 需要 node_modules 里的 undici，当前环境不可用");
    }
    const dispatcher = new undici.ProxyAgent(proxyUrl);
    return {
      fetch: (url, init) => undici.fetch(url, { ...init, dispatcher }),
      close: async () => {
        try {
          await dispatcher.close();
        } catch {
          // 关闭失败不影响结论
        }
      },
    };
  }
  return {
    fetch: undici ? undici.fetch : globalThis.fetch,
    close: async () => {},
  };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err) {
  return Boolean(err) && (err.name === "AbortError" || /abort/i.test(String(err.message)));
}

function buildError(stage, message, extra = {}) {
  return Object.assign(new Error(message), { stage, ...extra });
}

function decodeBase64(value) {
  const comma = value.indexOf(",");
  const payload = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  return Buffer.from(payload, "base64");
}

function parseImageResponse(buffer, contentType) {
  const isJson = /json/i.test(contentType) || (buffer.length > 0 && buffer[0] === 0x7b); // '{'
  if (!isJson) {
    return sniffImageExt(buffer)
      ? { kind: "image", buffer }
      : { kind: "unknown", buffer, contentType };
  }
  const text = buffer.toString("utf8");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "text", text };
  }
  const item = Array.isArray(json.data) ? json.data[0] : null;
  if (item && typeof item.b64_json === "string" && item.b64_json.length > 0) {
    return { kind: "b64", buffer: decodeBase64(item.b64_json), json };
  }
  if (item && typeof item.url === "string" && item.url.length > 0) {
    return { kind: "url", url: item.url, json };
  }
  return { kind: "json", json, text };
}

async function resolveImage(parsed, ctx) {
  if (parsed.kind === "image" || parsed.kind === "b64") {
    return { buffer: parsed.buffer, source: parsed.kind };
  }
  if (parsed.kind === "url") {
    const absolute = new URL(parsed.url, ctx.endpoint).toString();
    const res = await fetchWithTimeout(ctx.fetchImpl, absolute, {}, ctx.timeoutMs);
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw buildError("download", `下载输出图失败 HTTP ${res.status}`, {
        httpStatus: res.status,
        body: body.toString("utf8"),
      });
    }
    return { buffer: body, source: "url", url: absolute };
  }
  throw buildError("parse", "响应里既没有 data[0].b64_json，也没有 data[0].url", {
    body: parsed.text || null,
  });
}

/** 组装输入图 / mask / multipart 请求体；dry-run 与真实运行共用同一份计划。 */
async function buildPlan(args) {
  const inputPath = args.input ? path.resolve(args.input) : null;
  const inputBuffer = inputPath ? await fs.promises.readFile(inputPath) : await lib.makeBaseImage();
  const inputExt =
    sniffImageExt(inputBuffer) ||
    (inputPath ? path.extname(inputPath).slice(1).toLowerCase() : "") ||
    "png";
  const inputDims = await lib.imageDimensions(inputBuffer);

  const model = args.model || DEFAULT_MODEL;
  const prompt = args.prompt || DEFAULT_PROMPT;
  const size = args.size || "1024x1024";
  if (!/^(auto|\d+x\d+)$/.test(size)) {
    throw new Error(`--size 需要 WxH 或 auto，收到 ${size}`);
  }
  const responseFormat = args.responseFormat || "";
  if (responseFormat && responseFormat !== "b64_json" && responseFormat !== "url") {
    throw new Error(`--response-format 只能是 b64_json 或 url，收到 ${responseFormat}`);
  }
  const timeoutSec = parsePositiveInt(args.maxTime, DEFAULT_TIMEOUT_SEC, "--max-time");

  const arms = [];
  for (const arm of [
    { id: "A", transparentHalf: "top" },
    { id: "B", transparentHalf: "bottom" },
  ]) {
    const mask = await lib.makeMask({
      transparentHalf: arm.transparentHalf,
      width: inputDims.width,
      height: inputDims.height,
    });
    const fields = { model, prompt, size };
    if (responseFormat) fields.response_format = responseFormat;
    const files = [
      { name: "image", filename: `image.${inputExt}`, mime: mimeOfExt(inputExt), buffer: inputBuffer },
      { name: "mask", filename: `mask-${arm.transparentHalf}.png`, mime: "image/png", buffer: mask },
    ];
    const { body, contentType } = buildMultipart(fields, files);
    arms.push({ ...arm, mask, body, contentType, fields, files });
  }

  return {
    endpoint: joinUrl(args.baseUrl, "/images/edits"),
    model,
    prompt,
    size,
    responseFormat,
    timeoutSec,
    proxy: args.proxy || "",
    input: {
      source: inputPath ? "file" : "synthetic",
      path: inputPath,
      buffer: inputBuffer,
      dims: inputDims,
      ext: inputExt,
    },
    arms,
  };
}

function armLabel(arm) {
  return arm.transparentHalf === "top" ? "上半" : "下半";
}

function printPlan(plan, args, outDir, kind) {
  const lines = [];
  lines.push(kind === "dry-run" ? "[dry-run] 只打印请求计划，不会发送任何网络请求" : "[probe] 请求计划");
  lines.push(`  端点          POST ${plan.endpoint || "<缺少 --base-url>"}`);
  lines.push(`  Authorization Bearer ${args.key ? redactKey(args.key) : "<缺少 --key>"}`);
  lines.push(`  模型          ${plan.model}`);
  lines.push(`  size          ${plan.size}`);
  lines.push(`  prompt        ${plan.prompt}`);
  lines.push(`  超时          ${plan.timeoutSec}s / 请求`);
  lines.push(`  代理          ${plan.proxy ? redactProxy(plan.proxy) : "（无）"}`);
  lines.push(
    `  输入          ${
      plan.input.source === "file"
        ? `文件 ${plan.input.path}`
        : "合成底图 makeBaseImage()"
    }，${plan.input.dims.width}x${plan.input.dims.height}`,
  );
  lines.push(`  报告目录      ${relativeToCwd(outDir)}${kind === "dry-run" ? "（dry-run 不创建）" : ""}`);
  for (const arm of plan.arms) {
    const maskFile = arm.files.find((f) => f.name === "mask");
    const imageFile = arm.files.find((f) => f.name === "image");
    lines.push(
      `  臂 ${arm.id}          mask 透明区=${armLabel(arm)}（可重绘${armLabel(arm)}，保护另半区）`,
    );
    lines.push(
      `                multipart 字段：${Object.keys(arm.fields).join(" / ")}；` +
        `image=${imageFile.filename}(${formatBytes(imageFile.buffer.length)}) ` +
        `mask=${maskFile.filename}(${formatBytes(maskFile.buffer.length)})`,
    );
    lines.push(`                请求体 ${formatBytes(arm.body.length)}`);
  }
  lines.push("  A/B 唯一变量：mask 的透明半区（model / prompt / size / 输入图完全相同）");
  lines.push(
    kind === "dry-run"
      ? "[dry-run] 以上请求未发送。去掉 --dry-run 即真实调用。"
      : "[probe] 开始两臂请求……",
  );
  console.log(lines.join("\n"));
}

async function runArm(arm, ctx) {
  const t0 = Date.now();
  const record = {
    id: arm.id,
    transparentHalf: arm.transparentHalf,
    startedAt: new Date().toISOString(),
    request: {
      bytes: arm.body.length,
      fields: { ...arm.fields },
      files: arm.files.map((f) => ({ field: f.name, filename: f.filename, bytes: f.buffer.length })),
    },
  };

  try {
    const res = await fetchWithTimeout(
      ctx.fetchImpl,
      ctx.endpoint,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.key}`, "Content-Type": arm.contentType },
        body: arm.body,
      },
      ctx.timeoutMs,
    );
    const raw = Buffer.from(await res.arrayBuffer());
    record.httpStatus = res.status;
    record.requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || null;
    record.durationMs = Date.now() - t0;
    const contentType = res.headers.get("content-type") || "";
    const parsed = parseImageResponse(raw, contentType);

    if (!res.ok) {
      // 错误体原样留档：以后拿去找上游对质时，别让重写过的摘要替代原文。
      throw buildError("http", `HTTP ${res.status}`, {
        httpStatus: res.status,
        body: raw.toString("utf8"),
        contentType,
      });
    }

    const image = await resolveImage(parsed, ctx);
    record.response = {
      source: image.source,
      bytes: image.buffer.length,
      url: image.url || null,
    };
    if (parsed.json) {
      record.response.usage = parsed.json.usage || null;
      record.response.revisedPrompt = parsed.json.data && parsed.json.data[0] ? parsed.json.data[0].revised_prompt || null : null;
    }

    const ext = sniffImageExt(image.buffer) || "img";
    const outputFile = path.join(ctx.outDir, `arm-${arm.id}-output.${ext}`);
    fs.writeFileSync(outputFile, image.buffer);
    record.outputFile = relativeToCwd(outputFile);

    const sheet = await lib.contactSheet({ input: ctx.inputBuffer, mask: arm.mask, output: image.buffer });
    const sheetFile = path.join(ctx.outDir, `arm-${arm.id}-sheet.png`);
    fs.writeFileSync(sheetFile, sheet);
    record.sheetFile = relativeToCwd(sheetFile);

    record.metrics = await lib.diffMetrics(ctx.inputBuffer, image.buffer);
    record.ok = true;
    return record;
  } catch (err) {
    record.ok = false;
    record.durationMs = record.durationMs === undefined ? Date.now() - t0 : record.durationMs;
    record.message = err.message;
    record.error = {
      stage: err.stage || "request",
      message: isAbortError(err) ? `请求超时（>${Math.round(ctx.timeoutMs / 1000)}s）` : err.message,
      httpStatus: err.httpStatus !== undefined ? err.httpStatus : record.httpStatus !== undefined ? record.httpStatus : null,
      contentType: err.contentType || null,
      body: err.body !== undefined ? err.body : null,
      requestId: record.requestId || null,
    };
    return record;
  }
}

function truncateOneLine(text, max = 400) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function networkProbe(args) {
  const baseUrl = (args.baseUrl || "").trim();
  const key = (args.key || "").trim();
  if (!baseUrl || !key) {
    throw new Error("联网模式需要 --base-url 和 --key（想先看请求计划可加 --dry-run）");
  }

  const outDir = resolveOutDir(args);
  fs.mkdirSync(outDir, { recursive: true });

  const plan = await buildPlan(args);
  const fetchHelper = createFetch(plan.proxy);
  const ctx = {
    endpoint: plan.endpoint,
    fetchImpl: fetchHelper.fetch,
    key,
    outDir,
    inputBuffer: plan.input.buffer,
    timeoutMs: plan.timeoutSec * 1000,
  };

  // 先把输入图和 mask 落盘：事后核对 / 投诉上游时需要知道我们到底发了什么。
  const inputFile = path.join(outDir, `input.${plan.input.ext}`);
  fs.writeFileSync(inputFile, plan.input.buffer);
  for (const arm of plan.arms) {
    fs.writeFileSync(path.join(outDir, `mask-${arm.id}-${arm.transparentHalf}.png`), arm.mask);
  }

  console.log("═".repeat(72));
  console.log("inpaint-probe 联网探针 —— 两臂 A/B，唯一变量是 mask 透明半区");
  console.log("═".repeat(72));
  printPlan(plan, args, outDir, "run");
  console.log("");

  const arms = [];
  for (const arm of plan.arms) {
    console.log(`[臂 ${arm.id}] 发送中（mask 透明区=${armLabel(arm)}）……`);
    const record = await runArm(arm, ctx);
    arms.push(record);
    if (record.ok) {
      const m = record.metrics;
      console.log(
        `[臂 ${arm.id}] HTTP ${record.httpStatus}，耗时 ${(record.durationMs / 1000).toFixed(1)}s，` +
          `输出 ${m.dims.width}x${m.dims.height}${m.dimsMatch ? "" : "（与输入尺寸不同，已对齐后比较）"}`,
      );
      console.log(
        `[臂 ${arm.id}] topDiff=${m.topDiff}  bottomDiff=${m.bottomDiff}  globalDiff=${m.globalDiff}`,
      );
      console.log(`[臂 ${arm.id}] 输出图 ${record.outputFile}；三联图 ${record.sheetFile}`);
    } else {
      console.log(`[臂 ${arm.id}] 失败（${record.error.stage}）：${record.error.message}`);
      if (record.error.body) {
        console.log(`[臂 ${arm.id}] 错误体已原样写入报告：${truncateOneLine(record.error.body)}`);
      }
    }
    console.log("");
  }

  const { verdict, reasons } = lib.decideVerdict(arms);
  const report = {
    schema: "inpaint-probe/report@1",
    createdAt: new Date().toISOString(),
    endpoint: plan.endpoint,
    model: plan.model,
    prompt: plan.prompt,
    size: plan.size,
    responseFormat: plan.responseFormat || null,
    timeoutSec: plan.timeoutSec,
    proxy: plan.proxy ? redactProxy(plan.proxy) : null,
    input: {
      source: plan.input.source,
      path: plan.input.path,
      dims: plan.input.dims,
      file: path.basename(inputFile),
    },
    armDesign:
      "两臂唯一变量是 mask 透明半区：A 臂透明区=上半（可重绘上半、保护下半），B 臂透明区=下半；" +
      "model / prompt / size / 输入图完全相同。",
    thresholds: lib.THRESHOLDS,
    arms,
    verdict,
    verdictReasons: reasons,
    notes: [
      "mask 在图像高度中线硬切、无羽化；alpha=0（透明）= 可重绘区，alpha=255 = 保护。",
      "topDiff/bottomDiff/globalDiff 为对应区域 RGB 逐像素平均绝对差，归一化到 0~1。",
      "输出尺寸与输入不同时已 resize 回输入尺寸再比较（metrics.dimsMatch=false）。",
      "HTTP 错误体按原文保存，便于后续向上游反馈。",
    ],
  };

  const reportFile = path.join(outDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log("─".repeat(72));
  console.log(`[结论] ${verdict}`);
  for (const reason of reasons) console.log(`  理由：${reason}`);
  console.log(`[报告] ${relativeToCwd(reportFile)}`);
  console.log("─".repeat(72));

  await fetchHelper.close();

  if (arms.some((arm) => !arm.ok)) return 1;
  if (verdict === "MASK_RESPECTED") return 0;
  if (verdict === "MASK_IGNORED") return 2;
  return 3;
}

async function dryRun(args) {
  const plan = await buildPlan(args);
  const outDir = resolveOutDir(args);
  console.log("═".repeat(72));
  console.log("inpaint-probe dry-run —— 只生成并打印请求计划，不联网");
  console.log("═".repeat(72));
  printPlan(plan, args, outDir, "dry-run");
  return 0;
}

function f5(value) {
  return Number(value).toFixed(5);
}

function ratioText(numerator, denominator) {
  if (denominator === 0) return numerator === 0 ? "0/0" : "∞";
  return (numerator / denominator).toFixed(2);
}

async function selftest(args) {
  const outDir = path.join(resolveOutDir(args), "selftest");
  fs.mkdirSync(outDir, { recursive: true });
  const startedAt = Date.now();

  const base = await lib.makeBaseImage();
  const maskTop = await lib.makeMask({ transparentHalf: "top" });
  const maskBottom = await lib.makeMask({ transparentHalf: "bottom" });
  const respectTop = await lib.simulateRespected(base, { transparentHalf: "top" });
  const respectBottom = await lib.simulateRespected(base, { transparentHalf: "bottom" });
  const ignored = await lib.simulateIgnored(base);
  // 尺寸不一致分支：验证 diffMetrics 会先对齐再比，并如实标记 dimsMatch=false。
  const resizedBottom = await sharp(respectBottom).resize(512, 512, { fit: "fill" }).png().toBuffer();

  const artifacts = [
    ["input.png", base],
    ["mask-top.png", maskTop],
    ["mask-bottom.png", maskBottom],
    ["scenario1-output-bottom-half.png", respectBottom],
    ["scenario1-output-top-half.png", respectTop],
    ["scenario2-output-ignored.png", ignored],
  ];
  for (const [name, buffer] of artifacts) fs.writeFileSync(path.join(outDir, name), buffer);

  const sheet1 = await lib.contactSheet({ input: base, mask: maskBottom, output: respectBottom });
  const sheet2 = await lib.contactSheet({ input: base, mask: maskBottom, output: ignored });
  fs.writeFileSync(path.join(outDir, "scenario1-sheet.png"), sheet1);
  fs.writeFileSync(path.join(outDir, "scenario2-sheet.png"), sheet2);

  const m1 = await lib.diffMetrics(base, respectBottom); // mask 透明区=下半
  const m1Top = await lib.diffMetrics(base, respectTop); // 另一臂：mask 透明区=上半
  const m2 = await lib.diffMetrics(base, ignored); // 忽略 mask：整图变
  const mResized = await lib.diffMetrics(base, resizedBottom);

  const assertions = [];
  const check = (label, actual, pass) => assertions.push({ label, actual, pass });
  const T = lib.SELFTEST_THRESHOLDS;

  console.log("═".repeat(72));
  console.log("inpaint-probe 自检（纯本地：不联网、不读取任何 API Key）");
  console.log("═".repeat(72));

  console.log("");
  console.log("[场景 1] 模拟「尊重蒙版」：mask 透明区=下半 → 只改下半，上半逐像素保留");
  console.log(
    `  topDiff=${f5(m1.topDiff)}  bottomDiff=${f5(m1.bottomDiff)}  globalDiff=${f5(m1.globalDiff)}`,
  );
  check(
    `场景1 masked 半区（下半）明显变化`,
    `bottomDiff=${f5(m1.bottomDiff)} > ${T.maskedMin}`,
    m1.bottomDiff > T.maskedMin,
  );
  check(
    `场景1 unmasked 半区（上半）逐像素保留`,
    `topDiff=${f5(m1.topDiff)} < ${T.unmaskedMax}`,
    m1.topDiff < T.unmaskedMax,
  );
  check(
    `场景1 masked / unmasked 倍数`,
    `bottomDiff/topDiff=${ratioText(m1.bottomDiff, m1.topDiff)} > ${T.ratio}`,
    m1.bottomDiff > T.ratio * m1.topDiff,
  );
  check(
    `场景1 全局确有差异（变化真的发生了）`,
    `globalDiff=${f5(m1.globalDiff)} > ${f5(T.unmaskedMax)}`,
    m1.globalDiff > T.unmaskedMax,
  );

  console.log("");
  console.log("[场景 2] 模拟「忽略蒙版」：整图重绘（颜色全换 + 确定性噪声），mask 形同虚设");
  console.log(
    `  topDiff=${f5(m2.topDiff)}  bottomDiff=${f5(m2.bottomDiff)}  globalDiff=${f5(m2.globalDiff)}`,
  );
  check(`场景2 unmasked 半区（上半）也被改（topDiff 大）`, `topDiff=${f5(m2.topDiff)} > ${T.maskedMin}`, m2.topDiff > T.maskedMin);
  check(`场景2 masked 半区（下半）也被改（bottomDiff 大）`, `bottomDiff=${f5(m2.bottomDiff)} > ${T.maskedMin}`, m2.bottomDiff > T.maskedMin);

  const scenario2LooksRespected =
    m2.bottomDiff > T.maskedMin && m2.topDiff < T.unmaskedMax && m2.bottomDiff > T.ratio * m2.topDiff;
  check(
    `场景2 不满足场景1 判据（指标能区分两种输出）`,
    `!(${f5(m2.bottomDiff)} > ${T.maskedMin} && ${f5(m2.topDiff)} < ${T.unmaskedMax} && ` +
      `${f5(m2.bottomDiff)} > ${T.ratio}×${f5(m2.topDiff)}) = ${!scenario2LooksRespected}`,
    !scenario2LooksRespected,
  );

  console.log("");
  console.log("[尺寸记录] 合成输入与输出应记录为 1024x1024 且 dimsMatch=true");
  check(
    `diffMetrics 记录尺寸与 dimsMatch`,
    `dims=${m1.dims.width}x${m1.dims.height} dimsMatch=${m1.dimsMatch}`,
    m1.dims.width === 1024 && m1.dims.height === 1024 && m1.dimsMatch === true,
  );

  console.log("");
  console.log("[尺寸不一致] 把场景1输出缩到 512x512 再比：应先对齐到输入尺寸，并标记 dimsMatch=false");
  console.log(
    `  dims=${mResized.dims.width}x${mResized.dims.height}  inputDims=${mResized.inputDims.width}x${mResized.inputDims.height}  ` +
      `dimsMatch=${mResized.dimsMatch}  topDiff=${f5(mResized.topDiff)}  bottomDiff=${f5(mResized.bottomDiff)}`,
  );
  check(
    `尺寸不一致时如实记录 dimsMatch=false`,
    `dimsMatch=${mResized.dimsMatch}（输出 ${mResized.dims.width}x${mResized.dims.height}）`,
    mResized.dimsMatch === false && mResized.dims.width === 512,
  );
  check(
    `尺寸不一致时对齐后指标仍成立`,
    `bottomDiff=${f5(mResized.bottomDiff)} > ${T.maskedMin} 且 topDiff=${f5(mResized.topDiff)} < ${T.unmaskedMax}`,
    mResized.bottomDiff > T.maskedMin && mResized.topDiff < T.unmaskedMax,
  );

  console.log("");
  console.log("[判据联调] 用真实联网判据 decideVerdict 检查合成数据");
  const verdictRespected = lib.decideVerdict([
    { id: "A", transparentHalf: "top", metrics: m1Top },
    { id: "B", transparentHalf: "bottom", metrics: m1 },
  ]);
  const verdictIgnored = lib.decideVerdict([
    { id: "A", transparentHalf: "top", metrics: m2 },
    { id: "B", transparentHalf: "bottom", metrics: m2 },
  ]);
  check(
    `A/B 判据：两臂各只改自己的透明半区 → MASK_RESPECTED`,
    `verdict=${verdictRespected.verdict}`,
    verdictRespected.verdict === "MASK_RESPECTED",
  );
  check(
    `A/B 判据：两臂都是整图重绘 → MASK_IGNORED`,
    `verdict=${verdictIgnored.verdict}`,
    verdictIgnored.verdict === "MASK_IGNORED",
  );

  console.log("");
  for (const item of assertions) {
    console.log(`  ${item.pass ? "PASS" : "FAIL"}  ${item.label}（${item.actual}）`);
  }

  const failed = assertions.filter((item) => !item.pass).length;
  console.log("");
  console.log("─".repeat(72));
  console.log(`断言：${assertions.length - failed} PASS / ${failed} FAIL（耗时 ${Date.now() - startedAt}ms）`);
  console.log(`产物目录：${relativeToCwd(outDir)}`);
  for (const [name, buffer] of artifacts) {
    console.log(`  ${name}  ${formatBytes(buffer.length)}`);
  }
  console.log(`  scenario1-sheet.png  ${formatBytes(sheet1.length)}（左=输入 / 中=mask 洋红=可重绘 / 右=输出）`);
  console.log(`  scenario2-sheet.png  ${formatBytes(sheet2.length)}`);
  console.log("─".repeat(72));
  if (failed === 0) {
    console.log("[结论] PASS —— 指标能清晰区分「尊重蒙版」与「忽略蒙版」");
    return 0;
  }
  console.log("[结论] FAIL —— 指标区分度不足，不要用它去判断中转行为");
  return 1;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[参数错误] ${err.message}\n`);
    printUsage();
    return 1;
  }
  if (args.help || args._.length > 0) {
    printUsage();
    return args._.length > 0 ? 1 : 0;
  }
  if (args.selftest) return selftest(args);
  if (args.dryRun) return dryRun(args);
  return networkProbe(args);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[错误] ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
