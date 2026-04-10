"""
提交复习评分命令实现。
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from ..database import Database
from ..schemas import ReviewResult
from ..strategies import get_strategy

logger = logging.getLogger("srs.review")


def run_review(
    db: Database,
    user_vid: str,
    card_id: str,
    quality: int,
    strategy_name: str | None = None,
) -> dict[str, Any]:
    """
    提交复习评分并更新卡片状态。
    """
    state = db.fetch_review_state(card_id, user_vid)
    if not state:
        msg = f"未找到卡片 {card_id} 的复习记录，可能尚未同步或卡片不存在。"
        logger.error(msg)
        print(json.dumps({"error": msg}, ensure_ascii=False, indent=2))
        return {"error": msg}

    # 确定使用的策略
    effective_strategy = strategy_name or state["strategy"] or "sm2"
    strategy = get_strategy(effective_strategy)

    calc = strategy.calc(
        repetition_count=state["repetition_count"] or 0,
        ease_factor=state["ease_factor"] or 2.5,
        interval_days=state["interval_days"] or 0,
        quality=quality,
    )

    new_lapses = (state["lapses"] or 0) + calc["lapses"]
    scheduled_at = datetime.now() + timedelta(days=calc["interval_days"])

    db.update_review(
        card_id=card_id,
        user_vid=user_vid,
        scheduled_at=scheduled_at,
        ease_factor=calc["ease_factor"],
        interval_days=calc["interval_days"],
        repetition_count=calc["repetition_count"],
        lapses=new_lapses,
        state=calc["state"],
    )

    result = ReviewResult(
        card_id=card_id,
        quality=quality,
        previous_state=state["state"],
        new_state=calc["state"],
        interval_days=calc["interval_days"],
        ease_factor=calc["ease_factor"],
        repetition_count=calc["repetition_count"],
        lapses=new_lapses,
        scheduled_at=scheduled_at,
        strategy=effective_strategy,
    )

    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2))
    return result.model_dump(mode="json")
