"""
FreqTrade bot proxy module.
Supports multiple bot instances configured via comma-separated env vars.
Uses HTTP Basic Auth (proven to work with the running container).
"""
from __future__ import annotations

import base64
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException

from .database import ensure_bot_share, get_bot_share_by_token, set_bot_share_enabled
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
        raise HTTPException(status_code=404, detail=f"Bot '{bot_id}' not found")
    return BOT_REGISTRY[bot_id]


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
def list_bots():
    """Return all configured bot IDs and names."""
    return [{"id": b["id"], "name": b["name"]} for b in BOT_REGISTRY.values()]


@router.get("/{bot_id}/ping")
def bot_ping(bot_id: str):
    bot = _resolve(bot_id)
    return _ft_get(bot, "ping")


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
    bot = _resolve(bot_id)
    return _ft_get(bot, "profit")


@router.get("/{bot_id}/balance")
def bot_balance(bot_id: str):
    bot = _resolve(bot_id)
    return _ft_get(bot, "balance")


@router.get("/{bot_id}/status")
def bot_status(bot_id: str):
    """Open trades."""
    bot = _resolve(bot_id)
    return _ft_get(bot, "status")


@router.get("/{bot_id}/trades")
def bot_trades(bot_id: str, limit: int = 50, offset: int = 0):
    """Closed trades."""
    bot = _resolve(bot_id)
    return _ft_get(bot, "trades", f"limit={limit}&offset={offset}")


@router.get("/{bot_id}/performance")
def bot_performance(bot_id: str):
    """Per-pair performance stats."""
    bot = _resolve(bot_id)
    return _ft_get(bot, "performance")


@router.get("/{bot_id}/daily")
def bot_daily(bot_id: str, days: int = 30):
    bot = _resolve(bot_id)
    return _ft_get(bot, "daily", f"timescale={days}")


@router.get("/{bot_id}/stats")
def bot_stats(bot_id: str):
    """
    Aggregate endpoint: merges profit, balance, and config
    into one response consumed by the My Bots detail panel.
    """
    bot = _resolve(bot_id)
    profit = _ft_get(bot, "profit")
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
    bot = _resolve(bot_id)
    try:
        return _ft_get(bot, f"trade/{trade_id}")
    except HTTPException as exc:
        if exc.status_code in (404, 405):
            return _ft_get(bot, f"trades/{trade_id}")
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
