"""
SRS CLI 入口。
"""

import argparse
import logging
import sys

from .config import load_config
from .database import Database
from .commands.sync import run_sync
from .commands.queue import run_queue
from .commands.next import run_next
from .commands.review import run_review
from .commands.stats import run_stats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("srs")


def main() -> None:
    parser = argparse.ArgumentParser(description="微信读书笔记 SRS 复习调度 CLI")
    parser.add_argument(
        "--database-url",
        default=None,
        help="PostgreSQL 连接字符串（也可通过 DATABASE_URL 环境变量设置）",
    )
    parser.add_argument(
        "--user-vid",
        required=True,
        help="用户 VID",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # sync 子命令
    sync_parser = subparsers.add_parser("sync", help="将 highlights 同步为 flashcards")

    # queue 子命令
    queue_parser = subparsers.add_parser("queue", help="查看今日待复习队列")
    queue_parser.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="输出格式（默认: table）",
    )

    # next 子命令
    next_parser = subparsers.add_parser("next", help="获取下一张复习卡片")
    next_parser.add_argument(
        "--card-id",
        default=None,
        help="指定卡片 ID（默认取队列中最早到期的一张）",
    )
    next_parser.add_argument(
        "--skip",
        default=None,
        metavar="CARD_ID",
        help="跳过指定卡片（延后 10 分钟），然后返回队列中的下一张",
    )

    # review 子命令
    review_parser = subparsers.add_parser("review", help="提交复习评分")
    review_parser.add_argument(
        "--card-id",
        required=True,
        help="卡片 ID",
    )
    review_parser.add_argument(
        "--quality",
        type=int,
        required=True,
        help="评分 (0-5)",
    )
    review_parser.add_argument(
        "--strategy",
        default=None,
        help="强制使用指定策略（默认使用卡片当前绑定的策略）",
    )

    # stats 子命令
    stats_parser = subparsers.add_parser("stats", help="查看复习统计")
    stats_parser.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="输出格式（默认: table）",
    )

    args = parser.parse_args()

    try:
        config = load_config(args.database_url)
        db = Database(config.database_url)
    except RuntimeError as e:
        logger.error("%s", e)
        sys.exit(1)

    cmd = args.command
    if cmd == "sync":
        run_sync(db, args.user_vid)
    elif cmd == "queue":
        run_queue(db, args.user_vid, fmt=args.format)
    elif cmd == "next":
        run_next(db, args.user_vid, card_id=args.card_id, skip_card_id=args.skip)
    elif cmd == "review":
        run_review(
            db,
            args.user_vid,
            card_id=args.card_id,
            quality=args.quality,
            strategy_name=args.strategy,
        )
    elif cmd == "stats":
        run_stats(db, args.user_vid, fmt=args.format)


if __name__ == "__main__":
    main()
