# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 WXT 框架的浏览器扩展，用于导出微信读书（weread.qq.com）的读书笔记为 Markdown 格式。

## 常用命令

```bash
# 开发（热重载）
pnpm dev

# 构建生产版本
pnpm build

# 打包为 zip（商店发布）
pnpm zip

# TypeScript 类型检查
pnpm check
```

## 架构说明

### WXT 框架约定

- 入口点放在 `src/entrypoints/` 目录下
- `background.ts` - 后台脚本
- `content.ts` - 内容脚本
- `popup/` - 弹窗 UI（Svelte 组件）

### 核心组件

- `App.svelte` - 登录状态检测，调用 `/api/user/notebook` 判断是否登录
- `List.svelte` - 书籍列表展示和导出触发
- `utils.js` - 笔记处理核心逻辑，包含 `Book` 类用于生成 Markdown

### 数据处理流程

1. 获取笔记本列表 → 展示书籍
2. 选择书籍 → 并行获取划线、评论、进度
3. 按章节合并排序 → 生成 Markdown

### API 端点

插件直接调用微信读书 Web API：
- `https://weread.qq.com/api/user/notebook` - 笔记本列表
- `https://weread.qq.com/web/book/bookmarklist?bookId={id}` - 划线数据
- `https://weread.qq.com/web/review/list?bookId={id}&mine=1` - 评论数据
- `https://weread.qq.com/web/book/getProgress?bookId={id}` - 阅读进度

### 特殊配置

Svelte 直接在 `wxt.config.ts` 中配置，不使用独立的 `svelte.config.js`（会导致段错误）。

路径别名：`@/` 和 `~/` 都指向 `src/` 目录。

## 登录错误码

- `-2012`: 登录超时
- `-2010`: 其他登录错误
