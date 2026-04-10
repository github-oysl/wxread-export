"""
将 highlights 同步为 flashcards 的命令实现。
"""

import json
import logging
from datetime import datetime

from ..database import Database
from ..schemas import FlashcardIn, CardReviewIn

logger = logging.getLogger("srs.sync")


def _contains_question(text: str | None) -> bool:
    """检查文本是否包含问号（中英文）。"""
    if not text:
        return False
    return "?" in text or "？" in text


def _build_question(note_text: str | None, mark_text: str | None) -> str:
    """组合 note_text 和 mark_text 作为 question_text。"""
    note = (note_text or "").strip()
    mark = (mark_text or "").strip()
    if note and mark:
        return f"{note}\n\n---\n\n{mark}"
    return note or mark


def run_sync(db: Database, user_vid: str) -> dict:
    """
    执行 highlights -> flashcards 同步。
    返回统计字典。
    """
    highlights = db.fetch_unsynced_highlights(user_vid)
    if not highlights:
        logger.info("没有新的 highlights 需要同步。")
        return {"created": 0, "skipped": 0}

    cards: list[FlashcardIn] = []
    for hl in highlights:
        note_text = hl.get("note_text")
        mark_text = hl.get("mark_text")
        card_type = "qa" if _contains_question(note_text) or _contains_question(mark_text) else "highlight"
        question = _build_question(note_text, mark_text)
        if not question:
            continue

        cards.append(
            FlashcardIn(
                user_vid=user_vid,
                highlight_id=hl["id"],
                card_type=card_type,
                question_text=question,
                reference_text=mark_text or None,
                book_id=hl.get("book_id"),
                chapter_uid=hl.get("chapter_uid"),
            )
        )

    created_ids: list[str] = []
    with db.session() as conn:
        created_ids = db.insert_flashcards(
            conn, [c.model_dump(exclude_none=True) for c in cards]
        )

        reviews = [
            CardReviewIn(
                card_id=cid,
                user_vid=user_vid,
                scheduled_at=datetime.now(),
                state="new",
                strategy="sm2",
            )
            for cid in created_ids
        ]
        db.init_card_reviews(
            conn, [r.model_dump(exclude_none=True) for r in reviews]
        )

    logger.info("同步完成: 新创建 %d 张 flashcards", len(created_ids))
    return {"created": len(created_ids), "skipped": len(highlights) - len(cards)}
