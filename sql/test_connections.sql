-- PostgreSQL 连接测试脚本
-- 在 psql 中执行以确认数据库状态

-- 1. 检查当前连接信息
SELECT
    '连接成功' as status,
    current_database() as database,
    current_user as username,
    version() as postgres_version;

-- 2. 检查 public schema 中的表
SELECT
    table_schema,
    table_name,
    '存在' as status
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 3. 检查表结构
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 4. 测试插入权限（会回滚）
BEGIN;
INSERT INTO users (user_vid, user_name) VALUES ('test_user', 'Test');
SELECT '写入权限正常' as write_test;
ROLLBACK;

-- 5. 检查是否有触发器
SELECT
    tgname as trigger_name,
    relname as table_name,
    tgenabled as enabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname IN ('users', 'books', 'chapters', 'highlights', 'sync_state')
AND NOT tgisinternal;
