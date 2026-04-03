<script>
  import List from "./List.svelte";
  import Login from "./Login.svelte";

  console.log("[App] 组件脚本开始执行");

  let loading = true;
  let user = { loggedIn: false, loginStatus: "unlogin" };
  let error = null;

  async function checkLogin() {
    console.log("[App] 开始检查登录状态");
    try {
      const response = await fetch("https://weread.qq.com/api/user/notebook");
      const data = await response.json();
      console.log("[App] API 响应:", data);

      loading = false;

      if (!data?.data?.errcode) {
        user.loggedIn = true;
        user.userVid = data?.user?.vid || data?.data?.user?.vid || data?.userVid || "";
        console.log("[App] 登录成功, userVid:", user.userVid);
      } else {
        user.loggedIn = false;
        if (data?.data?.errcode === -2012) {
          user.loginStatus = "timeout";
        } else {
          user.loginStatus = "unlogin";
        }
        console.log("[App] 未登录, status:", user.loginStatus);
      }
    } catch (e) {
      console.error("[App] 检查登录失败:", e);
      loading = false;
      error = e.message;
    }
  }

  checkLogin();
</script>

{#if loading}
  <div class="loading-container">
    <div class="spinner"></div>
    <div class="loading-text">正在检查登录状态...</div>
  </div>
{/if}

{#if error}
  <div class="error-container">
    <div class="error-title">出错了</div>
    <div class="error-message">{error}</div>
  </div>
{/if}

{#if !loading && !error}
  <div class="app-container">
    {#if user.loggedIn}
      <List userVid={user.userVid} />
    {:else}
      <Login loginStatus={user.loginStatus} />
    {/if}
  </div>
{/if}

<style>
  .app-container {
    width: 520px;
    min-height: 400px;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 520px;
    height: 400px;
    gap: 16px;
    background: #fff;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e0e0e0;
    border-top-color: #3f51b5;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    color: #666;
    font-size: 14px;
  }

  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 520px;
    height: 400px;
    gap: 12px;
    padding: 20px;
    box-sizing: border-box;
    background: #fff;
  }

  .error-title {
    font-size: 18px;
    font-weight: bold;
    color: #f44336;
  }

  .error-message {
    font-size: 14px;
    color: #666;
    text-align: center;
  }
</style>
