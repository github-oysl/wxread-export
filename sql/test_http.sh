#!/bin/bash
# PostgREST HTTP 连接测试脚本
# 在服务器上运行此脚本

POSTGREST_URL="http://localhost:3000"

echo "========================================"
echo "1. 测试 PostgREST 服务是否运行"
echo "========================================"
curl -s "${POSTGREST_URL}/" | head -c 500
echo ""
echo ""

echo "========================================"
echo "2. 测试表列表（OpenAPI 描述）"
echo "========================================"
curl -s "${POSTGREST_URL}/" | grep -o '"\/[^"]*"' | head -20
echo ""
echo ""

echo "========================================"
echo "3. 测试 GET 查询"
echo "========================================"
echo "测试 /users:"
curl -s "${POSTGREST_URL}/users?limit=1" -w "\nHTTP状态: %{http_code}\n"
echo ""

echo "测试 /books:"
curl -s "${POSTGREST_URL}/books?limit=1" -w "\nHTTP状态: %{http_code}\n"
echo ""

echo "========================================"
echo "4. 测试 POST 插入"
echo "========================================"
echo "尝试插入测试数据到 users 表:"
curl -s -X POST "${POSTGREST_URL}/users" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"user_vid":"test_http","user_name":"HTTP Test"}' \
  -w "\nHTTP状态: %{http_code}\n"
echo ""

echo "========================================"
echo "5. 测试 PATCH 更新"
echo "========================================"
echo "尝试更新测试数据:"
curl -s -X PATCH "${POSTGREST_URL}/users?user_vid=eq.test_http" \
  -H "Content-Type: application/json" \
  -d '{"user_name":"Updated Name"}' \
  -w "\nHTTP状态: %{http_code}\n"
echo ""

echo "========================================"
echo "6. 测试 DELETE"
echo "========================================"
echo "删除测试数据:"
curl -s -X DELETE "${POSTGREST_URL}/users?user_vid=eq.test_http" \
  -w "\nHTTP状态: %{http_code}\n"
echo ""

echo "========================================"
echo "7. 检查响应头（CORS 等）"
echo "========================================"
echo "发送 OPTIONS 请求:"
curl -s -X OPTIONS "${POSTGREST_URL}/users" \
  -H "Origin: http://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -D - \
  -o /dev/null
echo ""

echo "========================================"
echo "测试完成"
echo "========================================"
