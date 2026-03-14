"""
FreqTrade bot proxy module.
Supports multiple bot instances configured via comma-separated env vars.
Uses HTTP Basic Auth (proven to work with the running container).
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException

from .database import (
    ensure_bot_share,
    get_auth_session_by_token_hash,
    get_bot_account,
    get_bot_share_by_token,
    get_user_by_email,
    list_bot_accounts,
    set_bot_share_enabled,
    touch_auth_session,
    upsert_bot_account,
    upsert_bot_runtime_data,
)
from .settings import settings

router = APIRouter(prefix="/api/bots", tags=["bots"])


# ---------------------------------------------------------------------------
# Bot registry – built once at import time from settings
# ---------------------------------------------------------------------------

def _split(raw: str) -> list[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


def _build_registry() -> dict[str, dict[str, str]]:
    ids = _split(settings.freqtrade_bot_ids)
    urls = _split(settings.freqtrade_urls)
    users = _split(settings.freqtrade_usernames)
    passwords = _split(settings.freqtrade_passwords)
    names = _split(settings.freqtrade_bot_names)

    registry: dict[str, dict[str, str]] = {}
    for i, bot_id in enumerate(ids):
        registry[bot_id] = {
            "id": bot_id,
            "name": names[i] if i < len(names) else bot_id,
            "url": urls[i] if i < len(urls) else urls[0],
            "username": users[i] if i < len(users) else users[0],
            "password": passwords[i] if i < len(passwords) else passwords[0],
        }
    return registry


BOT_REGISTRY: dict[str, dict[str, str]] = _build_registry()


def _sync_registry_to_db() -> None:
    for bot in BOT_REGISTRY.values():
        upsert_bot_account(
            bot_id=bot["id"],
            bot_name=bot.get("name") or bot["id"],
            freqtrade_url=bot.get("url"),
            metadata_json={"source": "freqtrade_settings"},
        )


# ---------------------------------------------------------------------------
# FreqTrade HTTP helper
# ---------------------------------------------------------------------------

def _basic_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


def _ft_request(bot: dict[str, str], path: str, method: str = "GET", params: str = "", payload: dict[str, Any] | None = None) -> Any:
    """Call a FreqTrade REST endpoint and return parsed JSON response when possible."""
    url = f"{bot['url']}/api/v1/{path}"
    if params:
        url = f"{url}?{params}"

    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": _basic_header(bot["username"], bot["password"]),
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(req, timeout=15) as resp:
            raw = resp.read()
            if not raw:
                return {"status": "ok"}
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"status": "ok", "raw": raw.decode(errors="ignore")}
    except HTTPError as exc:
        detail = f"FreqTrade returned {exc.code}: {exc.reason}"
        try:
            err_raw = exc.read()
            if err_raw:
                err_json = json.loads(err_raw)
                if isinstance(err_json, dict):
                    detail = err_json.get("detail") or err_json.get("error") or detail
        except Exception:
            pass
        raise HTTPException(status_code=exc.code, detail=detail)
    except (URLError, OSError) as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach FreqTrade bot: {exc}")


def _ft_get(bot: dict[str, str], path: str, params: str = "") -> Any:
    return _ft_request(bot, path, method="GET", params=params)


def _resolve(bot_id: str) -> dict[str, str]:
    if bot_id not in BOT_REGISTRY:
        row = get_bot_account(bot_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Bot '{bot_id}' not found")

        urls = _split(settings.freqtrade_urls)
        users = _split(settings.freqtrade_usernames)
        passwords = _split(settings.freqtrade_passwords)

        fallback_url = urls[0] if urls else ""
        fallback_user = users[0] if users else ""
        fallback_password = passwords[0] if passwords else ""

        return {
            "id": bot_id,
            "name": str(row.get("bot_name") or bot_id),
            "url": str(row.get("freqtrade_url") or fallback_url),
            "username": fallback_user,
            "password": fallback_password,
        }
    return BOT_REGISTRY[bot_id]


def _get_db_only_bot_row(bot_id: str) -> dict[str, Any] | None:
    row = get_bot_account(bot_id)
    if not row:
        return None
    # Purchased bots should use persisted DB payloads until explicitly wired to dedicated runtime.
    if bool(row.get("purchased")) and bot_id not in BOT_REGISTRY:
        metadata = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
        setup_completed = str(metadata.get("setup_status") or "").lower() == "completed"
        freqtrade_url = str(row.get("freqtrade_url") or "").strip()
        if setup_completed and freqtrade_url:
            return None
        return row
    return None


def _is_setup_completed(row: dict[str, Any]) -> bool:
    metadata = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
    return str(metadata.get("setup_status") or "").lower() == "completed"


def _normalize_stored_trades_payload(raw: Any, limit: int, offset: int) -> dict[str, Any] | list[Any]:
    if isinstance(raw, dict):
        trades = raw.get("trades") if isinstance(raw.get("trades"), list) else []
        total = raw.get("total_trades") if isinstance(raw.get("total_trades"), int) else len(trades)
        sliced = trades[offset: offset + limit]
        return {
            "trades": sliced,
            "trades_count": len(sliced),
            "offset": offset,
            "total_trades": total,
        }
    if isinstance(raw, list):
        sliced = raw[offset: offset + limit]
        return {
            "trades": sliced,
            "trades_count": len(sliced),
            "offset": offset,
            "total_trades": len(raw),
        }
    return {"trades": [], "trades_count": 0, "offset": offset, "total_trades": 0}


def _validate_session_for_email(email: str, session_token: str) -> int:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
    session_row = get_auth_session_by_token_hash(token_hash)
    if not session_row or session_row.get("user_id") != user.get("id") or session_row.get("revoked_at") is not None:
        raise HTTPException(status_code=401, detail="Invalid session")

    touch_auth_session(str(session_row["id"]))
    return int(user["id"])


def _share_payload(row: dict[str, Any]) -> dict[str, Any]:
    token = str(row.get("share_token") or "")
    base = settings.frontend_url.rstrip("/")
    return {
        "bot_id": row.get("bot_id"),
        "enabled": bool(row.get("enabled")),
        "share_token": token,
        "share_url": f"{base}/shared/bot-accounts/{token}" if token else "",
    }


def _resolve_shared_bot(share_token: str) -> tuple[str, dict[str, str]]:
    row = get_bot_share_by_token(share_token)
    if not row or not bool(row.get("enabled")):
        raise HTTPException(status_code=404, detail="Shared bot link not found or disabled")

    bot_id = str(row.get("bot_id") or "")
    if not bot_id:
        raise HTTPException(status_code=404, detail="Shared bot link not found or disabled")
    return bot_id, _resolve(bot_id)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_bots(email: str | None = None, session_token: str | None = None, purchased_only: bool = False):
    """Return all configured bot IDs and names from DB."""
    _sync_registry_to_db()
    rows = list_bot_accounts()

    def _row_to_entry(r: dict) -> dict:
        metadata = r.get("metadata_json") or {}
        account_type = str(metadata.get("account_type") or "").lower()
        return {
            "id": r.get("bot_id"),
            "name": r.get("bot_name") or r.get("bot_id"),
            "account_type": account_type,
        }

    if purchased_only:
        if not email or not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        owner_user_id = _validate_session_for_email(email, session_token)
        rows = [
            r for r in rows
            if bool(r.get("purchased")) and int(r.get("owner_user_id") or 0) == owner_user_id
        ]
        return [_row_to_entry(r) for r in rows]

    if rows:
        return [_row_to_entry(r) for r in rows]
    return [{"id": b["id"], "name": b["name"], "account_type": ""} for b in BOT_REGISTRY.values()]


@router.get("/{bot_id}/ping")
def bot_ping(bot_id: str):
    bot = _resolve(bot_id)
    return _ft_get(bot, "ping")


@router.get("/{bot_id}/stored")
def bot_stored_data(bot_id: str):
    _ = _resolve(bot_id)
    row = get_bot_account(bot_id)
    if not row:
        raise HTTPException(status_code=404, detail="Stored bot record not found")
    return row


@router.get("/{bot_id}/share")
def bot_share_get(bot_id: str):
    _ = _resolve(bot_id)
    row = ensure_bot_share(bot_id)
    return _share_payload(row)


@router.post("/{bot_id}/share")
def bot_share_update(bot_id: str, body: dict[str, Any] | None = None):
    _ = _resolve(bot_id)
    enabled = bool((body or {}).get("enabled", False))
    row = set_bot_share_enabled(bot_id, enabled)
    return _share_payload(row)


@router.get("/shared/{share_token}/meta")
def shared_bot_meta(share_token: str):
    bot_id, bot = _resolve_shared_bot(share_token)
    row = get_bot_share_by_token(share_token) or {}
    return {
        "bot_id": bot_id,
        "bot_name": bot.get("name", bot_id),
        **_share_payload(row),
    }


@router.get("/shared/{share_token}/status")
def shared_bot_status(share_token: str):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_status(bot_id)


@router.get("/shared/{share_token}/trades")
def shared_bot_trades(share_token: str, limit: int = 50, offset: int = 0):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_trades(bot_id, limit=limit, offset=offset)


@router.get("/shared/{share_token}/performance")
def shared_bot_performance(share_token: str):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_performance(bot_id)


@router.get("/shared/{share_token}/daily")
def shared_bot_daily(share_token: str, days: int = 30):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_daily(bot_id, days=days)


@router.get("/shared/{share_token}/stats")
def shared_bot_stats(share_token: str):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_stats(bot_id)


@router.get("/shared/{share_token}/trade")
def shared_bot_trade_detail(share_token: str, trade_id: int):
    bot_id, _ = _resolve_shared_bot(share_token)
    return bot_trade_detail(bot_id, trade_id=trade_id)


@router.get("/{bot_id}/config")
def bot_config(bot_id: str):
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        config_raw = db_row.get("config_json") if isinstance(db_row.get("config_json"), dict) else {}
        exchange_name = str(db_row.get("exchange") or "")
        capital = float(db_row.get("capital_usdt") or 0)
        return {
            "bot_name": config_raw.get("bot_name") or db_row.get("bot_name") or bot_id,
            "strategy": config_raw.get("strategy") or "pending_setup",
            "state": config_raw.get("state") or "pending_setup",
            "runmode": config_raw.get("runmode") or "live",
            "exchange": config_raw.get("exchange") or exchange_name,
            "stake_currency": config_raw.get("stake_currency") or "USDT",
            "stake_amount": config_raw.get("stake_amount") if config_raw.get("stake_amount") is not None else capital,
            "max_open_trades": config_raw.get("max_open_trades") if config_raw.get("max_open_trades") is not None else 0,
            "timeframe": config_raw.get("timeframe") or "n/a",
            "dry_run": bool(config_raw.get("dry_run", False)),
        }

    bot = _resolve(bot_id)
    raw = _ft_get(bot, "show_config")
    # Sanitise – never forward secrets to the frontend
    safe_keys = [
        "bot_name", "strategy", "state", "runmode", "exchange",
        "stake_currency", "stake_amount", "max_open_trades",
        "timeframe", "dry_run",
    ]
    return {k: raw[k] for k in safe_keys if k in raw}


@router.get("/{bot_id}/profit")
def bot_profit(bot_id: str):
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            return {
                "profit_closed_fiat": 0,
                "profit_closed_percent": 0,
                "trade_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "winrate": 0,
                "first_trade_date": None,
                "latest_trade_date": None,
            }
        stored = db_row.get("profit_json")
        return stored if isinstance(stored, dict) else {
            "profit_closed_fiat": 0,
            "profit_closed_percent": 0,
            "trade_count": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "winrate": 0,
            "first_trade_date": None,
            "latest_trade_date": None,
        }

    bot = _resolve(bot_id)
    try:
        return _ft_get(bot, "profit")
    except HTTPException as exc:
        # Some exchanges/futures setups can intermittently fail the profit endpoint.
        # Return a safe default so bot dashboards still render.
        if exc.status_code >= 500:
            return {
                "profit_closed_fiat": 0,
                "profit_closed_percent": 0,
                "trade_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "winrate": 0,
                "first_trade_date": None,
                "latest_trade_date": None,
            }
        raise


@router.get("/{bot_id}/balance")
def bot_balance(bot_id: str):
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        capital = float(db_row.get("capital_usdt") or 0)
        if not _is_setup_completed(db_row):
            return {
                "currencies": [
                    {
                        "currency": "USDT",
                        "balance": capital,
                        "free": capital,
                        "used": 0,
                        "is_bot_managed": True,
                        "is_position": False,
                    }
                ]
            }
        stored = db_row.get("balance_json")
        if isinstance(stored, dict):
            return stored
        return {
            "currencies": [
                {
                    "currency": "USDT",
                    "balance": capital,
                    "free": capital,
                    "used": 0,
                    "is_bot_managed": True,
                    "is_position": False,
                }
            ]
        }

    bot = _resolve(bot_id)
    return _ft_get(bot, "balance")


@router.get("/{bot_id}/status")
def bot_status(bot_id: str):
    """Open trades."""
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            return []
        stored = db_row.get("status_json")
        return stored if isinstance(stored, list) else []

    bot = _resolve(bot_id)
    payload = _ft_get(bot, "status")
    if isinstance(payload, list):
        upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), status_json=payload)
    return payload


@router.get("/{bot_id}/trades")
def bot_trades(bot_id: str, limit: int = 50, offset: int = 0):
    """Closed trades."""
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            return {"trades": [], "trades_count": 0, "offset": offset, "total_trades": 0}
        stored = db_row.get("trades_json")
        return _normalize_stored_trades_payload(stored, limit=limit, offset=offset)

    bot = _resolve(bot_id)
    payload = _ft_get(bot, "trades", f"limit={limit}&offset={offset}")
    if isinstance(payload, dict) or isinstance(payload, list):
        upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), trades_json=payload)
    return payload


@router.get("/{bot_id}/performance")
def bot_performance(bot_id: str):
    """Per-pair performance stats."""
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            return []
        stored = db_row.get("performance_json")
        return stored if isinstance(stored, list) else []

    bot = _resolve(bot_id)
    payload = _ft_get(bot, "performance")
    if isinstance(payload, list):
        upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), performance_json=payload)
    return payload


@router.get("/{bot_id}/daily")
def bot_daily(bot_id: str, days: int = 30):
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            return []
        stored = db_row.get("daily_json")
        return stored if isinstance(stored, list) else []

    bot = _resolve(bot_id)
    payload = _ft_get(bot, "daily", f"timescale={days}")
    if isinstance(payload, list):
        upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), daily_json=payload)
    return payload


@router.get("/{bot_id}/stats")
def bot_stats(bot_id: str):
    """
    Aggregate endpoint: merges profit, balance, and config
    into one response consumed by the My Bots detail panel.
    """
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        config_raw = db_row.get("config_json") if isinstance(db_row.get("config_json"), dict) else {}
        setup_completed = _is_setup_completed(db_row)
        profit = db_row.get("profit_json") if setup_completed and isinstance(db_row.get("profit_json"), dict) else {
            "profit_closed_fiat": 0,
            "profit_closed_percent": 0,
            "trade_count": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "winrate": 0,
            "first_trade_date": None,
            "latest_trade_date": None,
        }
        capital = float(db_row.get("capital_usdt") or 0)
        balance = db_row.get("balance_json") if setup_completed and isinstance(db_row.get("balance_json"), dict) else {
            "currencies": [
                {
                    "currency": "USDT",
                    "balance": capital,
                    "free": capital,
                    "used": 0,
                    "is_bot_managed": True,
                    "is_position": False,
                }
            ]
        }

        safe_config = {
            "bot_name": config_raw.get("bot_name") or db_row.get("bot_name") or bot_id,
            "strategy": config_raw.get("strategy") or "pending_setup",
            "state": (config_raw.get("state") or "running") if setup_completed else "pending_setup",
            "runmode": config_raw.get("runmode") or "live",
            "stake_currency": config_raw.get("stake_currency") or "USDT",
            "stake_amount": config_raw.get("stake_amount") if config_raw.get("stake_amount") is not None else capital,
            "max_open_trades": config_raw.get("max_open_trades") if config_raw.get("max_open_trades") is not None else 0,
            "timeframe": config_raw.get("timeframe") or "n/a",
            "dry_run": bool(config_raw.get("dry_run", False)),
            "exchange": config_raw.get("exchange") or str(db_row.get("exchange") or ""),
        }

        currencies = balance.get("currencies", []) if isinstance(balance, dict) else []
        main_currency = next(
            (c for c in currencies if isinstance(c, dict) and c.get("is_bot_managed") and not c.get("is_position")),
            None,
        )
        return {
            "bot_id": bot_id,
            "bot_name": db_row.get("bot_name") or bot_id,
            "config": safe_config,
            "profit": profit,
            "balance_usdt": float(main_currency.get("balance") if isinstance(main_currency, dict) else capital or 0),
            "free_usdt": float(main_currency.get("free") if isinstance(main_currency, dict) else capital or 0),
            "used_usdt": float(main_currency.get("used") if isinstance(main_currency, dict) else 0),
        }

    bot = _resolve(bot_id)

    try:
        profit = _ft_get(bot, "profit")
    except HTTPException as exc:
        if exc.status_code >= 500:
            profit = {
                "profit_closed_fiat": 0,
                "profit_closed_percent": 0,
                "trade_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "winrate": 0,
                "first_trade_date": None,
                "latest_trade_date": None,
            }
        else:
            raise

    balance = _ft_get(bot, "balance")
    config_raw = _ft_get(bot, "show_config")

    safe_config = {k: config_raw.get(k) for k in [
        "bot_name", "strategy", "state", "runmode",
        "stake_currency", "stake_amount", "max_open_trades",
        "timeframe", "dry_run", "exchange",
    ]}

    main_currency = next(
        (c for c in balance.get("currencies", []) if c.get("is_bot_managed") and not c.get("is_position")),
        None,
    )

    upsert_bot_runtime_data(
        bot_id,
        bot_name=bot.get("name"),
        config_json=safe_config,
        profit_json=profit,
        balance_json=balance,
    )

    return {
        "bot_id": bot_id,
        "bot_name": bot["name"],
        "config": safe_config,
        "profit": profit,
        "balance_usdt": main_currency["balance"] if main_currency else 0,
        "free_usdt": main_currency["free"] if main_currency else 0,
        "used_usdt": main_currency["used"] if main_currency else 0,
    }


@router.get("/{bot_id}/trade")
def bot_trade_detail(bot_id: str, trade_id: int):
    """Fetch full details for a single trade."""
    db_row = _get_db_only_bot_row(bot_id)
    if db_row:
        if not _is_setup_completed(db_row):
            raise HTTPException(status_code=404, detail="Trade not found")
        detail = db_row.get("trade_detail_json")
        if isinstance(detail, dict):
            return detail

        stored = db_row.get("trades_json")
        trades: list[dict[str, Any]] = []
        if isinstance(stored, dict):
            raw_trades = stored.get("trades")
            if isinstance(raw_trades, list):
                trades = [t for t in raw_trades if isinstance(t, dict)]
        elif isinstance(stored, list):
            trades = [t for t in stored if isinstance(t, dict)]

        for trade in trades:
            candidate = trade.get("trade_id") or trade.get("tradeid")
            if candidate == trade_id:
                return trade

        raise HTTPException(status_code=404, detail="Trade not found")

    bot = _resolve(bot_id)
    try:
        payload = _ft_get(bot, f"trade/{trade_id}")
        if isinstance(payload, dict):
            upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), trade_detail_json=payload)
        return payload
    except HTTPException as exc:
        if exc.status_code in (404, 405):
            payload = _ft_get(bot, f"trades/{trade_id}")
            if isinstance(payload, dict):
                upsert_bot_runtime_data(bot_id, bot_name=bot.get("name"), trade_detail_json=payload)
            return payload
        raise


@router.post("/{bot_id}/forceexit")
def bot_forceexit(bot_id: str, body: dict[str, Any]):
    """Force-exit an open trade via limit/market/partial."""
    bot = _resolve(bot_id)
    tradeid = body.get("tradeid") or body.get("trade_id")
    if tradeid is None:
        raise HTTPException(status_code=400, detail="tradeid is required")

    payload: dict[str, Any] = {
        "tradeid": int(tradeid),
        "ordertype": body.get("ordertype", "market"),
    }
    if body.get("amount") is not None:
        payload["amount"] = body["amount"]

    return _ft_request(bot, "forceexit", method="POST", payload=payload)


@router.post("/{bot_id}/forceexit_all")
def bot_forceexit_all(bot_id: str, body: dict[str, Any] | None = None):
    """Force-exit all open trades for the bot."""
    bot = _resolve(bot_id)
    ordertype = (body or {}).get("ordertype", "market")
    open_trades = _ft_get(bot, "status")

    if not isinstance(open_trades, list):
        raise HTTPException(status_code=502, detail="Unexpected status response from FreqTrade")

    results: list[dict[str, Any]] = []
    for trade in open_trades:
        tradeid = trade.get("trade_id") or trade.get("tradeid")
        if tradeid is None:
            continue

        payload = {
            "tradeid": int(tradeid),
            "ordertype": ordertype,
        }
        results.append({
            "tradeid": int(tradeid),
            "result": _ft_request(bot, "forceexit", method="POST", payload=payload),
        })

    return {
        "count": len(results),
        "results": results,
    }


@router.post("/{bot_id}/reload")
def bot_reload(bot_id: str):
    """Reload bot configuration."""
    bot = _resolve(bot_id)
    return _ft_request(bot, "reload_config", method="POST", payload={})


@router.post("/{bot_id}/pause")
def bot_pause_entries(bot_id: str):
    """Pause new entries while keeping the bot running."""
    bot = _resolve(bot_id)
    return _ft_request(bot, "stopentry", method="POST", payload={})


@router.post("/{bot_id}/start")
def bot_start(bot_id: str):
    """Start/resume bot trading."""
    bot = _resolve(bot_id)
    return _ft_request(bot, "start", method="POST", payload={})


@router.post("/{bot_id}/delete_trade")
def bot_delete_trade(bot_id: str, body: dict[str, Any]):
    """Delete a trade from DB/history.

    Tries FreqTrade's `delete_trade` endpoint first, then falls back to `/trades/{id}` DELETE.
    """
    bot = _resolve(bot_id)
    tradeid = body.get("tradeid") or body.get("trade_id")
    if tradeid is None:
        raise HTTPException(status_code=400, detail="tradeid is required")

    payload = {"tradeid": int(tradeid)}
    try:
        return _ft_request(bot, "delete_trade", method="POST", payload=payload)
    except HTTPException as exc:
        if exc.status_code in (404, 405):
            return _ft_request(bot, f"trades/{int(tradeid)}", method="DELETE")
        raise
