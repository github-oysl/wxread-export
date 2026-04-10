"""
记忆曲线策略包。
"""

from .base import ReviewStrategy
from .sm2 import SM2Strategy

__all__ = ["ReviewStrategy", "SM2Strategy"]

STRATEGY_MAP = {
    "sm2": SM2Strategy(),
}


def get_strategy(name: str) -> ReviewStrategy:
    """根据策略名称返回对应实例。"""
    if name not in STRATEGY_MAP:
        raise ValueError(f"不支持的记忆策略: {name}，可用选项: {list(STRATEGY_MAP.keys())}")
    return STRATEGY_MAP[name]
