"""
Pydantic 数据对象定义。
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FlashcardIn(BaseModel):
    """用于批量插入 flashcards 的内部对象。"""

    model_config = ConfigDict(from_attributes=True)

    user_vid: str
    highlight_id: int
    card_type: str = "highlight"
    question_text: str
    reference_text: str | None = None
    book_id: str | None = None
    chapter_uid: int | None = None


class CardReviewIn(BaseModel):
    """用于初始化 card_reviews 的内部对象。"""

    model_config = ConfigDict(from_attributes=True)

    card_id: str
    user_vid: str
    scheduled_at: datetime
    state: str = "new"
    strategy: str = "sm2"


class QueueItem(BaseModel):
    """queue 命令输出的单条记录。"""

    scheduled_at: datetime
    book_title: str | None = None
    card_id: str
    question_text: str
    state: str
    interval_days: int
    ease_factor: float


class NextCardOut(BaseModel):
    """next 命令输出的卡片详情。"""

    book_id: str | None = None
    book_title: str | None = None
    card_id: str
    card_type: str
    question_text: str
    reference_text: str | None = None
    answers: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_expansions: list[dict[str, Any]] = Field(default_factory=list)
    review_state: str
    due_count_in_book: int = 0


class ReviewResult(BaseModel):
    """review 命令输出结果。"""

    card_id: str
    quality: int
    previous_state: str
    new_state: str
    interval_days: int
    ease_factor: float
    repetition_count: int
    lapses: int
    scheduled_at: datetime
    strategy: str


class StatsOut(BaseModel):
    """stats 命令输出结果。"""

    total_cards: int
    due_today: int
    new_cards: int
    learning_cards: int
    review_cards: int
    relearning_cards: int
    suspended_cards: int
