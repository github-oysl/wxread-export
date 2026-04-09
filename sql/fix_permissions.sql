-- 修复权限脚本
-- 确保 postgres 用户可以访问所有表

-- 1. 授予 public schema 的使用权限
GRANT USAGE ON SCHEMA public TO postgres;

-- 2. 授予所有表的查询和操作权限
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;

-- 3. 授予未来创建表的默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;

-- 4. 授予序列权限（对于自增ID）
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

-- 验证权限
SELECT '权限已授予' as status;
