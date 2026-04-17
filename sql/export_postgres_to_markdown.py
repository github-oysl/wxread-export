#!/usr/bin/env python3
"""
从 PostgreSQL（通过 PostgREST）导出微信读书笔记为 Markdown。
供本地运行，将数据库中的书籍和笔记渲染成 Obsidian 兼容的 Markdown 文件。
支持知识点卡片导出、增量更新与 --force 参数。
"""

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

DEFAULT_POSTGREST_URL = "http://43.139.41.82:3000"
DEFAULT_OUTPUT_DIR = "./wereader-export"
CONFIG_FILE_NAME = "export_config.json"
META_FILE_NAME = ".export_meta.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("export_postgres_to_markdown")

# ======================================================================
# Markdown 模板
# ======================================================================

CONCEPT_TEMPLATE = """---
concept_id: "{concept_id}"
concept_type: "concept"
concept_name: "{concept_name}"
aliases: {json_aliases}
source_books: {json_source_books}
generated_at: "{generated_at}"
---

# 概念：{concept_name}

## 定义
{section_definition}

## 通俗理解
{section_simple}

## 要点
{numbered_key_points}

## 时间线
{bulleted_timeline}

## 相关概念
{related_links}

## 学习路径
{numbered_learning_path}

{extra_sections}"""

NOTE_TEMPLATE = """---
concept_id: "{concept_id}"
concept_type: "note"
concept_name: "{concept_name}"
aliases: {json_aliases}
source_books: {json_source_books}
generated_at: "{generated_at}"
---

# 笔记：{concept_name}

## 定义
{section_definition}

## 核心要点
{numbered_key_points}

## 时间线
{bulleted_timeline}

## 相关主题
{related_links}

## 学习路径
{numbered_learning_path}

{extra_sections}"""

PERSON_TEMPLATE = """---
concept_id: "{concept_id}"
concept_type: "person"
concept_name: "{concept_name}"
aliases: {json_aliases}
source_books: {json_source_books}
generated_at: "{generated_at}"
---

# 人物：{concept_name}

## 生平简介
{section_definition}

## 一句话概括
{section_simple}

## 主要贡献
{numbered_key_points}

## 生平时间线
{bulleted_timeline}

## 相关人物/领域
{related_links}

## 阅读/学习路径
{numbered_learning_path}

{extra_sections}"""


class PostgrestClient:
    """通过 requests 访问 PostgREST 的轻量级客户端。"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        url = f"{self.base_url}{endpoint}"
        try:
            resp = self.session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except requests.RequestException as e:
            logger.error("请求失败: %s - %s", url, e)
            raise


def load_config(config_path: str) -> Dict[str, Any]:
    """加载本地配置文件（如果存在）。"""
    if os.path.isfile(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("加载配置文件失败: %s", e)
    return {}


def sanitize_filename(name: str) -> str:
    """将字符串转换为安全的文件夹/文件名字符串。"""
    name = name.strip()
    # 替换常见非法字符
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    # 控制字符
    name = re.sub(r'[\x00-\x1f]', "", name)
    # 首尾空格/点
    name = name.strip(". ")
    if not name:
        name = "untitled"
    return name


def make_anchor(name: str) -> str:
    """生成 URL-safe 锚点（小写、空格替换为 -）。"""
    return re.sub(r"\s+", "-", name.strip()).lower()


def make_relative_path(from_path: str, to_path: str) -> str:
    """
    计算从 from_path 到 to_path 的相对路径。
    两个路径都应是相对于同一根目录、使用正斜杠表示的文件路径。
    """
    from_parts = [p for p in from_path.replace("\\", "/").split("/") if p]
    to_parts = [p for p in to_path.replace("\\", "/").split("/") if p]

    i = 0
    while i < len(from_parts) - 1 and i < len(to_parts) and from_parts[i] == to_parts[i]:
        i += 1

    ups = len(from_parts) - 1 - i
    result = [".."] * ups + to_parts[i:]
    if not result:
        return "./"
    return "/".join(result)


def render_json_list(value: Any) -> List[str]:
    """将 JSON 字符串安全解析为 Python 列表；失败则返回原字符串的单项列表。"""
    if not value:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(v) for v in parsed]
    except Exception:
        pass
    return [str(value)]


# ======================================================================
# 数据获取
# ======================================================================

def fetch_users(client: PostgrestClient) -> List[Dict[str, Any]]:
    return client.get("/users")


def fetch_books(client: PostgrestClient) -> List[Dict[str, Any]]:
    return client.get("/books?order=created_at.desc")


def fetch_chapters(client: PostgrestClient, book_id: str) -> List[Dict[str, Any]]:
    return client.get(
        "/chapters",
        params={
            "book_id": f"eq.{book_id}",
            "order": "chapter_idx.asc",
        },
    )


def fetch_highlights(client: PostgrestClient, user_vid: str, book_id: str) -> List[Dict[str, Any]]:
    return client.get(
        "/highlights",
        params={
            "user_vid": f"eq.{user_vid}",
            "book_id": f"eq.{book_id}",
            "order": "chapter_uid.asc,range.asc",
        },
    )


def fetch_sync_state(client: PostgrestClient, user_vid: str, book_id: str) -> Optional[Dict[str, Any]]:
    rows = client.get(
        "/sync_state",
        params={
            "user_vid": f"eq.{user_vid}",
            "book_id": f"eq.{book_id}",
            "limit": "1",
        },
    )
    return rows[0] if rows else None


def fetch_knowledge_expansions(
    client: PostgrestClient, user_vid: str, highlight_ids: List[int]
) -> List[Dict[str, Any]]:
    """批量查询与指定 highlight_id 列表关联的知识点扩展。"""
    if not highlight_ids:
        return []
    results: List[Dict[str, Any]] = []
    batch_size = 100
    for i in range(0, len(highlight_ids), batch_size):
        batch = highlight_ids[i : i + batch_size]
        ids_str = ",".join(str(h) for h in batch)
        rows = client.get(
            "/knowledge_expansions",
            params={
                "user_vid": f"eq.{user_vid}",
                "highlight_id": f"in.({ids_str})",
            },
        )
        results.extend(rows)
    return results


def fetch_knowledge_source_links(
    client: PostgrestClient, expansion_ids: List[int]
) -> List[Dict[str, Any]]:
    """批量查询 knowledge_source_links。"""
    if not expansion_ids:
        return []
    results: List[Dict[str, Any]] = []
    batch_size = 100
    for i in range(0, len(expansion_ids), batch_size):
        batch = expansion_ids[i : i + batch_size]
        ids_str = ",".join(str(e) for e in batch)
        rows = client.get(
            "/knowledge_source_links",
            params={
                "expansion_id": f"in.({ids_str})",
            },
        )
        results.extend(rows)
    return results


# ======================================================================
# Markdown 生成
# ======================================================================

def generate_book_markdown(
    book: Dict[str, Any],
    chapters: List[Dict[str, Any]],
    highlights: List[Dict[str, Any]],
    sync_state: Optional[Dict[str, Any]],
    hl_expansion_map: Dict[int, List[Dict[str, Any]]],
) -> str:
    """
    按书籍生成 Markdown 内容。
    - Frontmatter 包含 title、author、exported_at。
    - 按章节分组，未匹配章节的笔记归入“其他”。
    - 若 highlight 有关联知识点，在划线后追加相关概念链接。
    """
    lines: List[str] = []
    book_title = book.get("title") or "untitled"
    safe_book_title = sanitize_filename(book_title)

    # Frontmatter
    lines.append("---")
    lines.append(f'title: "{book_title}"')
    lines.append(f'author: "{book.get("author", "")}"')
    lines.append(f'exported_at: "{datetime.now().isoformat()}"')
    if sync_state:
        last_sync = sync_state.get("last_sync_at")
        if last_sync:
            lines.append(f'last_sync: "{last_sync}"')
    lines.append("---")
    lines.append("")

    # 构建章节索引映射
    chapter_map: Dict[int, Dict[str, Any]] = {}
    for ch in chapters:
        cuid = ch.get("chapter_uid")
        if cuid is not None:
            chapter_map[int(cuid)] = ch

    # 按 chapter_uid 分组
    groups: Dict[int, List[Dict[str, Any]]] = {}
    for hl in highlights:
        cuid = hl.get("chapter_uid") or 0
        groups.setdefault(int(cuid), []).append(hl)

    # 按章节顺序输出；无匹配章节的放到最后
    ordered_uids = list(chapter_map.keys())
    other_uids = [uid for uid in groups if uid not in chapter_map]
    for uid in other_uids:
        ordered_uids.append(uid)

    for uid in ordered_uids:
        if uid not in groups:
            continue

        chapter = chapter_map.get(uid)
        if chapter:
            chapter_title = chapter.get("title", "") or "无标题章节"
            lines.append(f"## {chapter_title}")
        else:
            lines.append("## 其他")
        lines.append("")

        for hl in groups[uid]:
            mark_text = (hl.get("mark_text") or "").strip()
            note_text = (hl.get("note_text") or "").strip()
            hl_id = hl.get("id")

            # 使用 Callout 包裹原文和评论
            if mark_text or note_text:
                if mark_text and note_text:
                    callout_title = "原文与评论"
                elif mark_text:
                    callout_title = "原文"
                else:
                    callout_title = "评论"

                callout_lines = [f"> [!quote]- {callout_title}"]
                if mark_text:
                    callout_lines.append("> **原文：**")
                    for mline in mark_text.splitlines():
                        callout_lines.append(f"> > {mline}")
                if note_text:
                    if mark_text:
                        callout_lines.append(">")
                    callout_lines.append("> **评论：**")
                    for nline in note_text.splitlines():
                        callout_lines.append(f"> {nline}")
                lines.extend(callout_lines)

            # 相关概念链接
            expansions_for_hl = hl_expansion_map.get(hl_id, [])
            if expansions_for_hl:
                link_strs = []
                for exp in expansions_for_hl:
                    cname = exp.get("concept_name", "")
                    ctype = exp.get("concept_type", "concept")
                    safe_name = sanitize_filename(cname) + ".md"
                    concept_path = f"02-Concepts/{ctype}/{safe_name}"
                    rel = make_relative_path(
                        f"01-Books/{safe_book_title}/README.md", concept_path
                    )
                    link_strs.append(f"[{cname}]({rel})")
                if link_strs:
                    lines.append("")
                    lines.append("（相关概念: " + "、".join(link_strs) + "）")

            lines.append("")
            lines.append("---")
            lines.append("")

    return "\n".join(lines)


def generate_concept_body(
    expansion: Dict[str, Any],
    all_concepts_by_name: Dict[str, Dict[str, Any]],
    backlinks: Optional[List[Tuple[str, str, str, str]]] = None,
) -> str:
    """生成知识卡片的正文 Markdown（不含反链区）。"""
    cid = expansion.get("concept_id", "")
    cname = expansion.get("concept_name", "")
    ctype = expansion.get("concept_type", "concept")
    aliases = render_json_list(expansion.get("concept_aliases") or "[]")
    source_books = sorted({bt for bt, _, _, _ in backlinks}) if backlinks else []

    section_definition = (expansion.get("section_definition") or "").strip()
    section_simple = (expansion.get("section_simple") or "").strip()
    key_points = render_json_list(expansion.get("section_key_points"))
    timeline = render_json_list(expansion.get("section_timeline"))
    related = render_json_list(expansion.get("section_related"))
    learning_path = render_json_list(expansion.get("section_learning_path"))
    notes = (expansion.get("section_notes") or "").strip()
    diagram = (expansion.get("section_diagram") or "").strip()

    # 格式化列表
    numbered_key_points = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(key_points)) if key_points else ""
    bulleted_timeline = "\n".join(f"- {t}" for t in timeline) if timeline else ""
    numbered_learning_path = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(learning_path)) if learning_path else ""

    # 相关概念链接
    related_lines = []
    for rname in related:
        target = all_concepts_by_name.get(rname)
        target_type = target.get("concept_type", "concept") if target else "concept"
        safe_target = sanitize_filename(rname) + ".md"
        rel = make_relative_path(
            f"02-Concepts/{ctype}/{sanitize_filename(cname)}.md",
            f"02-Concepts/{target_type}/{safe_target}",
        )
        related_lines.append(f"- [{rname}]({rel})")
    related_links = "\n".join(related_lines)

    # extra_sections（备注、图解）
    extras: List[str] = []
    if notes:
        extras.append(f"## 备注\n\n{notes}")
    if diagram:
        extras.append(f"## 图解\n\n{diagram}")
    extra_sections = "\n\n".join(extras)
    if extra_sections:
        extra_sections += "\n\n"

    generated_at = datetime.now().isoformat()

    ctx = {
        "concept_id": cid,
        "concept_name": cname,
        "json_aliases": json.dumps(aliases, ensure_ascii=False),
        "json_source_books": json.dumps(source_books, ensure_ascii=False),
        "generated_at": generated_at,
        "section_definition": section_definition,
        "section_simple": section_simple,
        "numbered_key_points": numbered_key_points,
        "bulleted_timeline": bulleted_timeline,
        "related_links": related_links,
        "numbered_learning_path": numbered_learning_path,
        "extra_sections": extra_sections,
    }

    if ctype == "person":
        return PERSON_TEMPLATE.format(**ctx)
    if ctype == "note":
        return NOTE_TEMPLATE.format(**ctx)
    return CONCEPT_TEMPLATE.format(**ctx)


def generate_concept_backlinks(backlinks: List[Tuple[str, str, str, str]]) -> str:
    """生成知识卡片的反链区 Markdown（以 ## 来源笔记 开头）。"""
    # 反链按书籍-章节分组
    backlink_groups: Dict[Tuple[str, str], List[Tuple[str, str]]] = {}
    for bt, ct, mt, nt in backlinks:
        backlink_groups.setdefault((bt, ct), []).append((mt, nt))

    backlink_lines: List[str] = []
    for (bt, ct), items in backlink_groups.items():
        backlink_lines.append(f"### 《{bt}》— {ct}")
        for mt, nt in items:
            backlink_lines.append(f"> {mt}")
            if nt:
                backlink_lines.append("")
                backlink_lines.append(f"想法：{nt}")
            backlink_lines.append("")

    backlinks_md = "\n".join(backlink_lines)

    lines = ["## 来源笔记"]
    if backlinks_md:
        lines.append(backlinks_md)
    return "\n".join(lines)


# 标记常量
CONCEPT_BACKLINKS_START = "<!-- concept-backlinks:start -->"
CONCEPT_BACKLINKS_END = "<!-- concept-backlinks:end -->"


def write_concept_card(
    path: str,
    body: str,
    backlinks: str,
    concept_name: str,
    force: bool = False,
    force_name: Optional[str] = None,
) -> None:
    """
    写入知识卡片，支持正文-反链隔离。
    - 文件不存在或强制重写时：写入完整 body + 标记 + backlinks。
    - 文件存在且包含标记时：保留标记前的正文，仅替换标记之间的反链区。
    - 文件存在但不包含标记时：保留原文件全部内容，追加标记和反链区。
    """
    full_content = f"{body}{CONCEPT_BACKLINKS_START}\n{backlinks}\n{CONCEPT_BACKLINKS_END}\n"

    if not os.path.isfile(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(full_content)
        return

    # 强制重写指定概念或全部概念
    if force or (force_name and force_name == concept_name):
        with open(path, "w", encoding="utf-8") as f:
            f.write(full_content)
        return

    with open(path, "r", encoding="utf-8") as f:
        existing = f.read()

    start_idx = existing.find(CONCEPT_BACKLINKS_START)
    end_idx = existing.find(CONCEPT_BACKLINKS_END)

    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        # 保留标记之前的内容，替换标记之间的反链区
        preserved = existing[:start_idx]
        # 去除 preserved 末尾的空白换行，避免重复空行
        preserved = preserved.rstrip("\n")
        new_content = f"{preserved}\n\n{CONCEPT_BACKLINKS_START}\n{backlinks}\n{CONCEPT_BACKLINKS_END}\n"
    else:
        # 旧格式卡片，追加标记和反链区
        preserved = existing.rstrip("\n")
        new_content = f"{preserved}\n\n{CONCEPT_BACKLINKS_START}\n{backlinks}\n{CONCEPT_BACKLINKS_END}\n"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)


# ======================================================================
# 导出流程
# ======================================================================

def process_book(
    client: PostgrestClient,
    user_vid: str,
    book: Dict[str, Any],
    output_dir: str,
    force: bool,
) -> Tuple[bool, List[Dict], List[Dict], Optional[Dict], bool]:
    """
    获取单本书的数据并判断 README 是否需要更新。
    返回: (成功, chapters, highlights, sync_state, readme_needs_update)
    """
    book_id = book.get("book_id")
    title = book.get("title") or "untitled"

    try:
        chapters = fetch_chapters(client, book_id)
        highlights = fetch_highlights(client, user_vid, book_id)
        sync_state = fetch_sync_state(client, user_vid, book_id)

        safe_title = sanitize_filename(title)
        book_dir = os.path.join(output_dir, "01-Books", safe_title)

        needs_update = force
        if not needs_update:
            meta_path = os.path.join(book_dir, META_FILE_NAME)
            old_meta: Dict[str, Any] = {}
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        old_meta = json.load(f)
                except Exception:
                    pass

            last_sync = sync_state.get("last_sync_at") if sync_state else None
            old_last_sync = old_meta.get("last_sync_at")
            old_highlight_count = old_meta.get("highlight_count")
            current_highlight_count = len(highlights)

            if old_last_sync != last_sync or old_highlight_count != current_highlight_count:
                needs_update = True
            else:
                needs_update = False

        return True, chapters, highlights, sync_state, needs_update
    except Exception as e:
        logger.error("  处理失败: %s - %s", title, e)
        return False, [], [], None, False


def resolve_user_vid(client: PostgrestClient, cli_user_vid: Optional[str]) -> str:
    """解析有效的 user_vid。"""
    if cli_user_vid:
        return cli_user_vid.strip()

    users = fetch_users(client)
    if len(users) == 0:
        raise RuntimeError("数据库中没有任何用户记录，无法确定 user_vid。")
    if len(users) == 1:
        vid = users[0].get("user_vid")
        logger.info("自动选择唯一用户: %s", vid)
        return str(vid)

    logger.error("数据库中存在多名用户，请通过 --user-vid 指定其中一个:")
    for u in users:
        logger.error("  - %s (%s)", u.get("user_vid"), u.get("user_name") or "")
    raise RuntimeError("请通过 --user-vid 参数指定要导出的用户")


def main() -> None:
    parser = argparse.ArgumentParser(description="从 PostgreSQL(PostgREST) 导出微信读书笔记为 Markdown")
    parser.add_argument(
        "--postgrest-url",
        default=None,
        help=f"PostgREST 地址（默认: {DEFAULT_POSTGREST_URL}）",
    )
    parser.add_argument(
        "--output-dir", "-o",
        default=None,
        help=f"导出目录（默认: {DEFAULT_OUTPUT_DIR}）",
    )
    parser.add_argument(
        "--user-vid",
        default=None,
        help="指定用户 VID；若未指定且 users 表只有一条记录则自动使用",
    )
    parser.add_argument(
        "--format",
        default="obsidian",
        help="导出格式（预留，默认: obsidian）",
    )
    parser.add_argument(
        "--config",
        default=CONFIG_FILE_NAME,
        help=f"配置文件路径（默认: {CONFIG_FILE_NAME}）",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重新生成所有书籍 README",
    )
    parser.add_argument(
        "--force-concepts",
        action="store_true",
        help="强制重写所有知识卡片完整内容",
    )
    parser.add_argument(
        "--force-concept",
        default=None,
        help="强制重写指定名称的知识卡片完整内容",
    )
    args = parser.parse_args()

    # 加载配置文件
    config = load_config(args.config)

    # 命令行参数优先于配置文件，其次环境变量，最后默认值
    postgrest_url = (
        args.postgrest_url
        or config.get("postgrest_url")
        or os.environ.get("POSTGREST_URL")
        or DEFAULT_POSTGREST_URL
    )
    output_dir = (
        args.output_dir
        or config.get("output_dir")
        or os.environ.get("OUTPUT_DIR")
        or DEFAULT_OUTPUT_DIR
    )
    user_vid = args.user_vid or config.get("user_vid") or os.environ.get("USER_VID")

    logger.info("PostgREST URL: %s", postgrest_url)
    logger.info("输出目录: %s", os.path.abspath(output_dir))

    client = PostgrestClient(postgrest_url)

    # 确定用户
    effective_user_vid = resolve_user_vid(client, user_vid)

    # 获取书籍列表
    books = fetch_books(client)
    if not books:
        logger.warning("数据库中没有书籍记录。")
        return

    logger.info("共发现 %d 本书，开始处理...", len(books))

    success_count = 0
    skip_count = 0
    fail_count = 0

    # 阶段 1：逐本获取数据并判断更新必要性
    processed_books: List[Dict[str, Any]] = []
    for book in books:
        ok, chapters, highlights, sync_state, needs_update = process_book(
            client, effective_user_vid, book, output_dir, args.force
        )
        if not ok:
            fail_count += 1
            continue

        if not highlights:
            skip_count += 1
        else:
            success_count += 1

        processed_books.append({
            "book": book,
            "chapters": chapters,
            "highlights": highlights,
            "sync_state": sync_state,
            "needs_update": needs_update,
        })

    # 阶段 2：汇总 highlight_id，查询知识点
    all_highlight_ids: List[int] = []
    for pb in processed_books:
        for hl in pb["highlights"]:
            all_highlight_ids.append(hl["id"])

    expansions: List[Dict[str, Any]] = []
    if all_highlight_ids:
        logger.info("正在查询知识点数据...")
        expansions = fetch_knowledge_expansions(client, effective_user_vid, all_highlight_ids)
        logger.info("  发现 %d 条知识点记录", len(expansions))
    else:
        logger.info("没有任何笔记，跳过知识点查询。")

    expansion_ids = [e["expansion_id"] for e in expansions]
    source_links = fetch_knowledge_source_links(client, expansion_ids)
    if source_links:
        logger.info("  发现 %d 条知识点关联链接", len(source_links))

    # 阶段 3：构建全局查找表与概念映射
    book_id_to_title: Dict[str, str] = {}
    highlight_lookup: Dict[int, Dict[str, Any]] = {}

    for pb in processed_books:
        book_id = pb["book"].get("book_id")
        title = pb["book"].get("title") or "untitled"
        book_id_to_title[book_id] = title

        # 章节映射（用于补充 chapter_title）
        chapter_map: Dict[int, Dict[str, Any]] = {}
        for ch in pb["chapters"]:
            cuid = ch.get("chapter_uid")
            if cuid is not None:
                chapter_map[int(cuid)] = ch

        for hl in pb["highlights"]:
            hl_id = hl["id"]
            cuid = hl.get("chapter_uid") or 0
            ch_info = chapter_map.get(int(cuid))
            chapter_title = (hl.get("chapter_title") or "").strip()
            if not chapter_title and ch_info:
                chapter_title = (ch_info.get("title") or "").strip()
            if not chapter_title:
                chapter_title = "其他"

            highlight_lookup[hl_id] = {
                **hl,
                "book_title": title,
                "chapter_title": chapter_title,
            }

    # concept_id -> expansion（去重，保留 updated_at 最新的）
    concept_map: Dict[str, Dict[str, Any]] = {}
    for exp in expansions:
        cid = exp.get("concept_id")
        if not cid:
            continue
        if cid not in concept_map:
            concept_map[cid] = exp
        else:
            old_ts = concept_map[cid].get("updated_at") or ""
            new_ts = exp.get("updated_at") or ""
            if new_ts > old_ts:
                concept_map[cid] = exp

    # expansion_id -> concept_id
    expansion_id_to_cid = {exp["expansion_id"]: exp["concept_id"] for exp in expansions}

    # 反链构建（去重 highlight_id）
    seen_backlinks: Dict[str, set] = {cid: set() for cid in concept_map}
    concept_backlinks: Dict[str, List[Tuple[str, str, str, str]]] = {cid: [] for cid in concept_map}

    def _add_backlink(cid: str, hl_id: int) -> None:
        if hl_id in seen_backlinks[cid]:
            return
        hl = highlight_lookup.get(hl_id)
        if not hl:
            return
        seen_backlinks[cid].add(hl_id)
        concept_backlinks[cid].append((
            hl["book_title"],
            hl["chapter_title"],
            (hl.get("mark_text") or "").strip(),
            (hl.get("note_text") or "").strip(),
        ))

    for exp in expansions:
        cid = exp.get("concept_id")
        hl_id = exp.get("highlight_id")
        if cid and hl_id is not None:
            _add_backlink(cid, hl_id)

    for link in source_links:
        exp_id = link.get("expansion_id")
        hl_id = link.get("highlight_id")
        cid = expansion_id_to_cid.get(exp_id)
        if cid and hl_id is not None:
            _add_backlink(cid, hl_id)

    # 按名称索引的概念字典（用于 related_links 跳转）
    all_concepts_by_name: Dict[str, Dict[str, Any]] = {}
    for cid, exp in concept_map.items():
        name = exp.get("concept_name", "")
        if name:
            all_concepts_by_name[name] = exp

    # 计算每本书关联的 expansion_count（用于 meta）
    seen_book_expansions: set = set()
    book_expansion_counts: Dict[str, int] = {}
    for exp in expansions:
        hl_id = exp.get("highlight_id")
        if hl_id and hl_id in highlight_lookup:
            bid = highlight_lookup[hl_id].get("book_id")
            key = (bid, exp["expansion_id"])
            if key not in seen_book_expansions:
                seen_book_expansions.add(key)
                book_expansion_counts[bid] = book_expansion_counts.get(bid, 0) + 1
    for link in source_links:
        exp_id = link.get("expansion_id")
        hl_id = link.get("highlight_id")
        if hl_id and hl_id in highlight_lookup:
            bid = highlight_lookup[hl_id].get("book_id")
            key = (bid, exp_id)
            if key not in seen_book_expansions:
                seen_book_expansions.add(key)
                book_expansion_counts[bid] = book_expansion_counts.get(bid, 0) + 1

    # highlight_id -> 关联 expansion 列表（用于 README 内联链接）
    hl_expansion_map: Dict[int, List[Dict[str, Any]]] = {}
    expansion_id_map = {exp["expansion_id"]: exp for exp in expansions}

    for exp in expansions:
        hl_id = exp.get("highlight_id")
        if hl_id is not None:
            hl_expansion_map.setdefault(hl_id, []).append(exp)
    for link in source_links:
        exp_id = link.get("expansion_id")
        hl_id = link.get("highlight_id")
        exp = expansion_id_map.get(exp_id)
        if exp and hl_id is not None:
            hl_expansion_map.setdefault(hl_id, []).append(exp)

    for hl_id in list(hl_expansion_map):
        seen_cids: set = set()
        unique: List[Dict[str, Any]] = []
        for exp in hl_expansion_map[hl_id]:
            cid = exp.get("concept_id")
            if cid and cid not in seen_cids:
                seen_cids.add(cid)
                unique.append(exp)
        hl_expansion_map[hl_id] = unique

    # 阶段 4：生成全局概念卡片（正文-反链隔离）
    if concept_map:
        logger.info("正在生成知识卡片...")
        concept_base_dir = os.path.join(output_dir, "02-Concepts")
        for cid, exp in concept_map.items():
            ctype = exp.get("concept_type", "concept")
            cname = exp.get("concept_name", "")
            safe_name = sanitize_filename(cname) + ".md"
            ctype_dir = os.path.join(concept_base_dir, ctype)
            os.makedirs(ctype_dir, exist_ok=True)

            backlinks_list = concept_backlinks.get(cid, [])
            body = generate_concept_body(exp, all_concepts_by_name, backlinks_list)
            backlinks_md = generate_concept_backlinks(backlinks_list)
            path = os.path.join(ctype_dir, safe_name)
            write_concept_card(
                path,
                body,
                backlinks_md,
                concept_name=cname,
                force=args.force_concepts,
                force_name=args.force_concept,
            )
        logger.info("  已生成 %d 张知识卡片", len(concept_map))

    # 阶段 5：有条件地生成 README.md
    readme_written = 0
    readme_skipped = 0
    for pb in processed_books:
        if not pb["highlights"]:
            continue
        if not pb["needs_update"]:
            readme_skipped += 1
            continue

        book = pb["book"]
        chapters = pb["chapters"]
        highlights = pb["highlights"]
        sync_state = pb["sync_state"]
        title = book.get("title") or "untitled"
        safe_title = sanitize_filename(title)
        book_dir = os.path.join(output_dir, "01-Books", safe_title)
        os.makedirs(book_dir, exist_ok=True)

        try:
            md = generate_book_markdown(book, chapters, highlights, sync_state, hl_expansion_map)
            file_path = os.path.join(book_dir, "README.md")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(md)
            readme_written += 1

            # 写入/更新 meta 文件
            book_id = book.get("book_id")
            meta = {
                "exported_at": datetime.now().isoformat(),
                "last_sync_at": sync_state.get("last_sync_at") if sync_state else None,
                "highlight_count": len(highlights),
                "expansion_count": book_expansion_counts.get(book_id, 0),
            }
            meta_path = os.path.join(book_dir, META_FILE_NAME)
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error("  写入失败: %s - %s", title, e)
            fail_count += 1
            success_count = max(0, success_count - 1)

    logger.info("=" * 40)
    logger.info(
        "导出完成: 成功 %d 本, 跳过 %d 本, 失败 %d 本 (README 重写 %d 本, 跳过 %d 本)",
        success_count, skip_count, fail_count, readme_written, readme_skipped,
    )
    logger.info("文件位置: %s", os.path.abspath(output_dir))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.error("%s", e)
        sys.exit(1)
