"""
SM-2 (SuperMemo-2) 间隔重复算法实现。
"""

from .base import ReviewStrategy


class SM2Strategy(ReviewStrategy):
    def calc(
        self,
        repetition_count: int,
        ease_factor: float,
        interval_days: int,
        quality: int,
    ) -> dict:
        if quality < 3:
            rep_count = 0
            interval = 1
            state = "relearning"
            lapses = 1  # 调用方负责累加
        else:
            if repetition_count == 0:
                interval = 1
            elif repetition_count == 1:
                interval = 6
            else:
                interval = max(1, round(interval_days * ease_factor))
            rep_count = repetition_count + 1
            state = "review"
            lapses = 0

        new_ef = max(
            1.3,
            ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02),
        )

        return {
            "repetition_count": rep_count,
            "ease_factor": new_ef,
            "interval_days": interval,
            "state": state,
            "lapses": lapses,
        }
