"""
获取下一张卡片命令实现。
"""

import json
import logging

from ..database import Database
from ..scheduler import get_next_card

logger = logging.getLogger("srs.next")


def run_next(
    db: Database,
    user_vid: str,
    card_id: str | None = None,
    skip_card_id: str | None = None,
) -> None:
    """
    获取下一张待复习卡片详情，以 JSON 输出。
    """
    card = get_next_card(db, user_vid, card_id=card_id, skip_card_id=skip_card_id)
    if not card:
        print(json.dumps({"message": "没有到期的复习卡片。"}, ensure_ascii=False, indent=2))
        return

    print(json.dumps(card.model_dump(mode="json"), ensure_ascii=False, indent=2))
