-- 检查表是否存在以及 schema
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE tablename IN ('users', 'books', 'chapters', 'highlights', 'sync_state')
ORDER BY schemaname, tablename;

-- 检查当前数据库
SELECT current_database();

-- 检查 search_path
SHOW search_path;

-- 检查表权限
SELECT
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE table_name IN ('users', 'books', 'chapters', 'highlights', 'sync_state');
