"""
全局待复习明细列表命令实现。
"""

import json
import logging
from datetime import datetime

from ..database import Database
from ..schemas import QueueItem

logger = logging.getLogger("srs.queue")


def run_queue(db: Database, user_vid: str, fmt: str = "table") -> list[QueueItem]:
    """
    获取并输出今日全局待复习队列。
    fmt: "table" | "json"
    """
    rows = db.fetch_due_queue(user_vid)
    items = [QueueItem(**r) for r in rows]

    if fmt == "json":
        print(json.dumps([i.model_dump(mode="json") for i in items], ensure_ascii=False, indent=2))
        return items

    if not items:
        print("当前没有到期的复习卡片。")
        return items

    print(f"{'到期时间':20} | {'书名':20} | {'卡片ID':36} | {'问题内容':30}")
    print("-" * 120)
    for it in items:
        scheduled = it.scheduled_at.strftime("%Y-%m-%d %H:%M")
        book = (it.book_title or "未知书籍")[:18]
        qtext = it.question_text.replace("\n", " ")[:28]
        print(f"{scheduled:20} | {book:20} | {it.card_id:36} | {qtext:30}")

    print(f"\n共 {len(items)} 张卡片待复习。")
    return items
