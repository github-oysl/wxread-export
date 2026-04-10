import { defineConfig } from "wxt";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import fs from "fs";
import path from "path";

// 修复 popup.html 中的路径问题
function fixPopupPaths(outDir: string) {
  try {
    const popupHtmlPath = path.join(outDir, "popup.html");
    if (fs.existsSync(popupHtmlPath)) {
      let content = fs.readFileSync(popupHtmlPath, "utf-8");
      // 将 ../../../ 替换为 ./
      content = content.replace(/"\.\.\/\.\.\/\.\.\//g, '"./');
      fs.writeFileSync(popupHtmlPath, content);
      console.log("[WXT] 已修复 popup.html 中的路径");
    }
  } catch (e) {
    console.error("[WXT] 修复路径失败:", e);
  }
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  hooks: {
    "build:done": (config, output) => {
      // 修复 popup.html 中的路径问题
      if (output && typeof output === "object") {
        const outDir = ".output/chrome-mv3";
        fixPopupPaths(outDir);
      }
    },
  },
  manifest: {
    name: "微信读书导出",
    homepage_url: "https://github.com/scarqin/wxread-export",
    permissions: ["storage", "cookies", "alarms", "notifications"],
    // 添加宽泛的 host_permissions，以支持用户配置的任意 S3 endpoint 和 PostgREST
    host_permissions: ["https://weread.qq.com/*", "https://*/*", "http://*/*"],
  },
  vite: (env) => ({
    // 使用相对路径，避免扩展中绝对路径问题
    base: env.mode === "development" ? "" : "./",
    resolve: {
      // 优先使用 browser 字段，确保 aws-sdk 和 sql.js 正确解析到浏览器版本
      mainFields: ["browser", "module", "main"],
    },
    plugins: [
      svelte({
        // Using a svelte.config.js file causes a segmentation fault when importing the file
        configFile: false,
        preprocess: [vitePreprocess()],
      }),
    ],
  }),
});
