import json
from typing import Any

import redis

from .settings import settings

USERS_CACHE_KEY = "users:all"


def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def redis_health() -> bool:
    try:
        return bool(get_redis_client().ping())
    except Exception:
        return False


def get_cached_users() -> list[dict[str, Any]] | None:
    try:
        raw = get_redis_client().get(USERS_CACHE_KEY)
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


def set_cached_users(users: list[dict[str, Any]], ttl_seconds: int = 60) -> None:
    get_redis_client().setex(USERS_CACHE_KEY, ttl_seconds, json.dumps(users, default=str))


def invalidate_users_cache() -> None:
    get_redis_client().delete(USERS_CACHE_KEY)
