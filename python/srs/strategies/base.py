"""
记忆曲线策略抽象基类。
"""

from abc import ABC, abstractmethod


class ReviewStrategy(ABC):
    @abstractmethod
    def calc(
        self,
        repetition_count: int,
        ease_factor: float,
        interval_days: int,
        quality: int,
    ) -> dict:
        """
        根据当前复习状态和质量评分计算下次复习参数。

        返回字典应至少包含以下字段：
        - repetition_count: int
        - ease_factor: float
        - interval_days: int
        - state: str
        """
        pass
