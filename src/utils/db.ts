/**
 * SQLite 数据库操作模块
 * 使用 sql.js 实现浏览器端的 SQLite 功能
 */

// 使用默认导入，让 Vite 根据 sql.js 的 exports.browser 解析到浏览器专用版本
import initSqlJs from "sql.js";

/**
 * 安全获取 wasm 文件 URL
 */
function getWasmUrl(): string {
  // 在 WXT 环境中使用 import.meta.env
  // 使用相对路径，WXT 会在构建时处理
  return "/assets/sql-wasm.wasm";
}

// 数据库表结构初始化 SQL
const INIT_TABLES_SQL = `
-- 1. users - 用户表（解决多账号切换问题）
CREATE TABLE IF NOT EXISTS users (
  user_vid TEXT PRIMARY KEY,
  user_name TEXT,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. books - 书籍元数据
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  format TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. chapters - 章节信息
CREATE TABLE IF NOT EXISTS chapters (
  book_id TEXT,
  chapter_uid INTEGER,
  chapter_idx INTEGER,
  title TEXT,
  PRIMARY KEY (book_id, chapter_uid)
);

-- 4. highlights - 划线/笔记（含用户隔离）
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_vid TEXT NOT NULL,
  bookmark_id TEXT,
  book_id TEXT NOT NULL,
  chapter_uid INTEGER,
  chapter_title TEXT,
  range TEXT,
  mark_text TEXT,
  note_text TEXT,
  style INTEGER,
  type INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(user_vid, bookmark_id)
);
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_vid);
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_vid, book_id);

-- 5. sync_state - 同步状态（按用户+书籍隔离）
CREATE TABLE IF NOT EXISTS sync_state (
  user_vid TEXT,
  book_id TEXT,
  sync_key INTEGER,
  last_sync_at TIMESTAMP,
  reading_time INTEGER,
  start_reading_at TIMESTAMP,
  finish_reading_at TIMESTAMP,
  PRIMARY KEY (user_vid, book_id)
);
`;

// SQL.js 实例
let SQL: any = null;

/**
 * 初始化 SQL.js
 */
export async function initSqlite(): Promise<void> {
  if (SQL) return;

  const errors: string[] = [];

  // 方法1: 使用 chrome.runtime.getURL
  try {
    const url = getWasmUrl();
    console.log("[SQL.js] 方法1: 使用 runtime URL:", url);
    SQL = await initSqlJs({
      locateFile: () => url,
    });
    console.log("[SQL.js] 使用 runtime URL 初始化成功");
    return;
  } catch (error) {
    console.error("[SQL.js] 方法1 失败:", error);
    errors.push(`方法1 (runtime URL): ${error instanceof Error ? error.message : String(error)}`);
  }

  // 方法2: 使用动态文件名映射
  try {
    console.log("[SQL.js] 方法2: 使用 runtime URL 映射");

    // 首先检查 browser API 是否可用
    if (typeof browser === "undefined" || !browser.runtime) {
      throw new Error("Browser runtime API 不可用");
    }

    SQL = await initSqlJs({
      locateFile: (file: string) => {
        // sql.js 默认会查找 sql-wasm-browser.wasm，但我们只有 sql-wasm.wasm
        // 所以将任何 wasm 文件名映射到我们的标准文件
        const targetFile = file.includes("browser")
          ? "sql-wasm.wasm"
          : file;
        // 使用相对路径
        const url = `/assets/${targetFile}`;
        console.log("[SQL.js] locateFile:", file, "->", url);
        return url;
      },
    });
    console.log("[SQL.js] 使用 runtime URL 初始化成功");
    return;
  } catch (error) {
    console.error("[SQL.js] 方法2 失败:", error);
    errors.push(`方法2 (runtime URL): ${error instanceof Error ? error.message : String(error)}`);
  }

  // 方法3: 手动 fetch 然后使用二进制初始化
  try {
    // 检查 browser API 是否可用
    if (typeof browser === "undefined" || !browser.runtime) {
      throw new Error("Browser runtime API 不可用");
    }
    // 使用相对路径
    const fetchUrl = "/assets/sql-wasm.wasm";
    console.log("[SQL.js] 方法3: 手动 fetch:", fetchUrl);

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const wasmBinary = await response.arrayBuffer();
    console.log("[SQL.js] Wasm 文件大小:", wasmBinary.byteLength);

    // sql.js 1.14+ 支持通过 wasmBinary 参数传入
    SQL = await initSqlJs({
      // @ts-ignore - 类型定义可能不完整
      wasmBinary: new Uint8Array(wasmBinary),
    });
    console.log("[SQL.js] 使用二进制初始化成功");
    return;
  } catch (error) {
    console.error("[SQL.js] 方法3 失败:", error);
    errors.push(`方法3 (手动 fetch): ${error instanceof Error ? error.message : String(error)}`);
  }

  // 所有方法都失败
  console.error("[SQL.js] 所有加载方法都失败:", errors);
  throw new Error(
    "无法加载 SQLite WASM 文件。\n\n已尝试以下方法:\n" +
    errors.map((e, i) => `${i + 1}. ${e}`).join("\n") +
    "\n\n请检查:\n" +
    "1. 重新构建扩展: npm run build\n" +
    "2. 重新加载扩展\n" +
    "3. 检查控制台网络请求是否 404"
  );
}

/**
 * 创建新数据库
 */
export function createDatabase(): any {
  if (!SQL) {
    throw new Error("SQL.js 尚未初始化");
  }
  const db = new SQL.Database();
  db.run(INIT_TABLES_SQL);
  return db;
}

/**
 * 从 Uint8Array 加载数据库
 */
export function loadDatabase(data: Uint8Array): any {
  if (!SQL) {
    throw new Error("SQL.js 尚未初始化");
  }
  const db = new SQL.Database(data);
  return db;
}

/**
 * 导出数据库为 Uint8Array
 */
export function exportDatabase(db: any): Uint8Array {
  return db.export();
}

/**
 * 生成 bookmark_id
 */
export function generateBookmarkId(
  userVid: string,
  bookId: string,
  chapterUid: number,
  range: string
): string {
  return `${userVid}_${bookId}_${chapterUid}_${range}`;
}

/**
 * 获取上次同步状态
 */
export function getLastSyncState(
  db: any,
  userVid: string,
  bookId: string
): { syncKey: number; readingTime: number } | null {
  const result = db.exec(
    "SELECT sync_key, reading_time FROM sync_state WHERE user_vid = ? AND book_id = ?",
    [userVid, bookId]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const [syncKey, readingTime] = result[0].values[0];
  return { syncKey: syncKey as number, readingTime: (readingTime as number) || 0 };
}

/**
 * 插入或更新书籍信息
 */
export function upsertBook(
  db: any,
  bookData: {
    bookId: string;
    title: string;
    author: string;
    cover: string;
    format: string;
  }
): void {
  const stmt = db.prepare(`
    INSERT INTO books (book_id, title, author, cover, format)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover = excluded.cover,
      format = excluded.format
  `);
  stmt.run([
    bookData.bookId || "",
    bookData.title || "",
    bookData.author || "",
    bookData.cover || "",
    bookData.format || "epub",
  ]);
  stmt.free();
}

/**
 * 插入或更新章节信息
 */
export function upsertChapter(
  db: any,
  bookId: string,
  chapter: {
    chapterUid: number;
    chapterIdx: number;
    title: string;
  }
): void {
  const stmt = db.prepare(`
    INSERT INTO chapters (book_id, chapter_uid, chapter_idx, title)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_uid) DO UPDATE SET
      chapter_idx = excluded.chapter_idx,
      title = excluded.title
  `);
  stmt.run([
    bookId || "",
    chapter.chapterUid ?? 0,
    chapter.chapterIdx ?? 0,
    chapter.title || "",
  ]);
  stmt.free();
}

/**
 * 插入或更新划线数据
 * 通过 JS 层逐字段比较，确保只有真正发生变化时才执行更新，避免 updated_at 刷新导致误报
 * @param stats 可选统计对象，用于精确记录新增/更新数量
 */
export function upsertHighlight(
  db: any,
  userVid: string,
  bookId: string,
  mark: {
    bookmarkId: string;
    chapterUid: number;
    chapterTitle?: string;
    range: string;
    markText: string;
    style?: number;
    type?: number;
    createTime?: number;
    updated?: number;
  },
  stats?: { highlightsAdded?: number; highlightsUpdated?: number }
): void {
  const bookmarkId = mark.bookmarkId || "";

  // 查询现有记录
  const existing = db.exec(
    "SELECT chapter_uid, chapter_title, range, mark_text, style, type FROM highlights WHERE user_vid = ? AND bookmark_id = ?",
    [userVid, bookmarkId]
  );

  const hasExisting = existing.length > 0 && existing[0].values.length > 0;

  if (!hasExisting) {
    // 新增
    const stmt = db.prepare(`
      INSERT INTO highlights
        (user_vid, bookmark_id, book_id, chapter_uid, chapter_title, range, mark_text, style, type, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))
    `);
    const values = [
      userVid,
      bookmarkId,
      bookId,
      mark.chapterUid ?? 0,
      mark.chapterTitle || "",
      mark.range || "",
      mark.markText || "",
      mark.style ?? 0,
      mark.type ?? 1,
      mark.createTime ?? Date.now() / 1000,
      mark.updated ?? Date.now() / 1000,
    ];
    const undefinedIndex = values.findIndex(v => v === undefined);
    if (undefinedIndex !== -1) {
      console.error("[upsertHighlight] 发现 undefined 值，索引:", undefinedIndex, "mark:", mark);
      throw new Error(`SQL 绑定错误: 参数 ${undefinedIndex} 为 undefined`);
    }
    stmt.run(values);
    stmt.free();
    if (stats) stats.highlightsAdded = (stats.highlightsAdded || 0) + 1;
    return;
  }

  // 已存在：逐字段比较
  const [oldChapterUid, oldChapterTitle, oldRange, oldMarkText, oldStyle, oldType] = existing[0].values[0];
  const changed =
    Number(oldChapterUid) !== (mark.chapterUid ?? 0) ||
    (oldChapterTitle || "") !== (mark.chapterTitle || "") ||
    (oldRange || "") !== (mark.range || "") ||
    (oldMarkText || "") !== (mark.markText || "") ||
    Number(oldStyle) !== (mark.style ?? 0) ||
    Number(oldType) !== (mark.type ?? 1);

  if (!changed) {
    // 完全相同，跳过
    return;
  }

  // 真正发生变化，执行精确 UPDATE（避免 ON CONFLICT DO UPDATE 刷新 updated_at 的误报）
  const stmt = db.prepare(`
    UPDATE highlights
    SET
      chapter_uid = ?,
      chapter_title = ?,
      range = ?,
      mark_text = ?,
      style = ?,
      type = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_vid = ? AND bookmark_id = ?
  `);
  stmt.run([
    mark.chapterUid ?? 0,
    mark.chapterTitle || "",
    mark.range || "",
    mark.markText || "",
    mark.style ?? 0,
    mark.type ?? 1,
    userVid,
    bookmarkId,
  ]);
  stmt.free();

  if (stats && db.getRowsModified() > 0) {
    stats.highlightsUpdated = (stats.highlightsUpdated || 0) + 1;
  }
}

/**
 * 删除划线数据
 * @param stats 可选统计对象，用于精确记录删除数量
 */
export function deleteHighlight(
  db: any,
  userVid: string,
  bookmarkId: string,
  stats?: { highlightsRemoved?: number }
): void {
  const stmt = db.prepare(
    "DELETE FROM highlights WHERE user_vid = ? AND bookmark_id = ?"
  );
  stmt.run([userVid || "", bookmarkId || ""]);
  stmt.free();

  if (stats && db.getRowsModified() > 0) {
    stats.highlightsRemoved = (stats.highlightsRemoved || 0) + 1;
  }
}

/**
 * 更新划线的评论/想法
 * @param stats 可选统计对象，用于精确记录合并想法数量
 */
export function updateHighlightNote(
  db: any,
  userVid: string,
  bookId: string,
  chapterUid: number,
  range: string,
  noteText: string,
  stats?: { reviewsMerged?: number }
): void {
  console.log("[updateHighlightNote] 参数:", { userVid, bookId, chapterUid, range, noteText });

  // 检查参数
  if (userVid === undefined) console.error("[updateHighlightNote] userVid is undefined");
  if (bookId === undefined) console.error("[updateHighlightNote] bookId is undefined");
  if (chapterUid === undefined) console.error("[updateHighlightNote] chapterUid is undefined");
  if (range === undefined) console.error("[updateHighlightNote] range is undefined");
  if (noteText === undefined) console.error("[updateHighlightNote] noteText is undefined");

  const existing = db.exec(
    "SELECT note_text FROM highlights WHERE user_vid = ? AND book_id = ? AND chapter_uid = ? AND range = ?",
    [userVid || "", bookId || "", chapterUid ?? 0, range ?? ""]
  );

  if (!existing.length || !existing[0].values.length) {
    console.warn("[updateHighlightNote] 未找到对应 highlight，跳过:", { userVid, bookId, chapterUid, range });
    return;
  }

  const currentNoteText = existing[0].values[0][0] || "";
  if (currentNoteText === (noteText || "")) {
    // 内容相同，跳过
    return;
  }

  const stmt = db.prepare(`
    UPDATE highlights
    SET note_text = ?
    WHERE user_vid = ? AND book_id = ? AND chapter_uid = ? AND range = ?
  `);
  // 确保所有值都不是 undefined
  const values = [
    noteText || "",
    userVid || "",
    bookId || "",
    chapterUid ?? 0,
    range ?? ""
  ];

  // 检查是否有 undefined
  const undefinedIndex = values.findIndex(v => v === undefined);
  if (undefinedIndex !== -1) {
    console.error("[updateHighlightNote] 发现 undefined 值，索引:", undefinedIndex);
    throw new Error(`updateHighlightNote: 参数 ${undefinedIndex} 为 undefined`);
  }

  stmt.run(values);
  stmt.free();

  if (stats && db.getRowsModified() > 0) {
    stats.reviewsMerged = (stats.reviewsMerged || 0) + 1;
  }
}

/**
 * 更新同步状态
 */
export function updateSyncState(
  db: any,
  userVid: string,
  bookId: string,
  syncKey: number,
  progressData?: {
    readingTime?: number;
    startReadingTime?: number;
    finishTime?: number;
  }
): void {
  const stmt = db.prepare(`
    INSERT INTO sync_state
      (user_vid, book_id, sync_key, last_sync_at, reading_time, start_reading_at, finish_reading_at)
    VALUES
      (?, ?, ?, CURRENT_TIMESTAMP, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))
    ON CONFLICT(user_vid, book_id) DO UPDATE SET
      sync_key = excluded.sync_key,
      last_sync_at = excluded.last_sync_at,
      reading_time = excluded.reading_time,
      start_reading_at = excluded.start_reading_at,
      finish_reading_at = excluded.finish_reading_at
  `);
  stmt.run([
    userVid || "",
    bookId || "",
    syncKey ?? 0,
    progressData?.readingTime ?? 0,
    progressData?.startReadingTime ?? 0,
    progressData?.finishTime ?? 0,
  ]);
  stmt.free();
}

/**
 * 确保用户记录在 users 表中
 */
export function ensureUser(db: any, userVid: string, userName?: string): void {
  console.log("[ensureUser] userVid:", userVid, "userName:", userName);
  if (!userVid) {
    console.error("[ensureUser] userVid 为空!");
    throw new Error("userVid 不能为空");
  }
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (user_vid, user_name)
    VALUES (?, ?)
  `);
  stmt.run([userVid || "", userName || ""]);
  stmt.free();
}

/**
 * 同步一本书的数据到数据库（包含完整的事务处理）
 * @returns 精确增量统计对象 { highlightsAdded, highlightsUpdated, highlightsRemoved, reviewsMerged }
 */
export function syncBookToDatabase(
  db: any,
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
  }
): { highlightsAdded: number; highlightsUpdated: number; highlightsRemoved: number; reviewsMerged: number } {
  const stats = {
    highlightsAdded: 0,
    highlightsUpdated: 0,
    highlightsRemoved: 0,
    reviewsMerged: 0,
  };

  // 开始事务
  console.log("[syncBookToDatabase] 开始同步，userVid:", userVid, "bookId:", bookData.book?.bookId);
  db.run("BEGIN TRANSACTION");

  try {
    // 1. 确保用户记录
    console.log("[syncBookToDatabase] 步骤1: 确保用户记录");
    ensureUser(db, userVid, "");

    // 2. 插入/更新书籍信息
    console.log("[syncBookToDatabase] 步骤2: 插入/更新书籍信息");
    upsertBook(db, bookData.book);

    // 3. 插入/更新章节信息
    console.log("[syncBookToDatabase] 步骤3: 插入/更新章节信息，章节数:", bookData.chapters?.length || 0);
    for (const chapter of bookData.chapters) {
      upsertChapter(db, bookData.book.bookId, chapter);
    }

    // 4. 处理更新的划线数据
    console.log("[syncBookToDatabase] 步骤4: 处理更新的划线数据，划线数:", bookData.updated?.length || 0);
    for (const mark of bookData.updated) {
      const bookmarkId = generateBookmarkId(
        userVid,
        bookData.book.bookId,
        mark.chapterUid,
        mark.range
      );

      // 查找对应的章节标题
      const chapter = bookData.chapters.find(
        (c) => c.chapterUid === mark.chapterUid
      );

      upsertHighlight(db, userVid, bookData.book.bookId, {
        bookmarkId,
        chapterUid: mark.chapterUid,
        chapterTitle: chapter?.title,
        range: mark.range,
        markText: mark.markText,
        style: mark.style,
        type: mark.type,
        createTime: mark.createTime,
      }, stats);
    }

    // 5. 处理删除的划线数据
    console.log("[syncBookToDatabase] 步骤5: 处理删除的划线数据，删除数:", bookData.removed?.length || 0);
    if (bookData.removed) {
      for (const removed of bookData.removed) {
        const bookmarkId = generateBookmarkId(
          userVid,
          bookData.book.bookId,
          removed.chapterUid,
          removed.range
        );
        deleteHighlight(db, userVid, bookmarkId, stats);
      }
    }

    // 6. 合并评论/想法
    console.log("[syncBookToDatabase] 步骤6: 合并评论/想法，评论数:", reviewData?.reviews?.length || 0);
    if (reviewData?.reviews) {
      for (const reviewItem of reviewData.reviews) {
        const review = reviewItem.review;
        if (!review || review.chapterUid == null || !review.range || review.content == null) {
          console.warn("[syncBookToDatabase] 跳过不合法评论:", review);
          continue;
        }
        console.log("[syncBookToDatabase] 处理评论:", { chapterUid: review.chapterUid, range: review.range, content: review.content.substring(0, 50) });
        updateHighlightNote(
          db,
          userVid,
          bookData.book.bookId,
          review.chapterUid,
          review.range,
          review.content,
          stats
        );
      }
    }

    // 7. 更新同步状态
    console.log("[syncBookToDatabase] 步骤7: 更新同步状态");
    updateSyncState(db, userVid, bookData.book.bookId, bookData.synckey, {
      readingTime: progressData?.readingTime,
      startReadingTime: progressData?.startReadingTime,
      finishTime: progressData?.finishTime,
    });

    // 提交事务
    console.log("[syncBookToDatabase] 提交事务");
    db.run("COMMIT");
    console.log("[syncBookToDatabase] 同步完成，stats:", stats);
    return stats;
  } catch (error) {
    console.error("[syncBookToDatabase] 同步失败:", error);
    // 回滚事务
    db.run("ROLLBACK");
    throw error;
  }
}

/**
 * 查询一本书的所有划线
 */
export function getHighlightsByBook(
  db: any,
  userVid: string,
  bookId: string
): any[] {
  const result = db.exec(
    `SELECT
      h.bookmark_id, h.chapter_uid, h.chapter_title, h.range,
      h.mark_text, h.note_text, h.style, h.type,
      h.created_at, h.updated_at
    FROM highlights h
    WHERE h.user_vid = ? AND h.book_id = ?
    ORDER BY h.chapter_uid, h.range`,
    [userVid, bookId]
  );

  if (result.length === 0) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map((row: any[]) => {
    const obj: any = {};
    columns.forEach((col: string, index: number) => {
      obj[col] = row[index];
    });
    return obj;
  });
}

/**
 * 获取所有书籍列表
 */
export function getAllBooks(db: any): any[] {
  const result = db.exec(
    `SELECT book_id, title, author, cover, format, created_at
     FROM books ORDER BY created_at DESC`
  );

  if (result.length === 0) {
    return [];
  }

  const columns = result[0].columns;
  return result[0].values.map((row: any[]) => {
    const obj: any = {};
    columns.forEach((col: string, index: number) => {
      obj[col] = row[index];
    });
    return obj;
  });
}

/**
 * 获取 API 调用所需的 synckey
 * 如果数据库中没有记录，返回 0
 */
export function getSyncKeyForApi(db: any, userVid: string, bookId: string): number {
  if (!db) return 0;
  try {
    const state = getLastSyncState(db, userVid, bookId);
    return state?.syncKey ?? 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 获取用户的同步状态统计
 */
export function getUserSyncStats(db: any, userVid: string): any {
  const result = db.exec(
    `SELECT
      (SELECT COUNT(DISTINCT book_id) FROM sync_state WHERE user_vid = ?) as book_count,
      (SELECT COUNT(*) FROM highlights WHERE user_vid = ?) as highlight_count,
      (SELECT MAX(last_sync_at) FROM sync_state WHERE user_vid = ?) as last_sync_at`,
    [userVid, userVid, userVid]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return { bookCount: 0, highlightCount: 0, lastSyncAt: null };
  }

  const [bookCount, highlightCount, lastSyncAt] = result[0].values[0];
  return {
    bookCount: bookCount as number,
    highlightCount: highlightCount as number,
    lastSyncAt: lastSyncAt as string,
  };
}
