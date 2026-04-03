<script>
  import {
    getS3Config,
    saveS3Config,
    clearS3Config,
    testS3Connection,
  } from "../../utils/s3";

  export let visible = false;
  export let onClose = () => {};

  let config = {
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "us-east-1",
    key: "wereader_notes.db",
    forcePathStyle: true,
  };

  let message = "";
  let messageType = ""; // 'success' | 'error' | 'info'
  let showSecretKey = false;

  // 分离测试和保存的 loading 状态，避免互相干扰
  let testLoading = false;
  let saveLoading = false;

  // 加载已有配置
  async function loadConfig() {
    try {
      const savedConfig = await getS3Config();
      if (savedConfig) {
        config = {
          ...config,
          ...savedConfig,
        };
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

  async function handleTest() {
    testLoading = true;
    message = "";

    const result = await testS3Connection(config);

    testLoading = false;
    showMessage(result.message, result.success ? "success" : "error");
  }

  async function handleSave() {
    if (!config.endpoint || !config.bucket || !config.accessKeyId) {
      showMessage("请填写所有必填项", "error");
      return;
    }

    saveLoading = true;
    message = "";

    try {
      await saveS3Config(config);
      showMessage("配置已保存！正在关闭...", "success");
      // 保存成功后延迟 800ms 自动关闭弹窗，给用户明确的反馈
      setTimeout(() => {
        handleClose();
      }, 800);
    } catch (e) {
      console.error("[Settings] 保存失败:", e);
      showMessage("保存失败: " + e.message, "error");
    } finally {
      saveLoading = false;
    }
  }

  async function handleClear() {
    if (!confirm("确定要清除 S3 配置吗？")) {
      return;
    }

    saveLoading = true;
    try {
      await clearS3Config();
      config = {
        endpoint: "",
        bucket: "",
        accessKeyId: "",
        secretAccessKey: "",
        region: "us-east-1",
        key: "wereader_notes.db",
        forcePathStyle: true,
      };
      showMessage("配置已清除", "info");
    } catch (e) {
      console.error("[Settings] 清除失败:", e);
      showMessage("清除失败: " + e.message, "error");
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
        <div class="mdui-card-header-title">S3 存储配置</div>
        <button
          class="mdui-btn mdui-btn-icon"
          on:click={handleClose}
          disabled={testLoading || saveLoading}
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

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">
            Endpoint *
            <span class="help-text">（例如: https://s3.amazonaws.com）</span>
          </label>
          <input
            class="mdui-textfield-input"
            type="text"
            bind:value={config.endpoint}
            placeholder="https://s3.example.com"
            disabled={testLoading || saveLoading}
          />
        </div>

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">Bucket *</label>
          <input
            class="mdui-textfield-input"
            type="text"
            bind:value={config.bucket}
            placeholder="my-bucket"
            disabled={testLoading || saveLoading}
          />
        </div>

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">Access Key ID *</label>
          <input
            class="mdui-textfield-input"
            type="text"
            bind:value={config.accessKeyId}
            placeholder="AKIA..."
            disabled={testLoading || saveLoading}
          />
        </div>

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">Secret Access Key</label>
          <div class="secret-input-wrapper">
            {#if showSecretKey}
              <input
                class="mdui-textfield-input"
                type="text"
                bind:value={config.secretAccessKey}
                placeholder="留空表示不修改"
                disabled={testLoading || saveLoading}
              />
            {:else}
              <input
                class="mdui-textfield-input"
                type="password"
                bind:value={config.secretAccessKey}
                placeholder="留空表示不修改"
                disabled={testLoading || saveLoading}
              />
            {/if}
            <button
              class="mdui-btn mdui-btn-icon toggle-visibility"
              on:click={() => (showSecretKey = !showSecretKey)}
              type="button"
              tabindex="-1"
            >
              <i class="mdui-icon material-icons">
                {showSecretKey ? "visibility_off" : "visibility"}
              </i>
            </button>
          </div>
          {#if config.secretAccessKey === ""}
            <div class="mdui-textfield-helper">
              如需修改 Secret Key，请在此输入
            </div>
          {/if}
        </div>

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">
            Region
            <span class="help-text">（默认: us-east-1）</span>
          </label>
          <input
            class="mdui-textfield-input"
            type="text"
            bind:value={config.region}
            placeholder="us-east-1"
            disabled={testLoading || saveLoading}
          />
        </div>

        <div class="mdui-textfield">
          <label class="mdui-textfield-label">
            对象键名 (Key)
            <span class="help-text">（默认: wereader_notes.db）</span>
          </label>
          <input
            class="mdui-textfield-input"
            type="text"
            bind:value={config.key}
            placeholder="wereader_notes.db"
            disabled={testLoading || saveLoading}
          />
        </div>

        <label class="mdui-checkbox">
          <input
            type="checkbox"
            bind:checked={config.forcePathStyle}
            disabled={testLoading || saveLoading}
          />
          <i class="mdui-checkbox-icon"></i>
          使用路径样式 (Path-style)
          <span class="help-text">（MinIO 等私有 S3 通常需要）</span>
        </label>

        <div class="help-section">
          <div class="help-title">支持的服务:</div>
          <ul class="help-list">
            <li>AWS S3</li>
            <li>S3Drive</li>
            <li>MinIO</li>
            <li>阿里云 OSS（S3 兼容模式）</li>
            <li>腾讯云 COS（S3 兼容模式）</li>
            <li>Cloudflare R2</li>
          </ul>
        </div>
      </div>

      <div class="mdui-card-actions settings-actions">
        <button
          class="mdui-btn mdui-btn-raised mdui-color-theme"
          on:click={handleTest}
          disabled={testLoading || saveLoading}
        >
          {#if testLoading}
            <i class="mdui-icon material-icons mdui-spin">refresh</i>
          {:else}
            测试连接
          {/if}
        </button>
        <button
          class="mdui-btn mdui-btn-raised mdui-color-red"
          on:click={handleClear}
          disabled={testLoading || saveLoading}
        >
          清除配置
        </button>
        <div class="spacer"></div>
        <button
          class="mdui-btn mdui-btn-raised mdui-color-theme"
          on:click={handleSave}
          disabled={testLoading || saveLoading}
        >
          {#if saveLoading}
            <i class="mdui-icon material-icons mdui-spin">refresh</i>
          {:else}
            保存配置
          {/if}
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

  .mdui-textfield-helper {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.38);
    margin-top: 4px;
  }

  .secret-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .secret-input-wrapper .mdui-textfield-input {
    flex: 1;
    padding-right: 40px;
  }

  .toggle-visibility {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    padding: 6px;
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

  .help-text {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.38);
    margin-left: 4px;
  }

  .help-section {
    margin-top: 16px;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 4px;
  }

  .help-title {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .help-list {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.6);
  }

  .help-list li {
    margin-bottom: 4px;
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

  .mdui-color-red {
    background-color: #f44336;
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
