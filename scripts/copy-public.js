const fs = require("fs");
const path = require("path");

// Copy public directory to standalone output
const publicDir = path.join(__dirname, "..", "public");
const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
const destPublic = path.join(standaloneDir, "public");

if (fs.existsSync(publicDir)) {
  if (!fs.existsSync(destPublic)) {
    fs.mkdirSync(destPublic, { recursive: true });
  }

  // Copy all files from public to standalone/public
  const copyDir = (src, dest) => {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  };

  copyDir(publicDir, destPublic);
  console.log("✓ Copied public directory to standalone output");
} else {
  console.log("⚠ public directory not found, skipping");
}
