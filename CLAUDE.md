# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 WXT 框架的浏览器扩展，用于导出微信读书（weread.qq.com）的读书笔记。

功能演进路径：Markdown 导出 → SQLite 本地存储 → S3 云备份 → **直接写入远程 PostgreSQL（通过 PostgREST HTTP API）**。当前主功能是通过顶部工具栏的"云上传"按钮触发批量全量同步到 PostgREST 数据库。

## 常用命令

```bash
# 开发（热重载）
pnpm dev

# Firefox 开发
pnpm dev:firefox

# 构建生产版本
pnpm build

# 打包为 zip（商店发布）
pnpm zip

# TypeScript 类型检查
pnpm check
```

安装依赖时会通过 `postinstall` 自动运行 `wxt prepare`。

## 架构说明

### WXT 框架约定

- 入口点放在 `src/entrypoints/` 目录下
- `background.ts` - MV3 Service Worker 后台脚本
- `content.ts` - 内容脚本（当前为占位）
- `popup/` - 弹窗 UI（Svelte 组件）

### 核心组件

- `App.svelte` - 登录状态检测，调用 `/api/user/notebook` 判断是否登录
- `List.svelte` - 书籍列表展示和导出触发（顶部云上传按钮调用 `syncAllBooksToDatabase`）
- `Settings.svelte` - 配置弹窗：PostgREST URL、本地导出目录路径、自动同步开关与间隔
- `popup/utils.js` - `Book` 类，负责按章节合并划线/评论并生成 Markdown 文本

### 数据存储架构

当前采用 **PostgREST HTTP API** 直接写入远程 PostgreSQL：

- `src/utils/db.ts` - PostgREST 数据库操作层（`books`、`chapters`、`highlights`、`sync_state`、`users` 表）
- `src/utils/sync.ts` - 全量同步核心：并行获取所有书籍数据，串行写入数据库
- `src/utils/file.ts` - 本地文件兼容层（PostgREST 模式下为虚拟实现，保留历史 API 兼容）

默认 PostgREST 地址在 `db.ts` 中硬编码为 `http://43.139.41.82:3000`，用户可在 Settings 中覆写。

### 数据流

1. **登录检测**（`App.svelte`）：调用 `https://weread.qq.com/api/user/notebook`
   - 错误码 `-2012` = 登录超时，`-2010` = 其他登录错误
2. **书籍列表**（`List.svelte`）：调用同一 API 提取 `data.books.map(v => v.book)`
3. **批量同步**（`sync.ts`）：对每本书并行发起 3 个请求：
   - `https://weread.qq.com/web/book/bookmarklist?bookId={id}&synckey={key}`
   - `https://weread.qq.com/web/review/list?bookId={id}&mine=1&listType=11&maxIdx=0&count=0&listMode=2&synckey=0&userVid={userVid}`
   - `https://weread.qq.com/web/book/getProgress?bookId={id}`
4. **写入数据库**：HTTP 获取完成后，串行调用 `db.ts` 中的 CRUD 方法写入 PostgREST
5. **生成 Markdown**：`popup/utils.js` 中的 `Book` 类按 `chapterUid` 分组、按 `range` 排序后输出 Markdown

### 后台自动同步（`background.ts`）

- 使用 `chrome.alarms` 设置定时 alarm（默认 24 小时）
- alarm 触发时自动调用 `syncAllBooksToDatabase()` 同步全部书籍
- 同步完成后发送桌面通知（`chrome.notifications`）
- 保存/获取文件名的消息处理（`SAVE_FILE_NAME` / `GET_FILE_NAME` / `CLEAR_FILE_NAME`）为历史兼容保留

### 特殊配置

Svelte 直接在 `wxt.config.ts` 中配置，不使用独立的 `svelte.config.js`（会导致段错误）。

路径别名：`@/` 和 `~/` 都指向 `src/` 目录。

`vite.base` 在开发模式下为空串，生产环境用 `"./"` 相对路径，避免扩展中绝对路径问题。

`mainFields: ["browser", "module", "main"]` 确保 `aws-sdk` 正确解析到浏览器版本。

`build:done` hook 修复 `popup.html` 中 `../../../` 为 `./` 的路径问题。
