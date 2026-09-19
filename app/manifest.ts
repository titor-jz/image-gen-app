import type { MetadataRoute } from "next";

// PWA manifest：Android Chrome「添加到主屏幕」依赖此文件。
// 图标为全出血设计并声明 any maskable：同一份图同时充当常规图标与
// 自适应图标（glyph 居中于安全区，启动器圆形裁切不切边）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Image Gen",
    short_name: "AI 生图",
    description: "Personal AI image generation tool powered by GPT-Image2",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // 应用默认亮色主题（Header.getInitialTheme 兜底 light），启动屏按亮色取值
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
