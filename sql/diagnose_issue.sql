-- 诊断脚本：确认数据库和表状态

-- 1. 确认当前连接的数据库
SELECT
    '当前数据库' as info,
    current_database() as database_name,
    current_user as username,
    current_schema() as schema;

-- 2. 列出所有数据库
\l

-- 3. 检查 public schema 中的表
SELECT
    table_schema,
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 4. 检查所有 schema 中的表（以防表创建在了其他 schema）
SELECT
    table_schema,
    COUNT(*) as table_count
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
GROUP BY table_schema;

-- 5. 检查是否有 DDL 执行错误日志（如果有日志表的话）
-- 这只是一个查询，不会报错
SELECT '诊断完成' as status;
