-- 诊断脚本：检查表、schema 和权限

-- 1. 检查当前数据库
SELECT '当前数据库: ' || current_database() as info;

-- 2. 检查所有 schema 中的表
SELECT
    table_schema,
    table_name
FROM information_schema.tables
WHERE table_name IN ('users', 'books', 'chapters', 'highlights', 'sync_state')
ORDER BY table_schema, table_name;

-- 3. 如果表在 public schema 中，检查权限
SELECT
    table_name,
    grantee,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
AND table_name IN ('users', 'books', 'chapters', 'highlights', 'sync_state')
ORDER BY table_name, privilege_type;

-- 4. 检查 public schema 是否存在
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'public';

-- 5. 检查搜索路径
SHOW search_path;
