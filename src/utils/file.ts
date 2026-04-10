/**
 * 文件管理模块（兼容层）
 * 原用于 SQLite 本地文件操作，现改为 PostgREST 兼容层
 * 数据直接通过 HTTP API 保存到 PostgreSQL，不再需要本地文件操作
 */

import {
  initSqlite,
  createDatabase,
  loadDatabase,
  exportDatabase,
  syncBookToDatabase,
  getLastSyncState,
  getUserSyncStats,
  getAllBooks,
  getHighlightsByBook
} from "./db";

// 存储文件句柄的 key（保留用于向后兼容）
const STORAGE_KEY_FILE_NAME = "wereader_db_file_name";

// 虚拟文件句柄（兼容层）
interface VirtualFileHandle {
  name: string;
  virtual: true;
}

/**
 * 与 Background Script 通信：保存文件名（兼容层，不再实际使用）
 */
async function saveFileNameToBackground(name: string): Promise<void> {
  // PostgREST 模式下不再需要
  console.log("[File] saveFileNameToBackground (兼容层):", name);
}

/**
 * 与 Background Script 通信：获取文件名（兼容层）
 */
async function getFileNameFromBackground(): Promise<{
  name?: string;
  hasFile?: boolean;
} | null> {
  // PostgREST 模式下始终返回有文件
  return { name: "postgrest", hasFile: true };
}

/**
 * 与 Background Script 通信：检查文件状态（兼容层）
 */
async function checkFileInBackground(): Promise<boolean> {
  // PostgREST 模式下始终返回 true
  return true;
}

/**
 * 检查 File System Access API 是否可用（兼容层，始终返回 false）
 */
export function isFileSystemAccessSupported(): boolean {
  // PostgREST 模式下不需要本地文件系统
  return false;
}

/**
 * 首次使用：创建数据库连接（兼容层）
 * @returns 虚拟文件句柄和数据库实例
 */
export async function createNewDatabaseFile(): Promise<{
  fileHandle: VirtualFileHandle;
  db: any;
}> {
  console.log("[createNewDatabaseFile] 初始化 PostgREST 连接...");

  // 初始化 PostgREST
  await initSqlite();

  // 创建虚拟数据库连接
  const db = createDatabase();

  console.log("[createNewDatabaseFile] PostgREST 连接完成");
  return { fileHandle: { name: "postgrest", virtual: true }, db };
}

/**
 * 打开已存在的数据库连接（兼容层）
 * @returns 虚拟文件句柄和数据库实例
 */
export async function openExistingDatabase(): Promise<{
  fileHandle: VirtualFileHandle;
  db: any;
} | null> {
  try {
    return await requestFileAccess();
  } catch (error) {
    console.error("打开数据库连接失败:", error);
    return null;
  }
}

/**
 * 请求数据库访问（兼容层）
 * @returns 虚拟文件句柄和数据库实例
 */
export async function requestFileAccess(): Promise<{
  fileHandle: VirtualFileHandle;
  db: any;
}> {
  console.log("[requestFileAccess] 连接到 PostgREST...");

  // 初始化 PostgREST
  await initSqlite();

  // 创建虚拟数据库连接
  const db = createDatabase();

  console.log("[requestFileAccess] PostgREST 连接完成");
  return { fileHandle: { name: "postgrest", virtual: true }, db };
}

/**
 * 保存数据库到文件（兼容层，PostgREST 模式下无操作）
 */
export async function saveDatabaseToFile(
  fileHandle: VirtualFileHandle,
  db: any
): Promise<void> {
  // PostgREST 模式下数据已通过 HTTP API 保存，无需本地文件操作
  console.log("[saveDatabaseToFile] PostgREST 模式，跳过本地文件保存");
}

/**
 * 安全获取 browser.storage API（兼容层）
 */
function getStorage() {
  if (typeof browser === "undefined" || !browser.storage) {
    // PostgREST 模式下返回空存储对象
    return {
      set: async () => {},
      get: async () => ({}),
      remove: async () => {},
    } as any;
  }
  return browser.storage.local;
}

/**
 * 保存文件句柄信息到 extension storage（兼容层）
 */
async function saveFileHandleInfo(fileName: string): Promise<void> {
  // PostgREST 模式下不再需要保存文件信息
  console.log("[saveFileHandleInfo] PostgREST 模式，跳过保存:", fileName);
}

/**
 * 获取保存的文件句柄信息（兼容层）
 */
async function getFileHandleInfo(): Promise<{ name: string } | null> {
  // PostgREST 模式下始终返回虚拟文件信息
  return { name: "postgrest" };
}

/**
 * 清除保存的文件句柄信息（兼容层）
 */
export async function clearFileHandleInfo(): Promise<void> {
  // PostgREST 模式下无需清除
  console.log("[clearFileHandleInfo] PostgREST 模式，无需清除");
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
    let fileHandle: VirtualFileHandle;
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
    await syncBookToDatabase(db, userVid, bookData, reviewData, progressData);
    console.log("[exportToSQLite] 数据同步完成");

    // 获取统计信息
    const stats = await getUserSyncStats(db, userVid);

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
 * 降级方案：生成 SQLite 文件下载（兼容层）
 * PostgREST 模式下导出为 JSON 格式
 */
export async function downloadDatabaseFile(db: any, filename: string, userVid?: string): Promise<void> {
  // PostgREST 模式下导出 JSON 数据
  if (userVid) {
    const books = await getAllBooks(db);
    const highlights = await getHighlightsByBook(db, userVid, "all");
    const exportData = {
      exportDate: new Date().toISOString(),
      userVid,
      books,
      highlights,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(".db", ".json");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    // 无 userVid 时导出空文件提示
    const blob = new Blob(["PostgREST 模式需要 userVid 参数才能导出数据"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(".db", ".txt");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * 获取 API 调用所需的 synckey
 * @param db 数据库实例（如果为 null 则返回 0）
 * @param userVid 用户 ID
 * @param bookId 书籍 ID
 * @returns synckey
 */
export async function getSyncKeyForApi(
  db: any | null,
  userVid: string,
  bookId: string
): Promise<number> {
  if (!db) {
    return 0;
  }
  const state = await getLastSyncState(db, userVid, bookId);
  return state?.syncKey || 0;
}
