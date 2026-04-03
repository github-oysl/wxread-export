<script>
  import {
    isFileSystemAccessSupported,
    exportToSQLite,
    getSyncKeyForApi,
    requestFileAccess,
    saveDatabaseToFile,
    downloadDatabaseFile,
  } from "../../utils/file";
  import { initSqlite } from "../../utils/db";
  import { isS3Configured } from "../../utils/s3";
  import { syncAllBooksToS3, fetchBookData, getWrVidFromCookie } from "../../utils/sync";
  import Settings from "./Settings.svelte";

  export let userVid;
  let books = [],
    selectedBook;
  let isExporting = false;
  let hasFileHandle = false;
  let errorMessage = "";
  let showError = false;
  let showSettings = false;
  let s3Configured = false;

  // 检查 S3 是否已配置
  async function checkS3Config() {
    s3Configured = await isS3Configured();
  }

  // 页面加载时检查 S3 配置
  checkS3Config();

  // 检查是否已有保存的数据库文件
  async function checkSavedFile() {
    try {
      // 安全检查 browser API
      if (typeof browser === "undefined" || !browser.storage) {
        console.warn("[checkSavedFile] Browser storage API 不可用");
        hasFileHandle = false;
        return;
      }
      const result = await browser.storage.local.get("wereader_db_file_name");
      hasFileHandle = !!result["wereader_db_file_name"];
    } catch (e) {
      console.warn("[checkSavedFile] 检查失败:", e);
      hasFileHandle = false;
    }
  }

  async function getNoteBooks() {
    // 优先从 cookie 读取 wr_vid
    const cookieVid = await getWrVidFromCookie();
    if (cookieVid) {
      userVid = cookieVid;
      console.log("[List] 优先使用 cookie 的 wr_vid 作为 userVid:", userVid);
    }

    fetch("https://weread.qq.com/api/user/notebook")
      .then((response) => response.json())
      .then((data) => {
        books = data.books.map((val) => val.book);
        if (books.length > 0) {
          selectedBook = books[0].bookId;
        }
        // 如果 cookie 没有，再尝试从 API 响应兜底
        if (!userVid) {
          const fixedUserVid = data.userVid || data.vid || data.books?.[0]?.userVid || data.books?.[0]?.vid;
          if (fixedUserVid) {
            userVid = String(fixedUserVid);
            console.log("[List] 从 notebook API 获取固定 userVid:", userVid);
          }
        }
      });
  }
  getNoteBooks();
  checkSavedFile();

  function handleClick(book) {
    selectedBook = book.bookId;
  }

  /**
   * 导出到 SQLite 数据库
   */
  async function exportToDatabase() {
    if (isExporting) return;
    if (books.length === 0) {
      alert("暂无书籍可导出");
      return;
    }

    isExporting = true;
    /** @type {string[]} */
    let debugInfo = [];

    // 诊断函数
    const diagnose = (step, info) => {
      const msg = `[诊断] ${step}: ${JSON.stringify(info)}`;
      console.log(msg);
      debugInfo.push(msg);
    };

    try {
      // 预检查：验证 wasm 文件可访问性
      diagnose("开始", "检查 wasm 文件可访问性");

      const testUrls = [
        browser.runtime.getURL("assets/sql-wasm.wasm"),
      ];

      for (const url of testUrls) {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          diagnose("wasm 检查", { url, status: response.status, ok: response.ok });
        } catch (e) {
          diagnose("wasm 检查失败", { url, error: String(e) });
        }
      }

      // 检查浏览器支持
      const isSupported = isFileSystemAccessSupported();
      diagnose("浏览器支持", { isSupported });

      // 检查是否配置了 S3，如果配置了优先使用 S3 导出
      const useS3 = await isS3Configured();
      diagnose("导出方式选择", { useS3, s3Configured: useS3, isSupported });

      if (useS3) {
        // S3 导出模式：调用核心同步模块
        diagnose("开始 S3 同步", { bookCount: books.length });
        const result = await syncAllBooksToS3();

        if (result.success) {
          const s = result.stats;
          let message = "同步到 S3 成功！";
          if (s) {
            const hasChanges = s.totalAdded > 0 || s.totalUpdated > 0 || s.totalRemoved > 0 || s.totalReviews > 0;
            if (hasChanges) {
              const details = [];
              if (s.totalAdded > 0) details.push(`新增 ${s.totalAdded} 条笔记`);
              if (s.totalUpdated > 0) details.push(`更新 ${s.totalUpdated} 条笔记`);
              if (s.totalRemoved > 0) details.push(`删除 ${s.totalRemoved} 条`);
              if (s.totalReviews > 0) details.push(`合并想法 ${s.totalReviews} 条`);
              message += `\n\n本次变更：涉及 ${s.changedBooks} 本书`;
              if (details.length > 0) message += `\n${details.join("，")}`;
            } else {
              message += "\n\n本次无新增变更，所有笔记已是最新。";
            }
            message += `\n\n数据库总计：${s.bookCount} 本书，${s.highlightCount} 条笔记。`;
            if (result.url) message += `\n\n文件地址: ${result.url}`;
          }
          alert(message);
        } else {
          throw new Error(result.message);
        }
        return;
      }

      // 本地文件导出模式（保持单本书逻辑）
      if (!selectedBook) {
        alert("请先选择一本书");
        isExporting = false;
        return;
      }

      // 获取上次同步状态（用于增量更新）
      let db = null;
      let fileHandle = null;

      if (isSupported && hasFileHandle) {
        try {
          // 尝试打开已有文件
          const result = await requestFileAccess();
          db = result.db;
          fileHandle = result.fileHandle;
        } catch (e) {
          console.log("打开已有文件失败，将创建新文件或下载:", e);
        }
      }

      // 获取书籍数据
      const book = books.find((b) => b.bookId === selectedBook);
      if (!book) {
        throw new Error("未找到选中的书籍");
      }

      const { bookData, reviewData, progressInfo, markData } = await fetchBookData(
        book,
        userVid || "",
        db
      );

      // 获取 effectiveUserVid（优先 cookie -> 已有 userVid -> API 响应 -> 兜底）
      let effectiveUserVid = userVid || (await getWrVidFromCookie());
      if (!effectiveUserVid) {
        effectiveUserVid = markData?.userVid || markData?.user?.vid || reviewData?.userVid || reviewData?.user?.vid || "";
      }
      if (!effectiveUserVid) {
        effectiveUserVid = "unknown_user";
      }

      if (isSupported && !db) {
        // 使用自动文件管理模式（首次导出）
        diagnose("调用 exportToSQLite", { userVid: effectiveUserVid, bookId: selectedBook });
        diagnose("reviewData 检查", { hasReviewData: !!reviewData, reviewCount: reviewData.reviews?.length || 0 });
        const result = await exportToSQLite(
          effectiveUserVid,
          bookData,
          reviewData,
          progressInfo,
          true
        );
        diagnose("exportToSQLite 返回", { success: result.success });

        if (result.success) {
          hasFileHandle = true;
          alert(
            `${result.message}\n\n您已导出 ${result.stats.bookCount} 本书的 ${result.stats.highlightCount} 条笔记。\n\n下次导出将自动使用同一文件进行增量更新。`
          );
        } else {
          diagnose("exportToSQLite 返回失败", { message: result.message });
          throw new Error(result.message);
        }
      } else if (db && fileHandle) {
        // 已有打开的数据库，直接同步
        await initSqlite();

        // 动态导入 db 模块
        const dbModule = await import("../../utils/db");
        dbModule.syncBookToDatabase(
          db,
          effectiveUserVid,
          bookData,
          reviewData,
          progressInfo
        );

        // 保存到文件
        await saveDatabaseToFile(fileHandle, db);

        // 获取统计信息
        const stats = dbModule.getUserSyncStats(db, effectiveUserVid);

        // 关闭数据库
        db.close();

        alert(
          `成功更新数据库：${book.title}\n\n您已导出 ${stats.bookCount} 本书的 ${stats.highlightCount} 条笔记。`
        );
      } else {
        // 浏览器不支持 File System Access API，使用降级方案
        await initSqlite();

        // 创建新数据库
        const dbModule = await import("../../utils/db");
        const newDb = dbModule.createDatabase();

        // 同步数据
        dbModule.syncBookToDatabase(
          newDb,
          effectiveUserVid,
          bookData,
          reviewData,
          progressInfo
        );

        // 下载文件
        downloadDatabaseFile(newDb, `wereader_notes_${book.title}.db`);

        // 关闭数据库
        newDb.close();

        alert(
          `已生成数据库文件并触发下载：wereader_notes_${book.title}.db\n\n由于您的浏览器不支持文件系统访问 API，每次导出都会生成新文件。推荐使用 Chrome 或 Edge 浏览器以获得更好的体验。`
        );
      }
    } catch (error) {
      console.error("导出到数据库失败:", error);

      // 增强错误信息提取
      let errorMsg;
      try {
        if (error instanceof Error) {
          errorMsg = `${error.message}\n${error.stack || ""}`;
        } else if (typeof error === "string") {
          errorMsg = error;
        } else if (error && typeof error === "object") {
          errorMsg = `非标准错误: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`;
        } else {
          errorMsg = `未知错误: ${String(error)}`;
        }
      } catch (e) {
        errorMsg = `无法序列化错误: ${String(error)}`;
      }

      const fullDebug = debugInfo.join("\n");
      errorMessage =
        `导出失败: ${errorMsg}\n\n` +
        `扩展 ID: ${browser.runtime.id}\n` +
        `预期 wasm URL: ${browser.runtime.getURL("assets/sql-wasm.wasm")}\n\n` +
        `诊断日志:\n${fullDebug}`;
      showError = true;
    } finally {
      isExporting = false;
    }
  }
</script>

<div class="mdui-toolbar mdui-appbar mdui-appbar-fixed mdui-color-theme">
  <span class="mdui-typo-title">导出笔记</span>
  <div class="mdui-toolbar-spacer" />
  <button
    class="mdui-btn mdui-btn-icon"
    on:click={() => (showSettings = true)}
    title="S3 存储设置"
  >
    <i class="mdui-icon material-icons">settings</i>
  </button>
  <button
    class="mdui-btn mdui-btn-icon"
    on:click={exportToDatabase}
    disabled={isExporting}
    title={isExporting ? "正在导出..." : s3Configured ? "导出到 S3" : "导出到 SQLite 数据库"}
  >
    <i class="mdui-icon material-icons">
      {s3Configured ? "cloud_upload" : "storage"}
    </i>
  </button>
</div>

<Settings bind:visible={showSettings} onClose={() => {
  showSettings = false;
  // 重新检查 S3 配置（用户可能已修改）
  checkS3Config();
}} />
<div class=" mdui-container book-list-wrap">
  {#each books as book (book.bookId)}
    <div class="mdui-card mdui-col" on:click={() => handleClick(book)}>
      <div class="mdui-card-media">
        <img src={book.cover.replace("s_", "t6_")} alt="cover" />
        <div class="mdui-card-media-covered">
          <div class="mdui-radio pull-right">
            <input type="radio" bind:group={selectedBook} value={book.bookId} />
            <i class="mdui-radio-icon" />
          </div>
        </div>
      </div>
      <div class="mdui-card-actions">
        <div class="mdui-typo-body-2 text-omit">{book.title}</div>
      </div>
    </div>
  {/each}
</div>

{#if showError}
  <div class="error-panel mdui-card">
    <div class="mdui-card-header">
      <div class="mdui-card-header-title">错误信息（可复制）</div>
      <button class="mdui-btn mdui-btn-icon" on:click={() => showError = false}>
        <i class="mdui-icon material-icons">close</i>
      </button>
    </div>
    <div class="mdui-card-content">
      <pre class="error-content" id="error-text">{errorMessage}</pre>
      <button
        class="mdui-btn mdui-btn-raised mdui-color-theme"
        on:click={() => {
          const text = document.getElementById('error-text')?.innerText || errorMessage;
          navigator.clipboard.writeText(text).then(() => alert('错误信息已复制到剪贴板'));
        }}
        style="margin-top: 10px;"
      >
        复制错误信息
      </button>
    </div>
  </div>
{/if}

<style>
  .pull-right {
    float: right;
  }
  .mdui-radio {
    padding-left: 22px;
  }
  .mdui-radio-icon::after {
    border-color: #fff;
  }
  .text-omit {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
  .mdui-card {
    padding-top: 8px;
    cursor: pointer;
  }
  .mdui-card img {
    height: 100%;
    object-fit: cover;
    min-height: 200px;
  }

  .mdui-container {
    width: 100%;
    padding: 20px;
    padding-top: 80px;
    display: grid;
    grid-template-columns: 150px 150px 150px;
    grid-row-gap: 20px;
    grid-column-gap: 20px;
  }

  .error-panel {
    position: fixed;
    bottom: 10px;
    left: 10px;
    right: 10px;
    max-height: 300px;
    overflow: auto;
    background: #fff;
    border: 2px solid #f44336;
    z-index: 1000;
    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
  }

  .error-panel .mdui-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f44336;
    color: white;
  }

  .error-panel .mdui-card-content {
    padding: 16px;
  }

  .error-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 12px;
    line-height: 1.5;
    max-height: 200px;
    overflow: auto;
    background: #f5f5f5;
    padding: 10px;
    border-radius: 4px;
  }
</style>
