from typing import Any
import re
import json

import psycopg
from psycopg.rows import dict_row

from .settings import settings


USERNAME_MAX_LENGTH = 30


def _slug_username(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]", "", value.lower().replace(" ", "_"))
    normalized = normalized.strip("_")
    if not normalized:
        return "user"
    return normalized[:USERNAME_MAX_LENGTH]


def _with_suffix(base: str, suffix: int) -> str:
    suffix_str = str(suffix)
    allowed_base = max(1, USERNAME_MAX_LENGTH - len(suffix_str))
    return f"{base[:allowed_base]}{suffix_str}"


def _build_username_seed(first_name: str, last_name: str, email: str) -> str:
    full_name_seed = f"{first_name}_{last_name}".strip("_")
    if full_name_seed:
        return _slug_username(full_name_seed)
    local_part = email.split("@", 1)[0]
    return _slug_username(local_part)


def _generate_unique_username(cur: psycopg.Cursor, seed: str, exclude_user_id: int | None = None) -> str:
    base = _slug_username(seed)
    candidate = base
    suffix = 1

    while True:
        if exclude_user_id is None:
            cur.execute("SELECT 1 FROM users WHERE username = %s LIMIT 1", (candidate,))
        else:
            cur.execute("SELECT 1 FROM users WHERE username = %s AND id <> %s LIMIT 1", (candidate, exclude_user_id))

        if cur.fetchone() is None:
            return candidate

        suffix += 1
        candidate = _with_suffix(base, suffix)


def get_pg_connection() -> psycopg.Connection:
    return psycopg.connect(settings.postgres_url, row_factory=dict_row)


def init_db() -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    username TEXT UNIQUE,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL DEFAULT '',
                    phone TEXT,
                    country TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT")

            cur.execute(
                """
                SELECT id, first_name, last_name, email
                FROM users
                WHERE username IS NULL OR username = ''
                ORDER BY id ASC
                """
            )
            users_without_username = cur.fetchall()

            for row in users_without_username:
                username_seed = _build_username_seed(row["first_name"], row["last_name"], row["email"])
                username = _generate_unique_username(cur, username_seed, exclude_user_id=row["id"])
                cur.execute("UPDATE users SET username = %s WHERE id = %s", (username, row["id"]))

            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username)")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS password_resets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    used_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS referral_settings (
                    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
                    show_in_leaderboard BOOLEAN NOT NULL DEFAULT TRUE,
                    auto_share_achievements BOOLEAN NOT NULL DEFAULT FALSE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS referrals (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    invite_email TEXT NOT NULL,
                    invite_name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    settings_json JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,
                    ip TEXT,
                    location TEXT,
                    device TEXT,
                    browser TEXT,
                    os TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    revoked_at TIMESTAMPTZ
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_login_history (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ip TEXT,
                    location TEXT,
                    device TEXT,
                    success BOOLEAN NOT NULL,
                    method TEXT NOT NULL
                )
                """
            )
        conn.commit()


def postgres_health() -> bool:
    try:
        with get_pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                _ = cur.fetchone()
        return True
    except Exception:
        return False


def create_user(first_name: str, last_name: str, email: str, password_hash: str, phone: str | None, country: str | None, username: str | None = None) -> dict[str, Any]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            username_seed = username or _build_username_seed(first_name, last_name, email)
            unique_username = _generate_unique_username(cur, username_seed)
            cur.execute(
                """
                INSERT INTO users (first_name, last_name, username, email, password_hash, phone, country)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, first_name, last_name, username, email, phone, country, created_at
                """,
                (first_name, last_name, unique_username, email.lower(), password_hash, phone, country),
            )
            user = cur.fetchone()
        conn.commit()
    return dict(user)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, first_name, last_name, username, email, password_hash, phone, country, created_at
                FROM users
                WHERE email = %s
                LIMIT 1
                """,
                (email.lower(),),
            )
            user = cur.fetchone()
    return dict(user) if user else None


def get_user_by_username(username: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, first_name, last_name, username, email, password_hash, phone, country, created_at
                FROM users
                WHERE username = %s
                LIMIT 1
                """,
                (username.lower(),),
            )
            user = cur.fetchone()
    return dict(user) if user else None


def get_users() -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, first_name, last_name, username, email, phone, country, created_at
                FROM users
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
    return [dict(row) for row in rows]


def create_password_reset_token(user_id: int, token_hash: str, expires_at: str) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO password_resets (user_id, token_hash, expires_at)
                VALUES (%s, %s, %s)
                """,
                (user_id, token_hash, expires_at),
            )
        conn.commit()


def get_valid_password_reset(token_hash: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, token_hash, expires_at, used_at, created_at
                FROM password_resets
                WHERE token_hash = %s
                  AND used_at IS NULL
                  AND expires_at > NOW()
                LIMIT 1
                """,
                (token_hash,),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def mark_password_reset_used(reset_id: int) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE password_resets
                SET used_at = NOW()
                WHERE id = %s
                """,
                (reset_id,),
            )
        conn.commit()


def update_user_password(user_id: int, password_hash: str) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET password_hash = %s
                WHERE id = %s
                """,
                (password_hash, user_id),
            )
        conn.commit()


def _normalize_referral_settings(row: dict[str, Any]) -> dict[str, bool]:
    return {
        "email_notifications": bool(row["email_notifications"]),
        "show_in_leaderboard": bool(row["show_in_leaderboard"]),
        "auto_share_achievements": bool(row["auto_share_achievements"]),
    }


def get_referral_settings(user_id: int) -> dict[str, bool]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO referral_settings (user_id)
                VALUES (%s)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id,),
            )
            cur.execute(
                """
                SELECT email_notifications, show_in_leaderboard, auto_share_achievements
                FROM referral_settings
                WHERE user_id = %s
                LIMIT 1
                """,
                (user_id,),
            )
            row = cur.fetchone()
        conn.commit()

    if not row:
        return {
            "email_notifications": True,
            "show_in_leaderboard": True,
            "auto_share_achievements": False,
        }

    return _normalize_referral_settings(dict(row))


def update_referral_settings(
    user_id: int,
    email_notifications: bool,
    show_in_leaderboard: bool,
    auto_share_achievements: bool,
) -> dict[str, bool]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO referral_settings (user_id, email_notifications, show_in_leaderboard, auto_share_achievements)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id)
                DO UPDATE SET
                    email_notifications = EXCLUDED.email_notifications,
                    show_in_leaderboard = EXCLUDED.show_in_leaderboard,
                    auto_share_achievements = EXCLUDED.auto_share_achievements,
                    updated_at = NOW()
                RETURNING email_notifications, show_in_leaderboard, auto_share_achievements
                """,
                (user_id, email_notifications, show_in_leaderboard, auto_share_achievements),
            )
            row = cur.fetchone()
        conn.commit()

    return _normalize_referral_settings(dict(row))


def create_referrals(user_id: int, emails: list[str]) -> list[dict[str, Any]]:
    created_rows: list[dict[str, Any]] = []
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            for email in emails:
                local_part = email.split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ")
                invite_name = " ".join(word.capitalize() for word in local_part.split() if word) or "New Referral"
                cur.execute(
                    """
                    INSERT INTO referrals (user_id, invite_email, invite_name, status)
                    VALUES (%s, %s, %s, 'pending')
                    RETURNING id, invite_email, invite_name, status, created_at
                    """,
                    (user_id, email.lower(), invite_name),
                )
                row = cur.fetchone()
                created_rows.append(dict(row))
        conn.commit()

    return created_rows


def get_referrals(user_id: int) -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, invite_email, invite_name, status, created_at
                FROM referrals
                WHERE user_id = %s
                ORDER BY created_at DESC
                """,
                (user_id,),
            )
            rows = cur.fetchall()

    return [dict(row) for row in rows]


def upsert_referral_signup(user_id: int, invite_email: str, invite_name: str) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM referrals
                WHERE user_id = %s AND invite_email = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (user_id, invite_email.lower()),
            )
            existing = cur.fetchone()

            if existing:
                cur.execute(
                    """
                    UPDATE referrals
                    SET invite_name = %s,
                        status = 'active'
                    WHERE id = %s
                    """,
                    (invite_name, existing["id"]),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO referrals (user_id, invite_email, invite_name, status)
                    VALUES (%s, %s, %s, 'active')
                    """,
                    (user_id, invite_email.lower(), invite_name),
                )

        conn.commit()


def get_user_settings(user_id: int) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT settings_json
                FROM user_settings
                WHERE user_id = %s
                LIMIT 1
                """,
                (user_id,),
            )
            row = cur.fetchone()

    if not row:
        return None

    settings_value = row.get("settings_json")
    if isinstance(settings_value, dict):
        return settings_value
    if isinstance(settings_value, str):
        try:
            return json.loads(settings_value)
        except Exception:
            return None
    return None


def upsert_user_settings(user_id: int, settings_json: dict[str, Any]) -> dict[str, Any]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_settings (user_id, settings_json)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (user_id)
                DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()
                RETURNING settings_json
                """,
                (user_id, json.dumps(settings_json)),
            )
            row = cur.fetchone()
        conn.commit()

    settings_value = row.get("settings_json") if row else settings_json
    if isinstance(settings_value, dict):
        return settings_value
    if isinstance(settings_value, str):
        try:
            return json.loads(settings_value)
        except Exception:
            return settings_json
    return settings_json


def create_auth_session(
    session_id: str,
    user_id: int,
    token_hash: str,
    ip: str,
    location: str,
    device: str,
    browser: str,
    os: str,
) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth_sessions (id, user_id, token_hash, ip, location, device, browser, os)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (session_id, user_id, token_hash, ip, location, device, browser, os),
            )
        conn.commit()


def get_auth_session_by_token_hash(token_hash: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, token_hash, ip, location, device, browser, os, created_at, last_active, revoked_at
                FROM auth_sessions
                WHERE token_hash = %s
                LIMIT 1
                """,
                (token_hash,),
            )
            row = cur.fetchone()

    return dict(row) if row else None


def touch_auth_session(session_id: str) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET last_active = NOW()
                WHERE id = %s AND revoked_at IS NULL
                """,
                (session_id,),
            )
        conn.commit()


def list_auth_sessions(user_id: int, current_session_id: str | None = None) -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, device, location, ip, last_active, browser, os, created_at
                FROM auth_sessions
                WHERE user_id = %s AND revoked_at IS NULL
                ORDER BY last_active DESC
                """,
                (user_id,),
            )
            rows = cur.fetchall()

    sessions: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        sessions.append(
            {
                "id": item["id"],
                "device": item.get("device") or "Unknown Device",
                "location": item.get("location") or "Unknown",
                "ip": item.get("ip") or "Unknown",
                "lastActive": item.get("last_active"),
                "current": item["id"] == current_session_id,
                "browser": item.get("browser") or "Unknown",
                "os": item.get("os") or "Unknown",
            }
        )

    return sessions


def revoke_auth_session(user_id: int, session_id: str) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET revoked_at = NOW()
                WHERE user_id = %s AND id = %s AND revoked_at IS NULL
                """,
                (user_id, session_id),
            )
        conn.commit()


def revoke_other_auth_sessions(user_id: int, current_session_id: str) -> int:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET revoked_at = NOW()
                WHERE user_id = %s AND id <> %s AND revoked_at IS NULL
                """,
                (user_id, current_session_id),
            )
            affected = cur.rowcount or 0
        conn.commit()

    return affected


def log_login_history_event(
    event_id: str,
    user_id: int,
    ip: str,
    location: str,
    device: str,
    success: bool,
    method: str,
) -> None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth_login_history (id, user_id, ip, location, device, success, method)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (event_id, user_id, ip, location, device, success, method),
            )
        conn.commit()


def list_login_history(user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, timestamp, ip, location, device, success, method
                FROM auth_login_history
                WHERE user_id = %s
                                    AND method <> 'two_factor_required'
                ORDER BY timestamp DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            rows = cur.fetchall()

    return [
        {
            "id": row["id"],
            "timestamp": row["timestamp"],
            "ip": row.get("ip") or "Unknown",
            "location": row.get("location") or "Unknown",
            "device": row.get("device") or "Unknown",
            "success": bool(row.get("success")),
            "method": row.get("method") or "unknown",
        }
        for row in rows
    ]
