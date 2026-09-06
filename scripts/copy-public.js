const fs = require("fs");
const path = require("path");

// Next standalone 输出默认不包含 public 与 .next/static（官方文档说明），
// Electron 版依赖 standalone server 直接伺服这两类资源，构建后需手动拷入。
// 由 package.json 的 electron:dev / electron:build 在 next build 之后调用。
const root = path.join(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠ source not found, skipping: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  console.error(
    "✗ .next/standalone/server.js 不存在 —— 请用 NEXT_OUTPUT=standalone next build 生成（package.json 的 electron 脚本已自动带上）"
  );
  process.exit(1);
}

copyDir(path.join(root, "public"), path.join(standaloneDir, "public"));
copyDir(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"));
console.log("✓ Copied public/ and .next/static into .next/standalone");
