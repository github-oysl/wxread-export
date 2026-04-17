/**
 * 同步核心逻辑
 * 供 popup 手动触发和 background 定时触发共用
 */

import { initSqlite, getSyncKeyForApi } from "./db";

const CACHED_USER_VID_KEY = "wereader_cached_user_vid";

/**
 * 从扩展存储中读取缓存的 userVid
 */
async function getCachedUserVid(): Promise<string | null> {
  try {
    if (typeof browser !== "undefined" && browser.storage) {
      const res = await browser.storage.local.get(CACHED_USER_VID_KEY);
      const cached = res[CACHED_USER_VID_KEY];
      if (cached) {
        console.log("[Sync] 从缓存读取 userVid:", cached);
        return String(cached);
      }
    }
  } catch (e) {
    console.error("[Sync] 读取缓存 userVid 失败:", e);
  }
  return null;
}

/**
 * 将 userVid 写入扩展存储缓存
 */
async function setCachedUserVid(userVid: string): Promise<void> {
  try {
    if (typeof browser !== "undefined" && browser.storage) {
      await browser.storage.local.set({ [CACHED_USER_VID_KEY]: userVid });
      console.log("[Sync] 已缓存 userVid:", userVid);
    }
  } catch (e) {
    console.error("[Sync] 缓存 userVid 失败:", e);
  }
}

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
 * 统一解析 effectiveUserVid
 * 优先读取缓存，其次 cookie，再次 notebookData，必要时请求第一本书的 bookmarklist
 */
export async function resolveEffectiveUserVid(notebookData?: any): Promise<string> {
  // 1. 优先读取缓存
  let userVid = await getCachedUserVid();
  if (userVid) {
    return userVid;
  }

  // 2. 尝试 cookie
  userVid = await getWrVidFromCookie();
  if (userVid) {
    await setCachedUserVid(userVid);
    return userVid;
  }

  // 3. 从 notebookData 回退提取
  if (notebookData) {
    userVid =
      notebookData.userVid ||
      notebookData.vid ||
      notebookData.books?.[0]?.userVid ||
      notebookData.books?.[0]?.vid ||
      "";
    if (userVid) {
      userVid = String(userVid);
      await setCachedUserVid(userVid);
      return userVid;
    }
  }

  // 4. 如果提供了 books 列表，请求第一本书的 bookmarklist 提取 userVid
  const books = notebookData?.books?.map((val: any) => val.book) as any[];
  if (books && books.length > 0) {
    try {
      const firstMark = await fetch(
        `https://weread.qq.com/web/book/bookmarklist?bookId=${books[0].bookId}&synckey=0`
      ).then((r) => r.json());
      userVid = firstMark?.userVid || firstMark?.user?.vid || "";
      if (userVid) {
        userVid = String(userVid);
        await setCachedUserVid(userVid);
        return userVid;
      }
    } catch (e) {
      console.error("[Sync] 从 bookmarklist 提取 userVid 失败:", e);
    }
  }

  // 5. 兜底
  return "unknown_user";
}

/**
 * 获取单本书的同步数据
 */
export async function fetchBookData(book: any, userVidStr: string, dbForSyncKey: any) {
  const lastSyncKey = await getSyncKeyForApi(dbForSyncKey, userVidStr, book.bookId);

  console.log(
    `[fetchBookData] userVid=${userVidStr}, bookId=${book.bookId}, lastSyncKey=${lastSyncKey}`
  );

  const [markData, reviewData, progressData] = await Promise.all([
    fetch(
      `https://weread.qq.com/web/book/bookmarklist?bookId=${book.bookId}&synckey=${lastSyncKey}`
    ).then((resp) => resp.json()),
    fetch(
      `https://weread.qq.com/web/review/list?bookId=${book.bookId}&mine=1&listType=11&maxIdx=0&count=0&listMode=2&synckey=${lastSyncKey}&userVid=${userVidStr}`
    ).then((resp) => resp.json()),
    fetch(
      `https://weread.qq.com/web/book/getProgress?bookId=${book.bookId}`
    ).then((resp) => resp.json()),
  ]);

  // 防御性字段探测：优先使用 synckey，其次 syncKey
  const apiSyncKey = markData.synckey ?? markData.syncKey;
  const resolvedSyncKey = apiSyncKey ?? lastSyncKey + 1;

  console.log(
    `[fetchBookData] API返回 synckey=${apiSyncKey}, resolvedSyncKey=${resolvedSyncKey}, updated=${(markData.updated || markData.marks || []).length}, removed=${(markData.removed || []).length}`
  );

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
    synckey: resolvedSyncKey,
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
 * 同步单本书到数据库
 * 如果未传入 db/dbModule/effectiveUserVid，则自动初始化
 */
export async function syncSingleBookToDatabase(
  book: any,
  effectiveUserVid?: string,
  db?: any,
  dbModule?: any
): Promise<{
  success: boolean;
  stats?: {
    highlightsAdded: number;
    highlightsUpdated: number;
    highlightsRemoved: number;
    reviewsMerged: number;
  };
  message?: string;
}> {
  let localDb = db;
  let localDbModule = dbModule;
  let localUserVid: string | null | undefined = effectiveUserVid;

  // 自动初始化数据库连接
  if (!localDb || !localDbModule) {
    await initSqlite();
    localDbModule = await import("./db");
    localDb = await localDbModule.createDatabase();
  }

  // 自动解析 userVid（统一入口）
  if (!localUserVid) {
    localUserVid = await resolveEffectiveUserVid();
  }

  if (!localUserVid) {
    localUserVid = "unknown_user";
  }

  try {
    const data = await fetchBookData(book, localUserVid, localDb);
    const stats = await localDbModule.syncBookToDatabase(
      localDb,
      localUserVid,
      data.bookData,
      data.reviewData,
      data.progressInfo
    );
    return { success: true, stats };
  } catch (e) {
    console.error(`[syncSingleBookToDatabase] 同步失败 ${book.title}:`, e);
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
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
  const db = await dbModule.createDatabase();
  console.log("[Sync] 已连接到 PostgREST 数据库");

  // 5. 统一获取 effectiveUserVid
  const effectiveUserVid = await resolveEffectiveUserVid(notebookData);

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
      if (!result.data) {
        failCount++;
        continue;
      }
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
