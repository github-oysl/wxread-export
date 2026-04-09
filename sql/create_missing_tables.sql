-- 创建缺失的3张表（knowledge_expansions, knowledge_source_links, book_exports）

-- 6. knowledge_expansions - 知识扩展数据
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

-- 为 knowledge_expansions 创建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_exp_user ON knowledge_expansions(user_vid);
CREATE INDEX IF NOT EXISTS idx_knowledge_exp_highlight ON knowledge_expansions(highlight_id);

-- 7. knowledge_source_links - 知识源链接
CREATE TABLE IF NOT EXISTS knowledge_source_links (
  link_id INTEGER PRIMARY KEY,
  expansion_id INTEGER,
  highlight_id INTEGER,
  user_vid TEXT,
  extraction_confidence REAL,
  created_at TIMESTAMP
);

-- 为 knowledge_source_links 创建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_link_user ON knowledge_source_links(user_vid);
CREATE INDEX IF NOT EXISTS idx_knowledge_link_exp ON knowledge_source_links(expansion_id);

-- 8. book_exports - 书籍导出记录
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

-- 为 book_exports 创建索引
CREATE INDEX IF NOT EXISTS idx_book_exports_user ON book_exports(user_vid);
CREATE INDEX IF NOT EXISTS idx_book_exports_book ON book_exports(book_id);

-- 验证表创建成功
SELECT
  'knowledge_expansions' as table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'knowledge_expansions'
UNION ALL
SELECT
  'knowledge_source_links',
  COUNT(*)
FROM information_schema.columns
WHERE table_name = 'knowledge_source_links'
UNION ALL
SELECT
  'book_exports',
  COUNT(*)
FROM information_schema.columns
WHERE table_name = 'book_exports';
