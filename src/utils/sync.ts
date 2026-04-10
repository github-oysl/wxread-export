/**
 * S3 全量同步核心逻辑
 * 供 popup 手动触发和 background 定时触发共用
 */

import { initSqlite, getSyncKeyForApi } from "./db";

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
  const lastSyncKey = await getSyncKeyForApi(dbForSyncKey, userVidStr, book.bookId);
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
 * 同步所有书籍到数据库（PostgreSQL）
 * @returns 同步结果，包含增量统计
 */
export async function syncAllBooksToDatabase(): Promise<{
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

  // 2. 初始化 PostgREST 连接
  await initSqlite();

  // 3. 动态导入 db 模块
  const dbModule = await import("./db");

  // 4. 创建数据库连接（PostgREST 模式）
  const db = dbModule.createDatabase();
  console.log("[Sync] 已连接到 PostgREST 数据库");

  // 5. 获取 effectiveUserVid
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

  // 7. 并行获取所有书籍数据（提高速度）
  console.log(`[Sync] 开始并行获取 ${books.length} 本书的数据...`);
  const startTime = Date.now();

  // 先并行获取所有书籍数据（HTTP请求可以并行）
  const bookDataPromises = books.map(async (book, index) => {
    try {
      console.log(`[Sync] 获取第 ${index + 1}/${books.length} 本书数据:`, book.title);
      const data = await fetchBookData(book, effectiveUserVid, db);
      return { book, data, success: true, index };
    } catch (e) {
      console.error(`[Sync] 获取书籍数据失败 ${book.title}:`, e);
      return { book, data: null, success: false, index, error: e };
    }
  });

  const bookDataResults = await Promise.all(bookDataPromises);
  const fetchTime = Date.now() - startTime;
  console.log(`[Sync] 数据获取完成，耗时: ${fetchTime}ms`);

  // 8. 串行写入数据库（避免并发写入冲突）
  let successCount = 0;
  let failCount = 0;
  let changedBooks = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalReviews = 0;

  for (const result of bookDataResults) {
    if (!result.success) {
      failCount++;
      continue;
    }

    try {
      const { bookData, reviewData, progressInfo } = result.data;
      const bookStats = await dbModule.syncBookToDatabase(
        db,
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
      console.error(`[Sync] 同步书籍失败 ${result.book.title}:`, e);
      failCount++;
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`[Sync] 同步完成，总耗时: ${totalTime}ms`);

  // 8. （可选）上传到 S3 - 现在数据已直接保存到 PostgreSQL，S3 备份可选
  // const result = await exportToS3(s3Db, "全部笔记");

  // 9. 获取最终统计
  const stats = await dbModule.getUserSyncStats(db, effectiveUserVid);

  // 10. PostgREST 不需要关闭连接

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
  };
}

/**
 * 同步所有书籍到 S3（别名，保持向后兼容）
 * @deprecated 请使用 syncAllBooksToDatabase
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
  return syncAllBooksToDatabase();
}
