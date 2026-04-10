#!/usr/bin/env python3
"""
通过 PostgREST HTTP API 查询表是否存在
不需要 PostgreSQL 驱动
"""

import urllib.request
import urllib.error
import json

POSTGREST_URL = "http://43.139.41.82:3000"

def query_postgrest(endpoint):
    """查询 PostgREST"""
    url = f"{POSTGREST_URL}{endpoint}"
    headers = {"Accept": "application/json"}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))
    except Exception as e:
        return -1, str(e)

def main():
    print("=" * 60)
    print("PostgREST API 表查询")
    print("=" * 60)
    print(f"API地址: {POSTGREST_URL}")
    print()

    # 查询所有表
    status, result = query_postgrest("/")
    print(f"OpenAPI 状态: {status}")

    if status == 200:
        # 解析 OpenAPI 中的 paths
        paths = result.get('paths', {})
        tables = [p for p in paths.keys() if p.startswith('/') and not p.startswith('/rpc/') and p != '/']

        if tables:
            print(f"\nPostgREST 可见的表 ({len(tables)} 张):")
            for t in tables:
                print(f"  - {t}")
        else:
            print("\n[!] PostgREST 看不到任何表!")
            print("\n可能原因:")
            print("  1. 数据库 mydb 中没有表")
            print("  2. 表创建在了其他 schema 中（非 public）")
            print("  3. PostgREST 配置的数据库不是 mydb")
            print("  4. 表没有权限访问")

        # 检查 PostgREST 配置的数据库
        print("\n" + "=" * 60)
        print("PostgREST 配置信息:")
        print("=" * 60)

        # 尝试查询 pg_tables 系统表
        status2, result2 = query_postgrest("/pg_tables?schemaname=eq.public")
        print(f"查询 pg_tables 状态: {status2}")
        if status2 == 200:
            print(f"结果: {result2}")
        else:
            print(f"错误: {result2}")

    else:
        print(f"查询失败: {result}")

    # 测试具体表
    print("\n" + "=" * 60)
    print("测试具体表查询:")
    print("=" * 60)

    tables_to_check = ['users', 'books', 'chapters', 'highlights',
                       'sync_state', 'knowledge_expansions',
                       'knowledge_source_links', 'book_exports']

    for table in tables_to_check:
        status, result = query_postgrest(f"/{table}?limit=1")
        if status == 200:
            print(f"  [OK] {table}: 存在 (状态 {status})")
        elif status == 404:
            error_msg = result.get('message', '')
            if "Could not find" in error_msg:
                print(f"  [X] {table}: 不存在 ({error_msg})")
            else:
                print(f"  [?] {table}: 其他错误 ({error_msg})")
        else:
            print(f"  [?] {table}: 状态 {status}")

if __name__ == "__main__":
    main()
