-- PostgreSQL 数据库初始化脚本
-- 用于 PostgREST 服务的 wxread-export 项目

-- 1. users - 用户表（解决多账号切换问题）
CREATE TABLE IF NOT EXISTS users (
  user_vid TEXT PRIMARY KEY,
  user_name TEXT,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. books - 书籍元数据
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  format TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. chapters - 章节信息
CREATE TABLE IF NOT EXISTS chapters (
  book_id TEXT,
  chapter_uid INTEGER,
  chapter_idx INTEGER,
  title TEXT,
  PRIMARY KEY (book_id, chapter_uid)
);

-- 4. highlights - 划线/笔记（含用户隔离）
-- 注意：SQLite 使用 INTEGER PRIMARY KEY AUTOINCREMENT
-- PostgreSQL 使用 GENERATED ALWAYS AS IDENTITY
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_vid TEXT NOT NULL,
  bookmark_id TEXT,
  book_id TEXT NOT NULL,
  chapter_uid INTEGER,
  chapter_title TEXT,
  range TEXT,
  mark_text TEXT,
  note_text TEXT,
  style INTEGER,
  type INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_vid, bookmark_id)
);

-- 为 highlights 表创建索引
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_vid);
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_vid, book_id);

-- 5. sync_state - 同步状态（按用户+书籍隔离）
CREATE TABLE IF NOT EXISTS sync_state (
  user_vid TEXT,
  book_id TEXT,
  sync_key INTEGER,
  last_sync_at TIMESTAMP,
  reading_time INTEGER,
  start_reading_at TIMESTAMP,
  finish_reading_at TIMESTAMP,
  PRIMARY KEY (user_vid, book_id)
);

-- 创建更新时间戳的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 为 highlights 表添加自动更新 updated_at 的触发器
DROP TRIGGER IF EXISTS update_highlights_updated_at ON highlights;
CREATE TRIGGER update_highlights_updated_at
  BEFORE UPDATE ON highlights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为 PostgREST 启用行级安全（可选，如果需要多用户隔离）
-- ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
