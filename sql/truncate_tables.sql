-- 清空 PostgreSQL 所有数据表
-- 注意：此操作会删除所有数据，请谨慎使用

-- 按依赖关系顺序清空（先清空有外键依赖的表）
TRUNCATE TABLE knowledge_source_links CASCADE;
TRUNCATE TABLE knowledge_expansions CASCADE;
TRUNCATE TABLE book_exports CASCADE;
TRUNCATE TABLE sync_state CASCADE;
TRUNCATE TABLE highlights CASCADE;
TRUNCATE TABLE chapters CASCADE;
TRUNCATE TABLE books CASCADE;
TRUNCATE TABLE users CASCADE;

-- 重置自增序列（如果有）
ALTER SEQUENCE IF EXISTS highlights_id_seq RESTART WITH 1;

-- 验证清空结果
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'books', COUNT(*) FROM books
UNION ALL
SELECT 'chapters', COUNT(*) FROM chapters
UNION ALL
SELECT 'highlights', COUNT(*) FROM highlights
UNION ALL
SELECT 'sync_state', COUNT(*) FROM sync_state
UNION ALL
SELECT 'knowledge_expansions', COUNT(*) FROM knowledge_expansions
UNION ALL
SELECT 'knowledge_source_links', COUNT(*) FROM knowledge_source_links
UNION ALL
SELECT 'book_exports', COUNT(*) FROM book_exports;
