<script>
  export let visible = false;
  export let onClose = () => {};

  const AUTO_SYNC_STORAGE_KEY = "wereader_auto_sync_config";
  const POSTGREST_CONFIG_KEY = "wereader_postgrest_config";
  const EXPORT_CONFIG_KEY = "wereader_export_config";

  let config = {
    postgrestUrl: "",
    jwtToken: "",
    exportDir: "",
  };

  let autoSyncConfig = {
    enabled: false,
    intervalHours: 24,
  };

  let message = "";
  let messageType = ""; // 'success' | 'error' | 'info'
  let saveLoading = false;

  // 加载已有配置
  async function loadConfig() {
    try {
      if (typeof browser !== "undefined" && browser.storage) {
        const res = await browser.storage.local.get([
          POSTGREST_CONFIG_KEY,
          EXPORT_CONFIG_KEY,
          AUTO_SYNC_STORAGE_KEY,
        ]);
        const pgConfig = res[POSTGREST_CONFIG_KEY];
        const exportConfig = res[EXPORT_CONFIG_KEY];
        const autoSync = res[AUTO_SYNC_STORAGE_KEY];

        if (pgConfig) {
          config.postgrestUrl = pgConfig.postgrestUrl || "";
          config.jwtToken = pgConfig.jwtToken || "";
        }
        if (exportConfig) {
          config.exportDir = exportConfig.exportDir || "";
        }
        if (autoSync) {
          autoSyncConfig = {
            enabled: !!autoSync.enabled,
            intervalHours: autoSync.intervalHours || 24,
          };
        }
      }
    } catch (e) {
      console.error("[Settings] 加载配置失败:", e);
    }
  }

  // 当对话框打开时加载配置
  $: if (visible) {
    loadConfig();
    message = "";
  }

  function showMessage(msg, type = "info") {
    message = msg;
    messageType = type;
  }

  async function handleSave() {
    saveLoading = true;
    message = "";

    try {
      if (typeof browser !== "undefined" && browser.storage) {
        await browser.storage.local.set({
          [POSTGREST_CONFIG_KEY]: {
            postgrestUrl: config.postgrestUrl.trim(),
            jwtToken: config.jwtToken.trim(),
          },
          [EXPORT_CONFIG_KEY]: {
            exportDir: config.exportDir.trim(),
          },
          [AUTO_SYNC_STORAGE_KEY]: autoSyncConfig,
        });
      }

      // 清除 URL 缓存，使新配置立即生效
      const { invalidatePostgrestUrlCache } = await import("../../utils/db");
      invalidatePostgrestUrlCache();

      // 通知 background 设置/清除 alarm
      if (typeof browser !== "undefined" && browser.runtime?.sendMessage) {
        await browser.runtime.sendMessage({
          type: "SET_AUTO_SYNC",
          payload: autoSyncConfig,
        });
      }

      showMessage("配置已保存！正在关闭...", "success");
      setTimeout(() => {
        handleClose();
      }, 800);
    } catch (e) {
      console.error("[Settings] 保存失败:", e);
      showMessage("保存失败: " + (e.message || String(e)), "error");
    } finally {
      saveLoading = false;
    }
  }

  function handleClose() {
    visible = false;
    onClose();
  }

  // 点击遮罩层关闭
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  // 阻止事件冒泡
  function stopPropagation(e) {
    e.stopPropagation();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="settings-overlay" on:click={handleBackdropClick}>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="settings-dialog mdui-card" on:click={stopPropagation}>
      <div class="mdui-card-header">
        <div class="mdui-card-header-title">数据库与导出设置</div>
        <button
          class="mdui-btn mdui-btn-icon"
          on:click={handleClose}
          disabled={saveLoading}
        >
          <i class="mdui-icon material-icons">close</i>
        </button>
      </div>

      <div class="mdui-card-content settings-content">
        {#if message}
          <div
            class="mdui-alert"
            class:mdui-color-green-100={messageType === "success"}
            class:mdui-color-red-100={messageType === "error"}
            class:mdui-color-blue-100={messageType === "info"}
            style="white-space: pre-wrap; word-break: break-all;"
          >
            {message}
          </div>
        {/if}

        <div class="section-title">PostgREST 数据库</div>
        <div class="mdui-textfield">
          <label class="mdui-textfield-label" for="postgrest-url">
            PostgREST URL
            <span class="help-text">（留空使用默认值）</span>
          </label>
          <input
            id="postgrest-url"
            class="mdui-textfield-input"
            type="text"
            bind:value={config.postgrestUrl}
            placeholder="http://43.139.41.82:3000"
            disabled={saveLoading}
          />
        </div>
        <div class="mdui-textfield">
          <label class="mdui-textfield-label" for="jwt-token">
            JWT Token
            <span class="help-text">（开启 JWT 认证后必填）</span>
          </label>
          <input
            id="jwt-token"
            class="mdui-textfield-input"
            type="password"
            bind:value={config.jwtToken}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            disabled={saveLoading}
          />
        </div>

        <div class="section-title">本地导出配置</div>
        <div class="mdui-textfield">
          <label class="mdui-textfield-label" for="export-dir">
            导出目录路径
            <span class="help-text">（相对于浏览器下载目录的路径前缀，例如：wereader-export）</span>
          </label>
          <input
            id="export-dir"
            class="mdui-textfield-input"
            type="text"
            bind:value={config.exportDir}
            placeholder="例如: wereader-export"
            disabled={saveLoading}
          />
        </div>

        <div class="autosync-section">
          <label class="mdui-checkbox">
            <input
              type="checkbox"
              bind:checked={autoSyncConfig.enabled}
              disabled={saveLoading}
            />
            <i class="mdui-checkbox-icon"></i>
            启用定时自动同步到数据库
          </label>

          {#if autoSyncConfig.enabled}
            <div class="mdui-textfield" style="margin-top: 8px;">
              <label class="mdui-textfield-label" for="sync-interval">
                自动同步间隔
                <span class="help-text">（到达间隔后自动在后台执行全量同步）</span>
              </label>
              <select
                id="sync-interval"
                class="mdui-textfield-input"
                bind:value={autoSyncConfig.intervalHours}
                disabled={saveLoading}
              >
                <option value={1 / 60}>每 1 分钟（测试用）</option>
                <option value={1}>每 1 小时</option>
                <option value={3}>每 3 小时</option>
                <option value={6}>每 6 小时</option>
                <option value={12}>每 12 小时</option>
                <option value={24}>每 24 小时</option>
              </select>
            </div>
          {/if}
        </div>
      </div>

      <div class="mdui-card-actions settings-actions">
        <div class="spacer"></div>
        <button
          class="mdui-btn mdui-btn-raised mdui-color-theme"
          on:click={handleSave}
          disabled={saveLoading}
        >
          {#if saveLoading}
            <i class="mdui-icon material-icons mdui-spin">refresh</i>
          {:else}
            保存配置
          {/if}
        </button>
        <button
          class="mdui-btn mdui-btn-raised"
          on:click={handleClose}
          disabled={saveLoading}
        >
          关闭
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .settings-dialog {
    width: 90%;
    max-width: 500px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .settings-dialog .mdui-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    background: var(--mdui-color-primary);
    color: white;
  }

  .settings-dialog .mdui-card-header-title {
    font-size: 18px;
    font-weight: 500;
  }

  .settings-content {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .section-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.6);
    margin-top: 8px;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .mdui-textfield {
    margin-bottom: 12px;
  }

  .mdui-textfield-label {
    display: block;
    margin-bottom: 4px;
    font-size: 14px;
    color: rgba(0, 0, 0, 0.54);
  }

  .mdui-textfield-input {
    width: 100%;
    padding: 8px 0;
    border: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    font-size: 16px;
    background: transparent;
  }

  .mdui-textfield-input:focus {
    outline: none;
    border-bottom-color: var(--mdui-color-primary);
  }

  .mdui-textfield-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .help-text {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.38);
    margin-left: 4px;
  }

  .mdui-checkbox {
    display: flex;
    align-items: center;
    margin: 16px 0;
    cursor: pointer;
  }

  .mdui-checkbox input {
    display: none;
  }

  .mdui-checkbox-icon {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(0, 0, 0, 0.54);
    border-radius: 2px;
    margin-right: 8px;
    position: relative;
  }

  .mdui-checkbox input:checked + .mdui-checkbox-icon {
    background: var(--mdui-color-primary);
    border-color: var(--mdui-color-primary);
  }

  .mdui-checkbox input:checked + .mdui-checkbox-icon::after {
    content: "";
    position: absolute;
    left: 5px;
    top: 1px;
    width: 4px;
    height: 9px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .autosync-section {
    margin-top: 16px;
    padding: 12px;
    background: #f0f4ff;
    border-radius: 4px;
  }

  .mdui-alert {
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 16px;
    font-size: 14px;
  }

  .settings-actions {
    display: flex;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
  }

  .spacer {
    flex: 1;
  }

  .mdui-btn {
    min-width: 80px;
  }

  .mdui-btn-raised {
    box-shadow:
      0 2px 2px 0 rgba(0, 0, 0, 0.14),
      0 3px 1px -2px rgba(0, 0, 0, 0.2),
      0 1px 5px 0 rgba(0, 0, 0, 0.12);
  }

  .mdui-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mdui-color-theme {
    background-color: #3f51b5;
    color: white;
  }

  .mdui-color-green-100 {
    background-color: #c8e6c9;
    color: #1b5e20;
  }

  .mdui-color-red-100 {
    background-color: #ffcdd2;
    color: #b71c1c;
  }

  .mdui-color-blue-100 {
    background-color: #bbdefb;
    color: #0d47a1;
  }

  .mdui-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
