import "./app.css";
import "mdui/dist/css/mdui.min.css";

// 在导入任何其他模块之前先添加错误处理
console.log("[Main] 脚本开始执行");

// 在最开始就添加全局错误处理
window.addEventListener('error', (event) => {
  console.error('[Main] 全局错误:', event.error);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div style="padding: 20px; color: #f44336; font-family: sans-serif; width: 520px; min-height: 400px;">
        <h3>发生错误</h3>
        <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px;">${event.error?.message || '未知错误'}\n${event.error?.stack || ''}</pre>
      </div>
    `;
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Main] 未处理的 Promise 拒绝:', event.reason);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `
      <div style="padding: 20px; color: #f44336; font-family: sans-serif; width: 520px; min-height: 400px;">
        <h3>Promise 错误</h3>
        <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px;">${event.reason?.message || String(event.reason)}\n${event.reason?.stack || ''}</pre>
      </div>
    `;
  }
});

// 主初始化函数
async function init() {
  console.log("[Main] 开始初始化...");

  try {
    // 动态导入 mdui JS，避免初始化错误
    let mdui: any = null;
    try {
      console.log("[Main] 导入 mdui JS...");
      const mduiModule = await import("mdui");
      mdui = mduiModule.default || mduiModule;
      console.log("[Main] mdui 导入成功:", mdui ? "已加载" : "未加载");
    } catch (mduiError) {
      console.warn("[Main] mdui 导入失败（非致命）:", mduiError);
    }

    // 导入 App 组件
    console.log("[Main] 导入 App.svelte...");
    const { default: App } = await import("./App.svelte");
    console.log("[Main] App.svelte 导入成功:", typeof App);

    const target = document.getElementById("app");
    console.log("[Main] 目标元素:", target);

    if (!target) {
      throw new Error("找不到 #app 元素");
    }

    console.log("[Main] 创建 Svelte 应用...");
    const app = new App({
      target: target,
    });

    console.log("[Main] Svelte 应用已挂载");

    // 导出到全局以便调试
    (window as any).__APP__ = app;

  } catch (error) {
    console.error("[Main] 初始化失败:", error);
    const appElement = document.getElementById('app');
    if (appElement) {
      appElement.innerHTML = `
        <div style="padding: 20px; color: #f44336; font-family: sans-serif; width: 520px; min-height: 400px;">
          <h3>初始化失败</h3>
          <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px;">${error instanceof Error ? error.message : String(error)}\n${error instanceof Error ? error.stack : ''}</pre>
        </div>
      `;
    }
  }
}

// 启动初始化
init();
