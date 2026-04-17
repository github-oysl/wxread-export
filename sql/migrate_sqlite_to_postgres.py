#!/usr/bin/env python3
"""
SQLite 到 PostgreSQL 数据迁移脚本
通过 PostgREST HTTP API 写入数据
"""

import sqlite3
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime

# 默认配置（可通过环境变量或命令行参数覆盖）
DEFAULT_POSTGREST_URL = "http://43.139.41.82:3000"


def get_config():
    """从环境变量和命令行参数读取配置"""
    import argparse
    parser = argparse.ArgumentParser(description="SQLite 到 PostgreSQL 数据迁移")
    parser.add_argument("sqlite_path", help="SQLite 数据库文件路径")
    parser.add_argument("--postgrest-url", default=os.environ.get("POSTGREST_URL", DEFAULT_POSTGREST_URL), help="PostgREST URL")
    parser.add_argument("--jwt-token", default=os.environ.get("POSTGREST_JWT_TOKEN", ""), help="JWT Token（如已启用 JWT 认证则必填）")
    parser.add_argument("--yes", action="store_true", help="自动确认，不再询问")
    args = parser.parse_args()
    return args


def sqlite_to_iso_timestamp(ts):
    """将 SQLite 时间戳转换为 ISO 格式"""
    if ts is None:
        return None
    if isinstance(ts, str):
        # 已经是字符串格式，直接返回
        return ts
    if isinstance(ts, (int, float)):
        # Unix 时间戳（秒）
        return datetime.fromtimestamp(ts).isoformat()
    return str(ts)


def postgrest_insert(table, data, postgrest_url, jwt_token):
    """通过 PostgREST 插入数据"""
    url = f"{postgrest_url}/{table}"
    headers = {
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    }
    if jwt_token:
        headers["Authorization"] = f"Bearer {jwt_token}"

    # 处理数据类型
    payload = {}
    for key, value in data.items():
        if value is None:
            continue
        # 布尔值转换
        if isinstance(value, bool):
            payload[key] = int(value)
        else:
            payload[key] = value

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status == 201 or response.status == 200
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"  插入失败: {e.code} {error_body}")
        return False
    except Exception as e:
        print(f"  请求失败: {e}")
        return False


def migrate_users(sqlite_conn, postgrest_url, jwt_token):
    """迁移 users 表"""
    print("\n=== 迁移 users 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT user_vid, user_name, first_seen_at FROM users")
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        user_vid, user_name, first_seen_at = row
        data = {
            "user_vid": user_vid,
            "user_name": user_name or "",
            "first_seen_at": sqlite_to_iso_timestamp(first_seen_at) or datetime.now().isoformat()
        }
        if postgrest_insert("users", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1
            print(f"  失败: user_vid={user_vid}")

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_books(sqlite_conn, postgrest_url, jwt_token):
    """迁移 books 表"""
    print("\n=== 迁移 books 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT book_id, title, author, cover, format, created_at FROM books")
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        book_id, title, author, cover, format, created_at = row
        data = {
            "book_id": book_id,
            "title": title or "",
            "author": author or "",
            "cover": cover or "",
            "format": format or "epub",
            "created_at": sqlite_to_iso_timestamp(created_at) or datetime.now().isoformat()
        }
        if postgrest_insert("books", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_chapters(sqlite_conn, postgrest_url, jwt_token):
    """迁移 chapters 表"""
    print("\n=== 迁移 chapters 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT book_id, chapter_uid, chapter_idx, title FROM chapters")
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        book_id, chapter_uid, chapter_idx, title = row
        data = {
            "book_id": book_id,
            "chapter_uid": chapter_uid,
            "chapter_idx": chapter_idx or 0,
            "title": title or ""
        }
        if postgrest_insert("chapters", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_highlights(sqlite_conn, postgrest_url, jwt_token):
    """迁移 highlights 表"""
    print("\n=== 迁移 highlights 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("""
        SELECT id, user_vid, bookmark_id, book_id, chapter_uid, chapter_title,
               range, mark_text, note_text, style, type, created_at, updated_at
        FROM highlights
    """)
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for i, row in enumerate(rows):
        id_, user_vid, bookmark_id, book_id, chapter_uid, chapter_title, \
        range_, mark_text, note_text, style, type_, created_at, updated_at = row

        data = {
            "user_vid": user_vid,
            "bookmark_id": bookmark_id,
            "book_id": book_id,
            "chapter_uid": chapter_uid or 0,
            "chapter_title": chapter_title or "",
            "range": range_ or "",
            "mark_text": mark_text or "",
            "note_text": note_text or "",
            "style": style or 0,
            "type": type_ or 1,
            "created_at": sqlite_to_iso_timestamp(created_at) or datetime.now().isoformat(),
            "updated_at": sqlite_to_iso_timestamp(updated_at)
        }

        if postgrest_insert("highlights", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1
            if failed <= 5:  # 只显示前5个错误
                print(f"  失败: id={id_}, bookmark_id={bookmark_id}")

        # 每100条显示进度
        if (i + 1) % 100 == 0:
            print(f"  进度: {i + 1}/{len(rows)}")

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_sync_state(sqlite_conn, postgrest_url, jwt_token):
    """迁移 sync_state 表"""
    print("\n=== 迁移 sync_state 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("""
        SELECT user_vid, book_id, sync_key, last_sync_at, reading_time,
               start_reading_at, finish_reading_at
        FROM sync_state
    """)
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        user_vid, book_id, sync_key, last_sync_at, reading_time, \
        start_reading_at, finish_reading_at = row

        data = {
            "user_vid": user_vid,
            "book_id": book_id,
            "sync_key": sync_key or 0,
            "last_sync_at": sqlite_to_iso_timestamp(last_sync_at) or datetime.now().isoformat(),
            "reading_time": reading_time or 0,
            "start_reading_at": sqlite_to_iso_timestamp(start_reading_at),
            "finish_reading_at": sqlite_to_iso_timestamp(finish_reading_at)
        }

        if postgrest_insert("sync_state", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_knowledge_expansions(sqlite_conn, postgrest_url, jwt_token):
    """迁移 knowledge_expansions 表"""
    print("\n=== 迁移 knowledge_expansions 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("""
        SELECT expansion_id, highlight_id, user_vid, concept_id, concept_name,
               concept_aliases, concept_type, section_definition, section_simple,
               section_key_points, section_timeline, section_related,
               section_learning_path, section_diagram, section_notes,
               source_highlights, source_references, status, created_at, updated_at
        FROM knowledge_expansions
    """)
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for i, row in enumerate(rows):
        (expansion_id, highlight_id, user_vid, concept_id, concept_name,
         concept_aliases, concept_type, section_definition, section_simple,
         section_key_points, section_timeline, section_related,
         section_learning_path, section_diagram, section_notes,
         source_highlights, source_references, status, created_at, updated_at) = row

        data = {
            "expansion_id": expansion_id,
            "highlight_id": highlight_id,
            "user_vid": user_vid,
            "concept_id": concept_id or "",
            "concept_name": concept_name or "",
            "concept_aliases": concept_aliases or "",
            "concept_type": concept_type or "",
            "section_definition": section_definition or "",
            "section_simple": section_simple or "",
            "section_key_points": section_key_points or "",
            "section_timeline": section_timeline or "",
            "section_related": section_related or "",
            "section_learning_path": section_learning_path or "",
            "section_diagram": section_diagram or "",
            "section_notes": section_notes or "",
            "source_highlights": source_highlights or "",
            "source_references": source_references or "",
            "status": status or "",
            "created_at": sqlite_to_iso_timestamp(created_at),
            "updated_at": sqlite_to_iso_timestamp(updated_at)
        }

        if postgrest_insert("knowledge_expansions", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1
            if failed <= 5:
                print(f"  失败: expansion_id={expansion_id}")

        if (i + 1) % 50 == 0:
            print(f"  进度: {i + 1}/{len(rows)}")

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_knowledge_source_links(sqlite_conn, postgrest_url, jwt_token):
    """迁移 knowledge_source_links 表"""
    print("\n=== 迁移 knowledge_source_links 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("""
        SELECT link_id, expansion_id, highlight_id, user_vid, extraction_confidence, created_at
        FROM knowledge_source_links
    """)
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        link_id, expansion_id, highlight_id, user_vid, extraction_confidence, created_at = row

        data = {
            "link_id": link_id,
            "expansion_id": expansion_id,
            "highlight_id": highlight_id,
            "user_vid": user_vid,
            "extraction_confidence": extraction_confidence or 0.0,
            "created_at": sqlite_to_iso_timestamp(created_at)
        }

        if postgrest_insert("knowledge_source_links", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def migrate_book_exports(sqlite_conn, postgrest_url, jwt_token):
    """迁移 book_exports 表"""
    print("\n=== 迁移 book_exports 表 ===")
    cursor = sqlite_conn.cursor()
    cursor.execute("""
        SELECT export_id, book_id, user_vid, format, markdown_content, highlights_hash,
               highlights_count, generated_at, file_path, created_at, updated_at
        FROM book_exports
    """)
    rows = cursor.fetchall()

    success = 0
    failed = 0
    for row in rows:
        (export_id, book_id, user_vid, format_, markdown_content, highlights_hash,
         highlights_count, generated_at, file_path, created_at, updated_at) = row

        data = {
            "export_id": export_id,
            "book_id": book_id,
            "user_vid": user_vid,
            "format": format_ or "",
            "markdown_content": markdown_content or "",
            "highlights_hash": highlights_hash or "",
            "highlights_count": highlights_count or 0,
            "generated_at": sqlite_to_iso_timestamp(generated_at),
            "file_path": file_path or "",
            "created_at": sqlite_to_iso_timestamp(created_at),
            "updated_at": sqlite_to_iso_timestamp(updated_at)
        }

        if postgrest_insert("book_exports", data, postgrest_url, jwt_token):
            success += 1
        else:
            failed += 1

    print(f"  成功: {success}, 失败: {failed}")
    return success, failed


def get_sqlite_counts(sqlite_conn):
    """获取 SQLite 各表数据条数"""
    cursor = sqlite_conn.cursor()
    tables = ['users', 'books', 'chapters', 'highlights', 'sync_state',
              'knowledge_expansions', 'knowledge_source_links', 'book_exports']
    counts = {}
    for table in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = cursor.fetchone()[0]
        except Exception:
            counts[table] = 0
    return counts


def get_postgres_counts(postgrest_url, jwt_token):
    """获取 PostgreSQL 各表数据条数"""
    counts = {}
    tables = ['users', 'books', 'chapters', 'highlights', 'sync_state',
              'knowledge_expansions', 'knowledge_source_links', 'book_exports']

    for table in tables:
        try:
            headers = {"Accept": "application/json"}
            if jwt_token:
                headers["Authorization"] = f"Bearer {jwt_token}"
            req = urllib.request.Request(
                f"{postgrest_url}/{table}?select=count",
                headers=headers
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode('utf-8'))
                counts[table] = len(data) if isinstance(data, list) else 0
        except Exception as e:
            counts[table] = f"错误: {e}"

    return counts


def main():
    args = get_config()

    print("=" * 60)
    print("SQLite 到 PostgreSQL 数据迁移")
    print("=" * 60)
    print(f"SQLite 数据库: {args.sqlite_path}")
    print(f"PostgREST API: {args.postgrest_url}")
    print(f"JWT 认证: {'已配置' if args.jwt_token else '未配置'}")

    # 连接 SQLite
    print("\n连接 SQLite 数据库...")
    try:
        sqlite_conn = sqlite3.connect(args.sqlite_path)
    except Exception as e:
        print(f"连接 SQLite 失败: {e}")
        return

    # 获取迁移前数据条数
    print("\n=== 迁移前数据条数 ===")
    sqlite_counts = get_sqlite_counts(sqlite_conn)
    for table, count in sqlite_counts.items():
        print(f"  {table}: {count}")

    # 确认迁移
    print("\n" + "=" * 60)
    if args.yes:
        print("自动确认模式 (--yes)")
        response = 'yes'
    else:
        response = input("确认开始迁移? (yes/no): ")
    if response.lower() != 'yes':
        print("取消迁移")
        sqlite_conn.close()
        return

    # 执行迁移（按依赖顺序）
    results = {}
    results['users'] = migrate_users(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['books'] = migrate_books(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['chapters'] = migrate_chapters(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['highlights'] = migrate_highlights(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['sync_state'] = migrate_sync_state(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['knowledge_expansions'] = migrate_knowledge_expansions(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['knowledge_source_links'] = migrate_knowledge_source_links(sqlite_conn, args.postgrest_url, args.jwt_token)
    results['book_exports'] = migrate_book_exports(sqlite_conn, args.postgrest_url, args.jwt_token)

    # 关闭连接
    sqlite_conn.close()

    # 显示迁移结果
    print("\n" + "=" * 60)
    print("迁移结果汇总")
    print("=" * 60)
    total_success = 0
    total_failed = 0
    for table, (success, failed) in results.items():
        print(f"  {table}: 成功 {success}, 失败 {failed}")
        total_success += success
        total_failed += failed
    print(f"\n  总计: 成功 {total_success}, 失败 {total_failed}")

    # 验证 PostgreSQL 数据
    print("\n=== 验证 PostgreSQL 数据条数 ===")
    pg_counts = get_postgres_counts(args.postgrest_url, args.jwt_token)
    for table, count in pg_counts.items():
        print(f"  {table}: {count}")

    print("\n" + "=" * 60)
    print("迁移完成!")
    print("=" * 60)


if __name__ == "__main__":
    main()
