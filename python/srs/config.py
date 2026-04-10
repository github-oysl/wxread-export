"""
配置读取模块：从环境变量和命令行参数中获取 DATABASE_URL。
"""

import os
from dataclasses import dataclass


@dataclass
class Config:
    database_url: str


def load_config(database_url: str | None = None) -> Config:
    """
    读取 DATABASE_URL，优先级：传入参数 > 环境变量。
    """
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "必须提供 DATABASE_URL，可通过 --database-url 参数或环境变量设置。"
        )
    return Config(database_url=url)
