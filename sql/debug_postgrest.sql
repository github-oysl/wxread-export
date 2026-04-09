-- 在 PostgreSQL 中执行这个函数来确认 PostgREST 连接的是哪个数据库
-- 这个函数可以被 PostgREST 调用

-- 创建一个诊断函数供 PostgREST 调用
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

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.debug_connection() TO postgres;

-- 验证函数创建成功
SELECT '诊断函数已创建' as status;
