"""
统计信息命令实现。
"""

import json
import logging

from ..database import Database
from ..schemas import StatsOut

logger = logging.getLogger("srs.stats")


def run_stats(db: Database, user_vid: str, fmt: str = "table") -> StatsOut:
    """
    获取并输出复习统计信息。
    """
    raw = db.fetch_stats(user_vid)
    stats = StatsOut(**raw)

    if fmt == "json":
        print(json.dumps(stats.model_dump(mode="json"), ensure_ascii=False, indent=2))
        return stats

    print("=" * 40)
    print("SRS 复习统计")
    print("=" * 40)
    print(f"总卡片数:     {stats.total_cards}")
    print(f"今日到期:     {stats.due_today}")
    print(f"  - 新卡片:   {stats.new_cards}")
    print(f"  - 学习中:   {stats.learning_cards}")
    print(f"  - 复习中:   {stats.review_cards}")
    print(f"  - 再学习:   {stats.relearning_cards}")
    print(f"  - 已暂停:   {stats.suspended_cards}")
    print("=" * 40)

    return stats
