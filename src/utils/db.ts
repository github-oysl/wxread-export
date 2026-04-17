/**
 * PostgreSQL 数据库操作模块（通过 PostgREST HTTP API）
 * 替代原有的 SQLite/sql.js 实现
 */

const DEFAULT_POSTGREST_URL = "http://43.139.41.82:3000";

// 模块级缓存，减少频繁读取 storage
let cachedPostgrestUrl: string | null = null;
let cachedJwtToken: string | null = null;

/**
 * 从扩展存储中获取 PostgREST 配置
 */
async function getPostgrestConfig(): Promise<{ url: string; jwtToken: string }> {
  try {
    if (typeof browser !== "undefined" && browser.storage) {
      const res = await browser.storage.local.get("wereader_postgrest_config");
      const config = res["wereader_postgrest_config"];
      return {
        url: config?.postgrestUrl?.trim() || DEFAULT_POSTGREST_URL,
        jwtToken: config?.jwtToken?.trim() || "",
      };
    }
  } catch (e) {
    console.error("[db] 读取 PostgREST 配置失败:", e);
  }
  return { url: DEFAULT_POSTGREST_URL, jwtToken: "" };
}

/**
 * 从扩展存储中获取 PostgREST URL，未配置时返回默认值
 */
export async function getPostgrestUrl(): Promise<string> {
  if (cachedPostgrestUrl) {
    return cachedPostgrestUrl;
  }
  const config = await getPostgrestConfig();
  cachedPostgrestUrl = config.url;
  cachedJwtToken = config.jwtToken;
  return cachedPostgrestUrl;
}

/**
 * 从扩展存储中获取 JWT Token
 */
export async function getJwtToken(): Promise<string> {
  if (cachedJwtToken !== null) {
    return cachedJwtToken;
  }
  const config = await getPostgrestConfig();
  cachedPostgrestUrl = config.url;
  cachedJwtToken = config.jwtToken;
  return cachedJwtToken;
}

/**
 * 清除 PostgREST 配置缓存
 */
export function invalidatePostgrestUrlCache(): void {
  cachedPostgrestUrl = null;
  cachedJwtToken = null;
}

/**
 * 获取 API 请求的基础配置
 */
async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
  const token = await getJwtToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * 发送 HTTP 请求
 */
async function request(
  method: string,
  endpoint: string,
  body?: unknown,
  prefer?: string
): Promise<any> {
  const headers = await getHeaders();
  if (prefer) {
    headers["Prefer"] = prefer;
  }

  const postgrestUrl = await getPostgrestUrl();
  const response = await fetch(`${postgrestUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PostgREST ${method} ${endpoint} failed: ${response.status} ${errorText}`);
  }

  // 处理 204 No Content（DELETE/PATCH 可能返回）
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * 初始化 PostgREST 连接
 * 检查服务是否可用
 */
export async function initSqlite(): Promise<void> {
  try {
    const postgrestUrl = await getPostgrestUrl();
    const headers = await getHeaders();
    const response = await fetch(postgrestUrl, { headers });
    if (!response.ok) {
      throw new Error(`PostgREST 服务不可用: ${response.status}`);
    }
    console.log("[PostgREST] 连接成功:", postgrestUrl);
  } catch (error) {
    console.error("[PostgREST] 连接失败:", error);
    throw new Error(
      "无法连接到 PostgREST 服务。\n" +
      "请检查:\n" +
      "1. PostgREST 服务是否已启动 (默认: http://43.139.41.82:3000)\n" +
      "2. JWT Token 是否配置正确\n" +
      "3. 网络连接是否正常"
    );
  }
}

/**
 * 创建新数据库连接
 * 在 PostgREST 模式下不需要创建数据库，返回一个虚拟对象用于兼容
 */
export async function createDatabase(): Promise<any> {
  // 返回一个虚拟对象，表示使用 PostgREST
  const postgrestUrl = await getPostgrestUrl();
  return { type: "postgrest", url: postgrestUrl };
}

/**
 * 从 Uint8Array 加载数据库
 * 在 PostgREST 模式下不支持此操作，返回虚拟对象
 */
export function loadDatabase(data: Uint8Array): any {
  console.warn("[PostgREST] loadDatabase 在 HTTP 模式下不支持本地加载，将使用远程数据库");
  return createDatabase();
}

/**
 * 导出数据库为 Uint8Array
 * 在 PostgREST 模式下不支持此操作
 */
export function exportDatabase(db: any): Uint8Array {
  console.warn("[PostgREST] exportDatabase 在 HTTP 模式下不支持");
  return new Uint8Array();
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
export async function getLastSyncState(
  db: any,
  userVid: string,
  bookId: string
): Promise<{ syncKey: number; readingTime: number } | null> {
  try {
    const result = await request(
      "GET",
      `/sync_state?user_vid=eq.${encodeURIComponent(userVid)}&book_id=eq.${encodeURIComponent(bookId)}`
    );

    if (!result || result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      syncKey: row.sync_key ?? 0,
      readingTime: row.reading_time ?? 0,
    };
  } catch (error) {
    console.error("[getLastSyncState] 查询失败:", error);
    return null;
  }
}

/**
 * 插入或更新书籍信息
 */
export async function upsertBook(
  db: any,
  bookData: {
    bookId: string;
    title: string;
    author: string;
    cover: string;
    format: string;
  }
): Promise<void> {
  const data = {
    book_id: bookData.bookId || "",
    title: bookData.title || "",
    author: bookData.author || "",
    cover: bookData.cover || "",
    format: bookData.format || "epub",
  };

  // 使用 PostgREST 的 upsert 功能
  await request(
    "POST",
    "/books",
    data,
    "resolution=merge-duplicates,return=representation"
  );
}

/**
 * 插入或更新章节信息
 */
export async function upsertChapter(
  db: any,
  bookId: string,
  chapter: {
    chapterUid: number;
    chapterIdx: number;
    title: string;
  }
): Promise<void> {
  const data = {
    book_id: bookId || "",
    chapter_uid: chapter.chapterUid ?? 0,
    chapter_idx: chapter.chapterIdx ?? 0,
    title: chapter.title || "",
  };

  await request(
    "POST",
    "/chapters",
    data,
    "resolution=merge-duplicates,return=representation"
  );
}

/**
 * 插入或更新划线数据
 */
export async function upsertHighlight(
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
): Promise<void> {
  const bookmarkId = mark.bookmarkId || "";

  // 先查询现有记录
  const existing = await request(
    "GET",
    `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&bookmark_id=eq.${encodeURIComponent(bookmarkId)}`
  );

  const hasExisting = existing && existing.length > 0;

  const data = {
    user_vid: userVid,
    bookmark_id: bookmarkId,
    book_id: bookId,
    chapter_uid: mark.chapterUid ?? 0,
    chapter_title: mark.chapterTitle || "",
    range: mark.range || "",
    mark_text: mark.markText || "",
    style: mark.style ?? 0,
    type: mark.type ?? 1,
    created_at: mark.createTime
      ? new Date(mark.createTime * 1000).toISOString()
      : new Date().toISOString(),
  };

  if (!hasExisting) {
    // 新增
    await request("POST", "/highlights", data);
    if (stats) stats.highlightsAdded = (stats.highlightsAdded || 0) + 1;
  } else {
    // 检查是否有变化
    const old = existing[0];
    const changed =
      old.chapter_uid !== data.chapter_uid ||
      old.chapter_title !== data.chapter_title ||
      old.range !== data.range ||
      old.mark_text !== data.mark_text ||
      old.style !== data.style ||
      old.type !== data.type;

    if (!changed) {
      // 完全相同，跳过
      return;
    }

    // 更新
    await request(
      "PATCH",
      `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&bookmark_id=eq.${encodeURIComponent(bookmarkId)}`,
      {
        chapter_uid: data.chapter_uid,
        chapter_title: data.chapter_title,
        range: data.range,
        mark_text: data.mark_text,
        style: data.style,
        type: data.type,
      }
    );

    if (stats) stats.highlightsUpdated = (stats.highlightsUpdated || 0) + 1;
  }
}

/**
 * 删除划线数据
 */
export async function deleteHighlight(
  db: any,
  userVid: string,
  bookmarkId: string,
  stats?: { highlightsRemoved?: number }
): Promise<void> {
  await request(
    "DELETE",
    `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&bookmark_id=eq.${encodeURIComponent(bookmarkId)}`
  );

  if (stats) stats.highlightsRemoved = (stats.highlightsRemoved || 0) + 1;
}

/**
 * 更新划线的评论/想法
 * @returns true 如果成功更新或无需更新，false 如果找不到对应划线
 */
export async function updateHighlightNote(
  db: any,
  userVid: string,
  bookId: string,
  chapterUid: number,
  range: string,
  noteText: string,
  stats?: { reviewsMerged?: number }
): Promise<boolean> {
  // 查询现有记录
  const existing = await request(
    "GET",
    `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&book_id=eq.${encodeURIComponent(bookId)}&chapter_uid=eq.${chapterUid}&range=eq.${encodeURIComponent(range ?? "")}`
  );

  if (!existing || existing.length === 0) {
    // 这种情况正常：用户可能先写了评论，后来删除了对应的划线
    // 或者微信读书的书摘类型评论没有对应划线
    return false;
  }

  const currentNoteText = existing[0].note_text || "";
  if (currentNoteText === (noteText || "")) {
    // 内容相同，跳过
    return true;
  }

  await request(
    "PATCH",
    `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&book_id=eq.${encodeURIComponent(bookId)}&chapter_uid=eq.${chapterUid}&range=eq.${encodeURIComponent(range ?? "")}`,
    { note_text: noteText || "" }
  );

  if (stats) stats.reviewsMerged = (stats.reviewsMerged || 0) + 1;
  return true;
}

/**
 * 更新同步状态
 */
export async function updateSyncState(
  db: any,
  userVid: string,
  bookId: string,
  syncKey: number,
  progressData?: {
    readingTime?: number;
    startReadingTime?: number;
    finishTime?: number;
  }
): Promise<void> {
  const data = {
    user_vid: userVid || "",
    book_id: bookId || "",
    sync_key: syncKey ?? 0,
    last_sync_at: new Date().toISOString(),
    reading_time: progressData?.readingTime ?? 0,
    start_reading_at: progressData?.startReadingTime
      ? new Date(progressData.startReadingTime * 1000).toISOString()
      : null,
    finish_reading_at: progressData?.finishTime
      ? new Date(progressData.finishTime * 1000).toISOString()
      : null,
  };

  await request(
    "POST",
    "/sync_state",
    data,
    "resolution=merge-duplicates,return=representation"
  );
}

/**
 * 确保用户记录在 users 表中
 */
export async function ensureUser(db: any, userVid: string, userName?: string): Promise<void> {
  console.log("[ensureUser] userVid:", userVid, "userName:", userName);
  if (!userVid) {
    console.error("[ensureUser] userVid 为空!");
    throw new Error("userVid 不能为空");
  }

  const data = {
    user_vid: userVid,
    user_name: userName || "",
  };

  await request(
    "POST",
    "/users",
    data,
    "resolution=merge-duplicates,return=representation"
  );
}

/**
 * 同步一本书的数据到数据库
 * @returns 精确增量统计对象 { highlightsAdded, highlightsUpdated, highlightsRemoved, reviewsMerged }
 */
export async function syncBookToDatabase(
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
): Promise<{ highlightsAdded: number; highlightsUpdated: number; highlightsRemoved: number; reviewsMerged: number }> {
  const stats = {
    highlightsAdded: 0,
    highlightsUpdated: 0,
    highlightsRemoved: 0,
    reviewsMerged: 0,
  };

  console.log("[syncBookToDatabase] 开始同步，userVid:", userVid, "bookId:", bookData.book?.bookId);

  try {
    // 1. 确保用户记录
    console.log("[syncBookToDatabase] 步骤1: 确保用户记录");
    await ensureUser(db, userVid, "");

    // 2. 插入/更新书籍信息
    console.log("[syncBookToDatabase] 步骤2: 插入/更新书籍信息");
    await upsertBook(db, bookData.book);

    // 3. 插入/更新章节信息
    console.log("[syncBookToDatabase] 步骤3: 插入/更新章节信息，章节数:", bookData.chapters?.length || 0);
    for (const chapter of bookData.chapters) {
      await upsertChapter(db, bookData.book.bookId, chapter);
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

      await upsertHighlight(db, userVid, bookData.book.bookId, {
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
        await deleteHighlight(db, userVid, bookmarkId, stats);
      }
    }

    // 6. 合并评论/想法
    console.log("[syncBookToDatabase] 步骤6: 合并评论/想法，评论数:", reviewData?.reviews?.length || 0);
    let skippedReviews = 0;
    let orphanedReviews = 0;
    if (reviewData?.reviews) {
      for (const reviewItem of reviewData.reviews) {
        const review = reviewItem.review;
        // 检查评论数据完整性
        if (!review || review.chapterUid == null || !review.range || review.content == null) {
          skippedReviews++;
          console.log("[syncBookToDatabase] 跳过格式不完整的评论（可能是系统-generated的摘要）");
          continue;
        }
        // 尝试更新对应划线的评论
        const result = await updateHighlightNote(
          db,
          userVid,
          bookData.book.bookId,
          review.chapterUid,
          review.range,
          review.content,
          stats
        );
        if (!result) {
          orphanedReviews++;
        }
      }
    }
    if (skippedReviews > 0 || orphanedReviews > 0) {
      console.log(`[syncBookToDatabase] 评论处理统计: ${skippedReviews} 个格式跳过, ${orphanedReviews} 个孤立评论（划线可能已删除）`);
    }

    // 7. 更新同步状态
    console.log("[syncBookToDatabase] 步骤7: 更新同步状态");
    await updateSyncState(db, userVid, bookData.book.bookId, bookData.synckey, {
      readingTime: progressData?.readingTime,
      startReadingTime: progressData?.startReadingTime,
      finishTime: progressData?.finishTime,
    });

    console.log("[syncBookToDatabase] 同步完成，stats:", stats);
    return stats;
  } catch (error) {
    console.error("[syncBookToDatabase] 同步失败:", error);
    throw error;
  }
}

/**
 * 查询一本书的所有划线
 */
export async function getHighlightsByBook(
  db: any,
  userVid: string,
  bookId: string
): Promise<any[]> {
  try {
    const result = await request(
      "GET",
      `/highlights?user_vid=eq.${encodeURIComponent(userVid)}&book_id=eq.${encodeURIComponent(bookId)}&order=chapter_uid.asc,range.asc`
    );

    if (!result || result.length === 0) {
      return [];
    }

    // 转换字段名（snake_case -> camelCase）
    return result.map((row: any) => ({
      bookmark_id: row.bookmark_id,
      chapter_uid: row.chapter_uid,
      chapter_title: row.chapter_title,
      range: row.range,
      mark_text: row.mark_text,
      note_text: row.note_text,
      style: row.style,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    console.error("[getHighlightsByBook] 查询失败:", error);
    return [];
  }
}

/**
 * 获取所有书籍列表
 */
export async function getAllBooks(db: any): Promise<any[]> {
  try {
    const result = await request(
      "GET",
      `/books?order=created_at.desc`
    );

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((row: any) => ({
      book_id: row.book_id,
      title: row.title,
      author: row.author,
      cover: row.cover,
      format: row.format,
      created_at: row.created_at,
    }));
  } catch (error) {
    console.error("[getAllBooks] 查询失败:", error);
    return [];
  }
}

/**
 * 获取 API 调用所需的 synckey
 * 如果数据库中没有记录，返回 0
 */
export async function getSyncKeyForApi(db: any, userVid: string, bookId: string): Promise<number> {
  if (!db) return 0;
  try {
    const state = await getLastSyncState(db, userVid, bookId);
    return state?.syncKey ?? 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 获取用户的同步状态统计
 */
export async function getUserSyncStats(db: any, userVid: string): Promise<any> {
  try {
    // 查询书籍数量 - 使用 PostgREST 计数功能
    const bookCount = await getTableCount("sync_state", userVid);

    // 查询划线数量
    const highlightCount = await getTableCount("highlights", userVid);

    // 查询最后同步时间
    const lastSyncResult = await request(
      "GET",
      `/sync_state?user_vid=eq.${encodeURIComponent(userVid)}&order=last_sync_at.desc&limit=1`
    );

    return {
      bookCount,
      highlightCount,
      lastSyncAt: lastSyncResult?.[0]?.last_sync_at || null,
    };
  } catch (error) {
    console.error("[getUserSyncStats] 查询失败:", error);
    return { bookCount: 0, highlightCount: 0, lastSyncAt: null };
  }
}

/**
 * 查询一本书的所有章节
 */
export async function getChaptersByBook(db: any, bookId: string): Promise<any[]> {
  try {
    const result = await request(
      "GET",
      `/chapters?book_id=eq.${encodeURIComponent(bookId)}&order=chapter_idx.asc`
    );

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((row: any) => ({
      chapter_uid: row.chapter_uid,
      chapter_idx: row.chapter_idx,
      title: row.title,
    }));
  } catch (error) {
    console.error("[getChaptersByBook] 查询失败:", error);
    return [];
  }
}

/**
 * 查询单本书的同步状态
 */
export async function getSyncStateByBook(
  db: any,
  userVid: string,
  bookId: string
): Promise<any | null> {
  try {
    const result = await request(
      "GET",
      `/sync_state?user_vid=eq.${encodeURIComponent(userVid)}&book_id=eq.${encodeURIComponent(bookId)}&limit=1`
    );

    if (!result || result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      user_vid: row.user_vid,
      book_id: row.book_id,
      sync_key: row.sync_key,
      last_sync_at: row.last_sync_at,
      reading_time: row.reading_time,
      start_reading_at: row.start_reading_at,
      finish_reading_at: row.finish_reading_at,
    };
  } catch (error) {
    console.error("[getSyncStateByBook] 查询失败:", error);
    return null;
  }
}

/**
 * 查询用户的所有知识点扩展
 */
export async function getKnowledgeExpansionsByUser(
  db: any,
  userVid: string
): Promise<any[]> {
  try {
    const result = await request(
      "GET",
      `/knowledge_expansions?user_vid=eq.${encodeURIComponent(userVid)}`
    );

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((row: any) => ({
      expansion_id: row.expansion_id,
      user_vid: row.user_vid,
      highlight_id: row.highlight_id,
      concept_id: row.concept_id,
      concept_name: row.concept_name,
      concept_type: row.concept_type,
      concept_aliases: row.concept_aliases,
      section_definition: row.section_definition,
      section_simple: row.section_simple,
      section_key_points: row.section_key_points,
      section_timeline: row.section_timeline,
      section_related: row.section_related,
      section_learning_path: row.section_learning_path,
      section_notes: row.section_notes,
      section_diagram: row.section_diagram,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    console.error("[getKnowledgeExpansionsByUser] 查询失败:", error);
    return [];
  }
}

/**
 * 批量查询知识点扩展的关联链接
 */
export async function getKnowledgeSourceLinksByExpansions(
  db: any,
  expansionIds: (number | string)[]
): Promise<any[]> {
  try {
    if (!expansionIds || expansionIds.length === 0) {
      return [];
    }

    const idsStr = expansionIds.join(",");
    const result = await request(
      "GET",
      `/knowledge_source_links?expansion_id=in.(${encodeURIComponent(idsStr)})`
    );

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((row: any) => ({
      link_id: row.link_id,
      expansion_id: row.expansion_id,
      highlight_id: row.highlight_id,
    }));
  } catch (error) {
    console.error("[getKnowledgeSourceLinksByExpansions] 查询失败:", error);
    return [];
  }
}

/**
 * 获取表中特定用户的记录数
 */
async function getTableCount(table: string, userVid: string): Promise<number> {
  try {
    const postgrestUrl = await getPostgrestUrl();
    const headers = await getHeaders();
    headers["Prefer"] = "count=exact";
    // 方法1: 使用 Range 头获取总数
    const response = await fetch(
      `${postgrestUrl}/${table}?user_vid=eq.${encodeURIComponent(userVid)}`,
      {
        method: "HEAD",
        headers
      }
    );

    const contentRange = response.headers.get("Content-Range");
    if (contentRange) {
      // Content-Range: 0-29/30 格式，取最后的数字
      const match = contentRange.match(/\/(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    // 方法2: 如果 HEAD 失败，查询所有记录并计数
    console.warn(`[getTableCount] ${table} HEAD 请求失败，回退到 GET`);
    const result = await request(
      "GET",
      `/${table}?user_vid=eq.${encodeURIComponent(userVid)}&select=book_id`
    );
    return result?.length || 0;
  } catch (error) {
    console.error(`[getTableCount] ${table} 计数失败:`, error);
    return 0;
  }
}
