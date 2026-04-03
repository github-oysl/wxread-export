/**
 * 文件管理模块
 * 处理数据库文件的保存、读取和权限管理
 * 使用 File System Access API 实现文件自动管理
 */

import {
  initSqlite,
  createDatabase,
  loadDatabase,
  exportDatabase,
  syncBookToDatabase,
  getLastSyncState,
  getUserSyncStats
} from "./db";

// 存储文件句柄的 key
const STORAGE_KEY_FILE_NAME = "wereader_db_file_name";

// 文件句柄存储接口
interface FileHandleData {
  name: string;
  // FileSystemFileHandle 无法直接序列化存储
  // 我们存储文件名，用户每次需要重新选择文件（如果权限过期）
}

/**
 * 与 Background Script 通信：保存文件名
 */
async function saveFileNameToBackground(name: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'SAVE_FILE_NAME',
      payload: { name }
    });
  } catch (error) {
    console.warn('[File] 保存文件名到 background 失败:', error);
  }
}

/**
 * 与 Background Script 通信：获取文件名
 */
async function getFileNameFromBackground(): Promise<{
  name?: string;
  hasFile?: boolean;
} | null> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_FILE_NAME'
    });
    if (response?.success) {
      return {
        name: response.name,
        hasFile: response.hasFile
      };
    }
    return null;
  } catch (error) {
    console.warn('[File] 从 background 获取文件名失败:', error);
    return null;
  }
}

/**
 * 与 Background Script 通信：检查文件状态
 */
async function checkFileInBackground(): Promise<boolean> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_FILE_NAME'
    });
    return response?.hasFile || false;
  } catch (error) {
    console.warn('[File] 检查 background 文件状态失败:', error);
    return false;
  }
}

/**
 * 检查 File System Access API 是否可用
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/**
 * 首次使用：选择保存位置并创建数据库文件
 * @returns 文件句柄和数据库实例
 */
export async function createNewDatabaseFile(): Promise<{
  fileHandle: FileSystemFileHandle;
  db: any;
}> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("您的浏览器不支持文件系统访问 API，请使用 Chrome 或 Edge 浏览器");
  }

  console.log("[createNewDatabaseFile] 开始初始化 sql.js...");

  // 等待 sql.js 初始化
  await initSqlite();

  console.log("[createNewDatabaseFile] sql.js 初始化完成，显示文件选择器...");

  // 显示保存文件选择器
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await (window as any).showSaveFilePicker({
      suggestedName: "wereader_notes.db",
      types: [
        {
          description: "SQLite 数据库文件",
          accept: {
            "application/x-sqlite3": [".db", ".sqlite", ".sqlite3"],
            "application/octet-stream": [".db"],
          },
        },
      ],
    });
  } catch (pickerError) {
    // 用户取消或其他选择器错误
    console.log("[createNewDatabaseFile] 文件选择器错误:", pickerError);
    if (pickerError instanceof Error && pickerError.name === "AbortError") {
      throw new Error("用户取消了文件保存对话框");
    }
    throw pickerError;
  }

  console.log("[createNewDatabaseFile] 用户选择文件:", fileHandle.name);

  // 创建新数据库
  console.log("[createNewDatabaseFile] 创建数据库...");
  const db = createDatabase();

  // 保存文件句柄信息到 extension storage
  console.log("[createNewDatabaseFile] 保存文件句柄信息...");
  await saveFileHandleInfo(fileHandle.name);

  // 保存文件名到 background script（内存中保持）
  console.log("[createNewDatabaseFile] 保存文件名到 background...");
  await saveFileNameToBackground(fileHandle.name);

  // 保存数据库到文件
  console.log("[createNewDatabaseFile] 保存数据库到文件...");
  await saveDatabaseToFile(fileHandle, db);

  console.log("[createNewDatabaseFile] 完成");
  return { fileHandle, db };
}

/**
 * 打开已存在的数据库文件
 * @returns 文件句柄和数据库实例，如果没有保存的文件则返回 null
 */
export async function openExistingDatabase(): Promise<{
  fileHandle: FileSystemFileHandle;
  db: any;
} | null> {
  if (!isFileSystemAccessSupported()) {
    return null;
  }

  // 检查 storage 中是否有保存的文件名
  const fileInfo = await getFileHandleInfo();
  if (!fileInfo) {
    return null;
  }

  try {
    // 需要用户重新选择文件
    return await requestFileAccess();
  } catch (error) {
    console.error("打开数据库文件失败:", error);
    return null;
  }
}

/**
 * 请求用户选择已有的数据库文件
 * @returns 文件句柄和数据库实例
 */
export async function requestFileAccess(): Promise<{
  fileHandle: FileSystemFileHandle;
  db: any;
}> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("您的浏览器不支持文件系统访问 API");
  }

  // 等待 sql.js 初始化
  await initSqlite();

  // 显示打开文件选择器
  const [fileHandle] = await (window as any).showOpenFilePicker({
    types: [
      {
        description: "SQLite 数据库文件",
        accept: {
          "application/x-sqlite3": [".db", ".sqlite", ".sqlite3"],
          "application/octet-stream": [".db"],
        },
      },
    ],
    multiple: false,
  });

  // 读取文件内容
  const file = await fileHandle.getFile();
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 加载数据库
  const db = loadDatabase(uint8Array);

  // 保存文件句柄信息
  await saveFileHandleInfo(fileHandle.name);

  // 保存文件名到 background script
  await saveFileNameToBackground(fileHandle.name);

  return { fileHandle, db };
}

/**
 * 保存数据库到文件
 */
export async function saveDatabaseToFile(
  fileHandle: FileSystemFileHandle,
  db: any
): Promise<void> {
  // 请求写入权限
  const writable = await fileHandle.createWritable();

  try {
    // 导出数据库
    const data = exportDatabase(db);

    // 写入文件（将 Uint8Array 转换为 ArrayBuffer）
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await writable.write(buffer);
  } finally {
    // 关闭写入流
    await writable.close();
  }
}

/**
 * 安全获取 browser.storage API
 */
function getStorage() {
  if (typeof browser === "undefined" || !browser.storage) {
    throw new Error("Browser storage API 不可用，请确保在扩展环境中运行");
  }
  return browser.storage.local;
}

/**
 * 保存文件句柄信息到 extension storage
 */
async function saveFileHandleInfo(fileName: string): Promise<void> {
  const storage = getStorage();
  await storage.set({
    [STORAGE_KEY_FILE_NAME]: fileName,
  });
}

/**
 * 获取保存的文件句柄信息
 */
async function getFileHandleInfo(): Promise<FileHandleData | null> {
  const storage = getStorage();
  const result = await storage.get(STORAGE_KEY_FILE_NAME);
  const fileName = result[STORAGE_KEY_FILE_NAME];
  if (!fileName || typeof fileName !== "string") {
    return null;
  }
  return {
    name: fileName,
  };
}

/**
 * 清除保存的文件句柄信息
 */
export async function clearFileHandleInfo(): Promise<void> {
  const storage = getStorage();
  await storage.remove([STORAGE_KEY_FILE_NAME]);
}

/**
 * 导出数据到 SQLite 数据库的完整流程
 * @param userVid 用户 ID
 * @param bookData 书籍数据
 * @param reviewData 评论数据
 * @param progressData 进度数据
 * @param isFirstTime 是否首次导出
 */
export async function exportToSQLite(
  userVid: string,
  bookData: {
    book: {
      bookId: string;
      title: string;
      author: string;
      cover: string;
      format: string;
    };
    chapters: Array<{
      chapterUid: number;
      chapterIdx: number;
      title: string;
    }>;
    updated: Array<{
      chapterUid: number;
      range: string;
      markText: string;
      style?: number;
      type?: number;
      createTime?: number;
    }>;
    removed?: Array<{
      chapterUid: number;
      range: string;
    }>;
    synckey: number;
  },
  reviewData: {
    reviews: Array<{
      review: {
        chapterUid: number;
        chapterTitle?: string;
        content: string;
        abstract?: string;
        range: string;
      };
    }>;
  },
  progressData?: {
    readingTime?: number;
    startReadingTime?: number;
    finishTime?: number;
  },
  isFirstTime: boolean = false
): Promise<{
  success: boolean;
  message: string;
  stats?: {
    bookCount: number;
    highlightCount: number;
    lastSyncAt: string | null;
  };
}> {
  try {
    let fileHandle: FileSystemFileHandle;
    let db: any;

    if (isFirstTime || !(await getFileHandleInfo())) {
      // 首次使用：创建新文件
      const result = await createNewDatabaseFile();
      fileHandle = result.fileHandle;
      db = result.db;
    } else {
      // 尝试打开已有文件
      const existing = await openExistingDatabase();
      if (existing) {
        fileHandle = existing.fileHandle;
        db = existing.db;
      } else {
        // 如果无法打开（权限过期等），引导用户重新选择
        const result = await requestFileAccess();
        fileHandle = result.fileHandle;
        db = result.db;
      }
    }

    // 同步数据到数据库
    console.log("[exportToSQLite] 开始同步数据...");
    syncBookToDatabase(db, userVid, bookData, reviewData, progressData);
    console.log("[exportToSQLite] 数据同步完成");

    // 保存到文件
    console.log("[exportToSQLite] 保存到文件...");
    await saveDatabaseToFile(fileHandle, db);
    console.log("[exportToSQLite] 文件保存完成");

    // 获取统计信息
    const stats = getUserSyncStats(db, userVid);

    // 清理资源
    db.close();

    return {
      success: true,
      message: `成功导出到数据库：${bookData.book.title}`,
      stats,
    };
  } catch (error) {
    console.error("导出到数据库失败:", error);

    // 增强错误信息提取，处理非标准错误类型
    let errorDetails: string;
    try {
      if (error instanceof Error) {
        errorDetails = `${error.message}\n${error.stack || ""}`;
      } else if (typeof error === "string") {
        errorDetails = error;
      } else if (error && typeof error === "object") {
        errorDetails = `非标准错误对象: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`;
      } else {
        errorDetails = `未知错误类型: ${String(error)}`;
      }
    } catch (e) {
      errorDetails = `无法序列化错误: ${String(error)}`;
    }

    return {
      success: false,
      message: `导出失败详情:\n${errorDetails}`,
    };
  }
}

/**
 * 降级方案：生成 SQL 文件下载
 * 当 File System Access API 不可用时使用
 */
export function downloadSqlFile(sqlContent: string, filename: string): void {
  const blob = new Blob([sqlContent], { type: "text/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * 降级方案：生成 SQLite 文件下载
 * 当 File System Access API 不可用时使用
 */
export function downloadDatabaseFile(db: any, filename: string): void {
  const data = exportDatabase(db);
  // 将 Uint8Array 转换为 ArrayBuffer 以兼容 Blob
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * 获取 API 调用所需的 synckey
 * @param db 数据库实例（如果为 null 则返回 0）
 * @param userVid 用户 ID
 * @param bookId 书籍 ID
 * @returns synckey
 */
export function getSyncKeyForApi(
  db: any | null,
  userVid: string,
  bookId: string
): number {
  if (!db) {
    return 0;
  }
  const state = getLastSyncState(db, userVid, bookId);
  return state?.syncKey || 0;
}
