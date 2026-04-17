<script>
  import { getSyncKeyForApi } from "../../utils/file";
  import { syncAllBooksToDatabase, syncSingleBookToDatabase, getWrVidFromCookie } from "../../utils/sync";
  import {
    exportAllBooksToLocal,
    exportBookToLocal,
    exportAllBooksToLocalDirect,
    exportBookToLocalDirect,
    checkDatabaseAvailable,
  } from "../../utils/export";
  import Settings from "./Settings.svelte";

  export let userVid;
  let books = [];
  let selectedBook = "all";
  let isExporting = false;
  let errorMessage = "";
  let showError = false;
  let showSettings = false;

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
        // 默认状态为全部，不自动选中任何单本书
        selectedBook = "all";
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

  function handleClick(book) {
    if (selectedBook === book.bookId) {
      selectedBook = "all";
    } else {
      selectedBook = book.bookId;
    }
  }

  function showErrorPanel(error) {
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

    errorMessage =
      `导出失败: ${errorMsg}\n\n` +
      `扩展 ID: ${browser.runtime.id}`;
    showError = true;
  }

  function getSelectedBookTitle() {
    const book = books.find((b) => b.bookId === selectedBook);
    return book?.title || "";
  }

  /**
   * 一键同步并导出
   * 有数据库：先同步到数据库，再增量导出本地
   * 无数据库：直接全量导出本地
   */
  async function syncAndExport() {
    if (isExporting) return;
    if (books.length === 0) {
      alert("暂无书籍可导出");
      return;
    }

    isExporting = true;

    try {
      const hasDb = await checkDatabaseAvailable();
      const isSingle = selectedBook && selectedBook !== "all";

      if (hasDb) {
        // 有数据库：先同步，再根据是否有变更决定是否导出
        if (isSingle) {
          const book = books.find((b) => b.bookId === selectedBook);
          const dbResult = await syncSingleBookToDatabase(book);
          if (!dbResult.success) {
            throw new Error(dbResult.message || "同步失败");
          }
          const hasChanges = dbResult.stats && (
            dbResult.stats.highlightsAdded > 0 ||
            dbResult.stats.highlightsUpdated > 0 ||
            dbResult.stats.highlightsRemoved > 0 ||
            dbResult.stats.reviewsMerged > 0
          );
          if (hasChanges) {
            const localResult = await exportBookToLocal(book.bookId);
            alert(`《${book.title}》同步并导出完成！\n${localResult.message}`);
          } else {
            alert(`《${book.title}》同步完成，本书无新增变更。`);
          }
        } else {
          const dbResult = await syncAllBooksToDatabase();
          if (!dbResult.success) {
            throw new Error(dbResult.message || "同步失败");
          }
          let msg = "数据库同步成功！";
          let hasChanges = false;
          if (dbResult.stats) {
            const s = dbResult.stats;
            msg += `\n处理书籍：${s.successCount} 本成功`;
            if (s.failCount > 0) msg += `，${s.failCount} 本失败`;
            hasChanges = s.changedBooks > 0;
            if (hasChanges) {
              const details = [];
              if (s.totalAdded > 0) details.push(`新增 ${s.totalAdded} 条笔记`);
              if (s.totalUpdated > 0) details.push(`更新 ${s.totalUpdated} 条笔记`);
              if (s.totalRemoved > 0) details.push(`删除 ${s.totalRemoved} 条`);
              if (s.totalReviews > 0) details.push(`合并想法 ${s.totalReviews} 条`);
              msg += `\n有变更的书籍：${s.changedBooks} 本`;
              if (details.length > 0) msg += `\n${details.join("，")}`;
            } else {
              msg += "\n本次无新增变更，所有笔记已是最新。";
            }
            msg += `\n数据库总计：${s.bookCount} 本书，${s.highlightCount} 条笔记。`;
          }
          if (hasChanges) {
            const localResult = await exportAllBooksToLocal();
            alert(`${msg}\n\n本地导出：${localResult.message}`);
          } else {
            alert(msg);
          }
        }
      } else {
        // 无数据库：全量导出
        if (isSingle) {
          const book = books.find((b) => b.bookId === selectedBook);
          const localResult = await exportBookToLocalDirect(book);
          if (!localResult.success) {
            throw new Error(localResult.message);
          }
          alert(`《${book.title}》已全量导出到本地。\n${localResult.message}`);
        } else {
          const localResult = await exportAllBooksToLocalDirect();
          if (!localResult.success) {
            throw new Error(localResult.message);
          }
          alert(`数据库不可用，已切换为全量本地导出。\n${localResult.message}`);
        }
      }
    } catch (error) {
      console.error("同步并导出失败:", error);
      showErrorPanel(error);
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
    title="数据库与导出设置"
  >
    <i class="mdui-icon material-icons">settings</i>
  </button>
  <button
    class="mdui-btn mdui-btn-icon"
    on:click={syncAndExport}
    disabled={isExporting}
    title={isExporting
      ? "正在处理..."
      : selectedBook && selectedBook !== "all"
        ? `同步并导出《${getSelectedBookTitle()}》`
        : "一键同步并导出所有书籍"}
  >
    <i class="mdui-icon material-icons">cloud_upload</i>
  </button>
</div>

<Settings bind:visible={showSettings} onClose={() => {
  showSettings = false;
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
