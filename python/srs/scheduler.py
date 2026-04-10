"""
全局复习调度逻辑：Next / Skip 调度。
"""

from typing import Any

from .database import Database
from .schemas import NextCardOut


def get_next_card(
    db: Database,
    user_vid: str,
    card_id: str | None = None,
    skip_card_id: str | None = None,
) -> NextCardOut | None:
    """
    获取下一张待复习卡片。
    - 若指定 card_id，直接返回该卡片详情。
    - 若指定 skip_card_id，先将该卡片 scheduled_at 延后 10 分钟，再取下一张。
    - 否则默认取全局 queue 中的第一张。
    """
    if skip_card_id:
        db.postpone_card(skip_card_id, minutes=10)

    target_id = card_id
    if not target_id:
        queue = db.fetch_due_queue(user_vid)
        if not queue:
            return None
        target_id = queue[0]["card_id"]

    detail = db.fetch_card_detail(target_id, user_vid)
    if not detail:
        return None

    highlight_id = db.get_highlight_id_for_card(target_id)
    answers = db.fetch_card_answers(target_id)
    knowledge = db.fetch_knowledge_for_highlight(highlight_id)
    due_count = db.count_due_in_book(user_vid, detail.get("book_id"))

    return NextCardOut(
        book_id=detail.get("book_id"),
        book_title=detail.get("book_title"),
        card_id=detail["card_id"],
        card_type=detail.get("card_type", "highlight"),
        question_text=detail["question_text"],
        reference_text=detail.get("reference_text"),
        answers=answers,
        knowledge_expansions=knowledge,
        review_state=detail.get("review_state", "new"),
        due_count_in_book=due_count,
    )
