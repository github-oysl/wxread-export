#!/bin/bash
# 简单的 HTTP 测试命令

POSTGREST_URL="http://43.139.41.82:3000"

echo "=== 测试 1: 基础连接 ==="
curl -s "${POSTGREST_URL}/" | python3 -m json.tool 2>/dev/null || curl -s "${POSTGREST_URL}/" | head -20

echo -e "\n\n=== 测试 2: 查询 users 表 ==="
curl -s "${POSTGREST_URL}/users" | head -c 500

echo -e "\n\n=== 测试 3: 插入测试（将失败或成功） ==="
RESULT=$(curl -s -X POST "${POSTGREST_URL}/users" \
  -H "Content-Type: application/json" \
  -d '{"user_vid":"diag_test","user_name":"Diagnostic"}')
echo "Response: $RESULT"

echo -e "\n\n=== 测试 4: 删除测试数据 ==="
curl -s -X DELETE "${POSTGREST_URL}/users?user_vid=eq.diag_test"
echo "删除完成"

echo -e "\n诊断完成"
