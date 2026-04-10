/**
 * 后台脚本 - 微信读书导出扩展
 * MV3 service worker 版本
 */

import { syncAllBooksToDatabase } from "../utils/sync";

// 由于项目中未安装 @types/chrome，在此处做最小声明
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const AUTO_SYNC_STORAGE_KEY = "wereader_auto_sync_config";
const AUTO_SYNC_ALARM_NAME = "AUTO_SYNC_DB";

// 简单的内存存储（service worker 生命周期内有效）
let savedFileName: string | null = null;

/**
 * 恢复自动同步 alarm
 * 注意：只有 alarm 不存在时才创建，避免 Service Worker 每次重启都重置计时器
 */
async function restoreAutoSyncAlarm(): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.alarms) {
      return;
    }
    const res = await chrome.storage.local.get(AUTO_SYNC_STORAGE_KEY);
    const config = res[AUTO_SYNC_STORAGE_KEY];
    const existing = await chrome.alarms.get(AUTO_SYNC_ALARM_NAME);

    if (config && config.enabled && config.intervalHours > 0) {
      const periodInMinutes = Math.max(1, Math.round(config.intervalHours * 60));
      if (!existing) {
        await chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
          periodInMinutes,
        });
        console.log("[Background] 自动同步 alarm 已恢复，间隔:", periodInMinutes, "分钟");
      }
    } else {
      await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
    }
  } catch (e) {
    console.error("[Background] 恢复自动同步 alarm 失败:", e);
  }
}

/**
 * 发送同步结果桌面通知
 */
function notifySyncResult(title: string, message: string): void {
  try {
    if (typeof chrome !== "undefined" && chrome.notifications) {
      chrome.notifications.create("wxread-sync-result", {
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/48.png"),
        title,
        message,
      });
    }
  } catch (e) {
    console.error("[Background] 发送通知失败:", e);
  }
}

export default defineBackground(() => {
  console.log("[Background] 微信读书导出扩展后台脚本已启动");

  // 恢复自动同步 alarm
  restoreAutoSyncAlarm();

  // 监听来自 popup 的消息
  browser.runtime.onMessage.addListener(
    (request: any, sender: any, sendResponse: any) => {
      const { type, payload } = request;

      console.log("[Background] 收到消息:", type);

      (async () => {
        try {
          switch (type) {
            // 保存文件名（不是文件句柄，因为 service worker 无法序列化存储 FileSystemFileHandle）
            case "SAVE_FILE_NAME":
              if (payload?.name) {
                savedFileName = payload.name;
                console.log("[Background] 文件名已保存:", payload.name);
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: "缺少文件名" });
              }
              break;

            // 获取文件名
            case "GET_FILE_NAME":
              sendResponse({
                success: true,
                hasFile: !!savedFileName,
                name: savedFileName,
              });
              break;

            // 清除文件名
            case "CLEAR_FILE_NAME":
              savedFileName = null;
              console.log("[Background] 文件名已清除");
              sendResponse({ success: true });
              break;

            // 设置/清除自动同步 alarm
            case "SET_AUTO_SYNC":
              try {
                const { enabled, intervalHours } = payload || {};
                await chrome.storage.local.set({
                  [AUTO_SYNC_STORAGE_KEY]: { enabled: !!enabled, intervalHours: intervalHours || 24 },
                });
                if (enabled && intervalHours > 0) {
                  const periodInMinutes = Math.max(1, Math.round(intervalHours * 60));
                  await chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
                    periodInMinutes,
                  });
                  console.log("[Background] 自动同步 alarm 已设置，间隔:", periodInMinutes, "分钟");
                } else {
                  await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
                  console.log("[Background] 自动同步 alarm 已清除");
                }
                sendResponse({ success: true });
              } catch (e) {
                sendResponse({ success: false, error: String(e) });
              }
              break;

            default:
              sendResponse({
                success: false,
                error: "未知的消息类型: " + type,
              });
          }
        } catch (error) {
          console.error("[Background] 处理消息时出错:", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();

      // 返回 true 表示将异步发送响应
      return true;
    }
  );

  // 监听 alarm 事件，触发自动同步
  if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener(async (alarm: any) => {
      if (alarm.name !== AUTO_SYNC_ALARM_NAME) return;

      console.log("[Background] 自动同步 alarm 触发，开始执行数据库同步");

      try {
        const result = await syncAllBooksToDatabase();
        if (result.success) {
          const s = result.stats;
          let message = "";
          if (s) {
            const hasChanges = s.totalAdded > 0 || s.totalUpdated > 0 || s.totalRemoved > 0 || s.totalReviews > 0;
            if (hasChanges) {
              const details: string[] = [];
              if (s.totalAdded > 0) details.push(`新增 ${s.totalAdded} 条笔记`);
              if (s.totalUpdated > 0) details.push(`更新 ${s.totalUpdated} 条笔记`);
              if (s.totalRemoved > 0) details.push(`删除 ${s.totalRemoved} 条`);
              if (s.totalReviews > 0) details.push(`合并想法 ${s.totalReviews} 条`);
              message += `本次变更：涉及 ${s.changedBooks} 本书`;
              if (details.length > 0) message += `\n${details.join("，")}`;
            } else {
              message += "本次无新增变更，所有笔记已是最新。";
            }
            message += `\n数据库总计：${s.bookCount} 本书，${s.highlightCount} 条笔记。`;
          }
          console.log("[Background] 自动同步成功:\n", message);
          notifySyncResult("微信读书自动同步成功", message);
        } else {
          console.error("[Background] 自动同步失败:", result.message);
          notifySyncResult("微信读书自动同步失败", result.message);
        }
      } catch (e) {
        console.error("[Background] 自动同步异常:", e);
        notifySyncResult("微信读书自动同步失败", String(e));
      }
    });
  }

  // 监听扩展安装/更新事件
  browser.runtime.onInstalled.addListener((details: any) => {
    console.log("[Background] 扩展状态变化:", details.reason);
    if (details.reason === "install") {
      console.log("[Background] 扩展首次安装");
    } else if (details.reason === "update") {
      console.log("[Background] 扩展已更新");
      savedFileName = null;
    }
    // 安装/更新后恢复 alarm
    restoreAutoSyncAlarm();
  });

  // service worker 启动时恢复 alarm
  restoreAutoSyncAlarm();
});
