/**
 * Markdown 导出模块
 * 将 PostgREST 数据库中的书籍和笔记导出为本地 Markdown 文件
 * 支持两种模式：有数据库时增量导出，无数据库时全量直连 API 导出
 */

import {
  initSqlite,
  createDatabase,
  getAllBooks,
  getChaptersByBook,
  getSyncStateByBook,
  getHighlightsByBook,
} from "./db";
import { getWrVidFromCookie, fetchBookData } from "./sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const EXPORT_STATE_KEY = "wereader_export_state";
const EXPORT_CONFIG_KEY = "wereader_export_config";

interface ExportState {
  [bookId: string]: {
    lastSyncAt: string;
    highlightCount: number;
    exportedAt: string;
  };
}

/**
 * 将字符串转换为安全的文件名字符串
 */
function sanitizeFilename(name: string): string {
  let safe = name.trim();
  // 替换常见非法字符
  safe = safe.replace(/[\\/:*?"<>|]+/g, "_");
  // 控制字符
  safe = safe.replace(/[\x00-\x1f]/g, "");
  // 首尾空格/点
  safe = safe.trim().replace(/^\.+|\.+$/g, "");
  if (!safe) {
    safe = "untitled";
  }
  return safe;
}

/**
 * 获取导出目录前缀
 */
async function getExportDir(): Promise<string> {
  try {
    const res = await chrome.storage.local.get(EXPORT_CONFIG_KEY);
    const dir = res[EXPORT_CONFIG_KEY]?.exportDir?.trim() || "";
    if (!dir) return "wereader-export";
    return sanitizeFilename(dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  } catch (e) {
    console.error("[getExportDir] 读取配置失败:", e);
    return "wereader-export";
  }
}

/**
 * 判断数据库是否可用
 */
export async function checkDatabaseAvailable(): Promise<boolean> {
  try {
    await initSqlite();
    await createDatabase();
    return true;
  } catch (e) {
    console.warn("[checkDatabaseAvailable] 数据库不可用:", e);
    return false;
  }
}

/**
 * 生成单本书的 Markdown 内容（基于数据库字段）
 */
function generateBookMarkdown(
  book: any,
  chapters: any[],
  highlights: any[],
  syncState: any | null
): string {
  const lines: string[] = [];
  const bookTitle = book.title || "untitled";

  // Frontmatter
  lines.push("---");
  lines.push(`title: "${bookTitle}"`);
  lines.push(`author: "${book.author || ""}"`);
  lines.push(`exported_at: "${new Date().toISOString()}"`);
  if (syncState?.last_sync_at) {
    lines.push(`last_sync: "${syncState.last_sync_at}"`);
  }
  lines.push("---");
  lines.push("");

  // 构建章节索引映射
  const chapterMap: Record<number, any> = {};
  for (const ch of chapters) {
    const cuid = ch.chapter_uid;
    if (cuid != null) {
      chapterMap[cuid] = ch;
    }
  }

  // 按 chapter_uid 分组
  const groups: Record<number, any[]> = {};
  for (const hl of highlights) {
    const cuid = hl.chapter_uid || 0;
    if (!groups[cuid]) {
      groups[cuid] = [];
    }
    groups[cuid].push(hl);
  }

  // 按章节顺序输出；无匹配章节的放到最后
  const orderedUids = Object.keys(chapterMap).map((k) => parseInt(k, 10));
  const otherUids = Object.keys(groups)
    .map((k) => parseInt(k, 10))
    .filter((uid) => !(uid in chapterMap));
  orderedUids.push(...otherUids);

  for (const uid of orderedUids) {
    if (!groups[uid]) {
      continue;
    }

    const chapter = chapterMap[uid];
    if (chapter) {
      lines.push(`## ${chapter.title || "无标题章节"}`);
    } else {
      lines.push("## 其他");
    }
    lines.push("");

    for (const hl of groups[uid]) {
      const markText = (hl.mark_text || "").trim();
      const noteText = (hl.note_text || "").trim();

      if (markText || noteText) {
        let calloutTitle = "原文";
        if (markText && noteText) {
          calloutTitle = "原文与评论";
        } else if (!markText && noteText) {
          calloutTitle = "评论";
        }

        lines.push(`> [!quote]- ${calloutTitle}`);
        if (markText) {
          lines.push("> **原文：**");
          for (const mline of markText.split("\n")) {
            lines.push(`> > ${mline}`);
          }
        }
        if (noteText) {
          if (markText) {
            lines.push(">");
          }
          lines.push("> **评论：**");
          for (const nline of noteText.split("\n")) {
            lines.push(`> ${nline}`);
          }
        }
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 从 API 返回的原始数据生成 Markdown
 */
function generateBookMarkdownFromApiData(
  book: any,
  markData: any,
  reviewData: any
): string {
  const lines: string[] = [];
  const bookTitle = book.title || "untitled";

  // Frontmatter
  lines.push("---");
  lines.push(`title: "${bookTitle}"`);
  lines.push(`author: "${book.author || ""}"`);
  lines.push(`exported_at: "${new Date().toISOString()}"`);
  lines.push("---");
  lines.push("");

  const chapters = markData?.chapters || [];
  const marks = markData?.updated || markData?.marks || [];
  const reviews = reviewData?.reviews || [];

  // 构建章节索引映射
  const chapterMap: Record<number, any> = {};
  for (const ch of chapters) {
    const cuid = ch.chapterUid;
    if (cuid != null) {
      chapterMap[cuid] = ch;
    }
  }

  // 将评论按 chapterUid + range 索引
  const reviewMap: Record<string, string> = {};
  for (const reviewItem of reviews) {
    const review = reviewItem.review;
    if (review && review.chapterUid != null && review.range != null) {
      const key = `${review.chapterUid}_${review.range}`;
      reviewMap[key] = review.content || "";
    }
  }

  // 按 chapter_uid 分组
  const groups: Record<number, any[]> = {};
  for (const mark of marks) {
    const cuid = mark.chapterUid || 0;
    if (!groups[cuid]) {
      groups[cuid] = [];
    }
    // 合并评论
    const key = `${mark.chapterUid}_${mark.range}`;
    const noteText = reviewMap[key] || "";
    groups[cuid].push({
      mark_text: mark.markText || "",
      note_text: noteText,
    });
  }

  // 按章节顺序输出；无匹配章节的放到最后
  const orderedUids = Object.keys(chapterMap).map((k) => parseInt(k, 10));
  const otherUids = Object.keys(groups)
    .map((k) => parseInt(k, 10))
    .filter((uid) => !(uid in chapterMap));
  orderedUids.push(...otherUids);

  for (const uid of orderedUids) {
    if (!groups[uid]) {
      continue;
    }

    const chapter = chapterMap[uid];
    if (chapter) {
      lines.push(`## ${chapter.title || "无标题章节"}`);
    } else {
      lines.push("## 其他");
    }
    lines.push("");

    for (const hl of groups[uid]) {
      const markText = (hl.mark_text || "").trim();
      const noteText = (hl.note_text || "").trim();

      if (markText || noteText) {
        let calloutTitle = "原文";
        if (markText && noteText) {
          calloutTitle = "原文与评论";
        } else if (!markText && noteText) {
          calloutTitle = "评论";
        }

        lines.push(`> [!quote]- ${calloutTitle}`);
        if (markText) {
          lines.push("> **原文：**");
          for (const mline of markText.split("\n")) {
            lines.push(`> > ${mline}`);
          }
        }
        if (noteText) {
          if (markText) {
            lines.push(">");
          }
          lines.push("> **评论：**");
          for (const nline of noteText.split("\n")) {
            lines.push(`> ${nline}`);
          }
        }
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 判断书籍是否需要导出
 */
async function shouldExport(
  bookId: string,
  syncState: any | null,
  highlightCount: number
): Promise<boolean> {
  if (!syncState) {
    return true;
  }

  let exportState: ExportState = {};
  try {
    const res = await chrome.storage.local.get(EXPORT_STATE_KEY);
    exportState = res[EXPORT_STATE_KEY] || {};
  } catch (e) {
    console.error("[shouldExport] 读取导出状态失败:", e);
    return true;
  }

  const record = exportState[bookId];
  if (!record) {
    return true;
  }

  if (record.lastSyncAt !== syncState.last_sync_at) {
    return true;
  }
  if (record.highlightCount !== highlightCount) {
    return true;
  }

  return false;
}

/**
 * 更新导出状态记录
 */
async function updateExportState(
  bookId: string,
  syncState: any | null,
  highlightCount: number
): Promise<void> {
  let exportState: ExportState = {};
  try {
    const res = await chrome.storage.local.get(EXPORT_STATE_KEY);
    exportState = res[EXPORT_STATE_KEY] || {};
  } catch (e) {
    console.error("[updateExportState] 读取导出状态失败:", e);
  }

  exportState[bookId] = {
    lastSyncAt: syncState?.last_sync_at || "",
    highlightCount,
    exportedAt: new Date().toISOString(),
  };

  try {
    await chrome.storage.local.set({ [EXPORT_STATE_KEY]: exportState });
  } catch (e) {
    console.error("[updateExportState] 保存导出状态失败:", e);
  }
}

/**
 * 使用 chrome.downloads 下载 Markdown 文件
 */
async function downloadMarkdown(filename: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);

      chrome.downloads.download(
        {
          url,
          filename,
          saveAs: false,
        },
        (downloadId: number) => {
          URL.revokeObjectURL(url);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 解析有效的 user_vid
 */
async function resolveEffectiveUserVid(): Promise<string> {
  let effectiveUserVid = await getWrVidFromCookie();

  if (!effectiveUserVid) {
    try {
      const notebookRes = await fetch("https://weread.qq.com/api/user/notebook");
      const notebookData = await notebookRes.json();
      effectiveUserVid =
        notebookData.userVid ||
        notebookData.vid ||
        notebookData.books?.[0]?.userVid ||
        notebookData.books?.[0]?.vid ||
        "";
      if (effectiveUserVid) {
        effectiveUserVid = String(effectiveUserVid);
      }
    } catch (e) {
      console.error("[export] 从 notebook API 获取 userVid 失败:", e);
    }
  }

  if (!effectiveUserVid) {
    effectiveUserVid = "unknown_user";
  }

  return effectiveUserVid;
}

/**
 * 无数据库时，单本书直接导出到本地
 */
export async function exportBookToLocalDirect(book: any): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const effectiveUserVid = await resolveEffectiveUserVid();
    const data = await fetchBookData(book, effectiveUserVid, null);
    const markdown = generateBookMarkdownFromApiData(book, data.markData, data.reviewData);
    const safeTitle = sanitizeFilename(book.title || "untitled");
    const exportDir = await getExportDir();
    const filename = `${exportDir}/01-Books/${safeTitle}.md`;
    await downloadMarkdown(filename, markdown);
    return { success: true, message: `《${book.title || "untitled"}》已导出到本地` };
  } catch (e) {
    console.error(`[exportBookToLocalDirect] 导出失败 ${book.title}:`, e);
    return { success: false, message: `导出失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 无数据库时，全量导出所有书籍到本地
 */
export async function exportAllBooksToLocalDirect(): Promise<{
  success: boolean;
  message: string;
  exportedCount: number;
  failedCount: number;
}> {
  try {
    const notebookRes = await fetch("https://weread.qq.com/api/user/notebook");
    const notebookData = await notebookRes.json();
    const books = notebookData.books.map((val: any) => val.book) as any[];

    if (books.length === 0) {
      return { success: false, message: "暂无书籍可导出", exportedCount: 0, failedCount: 0 };
    }

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
    if (!effectiveUserVid) {
      effectiveUserVid = "unknown_user";
    }

    console.log(`[ExportDirect] 开始并行获取 ${books.length} 本书的数据...`);
    const startTime = Date.now();

    const bookDataPromises = books.map(async (book) => {
      try {
        const data = await fetchBookData(book, effectiveUserVid, null);
        return { book, data, success: true };
      } catch (e) {
        console.error(`[ExportDirect] 获取失败 ${book.title}:`, e);
        return { book, data: null, success: false, error: e };
      }
    });

    const results = await Promise.all(bookDataPromises);
    const fetchTime = Date.now() - startTime;
    console.log(`[ExportDirect] 数据获取完成，耗时: ${fetchTime}ms`);

    const exportDir = await getExportDir();
    let exportedCount = 0;
    let failedCount = 0;

    for (const result of results) {
      if (!result.success || !result.data) {
        failedCount++;
        continue;
      }
      try {
        const markdown = generateBookMarkdownFromApiData(
          result.book,
          result.data.markData,
          result.data.reviewData
        );
        const safeTitle = sanitizeFilename(result.book.title || "untitled");
        const filename = `${exportDir}/01-Books/${safeTitle}.md`;
        await downloadMarkdown(filename, markdown);
        exportedCount++;
        console.log(`[ExportDirect] 已导出: ${result.book.title}`);
      } catch (e) {
        failedCount++;
        console.error(`[ExportDirect] 下载失败 ${result.book.title}:`, e);
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[ExportDirect] 导出完成，总耗时: ${totalTime}ms`);
    const message = `全量本地导出完成：成功 ${exportedCount} 本，失败 ${failedCount} 本`;
    return { success: true, message, exportedCount, failedCount };
  } catch (e) {
    console.error("[exportAllBooksToLocalDirect] 导出失败:", e);
    return {
      success: false,
      message: `导出失败: ${e instanceof Error ? e.message : String(e)}`,
      exportedCount: 0,
      failedCount: 0,
    };
  }
}

/**
 * 有数据库时，单本书增量导出到本地
 */
export async function exportBookToLocal(bookId: string): Promise<{
  success: boolean;
  exported: boolean;
  message: string;
}> {
  await initSqlite();
  const db = await createDatabase();
  const effectiveUserVid = await resolveEffectiveUserVid();

  try {
    const syncState = await getSyncStateByBook(db, effectiveUserVid, bookId);
    const highlights = await getHighlightsByBook(db, effectiveUserVid, bookId);

    if (!highlights || highlights.length === 0) {
      return { success: true, exported: false, message: "本书没有划线记录，已跳过" };
    }

    const needsExport = await shouldExport(bookId, syncState, highlights.length);
    if (!needsExport) {
      return { success: true, exported: false, message: "本书无变化，已跳过" };
    }

    const chapters = await getChaptersByBook(db, bookId);

    // 构造 book 对象
    const bookRes = await getAllBooks(db);
    const book = bookRes.find((b: any) => b.book_id === bookId);
    if (!book) {
      return { success: false, exported: false, message: "在数据库中找不到该书籍" };
    }

    const markdown = generateBookMarkdown(book, chapters, highlights, syncState);
    const safeTitle = sanitizeFilename(book.title || "untitled");
    const exportDir = await getExportDir();
    const filename = `${exportDir}/01-Books/${safeTitle}.md`;
    await downloadMarkdown(filename, markdown);

    await updateExportState(bookId, syncState, highlights.length);

    return { success: true, exported: true, message: `《${book.title || "untitled"}》已导出到本地` };
  } catch (e) {
    console.error(`[exportBookToLocal] 导出失败 ${bookId}:`, e);
    return { success: false, exported: false, message: `导出失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 导出所有书籍到本地 Markdown（有数据库时增量导出）
 * @returns 导出统计结果
 */
export async function exportAllBooksToLocal(): Promise<{
  success: boolean;
  message: string;
  exportedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  // 1. 初始化 PostgREST 连接
  await initSqlite();
  const db = await createDatabase();

  // 2. 获取 effectiveUserVid
  const effectiveUserVid = await resolveEffectiveUserVid();
  console.log("[Export] 使用 userVid:", effectiveUserVid);

  // 3. 获取书籍列表
  const books = await getAllBooks(db);
  if (books.length === 0) {
    return { success: false, message: "数据库中没有书籍记录", exportedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  console.log(`[Export] 共发现 ${books.length} 本书，开始处理...`);

  let exportedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const exportDir = await getExportDir();

  for (const book of books) {
    const bookId = book.book_id;
    const title = book.title || "untitled";

    try {
      // 获取同步状态和划线数据
      const syncState = await getSyncStateByBook(db, effectiveUserVid, bookId);
      const highlights = await getHighlightsByBook(db, effectiveUserVid, bookId);

      if (!highlights || highlights.length === 0) {
        skippedCount++;
        continue;
      }

      // 增量判断
      const needsExport = await shouldExport(bookId, syncState, highlights.length);
      if (!needsExport) {
        skippedCount++;
        console.log(`[Export] 跳过无变化书籍: ${title}`);
        continue;
      }

      // 查询章节
      const chapters = await getChaptersByBook(db, bookId);

      // 生成 Markdown
      const markdown = generateBookMarkdown(book, chapters, highlights, syncState);

      // 下载文件
      const safeTitle = sanitizeFilename(title);
      const filename = `${exportDir}/01-Books/${safeTitle}.md`;
      await downloadMarkdown(filename, markdown);

      // 更新导出状态
      await updateExportState(bookId, syncState, highlights.length);

      exportedCount++;
      console.log(`[Export] 已导出: ${title}`);
    } catch (e) {
      failedCount++;
      console.error(`[Export] 导出失败 ${title}:`, e);
    }
  }

  const message = `导出完成：成功 ${exportedCount} 本，跳过 ${skippedCount} 本，失败 ${failedCount} 本`;
  console.log(`[Export] ${message}`);

  return {
    success: true,
    message,
    exportedCount,
    skippedCount,
    failedCount,
  };
}
