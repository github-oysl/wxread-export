-- 为 highlights 表添加缺失的 extraction_status 字段
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS extraction_status TEXT;

-- 验证字段添加成功
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'highlights'
ORDER BY ordinal_position;
