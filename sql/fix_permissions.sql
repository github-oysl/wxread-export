-- 修复权限脚本
-- 确保 PostgREST 和 postgres 用户可以访问所有表

-- 1. 授予 public schema 的使用权限
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO web_anon;

-- 2. 授予所有现有表的操作权限
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO web_anon;

-- 3. 授予未来创建表的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO web_anon;

-- 4. 授予序列权限（对于自增ID）
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO web_anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO web_anon;

-- 验证权限
SELECT '权限已授予 postgres, web_anon' as status;
