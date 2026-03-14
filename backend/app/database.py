from typing import Any
import re
import json
from uuid import uuid4

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
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS bot_shares (
                    bot_id TEXT PRIMARY KEY,
                    share_token TEXT NOT NULL UNIQUE,
                    enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS bot_accounts (
                    bot_id TEXT PRIMARY KEY,
                    bot_name TEXT NOT NULL,
                    freqtrade_url TEXT,
                    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    purchased BOOLEAN NOT NULL DEFAULT FALSE,
                    exchange TEXT,
                    model TEXT,
                    capital_usdt DOUBLE PRECISION,
                    billing_cycle_days INTEGER,
                    setup_charge_usd DOUBLE PRECISION,
                    monthly_server_fee_usd DOUBLE PRECISION NOT NULL DEFAULT 10,
                    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    config_json JSONB,
                    profit_json JSONB,
                    balance_json JSONB,
                    status_json JSONB,
                    trades_json JSONB,
                    performance_json JSONB,
                    daily_json JSONB,
                    trade_detail_json JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS bot_accounts_purchased_idx ON bot_accounts (purchased)")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS bot_setup_events (
                    id BIGSERIAL PRIMARY KEY,
                    bot_id TEXT NOT NULL REFERENCES bot_accounts(bot_id) ON DELETE CASCADE,
                    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    step TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS bot_setup_events_bot_idx ON bot_setup_events (bot_id, created_at DESC)")
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


def _new_share_token() -> str:
    return str(uuid4())


def ensure_bot_share(bot_id: str) -> dict[str, Any]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_shares (bot_id, share_token, enabled)
                VALUES (%s, %s, FALSE)
                ON CONFLICT (bot_id) DO NOTHING
                """,
                (bot_id, _new_share_token()),
            )
            cur.execute(
                """
                SELECT bot_id, share_token, enabled, created_at, updated_at
                FROM bot_shares
                WHERE bot_id = %s
                LIMIT 1
                """,
                (bot_id,),
            )
            row = cur.fetchone()
        conn.commit()

    return dict(row) if row else {"bot_id": bot_id, "share_token": _new_share_token(), "enabled": False}


def set_bot_share_enabled(bot_id: str, enabled: bool) -> dict[str, Any]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_shares (bot_id, share_token, enabled)
                VALUES (%s, %s, %s)
                ON CONFLICT (bot_id)
                DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
                RETURNING bot_id, share_token, enabled, created_at, updated_at
                """,
                (bot_id, _new_share_token(), enabled),
            )
            row = cur.fetchone()
        conn.commit()

    return dict(row)


def get_bot_share_by_token(share_token: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT bot_id, share_token, enabled, created_at, updated_at
                FROM bot_shares
                WHERE share_token = %s
                LIMIT 1
                """,
                (share_token,),
            )
            row = cur.fetchone()

    return dict(row) if row else None


def upsert_bot_account(
    bot_id: str,
    bot_name: str,
    freqtrade_url: str | None = None,
    owner_user_id: int | None = None,
    purchased: bool = False,
    metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata_payload = metadata_json or {}
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_accounts (
                    bot_id, bot_name, freqtrade_url, owner_user_id, purchased, metadata_json
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (bot_id)
                DO UPDATE SET
                    bot_name = EXCLUDED.bot_name,
                    freqtrade_url = COALESCE(EXCLUDED.freqtrade_url, bot_accounts.freqtrade_url),
                    owner_user_id = COALESCE(EXCLUDED.owner_user_id, bot_accounts.owner_user_id),
                    purchased = bot_accounts.purchased OR EXCLUDED.purchased,
                    metadata_json = CASE
                        WHEN EXCLUDED.metadata_json IS NULL THEN bot_accounts.metadata_json
                        ELSE bot_accounts.metadata_json || EXCLUDED.metadata_json
                    END,
                    updated_at = NOW()
                RETURNING *
                """,
                (bot_id, bot_name, freqtrade_url, owner_user_id, purchased, json.dumps(metadata_payload)),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def list_bot_accounts() -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM bot_accounts
                ORDER BY created_at DESC, bot_id DESC
                """
            )
            rows = cur.fetchall()
    return [dict(row) for row in rows]


def get_bot_account(bot_id: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM bot_accounts
                WHERE bot_id = %s
                LIMIT 1
                """,
                (bot_id,),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def get_user_purchased_bot_account(user_id: int, bot_id: str) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM bot_accounts
                WHERE bot_id = %s
                  AND owner_user_id = %s
                  AND purchased = TRUE
                LIMIT 1
                """,
                (bot_id, user_id),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def delete_user_purchased_bot_account(user_id: int, bot_id: str) -> bool:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM bot_accounts
                WHERE bot_id = %s
                  AND owner_user_id = %s
                  AND purchased = TRUE
                RETURNING bot_id
                """,
                (bot_id, user_id),
            )
            row = cur.fetchone()
        conn.commit()
    return row is not None


def update_bot_setup_state(user_id: int, bot_id: str, setup_patch: dict[str, Any]) -> dict[str, Any] | None:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE bot_accounts
                SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s::jsonb,
                    updated_at = NOW()
                WHERE bot_id = %s
                  AND owner_user_id = %s
                  AND purchased = TRUE
                RETURNING *
                """,
                (json.dumps(setup_patch), bot_id, user_id),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row) if row else None


def upsert_bot_runtime_data(
    bot_id: str,
    *,
    bot_name: str | None = None,
    config_json: dict[str, Any] | None = None,
    profit_json: dict[str, Any] | None = None,
    balance_json: dict[str, Any] | None = None,
    status_json: list[dict[str, Any]] | None = None,
    trades_json: dict[str, Any] | list[Any] | None = None,
    performance_json: list[dict[str, Any]] | None = None,
    daily_json: list[dict[str, Any]] | None = None,
    trade_detail_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_accounts (
                    bot_id,
                    bot_name,
                    config_json,
                    profit_json,
                    balance_json,
                    status_json,
                    trades_json,
                    performance_json,
                    daily_json,
                    trade_detail_json
                )
                VALUES (
                    %s,
                    %s,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb
                )
                ON CONFLICT (bot_id)
                DO UPDATE SET
                    bot_name = COALESCE(EXCLUDED.bot_name, bot_accounts.bot_name),
                    config_json = COALESCE(EXCLUDED.config_json, bot_accounts.config_json),
                    profit_json = COALESCE(EXCLUDED.profit_json, bot_accounts.profit_json),
                    balance_json = COALESCE(EXCLUDED.balance_json, bot_accounts.balance_json),
                    status_json = COALESCE(EXCLUDED.status_json, bot_accounts.status_json),
                    trades_json = COALESCE(EXCLUDED.trades_json, bot_accounts.trades_json),
                    performance_json = COALESCE(EXCLUDED.performance_json, bot_accounts.performance_json),
                    daily_json = COALESCE(EXCLUDED.daily_json, bot_accounts.daily_json),
                    trade_detail_json = COALESCE(EXCLUDED.trade_detail_json, bot_accounts.trade_detail_json),
                    updated_at = NOW()
                RETURNING *
                """,
                (
                    bot_id,
                    bot_name or bot_id,
                    json.dumps(config_json) if config_json is not None else None,
                    json.dumps(profit_json) if profit_json is not None else None,
                    json.dumps(balance_json) if balance_json is not None else None,
                    json.dumps(status_json) if status_json is not None else None,
                    json.dumps(trades_json) if trades_json is not None else None,
                    json.dumps(performance_json) if performance_json is not None else None,
                    json.dumps(daily_json) if daily_json is not None else None,
                    json.dumps(trade_detail_json) if trade_detail_json is not None else None,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def create_purchased_bot_account(
    *,
    owner_user_id: int,
    freqtrade_url: str | None = None,
    exchange: str,
    model: str,
    capital_usdt: float,
    billing_cycle_days: int,
    setup_charge_usd: float,
    monthly_server_fee_usd: float,
    metadata_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata_payload = metadata_json or {}
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            bot_id = ""
            for _ in range(8):
                candidate_num = uuid4().int % 100000000
                candidate = f"bot-{candidate_num:08d}"
                cur.execute("SELECT 1 FROM bot_accounts WHERE bot_id = %s LIMIT 1", (candidate,))
                if cur.fetchone() is None:
                    bot_id = candidate
                    break

            if not bot_id:
                raise RuntimeError("Failed to allocate unique bot id")

            account_type = str(metadata_payload.get("account_type") or "real").strip().lower()
            is_demo = account_type == "demo"

            trade_type_raw = str(metadata_payload.get("trade_type") or model or "compound").strip().lower()
            is_fixed = "fixed" in trade_type_raw

            dca_mode_raw = str(metadata_payload.get("dca_mode") or "Disable").strip().lower()
            dca_enabled = dca_mode_raw in {"enable", "enabled", "with_dca", "with dca", "true", "1", "yes"}

            stake_amount_value = 50.0
            raw_stake = metadata_payload.get("stake_amount")
            if raw_stake is not None:
                try:
                    parsed_stake = float(raw_stake)
                    if parsed_stake > 0:
                        stake_amount_value = parsed_stake
                except (TypeError, ValueError):
                    pass
            stake_amount = f"{stake_amount_value:g}" if is_fixed else "unlimited"

            max_open_order = 15
            raw_max_open_order = metadata_payload.get("max_open_order")
            if raw_max_open_order is not None:
                try:
                    max_open_order = int(raw_max_open_order)
                except (TypeError, ValueError):
                    max_open_order = 15
            max_open_order = max(5, min(15, max_open_order))

            bot_name = f"{model} {exchange} Bot"
            exchange_normalized = str(exchange or "").strip().lower()
            exchange_name = "bybit" if "bybit" in exchange_normalized else "binance"
            stake_currency = "USDT"
            initial_config = {
                "bot_name": bot_name,
                "strategy": "pending_setup",
                "state": "pending_setup",
                "runmode": "dry_run" if is_demo else "live",
                "stake_currency": stake_currency,
                "stake_amount": stake_amount,
                "max_open_trades": max_open_order,
                "timeframe": "n/a",
                "dry_run": is_demo,
                "dry_run_wallet": capital_usdt if is_demo else 0,
                "exchange": exchange_name,
                "position_adjustment_enable": dca_enabled,
            }
            initial_profit = {
                "profit_closed_fiat": 0,
                "profit_closed_percent": 0,
                "trade_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "winrate": 0,
                "first_trade_date": None,
                "latest_trade_date": None,
            }
            initial_balance = {
                "currencies": [
                    {
                        "currency": stake_currency,
                        "balance": capital_usdt,
                        "free": capital_usdt,
                        "used": 0,
                        "is_bot_managed": True,
                        "is_position": False,
                    }
                ]
            }
            initial_status: list[dict[str, Any]] = []
            initial_trades = {"trades": [], "trades_count": 0, "offset": 0, "total_trades": 0}
            initial_performance: list[dict[str, Any]] = []
            initial_daily: list[dict[str, Any]] = []

            cur.execute(
                """
                INSERT INTO bot_accounts (
                    bot_id,
                    bot_name,
                    freqtrade_url,
                    owner_user_id,
                    purchased,
                    exchange,
                    model,
                    capital_usdt,
                    billing_cycle_days,
                    setup_charge_usd,
                    monthly_server_fee_usd,
                    metadata_json,
                    config_json,
                    profit_json,
                    balance_json,
                    status_json,
                    trades_json,
                    performance_json,
                    daily_json
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    TRUE,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb
                )
                RETURNING *
                """,
                (
                    bot_id,
                    bot_name,
                    freqtrade_url,
                    owner_user_id,
                    exchange,
                    model,
                    capital_usdt,
                    billing_cycle_days,
                    setup_charge_usd,
                    monthly_server_fee_usd,
                    json.dumps(metadata_payload),
                    json.dumps(initial_config),
                    json.dumps(initial_profit),
                    json.dumps(initial_balance),
                    json.dumps(initial_status),
                    json.dumps(initial_trades),
                    json.dumps(initial_performance),
                    json.dumps(initial_daily),
                ),
            )
            row = cur.fetchone()
        conn.commit()

    return dict(row)


def create_bot_setup_event(
    *,
    bot_id: str,
    owner_user_id: int,
    step: str,
    status: str,
    message: str,
    extra_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    extra_payload = extra_json or {}
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bot_setup_events (bot_id, owner_user_id, step, status, message, extra_json)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id, bot_id, owner_user_id, step, status, message, extra_json, created_at
                """,
                (bot_id, owner_user_id, step, status, message, json.dumps(extra_payload)),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def list_bot_setup_events(owner_user_id: int, bot_id: str) -> list[dict[str, Any]]:
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, bot_id, owner_user_id, step, status, message, extra_json, created_at
                FROM bot_setup_events
                WHERE owner_user_id = %s AND bot_id = %s
                ORDER BY created_at ASC, id ASC
                """,
                (owner_user_id, bot_id),
            )
            rows = cur.fetchall()
    return [dict(row) for row in rows]
