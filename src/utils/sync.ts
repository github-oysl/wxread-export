/**
 * S3 全量同步核心逻辑
 * 供 popup 手动触发和 background 定时触发共用
 */

import { initSqlite, getSyncKeyForApi } from "./db";
import { isS3Configured, getS3Config, downloadFromS3, exportToS3 } from "./s3";

/**
 * 从 weread.qq.com 的 cookie 中读取 wr_vid 作为固定用户 ID
 */
export function getWrVidFromCookie() {
  return new Promise<string | null>((resolve) => {
    try {
      // @ts-ignore - chrome.cookies 在声明 cookies 权限后可用
      if (typeof chrome !== "undefined" && chrome.cookies && chrome.cookies.get) {
        // @ts-ignore
        chrome.cookies.get(
          { url: "https://weread.qq.com", name: "wr_vid" },
          (cookie: any) => {
            if (cookie && cookie.value) {
              console.log("[Sync] 从 cookie 获取 wr_vid:", cookie.value);
              resolve(cookie.value);
            } else {
              resolve(null);
            }
          }
        );
      } else {
        resolve(null);
      }
    } catch (e) {
      console.error("[Sync] 读取 cookie 失败:", e);
      resolve(null);
    }
  });
}

/**
 * 获取单本书的同步数据
 */
export async function fetchBookData(book: any, userVidStr: string, dbForSyncKey: any) {
  const lastSyncKey = getSyncKeyForApi(dbForSyncKey, userVidStr, book.bookId);
  const [markData, reviewData, progressData] = await Promise.all([
    fetch(
      `https://weread.qq.com/web/book/bookmarklist?bookId=${book.bookId}&synckey=${lastSyncKey}`
    ).then((resp) => resp.json()),
    fetch(
      `https://weread.qq.com/web/review/list?bookId=${book.bookId}&mine=1&listType=11&maxIdx=0&count=0&listMode=2&synckey=0&userVid=${userVidStr}`
    ).then((resp) => resp.json()),
    fetch(
      `https://weread.qq.com/web/book/getProgress?bookId=${book.bookId}`
    ).then((resp) => resp.json()),
  ]);

  const bookData = {
    book: {
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      cover: book.cover,
      format: book.format || "epub",
    },
    chapters: markData.chapters || [],
    updated: markData.updated || markData.marks || [],
    removed: markData.removed || [],
    synckey: markData.synckey || lastSyncKey + 1,
  };

  const progressInfo = progressData.book
    ? {
        readingTime: progressData.book.readingTime,
        startReadingTime: progressData.book.startReadingTime,
        finishTime: progressData.book.finishTime,
      }
    : undefined;

  return {
    bookData,
    reviewData: reviewData || { reviews: [] },
    progressInfo,
    markData,
  };
}

/**
 * 同步所有书籍到 S3
 * @returns 同步结果，包含增量统计
 */
export async function syncAllBooksToS3(): Promise<{
  success: boolean;
  message: string;
  stats?: {
    bookCount: number;
    highlightCount: number;
    successCount: number;
    failCount: number;
    changedBooks: number;
    totalAdded: number;
    totalUpdated: number;
    totalRemoved: number;
    totalReviews: number;
  };
  url?: string;
}> {
  // 1. 获取书籍列表
  const notebookRes = await fetch("https://weread.qq.com/api/user/notebook");
  const notebookData = await notebookRes.json();
  const books = notebookData.books.map((val: any) => val.book) as any[];

  if (books.length === 0) {
    return { success: false, message: "暂无书籍可导出" };
  }

  // 2. 检查 S3 配置
  const useS3 = await isS3Configured();
  if (!useS3) {
    return { success: false, message: "S3 未配置" };
  }

  // 3. 初始化 sql.js
  await initSqlite();

  // 4. 动态导入 db 模块（浏览器扩展中 sql.js 是动态的）
  const dbModule = await import("./db");

  // 5. 尝试从 S3 下载现有数据库
  let s3Db: any = null;
  const s3Config = await getS3Config();
  if (s3Config) {
    try {
      const existingData = await downloadFromS3(s3Config);
      if (existingData) {
        s3Db = dbModule.loadDatabase(existingData);
        console.log("[Sync] 已从 S3 加载现有数据库，大小:", existingData.byteLength, "字节");
      }
    } catch (e) {
      console.log("[Sync] 从 S3 下载数据库失败，将创建新数据库:", e);
    }
  }

  if (!s3Db) {
    s3Db = dbModule.createDatabase();
    console.log("[Sync] 创建了新的数据库用于 S3 导出");
  }

  // 6. 获取 effectiveUserVid
  let effectiveUserVid = await getWrVidFromCookie();
  if (!effectiveUserVid) {
    effectiveUserVid =
      notebookData.userVid ||
      notebookData.vid ||
      notebookData.books?.[0]?.userVid ||
      notebookData.books?.[0]?.vid ||
      "";
    if (effectiveUserVid) {
      effectiveUserVid = String(effectiveUserVid);
    }
  }
  if (!effectiveUserVid && books.length > 0) {
    const firstMark = await fetch(
      `https://weread.qq.com/web/book/bookmarklist?bookId=${books[0].bookId}&synckey=0`
    ).then((r) => r.json());
    effectiveUserVid = firstMark?.userVid || firstMark?.user?.vid || "";
  }
  if (!effectiveUserVid) {
    effectiveUserVid = "unknown_user";
  }

  // 7. 遍历所有书籍，逐本同步并统计精确增量
  let successCount = 0;
  let failCount = 0;
  let changedBooks = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalReviews = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    try {
      console.log(`[Sync] 同步第 ${i + 1}/${books.length} 本书:`, book.title);
      const { bookData, reviewData, progressInfo } = await fetchBookData(
        book,
        effectiveUserVid,
        s3Db
      );
      const bookStats = dbModule.syncBookToDatabase(
        s3Db,
        effectiveUserVid,
        bookData,
        reviewData,
        progressInfo
      );
      successCount++;

      totalAdded += bookStats.highlightsAdded;
      totalUpdated += bookStats.highlightsUpdated;
      totalRemoved += bookStats.highlightsRemoved;
      totalReviews += bookStats.reviewsMerged;

      if (
        bookStats.highlightsAdded +
        bookStats.highlightsUpdated +
        bookStats.highlightsRemoved +
        bookStats.reviewsMerged >
        0
      ) {
        changedBooks++;
      }
    } catch (e) {
      console.error(`[Sync] 同步书籍失败 ${book.title}:`, e);
      failCount++;
    }
  }

  // 8. 上传到 S3
  const result = await exportToS3(s3Db, "全部笔记");

  // 9. 获取最终统计
  const stats = dbModule.getUserSyncStats(s3Db, effectiveUserVid);

  // 10. 关闭数据库
  s3Db.close();

  if (!result.success) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    message: "同步完成",
    stats: {
      bookCount: stats.bookCount,
      highlightCount: stats.highlightCount,
      successCount,
      failCount,
      changedBooks,
      totalAdded,
      totalUpdated,
      totalRemoved,
      totalReviews,
    },
    url: result.url,
  };
}
