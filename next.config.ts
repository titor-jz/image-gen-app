import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electron 版依赖 .next/standalone/server.js 启动内置 Next 服务。
  // standalone 只在桌面构建时启用（package.json 的 electron 脚本通过
  // NEXT_OUTPUT 注入），Vercel / Cloudflare (OpenNext) 保持默认输出。
  ...(process.env.NEXT_OUTPUT
    ? { output: process.env.NEXT_OUTPUT as NextConfig["output"] }
    : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
