"""
数据库连接与原始 SQL 辅助函数。
使用 SQLAlchemy 管理连接池，并提供业务所需的查询封装。
"""

from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


class Database:
    """SRS 数据库操作封装。"""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(
            database_url,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 10},
        )

    @contextmanager
    def session(self) -> Generator[Any, None, None]:
        """提供原始数据库连接上下文。"""
        conn = self.engine.connect()
        trans = conn.begin()
        try:
            yield conn
            trans.commit()
        except Exception:
            trans.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # sync 相关
    # ------------------------------------------------------------------

    def fetch_unsynced_highlights(self, user_vid: str) -> list[dict[str, Any]]:
        """
        查询该用户 highlights 中尚未关联到 flashcards 的记录。
        """
        sql = text("""
            SELECT h.id, h.book_id, h.chapter_uid, h.mark_text, h.note_text
            FROM highlights h
            LEFT JOIN flashcards f
              ON f.highlight_id = h.id AND f.user_vid = :user_vid
            WHERE h.user_vid = :user_vid
              AND f.card_id IS NULL
            ORDER BY h.id
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"user_vid": user_vid})
            rows = result.mappings().all()
            return [dict(r) for r in rows]

    def insert_flashcards(
        self, conn: Any, cards: list[dict[str, Any]]
    ) -> list[str]:
        """
        批量插入 flashcards，返回生成的 card_id 列表。
        """
        if not cards:
            return []

        sql = text("""
            INSERT INTO flashcards (
                user_vid, highlight_id, card_type,
                question_text, reference_text, book_id, chapter_uid,
                auto_generated
            ) VALUES (
                :user_vid, :highlight_id, :card_type,
                :question_text, :reference_text, :book_id, :chapter_uid,
                true
            )
            RETURNING card_id
        """)
        ids: list[str] = []
        for card in cards:
            res = conn.execute(sql, card)
            row = res.fetchone()
            if row:
                ids.append(str(row[0]))
        return ids

    def init_card_reviews(
        self, conn: Any, entries: list[dict[str, Any]]
    ) -> None:
        """
        批量初始化 card_reviews 记录。
        """
        if not entries:
            return

        sql = text("""
            INSERT INTO card_reviews (
                card_id, user_vid, scheduled_at, state, strategy
            ) VALUES (
                :card_id, :user_vid, :scheduled_at, :state, :strategy
            )
            ON CONFLICT (card_id) DO NOTHING
        """)
        for entry in entries:
            conn.execute(sql, entry)

    # ------------------------------------------------------------------
    # queue / next 相关
    # ------------------------------------------------------------------

    def fetch_due_queue(self, user_vid: str) -> list[dict[str, Any]]:
        """
        获取当前到期的复习队列（全局），按 scheduled_at 升序。
        """
        sql = text("""
            SELECT
                cr.scheduled_at,
                b.title AS book_title,
                cr.card_id,
                f.question_text,
                cr.state,
                cr.interval_days,
                cr.ease_factor
            FROM card_reviews cr
            JOIN flashcards f ON f.card_id = cr.card_id
            LEFT JOIN books b ON b.book_id = f.book_id
            WHERE cr.user_vid = :user_vid
              AND cr.scheduled_at <= NOW()
              AND cr.state != 'suspended'
            ORDER BY cr.scheduled_at ASC
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"user_vid": user_vid})
            return [dict(r) for r in result.mappings().all()]

    def fetch_card_detail(self, card_id: str, user_vid: str) -> dict[str, Any] | None:
        """
        获取单张卡片的完整详情，包含书本信息和 review 状态。
        """
        sql = text("""
            SELECT
                f.book_id,
                b.title AS book_title,
                f.card_id,
                f.card_type,
                f.question_text,
                f.reference_text,
                cr.state AS review_state,
                cr.scheduled_at,
                cr.interval_days,
                cr.ease_factor,
                cr.repetition_count,
                cr.lapses,
                cr.strategy
            FROM flashcards f
            LEFT JOIN books b ON b.book_id = f.book_id
            LEFT JOIN card_reviews cr ON cr.card_id = f.card_id
            WHERE f.card_id = :card_id
              AND f.user_vid = :user_vid
            LIMIT 1
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"card_id": card_id, "user_vid": user_vid})
            row = result.mappings().first()
            return dict(row) if row else None

    def fetch_card_answers(self, card_id: str) -> list[dict[str, Any]]:
        """获取卡片的手动解答/提示。"""
        sql = text("""
            SELECT answer_type, content, source, created_at
            FROM card_answers
            WHERE card_id = :card_id
            ORDER BY created_at ASC
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"card_id": card_id})
            return [dict(r) for r in result.mappings().all()]

    def fetch_knowledge_for_highlight(
        self, highlight_id: int | None
    ) -> list[dict[str, Any]]:
        """
        通过 knowledge_source_links 查询与 highlight 关联的 knowledge_expansions。
        """
        if highlight_id is None:
            return []

        sql = text("""
            SELECT
                ke.expansion_id,
                ke.concept_id,
                ke.concept_name,
                ke.concept_type,
                ke.section_definition,
                ke.section_key_points,
                ke.section_timeline,
                ke.section_related,
                ke.section_learning_path,
                ke.section_notes
            FROM knowledge_expansions ke
            JOIN knowledge_source_links ksl
              ON ksl.expansion_id = ke.expansion_id
            WHERE ksl.highlight_id = :highlight_id
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"highlight_id": highlight_id})
            rows = result.mappings().all()
            return [dict(r) for r in rows]

    def get_highlight_id_for_card(self, card_id: str) -> int | None:
        """根据 card_id 获取关联的 highlight_id。"""
        sql = text("""
            SELECT highlight_id FROM flashcards
            WHERE card_id = :card_id
            LIMIT 1
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"card_id": card_id})
            row = result.fetchone()
            return row[0] if row and row[0] is not None else None

    def count_due_in_book(
        self, user_vid: str, book_id: str | None
    ) -> int:
        """统计某本书中当前到期的卡片数量。"""
        if book_id is None:
            return 0

        sql = text("""
            SELECT COUNT(*)
            FROM card_reviews cr
            JOIN flashcards f ON f.card_id = cr.card_id
            WHERE cr.user_vid = :user_vid
              AND f.book_id = :book_id
              AND cr.scheduled_at <= NOW()
              AND cr.state != 'suspended'
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"user_vid": user_vid, "book_id": book_id})
            row = result.fetchone()
            return row[0] if row else 0

    def postpone_card(self, card_id: str, minutes: int = 10) -> None:
        """将卡片的 scheduled_at 延后指定分钟数（skip 避让用）。"""
        sql = text("""
            UPDATE card_reviews
            SET scheduled_at = NOW() + (:minutes * INTERVAL '1 minute')
            WHERE card_id = :card_id
        """)
        with self.session() as conn:
            conn.execute(sql, {"card_id": card_id, "minutes": minutes})

    # ------------------------------------------------------------------
    # review 相关
    # ------------------------------------------------------------------

    def fetch_review_state(
        self, card_id: str, user_vid: str
    ) -> dict[str, Any] | None:
        """获取卡片的当前复习状态。"""
        sql = text("""
            SELECT
                review_id,
                card_id,
                user_vid,
                reviewed_at,
                scheduled_at,
                ease_factor,
                interval_days,
                repetition_count,
                lapses,
                state,
                strategy
            FROM card_reviews
            WHERE card_id = :card_id
              AND user_vid = :user_vid
            LIMIT 1
        """)
        with self.session() as conn:
            result = conn.execute(sql, {"card_id": card_id, "user_vid": user_vid})
            row = result.mappings().first()
            return dict(row) if row else None

    def update_review(
        self,
        card_id: str,
        user_vid: str,
        scheduled_at: datetime,
        ease_factor: float,
        interval_days: int,
        repetition_count: int,
        lapses: int,
        state: str,
    ) -> None:
        """更新卡片的复习记录。"""
        sql = text("""
            UPDATE card_reviews
            SET
                reviewed_at = NOW(),
                scheduled_at = :scheduled_at,
                ease_factor = :ease_factor,
                interval_days = :interval_days,
                repetition_count = :repetition_count,
                lapses = :lapses,
                state = :state
            WHERE card_id = :card_id
              AND user_vid = :user_vid
        """)
        with self.session() as conn:
            conn.execute(
                sql,
                {
                    "card_id": card_id,
                    "user_vid": user_vid,
                    "scheduled_at": scheduled_at,
                    "ease_factor": ease_factor,
                    "interval_days": interval_days,
                    "repetition_count": repetition_count,
                    "lapses": lapses,
                    "state": state,
                },
            )

    # ------------------------------------------------------------------
    # stats 相关
    # ------------------------------------------------------------------

    def fetch_stats(self, user_vid: str) -> dict[str, int]:
        """返回各状态卡片数量统计。"""
        sql_total = text("""
            SELECT COUNT(*) FROM flashcards WHERE user_vid = :user_vid
        """)
        sql_due = text("""
            SELECT COUNT(*) FROM card_reviews
            WHERE user_vid = :user_vid
              AND scheduled_at <= NOW()
              AND state != 'suspended'
        """)
        sql_states = text("""
            SELECT state, COUNT(*) FROM card_reviews
            WHERE user_vid = :user_vid
            GROUP BY state
        """)
        with self.session() as conn:
            total = conn.execute(sql_total, {"user_vid": user_vid}).scalar() or 0
            due = conn.execute(sql_due, {"user_vid": user_vid}).scalar() or 0
            state_rows = conn.execute(sql_states, {"user_vid": user_vid}).fetchall()

        state_counts: dict[str, int] = {
            "new": 0,
            "learning": 0,
            "review": 0,
            "relearning": 0,
            "suspended": 0,
        }
        for st, cnt in state_rows:
            state_counts[st] = cnt

        return {
            "total_cards": total,
            "due_today": due,
            **state_counts,
        }
