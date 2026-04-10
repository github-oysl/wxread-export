<script>
  import { getSyncKeyForApi } from "../../utils/file";
  import { isS3Configured } from "../../utils/s3";
  import { syncAllBooksToDatabase, fetchBookData, getWrVidFromCookie } from "../../utils/sync";
  import Settings from "./Settings.svelte";

  export let userVid;
  let books = [],
    selectedBook;
  let isExporting = false;
  let errorMessage = "";
  let showError = false;
  let showSettings = false;
  let s3Configured = false;

  // 检查 S3 是否已配置（保留用于设置按钮显示）
  async function checkS3Config() {
    s3Configured = await isS3Configured();
  }

  // 页面加载时检查 S3 配置
  checkS3Config();

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

  function handleClick(book) {
    selectedBook = book.bookId;
  }

  /**
   * 导出到 PostgreSQL 数据库
   * 批量导出所有书籍到远程数据库
   */
  async function exportToDatabase() {
    if (isExporting) return;
    if (books.length === 0) {
      alert("暂无书籍可导出");
      return;
    }

    isExporting = true;

    try {
      // 批量导出所有书籍到数据库
      const result = await syncAllBooksToDatabase();

      if (result.success) {
        const s = result.stats;
        let message = "导出到数据库成功！";

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
          if (s.failCount > 0) {
            message += `\n\n注意：${s.failCount} 本书导出失败。`;
          }
        }
        alert(message);
      } else {
        throw new Error(result.message);
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

      errorMessage =
        `导出失败: ${errorMsg}\n\n` +
        `扩展 ID: ${browser.runtime.id}`;
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
    title={isExporting ? "正在导出所有书籍..." : "批量导出所有书籍到数据库"}
  >
    <i class="mdui-icon material-icons">cloud_upload</i>
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
