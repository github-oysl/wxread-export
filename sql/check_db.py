#!/usr/bin/env python3
"""
直接连接PostgreSQL诊断脚本
"""

import sys

# 数据库连接配置
DB_HOST = "43.139.41.82"
DB_PORT = 5432
DB_NAME = "mydb"
DB_USER = "postgres"
DB_PASS = "postgres"  # 默认密码，可能需要修改

def check_with_psycopg2():
    """使用 psycopg2 连接"""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        cursor = conn.cursor()

        print(f"✓ 成功连接到数据库: {DB_NAME}")
        print()

        # 检查当前数据库
        cursor.execute("SELECT current_database(), current_user, current_schema()")
        db, user, schema = cursor.fetchone()
        print(f"当前数据库: {db}")
        print(f"当前用户: {user}")
        print(f"当前schema: {schema}")
        print()

        # 检查所有schema中的表
        cursor.execute("""
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name
        """)
        tables = cursor.fetchall()

        if not tables:
            print("⚠ 警告: 数据库中没有任何表!")
            print()

            # 检查所有schema
            cursor.execute("""
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            """)
            schemas = cursor.fetchall()
            print("存在的schema:")
            for s in schemas:
                print(f"  - {s[0]}")
        else:
            print(f"找到 {len(tables)} 张表:")
            print()
            current_schema = None
            for schema, table, ttype in tables:
                if schema != current_schema:
                    current_schema = schema
                    print(f"\nSchema: {schema}")
                print(f"  - {table} ({ttype})")

        cursor.close()
        conn.close()
        return True

    except ImportError:
        print("未安装 psycopg2，尝试其他方法...")
        return False
    except Exception as e:
        print(f"连接失败: {e}")
        return False

def check_with_pg8000():
    """使用 pg8000 连接"""
    try:
        import pg8000
        conn = pg8000.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        cursor = conn.cursor()

        print(f"✓ 成功连接到数据库: {DB_NAME}")
        print()

        cursor.execute("SELECT current_database(), current_user")
        row = cursor.fetchone()
        print(f"当前数据库: {row[0]}")
        print(f"当前用户: {row[1]}")
        print()

        cursor.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        tables = cursor.fetchall()

        if not tables:
            print("⚠ 警告: public schema 中没有任何表!")
        else:
            print(f"找到 {len(tables)} 张表:")
            for schema, table in tables:
                print(f"  - {table}")

        cursor.close()
        conn.close()
        return True

    except ImportError:
        print("未安装 pg8000")
        return False
    except Exception as e:
        print(f"连接失败: {e}")
        return False

def main():
    print("=" * 60)
    print("PostgreSQL 数据库诊断")
    print("=" * 60)
    print(f"主机: {DB_HOST}:{DB_PORT}")
    print(f"数据库: {DB_NAME}")
    print(f"用户: {DB_USER}")
    print()

    # 尝试使用 psycopg2
    if check_with_psycopg2():
        return

    print()

    # 尝试使用 pg8000
    if check_with_pg8000():
        return

    print()
    print("请安装 PostgreSQL 驱动:")
    print("  pip install psycopg2-binary")
    print("  或")
    print("  pip install pg8000")

if __name__ == "__main__":
    main()
