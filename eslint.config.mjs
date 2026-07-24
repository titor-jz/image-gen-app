import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron 主进程/preload 与构建脚本运行在 Node CommonJS 上下文，
    // 必须使用 require()，ESM 规则 @typescript-eslint/no-require-imports 不适用
    "electron/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
