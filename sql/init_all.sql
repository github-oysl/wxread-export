-- ============================================================
-- wxread-export 数据库完整初始化脚本
-- 用途：勒索攻击/数据库被重置后的全量重建
-- 执行方式：在 psql 中连接数据库后执行 \i init_all.sql
-- 或：psql -h <host> -U <user> -d <dbname> -f init_all.sql
-- ============================================================

-- --------------------------------------------------
-- 0. 前置：创建触发器函数（被多个表触发器依赖）
-- --------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- --------------------------------------------------
-- 1. 核心表：用户/书籍/章节/划线/同步状态
-- --------------------------------------------------

-- 1.1 users - 用户表
CREATE TABLE IF NOT EXISTS users (
  user_vid TEXT PRIMARY KEY,
  user_name TEXT,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1.2 books - 书籍元数据
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  format TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1.3 chapters - 章节信息
CREATE TABLE IF NOT EXISTS chapters (
  book_id TEXT,
  chapter_uid INTEGER,
  chapter_idx INTEGER,
  title TEXT,
  PRIMARY KEY (book_id, chapter_uid)
);

-- 1.4 highlights - 划线/笔记（含用户隔离）
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

-- highlights 索引
CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_vid);
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_vid, book_id);

-- highlights 触发器
DROP TRIGGER IF EXISTS update_highlights_updated_at ON highlights;
CREATE TRIGGER update_highlights_updated_at
  BEFORE UPDATE ON highlights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 1.5 sync_state - 同步状态
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

-- --------------------------------------------------
-- 2. 扩展表：知识扩展/导出记录
-- --------------------------------------------------

-- 2.1 knowledge_expansions - 知识扩展数据
CREATE TABLE IF NOT EXISTS knowledge_expansions (
  expansion_id INTEGER PRIMARY KEY,
  highlight_id INTEGER,
  user_vid TEXT,
  concept_id TEXT,
  concept_name TEXT,
  concept_aliases TEXT,
  concept_type TEXT,
  section_definition TEXT,
  section_simple TEXT,
  section_key_points TEXT,
  section_timeline TEXT,
  section_related TEXT,
  section_learning_path TEXT,
  section_diagram TEXT,
  section_notes TEXT,
  source_highlights TEXT,
  source_references TEXT,
  status TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_exp_user ON knowledge_expansions(user_vid);
CREATE INDEX IF NOT EXISTS idx_knowledge_exp_highlight ON knowledge_expansions(highlight_id);

-- 2.2 knowledge_source_links - 知识源链接
CREATE TABLE IF NOT EXISTS knowledge_source_links (
  link_id INTEGER PRIMARY KEY,
  expansion_id INTEGER,
  highlight_id INTEGER,
  user_vid TEXT,
  extraction_confidence REAL,
  created_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_link_user ON knowledge_source_links(user_vid);
CREATE INDEX IF NOT EXISTS idx_knowledge_link_exp ON knowledge_source_links(expansion_id);

-- 2.3 book_exports - 书籍导出记录
CREATE TABLE IF NOT EXISTS book_exports (
  export_id INTEGER PRIMARY KEY,
  book_id TEXT,
  user_vid TEXT,
  format TEXT,
  markdown_content TEXT,
  highlights_hash TEXT,
  highlights_count INTEGER,
  generated_at TIMESTAMP,
  file_path TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_exports_user ON book_exports(user_vid);
CREATE INDEX IF NOT EXISTS idx_book_exports_book ON book_exports(book_id);

-- --------------------------------------------------
-- 3. SRS 复习系统表
-- --------------------------------------------------

-- 3.1 flashcards - 卡片主表
CREATE TABLE IF NOT EXISTS flashcards (
    card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_vid TEXT NOT NULL,
    highlight_id INTEGER REFERENCES highlights(id) ON DELETE SET NULL,
    card_type TEXT NOT NULL CHECK (card_type IN ('highlight', 'qa', 'concept')),
    question_text TEXT NOT NULL,
    reference_text TEXT,
    book_id TEXT REFERENCES books(book_id),
    chapter_uid INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    auto_generated BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_vid);
CREATE INDEX IF NOT EXISTS idx_flashcards_book ON flashcards(book_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_highlight ON flashcards(highlight_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_active ON flashcards(user_vid, is_active);

DROP TRIGGER IF EXISTS update_flashcards_updated_at ON flashcards;
CREATE TRIGGER update_flashcards_updated_at
    BEFORE UPDATE ON flashcards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3.2 card_answers - 手动解答/知识点拓展
CREATE TABLE IF NOT EXISTS card_answers (
    answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES flashcards(card_id) ON DELETE CASCADE,
    user_vid TEXT NOT NULL,
    answer_type TEXT CHECK (answer_type IN ('manual_answer', 'expansion', 'hint')),
    content TEXT NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_answers_card ON card_answers(card_id);
CREATE INDEX IF NOT EXISTS idx_card_answers_user ON card_answers(user_vid);

DROP TRIGGER IF EXISTS update_card_answers_updated_at ON card_answers;
CREATE TRIGGER update_card_answers_updated_at
    BEFORE UPDATE ON card_answers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3.3 card_reviews - 复习记录
CREATE TABLE IF NOT EXISTS card_reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES flashcards(card_id) ON DELETE CASCADE,
    user_vid TEXT NOT NULL,
    reviewed_at TIMESTAMP,
    scheduled_at TIMESTAMP NOT NULL,
    ease_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetition_count INTEGER DEFAULT 0,
    lapses INTEGER DEFAULT 0,
    state TEXT DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning', 'suspended')),
    strategy TEXT DEFAULT 'sm2'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_reviews_card ON card_reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_card_reviews_scheduled ON card_reviews(user_vid, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_card_reviews_state ON card_reviews(user_vid, state);

-- --------------------------------------------------
-- 4. 字段补丁
-- --------------------------------------------------
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS extraction_status TEXT;

-- --------------------------------------------------
-- 5. 诊断函数（供 PostgREST 调用）
-- --------------------------------------------------
CREATE OR REPLACE FUNCTION public.debug_connection()
RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'database', current_database(),
        'user', current_user,
        'schema', current_schema(),
        'search_path', current_setting('search_path'),
        'tables_found', (
            SELECT json_agg(tablename)
            FROM pg_tables
            WHERE schemaname = 'public'
        )
    );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.debug_connection() TO postgres;

-- --------------------------------------------------
-- 6. 权限修复
-- --------------------------------------------------
GRANT USAGE ON SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- --------------------------------------------------
-- 7. 验证：列出所有已创建的表
-- --------------------------------------------------
SELECT
    'users' as table_name,
    COUNT(*) as column_count
FROM information_schema.columns WHERE table_name = 'users'
UNION ALL
SELECT 'books', COUNT(*) FROM information_schema.columns WHERE table_name = 'books'
UNION ALL
SELECT 'chapters', COUNT(*) FROM information_schema.columns WHERE table_name = 'chapters'
UNION ALL
SELECT 'highlights', COUNT(*) FROM information_schema.columns WHERE table_name = 'highlights'
UNION ALL
SELECT 'sync_state', COUNT(*) FROM information_schema.columns WHERE table_name = 'sync_state'
UNION ALL
SELECT 'knowledge_expansions', COUNT(*) FROM information_schema.columns WHERE table_name = 'knowledge_expansions'
UNION ALL
SELECT 'knowledge_source_links', COUNT(*) FROM information_schema.columns WHERE table_name = 'knowledge_source_links'
UNION ALL
SELECT 'book_exports', COUNT(*) FROM information_schema.columns WHERE table_name = 'book_exports'
UNION ALL
SELECT 'flashcards', COUNT(*) FROM information_schema.columns WHERE table_name = 'flashcards'
UNION ALL
SELECT 'card_answers', COUNT(*) FROM information_schema.columns WHERE table_name = 'card_answers'
UNION ALL
SELECT 'card_reviews', COUNT(*) FROM information_schema.columns WHERE table_name = 'card_reviews';
