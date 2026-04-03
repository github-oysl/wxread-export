/**
 * 后台脚本 - 微信读书导出扩展
 * MV3 service worker 版本
 */

// 简单的内存存储（service worker 生命周期内有效）
let savedFileName: string | null = null;

export default defineBackground(() => {
  console.log('[Background] 微信读书导出扩展后台脚本已启动');

  // 监听来自 popup 的消息
  browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    const { type, payload } = request;

    console.log('[Background] 收到消息:', type);

    try {
      switch (type) {
        // 保存文件名（不是文件句柄，因为 service worker 无法序列化存储 FileSystemFileHandle）
        case 'SAVE_FILE_NAME':
          if (payload?.name) {
            savedFileName = payload.name;
            console.log('[Background] 文件名已保存:', payload.name);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: '缺少文件名' });
          }
          break;

        // 获取文件名
        case 'GET_FILE_NAME':
          sendResponse({
            success: true,
            hasFile: !!savedFileName,
            name: savedFileName
          });
          break;

        // 清除文件名
        case 'CLEAR_FILE_NAME':
          savedFileName = null;
          console.log('[Background] 文件名已清除');
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: '未知的消息类型: ' + type });
      }
    } catch (error) {
      console.error('[Background] 处理消息时出错:', error);
      sendResponse({ success: false, error: String(error) });
    }

    // 返回 true 表示将异步发送响应
    return true;
  });

  // 监听扩展安装/更新事件
  browser.runtime.onInstalled.addListener((details) => {
    console.log('[Background] 扩展状态变化:', details.reason);
    if (details.reason === 'install') {
      console.log('[Background] 扩展首次安装');
    } else if (details.reason === 'update') {
      console.log('[Background] 扩展已更新');
      savedFileName = null;
    }
  });
});
