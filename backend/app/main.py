import hashlib
import hmac
import smtplib
import os
import json
import base64
import re
import shlex
import subprocess
import tempfile
from typing import Any
from datetime import datetime, timedelta, timezone
import time
from secrets import token_urlsafe
from uuid import uuid4
from urllib.parse import quote, urlparse, urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen
import pyotp
from cryptography.fernet import Fernet, InvalidToken

from pydantic import BaseModel, EmailStr
from psycopg.errors import UniqueViolation
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from docker.errors import DockerException

from .cache import get_cached_users, invalidate_users_cache, redis_health, set_cached_users
from .database import (
    create_bot_setup_event,
    create_purchased_bot_account,
    create_auth_session,
    create_referrals,
    delete_user_purchased_bot_account,
    create_password_reset_token,
    create_user,
    get_auth_session_by_token_hash,
    get_referral_settings,
    get_referrals,
    list_bot_accounts,
    list_auth_sessions,
    list_bot_setup_events,
    list_login_history,
    get_user_settings,
    get_user_purchased_bot_account,
    get_user_by_email,
    get_user_by_username,
    get_users,
    get_valid_password_reset,
    init_db,
    log_login_history_event,
    mark_password_reset_used,
    postgres_health,
    revoke_auth_session,
    revoke_other_auth_sessions,
    touch_auth_session,
    update_bot_setup_state,
    upsert_bot_account,
    upsert_referral_signup,
    upsert_user_settings,
    update_referral_settings,
    update_user_password,
)
from .docker_client import get_docker_client, safe_docker_ping
from .freqtrade import router as freqtrade_router
from .mailer import send_reset_email
from .security import hash_password, verify_password
from .settings import settings

app = FastAPI(title=settings.app_name)
app.include_router(freqtrade_router)
os.makedirs(settings.profile_pictures_dir, exist_ok=True)
app.mount("/media/profile-pictures", StaticFiles(directory=settings.profile_pictures_dir), name="profile-pictures")


class UserCreatePayload(BaseModel):
    first_name: str
    last_name: str
    username: str | None = None
    email: EmailStr
    password: str
    referral_username: str | None = None
    phone: str | None = None
    country: str | None = None

def build_referral_url(username: str) -> str:
    return f"{settings.frontend_url}/invite/{username}"

def serialize_user(user: dict) -> dict:
    serialized = {
        "id": user["id"],
        "first_name": user["first_name"],
        "last_name": user["last_name"],
        "username": user.get("username"),
        "email": user["email"],
        "phone": user.get("phone"),
        "country": user.get("country"),
        "created_at": user["created_at"],
    }

    if serialized.get("username"):
        serialized["referral_url"] = build_referral_url(serialized["username"])

    settings_payload = get_user_settings(user["id"]) or {}
    profile_settings = settings_payload.get("profile") if isinstance(settings_payload.get("profile"), dict) else {}
    avatar = profile_settings.get("avatar")
    if isinstance(avatar, str) and avatar.strip():
        serialized["avatar"] = avatar

    return serialized


def _avatar_url_from_filename(filename: str) -> str:
    base = settings.public_base_url.rstrip("/")
    return f"{base}/media/profile-pictures/{filename}"


def _avatar_filename_from_url(avatar_url: str) -> str | None:
    try:
        parsed = urlparse(avatar_url)
        path = parsed.path or avatar_url
    except Exception:
        path = avatar_url

    marker = "/media/profile-pictures/"
    if marker not in path:
        return None

    filename = path.split(marker, 1)[1].strip().split("/")[0]
    if not filename or filename in {".", ".."}:
        return None
    return filename


def _delete_avatar_file_if_exists(avatar_url: str) -> None:
    filename = _avatar_filename_from_url(avatar_url)
    if not filename:
        return

    target = os.path.join(settings.profile_pictures_dir, filename)
    if os.path.isfile(target):
        os.remove(target)


_ENCRYPTED_PREFIX = "enc::"


def _get_settings_cipher() -> Fernet | None:
    raw_key = (settings.settings_encryption_key or "").strip()
    if not raw_key:
        return None

    derived = hashlib.sha256(raw_key.encode("utf-8")).digest()
    fernet_key = base64.urlsafe_b64encode(derived)
    return Fernet(fernet_key)


def _encrypt_setting_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    if cleaned.startswith(_ENCRYPTED_PREFIX):
        return cleaned

    cipher = _get_settings_cipher()
    if not cipher:
        return cleaned

    token = cipher.encrypt(cleaned.encode("utf-8")).decode("utf-8")
    return f"{_ENCRYPTED_PREFIX}{token}"


def _decrypt_setting_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    if not cleaned.startswith(_ENCRYPTED_PREFIX):
        return cleaned

    cipher = _get_settings_cipher()
    if not cipher:
        return ""

    token = cleaned[len(_ENCRYPTED_PREFIX):]
    try:
        return cipher.decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


def _mask_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= 4:
        return "*" * len(cleaned)
    return f"{'*' * (len(cleaned) - 4)}{cleaned[-4:]}"


def _normalize_connection_permissions(raw_permissions: object) -> list[str]:
    if not isinstance(raw_permissions, list):
        return ["read", "trade"]

    allowed = {"read", "trade"}
    normalized = [str(item) for item in raw_permissions if str(item) in allowed]
    if not normalized:
        return ["read", "trade"]
    return sorted(set(normalized), key=lambda item: ["read", "trade"].index(item))


def _sanitize_connections_for_storage(settings_payload: dict) -> dict:
    connections = settings_payload.get("connections")
    if not isinstance(connections, list):
        return settings_payload

    sanitized_connections: list[dict] = []
    for raw_connection in connections:
        if not isinstance(raw_connection, dict):
            continue

        connection = dict(raw_connection)
        exchange = str(connection.get("exchange") or "").strip().lower()
        if exchange not in {"binance_futures", "bybit_futures"}:
            exchange = "binance_futures"
        connection["exchange"] = exchange
        connection["type"] = "exchange"
        connection["permissions"] = _normalize_connection_permissions(connection.get("permissions"))

        plain_api_key = str(connection.get("apiKey") or "").strip()
        plain_api_secret = str(connection.get("apiSecret") or "").strip()

        existing_api_key_enc = str(connection.get("apiKeyEnc") or "").strip()
        existing_api_secret_enc = str(connection.get("apiSecretEnc") or "").strip()

        api_key_enc = existing_api_key_enc
        api_secret_enc = existing_api_secret_enc

        if plain_api_key and "*" not in plain_api_key:
            api_key_enc = _encrypt_setting_secret(plain_api_key)
        if plain_api_secret and "*" not in plain_api_secret:
            api_secret_enc = _encrypt_setting_secret(plain_api_secret)

        key_source = _decrypt_setting_secret(api_key_enc) if api_key_enc else ""
        secret_source = _decrypt_setting_secret(api_secret_enc) if api_secret_enc else ""

        connection["apiKeyEnc"] = api_key_enc
        connection["apiSecretEnc"] = api_secret_enc
        connection["apiKey"] = _mask_secret(key_source or plain_api_key)
        connection["apiSecret"] = _mask_secret(secret_source or plain_api_secret)

        sanitized_connections.append(connection)

    updated = dict(settings_payload)
    updated["connections"] = sanitized_connections
    return updated


def _sanitize_connections_for_response(settings_payload: dict) -> dict:
    connections = settings_payload.get("connections")
    if not isinstance(connections, list):
        return settings_payload

    response_connections: list[dict] = []
    for raw_connection in connections:
        if not isinstance(raw_connection, dict):
            continue

        connection = dict(raw_connection)
        connection["permissions"] = _normalize_connection_permissions(connection.get("permissions"))

        api_key_enc = str(connection.get("apiKeyEnc") or "").strip()
        api_secret_enc = str(connection.get("apiSecretEnc") or "").strip()

        decrypted_key = _decrypt_setting_secret(api_key_enc) if api_key_enc else ""
        decrypted_secret = _decrypt_setting_secret(api_secret_enc) if api_secret_enc else ""

        if decrypted_key:
            connection["apiKey"] = _mask_secret(decrypted_key)
        elif isinstance(connection.get("apiKey"), str):
            connection["apiKey"] = _mask_secret(str(connection.get("apiKey") or ""))
        else:
            connection["apiKey"] = ""

        if decrypted_secret:
            connection["apiSecret"] = _mask_secret(decrypted_secret)
        elif isinstance(connection.get("apiSecret"), str):
            connection["apiSecret"] = _mask_secret(str(connection.get("apiSecret") or ""))
        else:
            connection["apiSecret"] = ""

        response_connections.append(connection)

    updated = dict(settings_payload)
    updated["connections"] = response_connections
    return updated


class SignInPayload(BaseModel):
    email: EmailStr
    password: str
    otp_code: str | None = None
    backup_code: str | None = None
    client_public_ip: str | None = None
    client_location: str | None = None
    client_device: str | None = None


class GoogleAuthPayload(BaseModel):
    credential: str
    otp_code: str | None = None
    backup_code: str | None = None
    client_public_ip: str | None = None
    client_location: str | None = None
    client_device: str | None = None


class ForgotPasswordPayload(BaseModel):
    email: EmailStr


class ResetPasswordPayload(BaseModel):
    token: str
    password: str


class ChangePasswordPayload(BaseModel):
    email: EmailStr
    current_password: str
    new_password: str


class TwoFactorPayload(BaseModel):
    email: EmailStr


class TwoFactorEnablePayload(BaseModel):
    email: EmailStr
    code: str


class TwoFactorRegenerateBackupCodesPayload(BaseModel):
    email: EmailStr
    otp_code: str | None = None
    backup_code: str | None = None


class TerminateSessionPayload(BaseModel):
    email: EmailStr
    session_token: str
    session_id: str


class TerminateOtherSessionsPayload(BaseModel):
    email: EmailStr
    session_token: str


class UsersResponse(BaseModel):
    users: list[dict]
    source: str


class ReferralSettingsPayload(BaseModel):
    email: EmailStr
    email_notifications: bool
    show_in_leaderboard: bool
    auto_share_achievements: bool


class ReferralInvitationsPayload(BaseModel):
    email: EmailStr
    emails: list[EmailStr]
    message: str


class UserSettingsPayload(BaseModel):
    email: EmailStr
    settings: dict


class AvatarDeletePayload(BaseModel):
    email: EmailStr


class SubscriptionCompletePayload(BaseModel):
    email: EmailStr
    session_token: str
    account_type: str = "demo"
    exchange: str
    model: str
    trade_type: str | None = None
    dca_mode: str | None = None
    stake_amount: float | None = None
    max_open_order: int | None = None
    capital_usdt: float
    billing_cycle_days: int
    setup_charge_usd: float
    monthly_server_fee_usd: float = 10.0
    payment_status: str = "paid"


class ContinueBotSetupPayload(BaseModel):
    email: EmailStr
    session_token: str


class ValidateBinanceSetupPayload(BaseModel):
    email: EmailStr
    session_token: str
    api_key: str | None = None
    api_secret: str | None = None


class DeployBotSetupPayload(BaseModel):
    email: EmailStr
    session_token: str
    strategy_name: str = "ProfitPath"
    strategy_code: str | None = None
    config_override: dict[str, Any] | None = None
    dry_run: bool | None = None
    api_key: str | None = None
    api_secret: str | None = None


class EmailSessionPayload(BaseModel):
    email: EmailStr
    session_token: str


def _setup_metadata(bot_row: dict[str, Any] | None) -> dict[str, Any]:
    if not bot_row:
        return {}
    metadata = bot_row.get("metadata_json")
    return metadata if isinstance(metadata, dict) else {}


def _record_setup_step(
    user_id: int,
    bot_id: str,
    bot_row: dict[str, Any],
    *,
    step: str,
    status: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = _setup_metadata(bot_row)
    history = metadata.get("setup_history") if isinstance(metadata.get("setup_history"), list) else []
    event = {
        "step": step,
        "status": status,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    create_bot_setup_event(
        bot_id=bot_id,
        owner_user_id=user_id,
        step=step,
        status=status,
        message=message,
        extra_json=extra or {},
    )
    history = [*history, event]

    patch: dict[str, Any] = {
        "setup_history": history,
        "setup_last_step": step,
        "setup_status": status,
    }
    if status.endswith("failed"):
        patch["setup_last_error"] = message
    elif "setup_last_error" in metadata:
        patch["setup_last_error"] = ""

    if extra:
        patch.update(extra)

    updated = update_bot_setup_state(user_id, bot_id, patch)
    return updated or bot_row


def _build_setup_state_payload(bot_row: dict[str, Any], history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    metadata = _setup_metadata(bot_row)
    normalized_history = history
    if normalized_history is None:
        normalized_history = metadata.get("setup_history") if isinstance(metadata.get("setup_history"), list) else []
    deploy_enabled, deploy_unavailable_reason = _deploy_prerequisites_status()

    return {
        "status": metadata.get("setup_status", "pending"),
        "last_step": metadata.get("setup_last_step", "pending"),
        "server_id": metadata.get("setup_server_id"),
        "server_ip": metadata.get("setup_server_ip"),
        "backend_server_ip": metadata.get("setup_backend_server_ip") or metadata.get("setup_request_ip"),
        "deploy_enabled": deploy_enabled,
        "deploy_unavailable_reason": deploy_unavailable_reason,
        "exchange": metadata.get("setup_exchange") or bot_row.get("exchange"),
        "last_error": metadata.get("setup_last_error", ""),
        "completed_at": metadata.get("setup_completed_at"),
        "history": normalized_history,
    }


def get_user_or_404(email: str) -> dict:
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _get_user_security_settings(user_id: int) -> tuple[dict, dict]:
    settings_payload = get_user_settings(user_id) or {}
    security_settings = settings_payload.get("security") if isinstance(settings_payload.get("security"), dict) else {}
    return settings_payload, security_settings


def _normalize_backup_code(value: str) -> str:
    return "".join(char for char in value.upper() if char.isalnum())


def _hash_backup_code(value: str) -> str:
    normalized = _normalize_backup_code(value)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _generate_backup_codes(count: int = 8) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()

    while len(codes) < count:
        candidate = _normalize_backup_code(token_urlsafe(8))
        if len(candidate) < 8:
            continue

        compact = candidate[:8]
        if compact in seen:
            continue

        seen.add(compact)
        codes.append(f"{compact[:4]}-{compact[4:]}")

    return codes


def _parse_user_agent(user_agent: str) -> tuple[str, str, str]:
    normalized = user_agent or ""
    lower = normalized.lower()

    browser = "Unknown"
    if "edg" in lower:
        browser = "Edge"
    elif "chrome" in lower and "safari" in lower:
        browser = "Chrome"
    elif "safari" in lower and "chrome" not in lower:
        browser = "Safari"
    elif "firefox" in lower:
        browser = "Firefox"

    os = "Unknown"
    if "windows" in lower:
        os = "Windows"
    elif "mac os" in lower or "macintosh" in lower:
        os = "macOS"
    elif "android" in lower:
        os = "Android"
    elif "iphone" in lower or "ipad" in lower or "ios" in lower:
        os = "iOS"
    elif "linux" in lower:
        os = "Linux"

    if any(token in lower for token in ["iphone", "android", "mobile"]):
        device = "Mobile Device"
    elif "ipad" in lower or "tablet" in lower:
        device = "Tablet"
    else:
        device = "Desktop"

    return device, browser, os


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    return request.client.host if request.client else "unknown"


def _validate_session_token_for_user(user_id: int, session_token: str) -> dict:
    token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
    session_row = get_auth_session_by_token_hash(token_hash)
    if not session_row or session_row.get("user_id") != user_id or session_row.get("revoked_at") is not None:
        raise HTTPException(status_code=401, detail="Invalid session")

    touch_auth_session(str(session_row["id"]))
    return session_row


def _normalize_exchange_key(exchange_value: str) -> str:
    normalized = str(exchange_value or "").strip().lower().replace(" ", "_")
    if normalized in {"binance", "binance_futures"}:
        return "binance_futures"
    if normalized in {"bybit", "bybit_futures"}:
        return "bybit_futures"
    return normalized


def _normalize_account_type(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"demo", "demo_account", "demo account"}:
        return "demo"
    return "real"


def _normalize_trade_type(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if "fixed" in normalized:
        return "fixed"
    return "compound"


def _is_dca_enabled(value: str) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in {"enable", "enabled", "with_dca", "with dca", "true", "1", "yes"}


def _get_user_exchange_api_credentials(user_id: int, exchange_key: str) -> tuple[str, str]:
    payload = get_user_settings(user_id) or {}
    connections = payload.get("connections") if isinstance(payload.get("connections"), list) else []

    for raw in connections:
        if not isinstance(raw, dict):
            continue

        connection_exchange = _normalize_exchange_key(str(raw.get("exchange") or ""))
        if connection_exchange != exchange_key:
            continue

        api_key_enc = str(raw.get("apiKeyEnc") or "").strip()
        api_secret_enc = str(raw.get("apiSecretEnc") or "").strip()

        api_key = _decrypt_setting_secret(api_key_enc) if api_key_enc else ""
        api_secret = _decrypt_setting_secret(api_secret_enc) if api_secret_enc else ""

        if api_key and api_secret:
            return api_key, api_secret

    return "", ""


def _hetzner_create_server(bot_id: str) -> dict[str, Any]:
    token = str(settings.hetzner_api_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Hetzner API token not configured")

    payload: dict[str, Any] = {
        "name": f"pp-{bot_id[-8:]}",
        "server_type": settings.hetzner_server_type,
        "image": settings.hetzner_image,
        "datacenter": settings.hetzner_datacenter,
    }

    ssh_keys = [k.strip() for k in str(settings.hetzner_ssh_keys or "").split(",") if k.strip()]
    if ssh_keys:
        payload["ssh_keys"] = ssh_keys

    # Inject the deploy SSH public key and optional fixed root password from day one.
    pub_key = _derive_deploy_public_key()
    user_data = _build_hetzner_cloud_init(pub_key)
    if user_data:
        payload["user_data"] = user_data

    req = URLRequest(
        "https://api.hetzner.cloud/v1/servers",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body) if body else {}
    except HTTPError as exc:
        detail = f"Hetzner API error: {exc.code} {exc.reason}"
        try:
            raw = exc.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            if isinstance(payload, dict):
                message = payload.get("error", {}).get("message") if isinstance(payload.get("error"), dict) else None
                if message:
                    detail = f"Hetzner API error: {message}"
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=detail) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to reach Hetzner API: {exc}") from exc

    server = data.get("server") if isinstance(data, dict) else {}
    public_net = server.get("public_net") if isinstance(server, dict) else {}
    ipv4 = public_net.get("ipv4") if isinstance(public_net, dict) else {}
    ip_address = ipv4.get("ip") if isinstance(ipv4, dict) else ""

    return {
        "server_id": server.get("id") if isinstance(server, dict) else None,
        "ip": ip_address or "",
    }


def _hetzner_delete_server(server_id: int) -> None:
    token = str(settings.hetzner_api_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Hetzner API token not configured")

    req = URLRequest(
        f"https://api.hetzner.cloud/v1/servers/{server_id}",
        method="DELETE",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(req, timeout=30) as response:
            _ = response.read()
        return
    except HTTPError as exc:
        # Treat not-found as already deleted.
        if exc.code == 404:
            return

        detail = f"Hetzner delete server failed: {exc.code} {exc.reason}"
        try:
            raw = exc.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            if isinstance(payload, dict):
                message = payload.get("error", {}).get("message") if isinstance(payload.get("error"), dict) else None
                if message:
                    detail = f"Hetzner delete server failed: {message}"
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=detail) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to reach Hetzner API: {exc}") from exc


def _validate_binance_futures(api_key: str, api_secret: str) -> tuple[bool, str]:
    ts = int(time.time() * 1000)
    query = urlencode({"timestamp": ts, "recvWindow": 5000})
    signature = hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
    url = f"https://fapi.binance.com/fapi/v2/account?{query}&signature={signature}"

    req = URLRequest(url, method="GET", headers={"X-MBX-APIKEY": api_key})
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            _ = json.loads(raw) if raw else {}
        return True, "Binance futures API validated"
    except HTTPError as exc:
        detail = f"Binance API validation failed ({exc.code})"
        try:
            raw = exc.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            msg = payload.get("msg") if isinstance(payload, dict) else None
            if msg:
                detail = f"Binance API validation failed: {msg}"
        except Exception:
            pass
        return False, detail
    except URLError as exc:
        return False, f"Unable to reach Binance API: {exc}"


def _validate_bybit_futures(api_key: str, api_secret: str) -> tuple[bool, str]:
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    signature_payload = f"{timestamp}{api_key}{recv_window}"
    signature = hmac.new(api_secret.encode("utf-8"), signature_payload.encode("utf-8"), hashlib.sha256).hexdigest()

    req = URLRequest(
        "https://api.bybit.com/v5/user/query-api",
        method="GET",
        headers={
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "X-BAPI-SIGN": signature,
        },
    )
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
        ret_code = payload.get("retCode") if isinstance(payload, dict) else None
        if ret_code == 0:
            return True, "Bybit futures API validated"
        ret_msg = payload.get("retMsg") if isinstance(payload, dict) else "Unknown error"
        return False, f"Bybit API validation failed: {ret_msg}"
    except HTTPError as exc:
        detail = f"Bybit API validation failed ({exc.code})"
        try:
            raw = exc.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            msg = payload.get("retMsg") if isinstance(payload, dict) else None
            if msg:
                detail = f"Bybit API validation failed: {msg}"
        except Exception:
            pass
        return False, detail
    except URLError as exc:
        return False, f"Unable to reach Bybit API: {exc}"


def _validate_exchange_api(exchange_key: str, api_key: str, api_secret: str) -> tuple[bool, str]:
    if exchange_key == "binance_futures":
        return _validate_binance_futures(api_key, api_secret)
    if exchange_key == "bybit_futures":
        return _validate_bybit_futures(api_key, api_secret)
    return False, "Unsupported exchange for API validation"


def _extract_request_ip_from_validation_message(message: str) -> str:
    raw = str(message or "")
    match = re.search(r"request\s+ip\s*:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})", raw, flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _guess_backend_server_ip() -> str:
    host = str(urlparse(settings.public_base_url).hostname or "").strip()
    if re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,3}){3}", host):
        return host
    return ""


def _deploy_prerequisites_status() -> tuple[bool, str]:
    key_path = str(settings.deploy_ssh_private_key_path or "").strip()
    if not key_path:
        return False, "Deploy SSH private key path is not configured"
    if not os.path.isfile(key_path):
        return False, f"Deploy SSH private key file not found: {key_path}"
    return True, ""


def _ensure_bot_connection_entry(user_id: int, bot_id: str, bot_name: str, exchange_key: str) -> bool:
    settings_payload = get_user_settings(user_id) or {}
    raw_connections = settings_payload.get("connections") if isinstance(settings_payload.get("connections"), list) else []

    bot_connection_id = f"bot_{bot_id}_{exchange_key}"
    bot_connection_name = str(bot_name or bot_id)

    existing_bot_index: int | None = None
    source_connection: dict[str, Any] | None = None

    for index, raw_connection in enumerate(raw_connections):
        if not isinstance(raw_connection, dict):
            continue

        connection_id = str(raw_connection.get("id") or "").strip()
        if connection_id == bot_connection_id:
            existing_bot_index = index
            source_connection = dict(raw_connection)
            break

        normalized_exchange = _normalize_exchange_key(str(raw_connection.get("exchange") or ""))
        if normalized_exchange == exchange_key and source_connection is None:
            source_connection = dict(raw_connection)

    if source_connection is None:
        return False

    base_connection: dict[str, Any] = {
        **source_connection,
        "id": bot_connection_id,
        "name": bot_connection_name,
        "type": "exchange",
        "exchange": exchange_key,
        "status": str(source_connection.get("status") or "connected"),
        "lastSync": str(source_connection.get("lastSync") or datetime.now(timezone.utc).isoformat()),
        "permissions": source_connection.get("permissions") if isinstance(source_connection.get("permissions"), list) else ["read", "trade"],
    }

    updated_connections: list[dict[str, Any]] = [dict(item) for item in raw_connections if isinstance(item, dict)]
    if existing_bot_index is not None and existing_bot_index < len(updated_connections):
        updated_connections[existing_bot_index] = base_connection
    else:
        updated_connections.append(base_connection)

    settings_payload["connections"] = updated_connections
    sanitized_settings = _sanitize_connections_for_storage(settings_payload)
    upsert_user_settings(user_id, sanitized_settings)
    return True


def _upsert_bot_connection_credentials(
    *,
    user_id: int,
    bot_id: str,
    bot_name: str,
    exchange_key: str,
    api_key: str,
    api_secret: str,
) -> None:
    settings_payload = get_user_settings(user_id) or {}
    raw_connections = settings_payload.get("connections") if isinstance(settings_payload.get("connections"), list) else []

    target_id = f"bot_{bot_id}_{exchange_key}"
    target_name = str(bot_name or bot_id)
    updated_connections: list[dict[str, Any]] = []
    updated = False

    for raw in raw_connections:
        if not isinstance(raw, dict):
            continue

        connection = dict(raw)
        if str(connection.get("id") or "").strip() == target_id:
            connection["id"] = target_id
            connection["name"] = target_name
            connection["type"] = "exchange"
            connection["exchange"] = exchange_key
            connection["status"] = "connected"
            connection["lastSync"] = datetime.now(timezone.utc).isoformat()
            connection["permissions"] = ["read", "trade"]
            connection["apiKey"] = api_key
            connection["apiSecret"] = api_secret
            updated = True

        updated_connections.append(connection)

    if not updated:
        updated_connections.append(
            {
                "id": target_id,
                "name": target_name,
                "type": "exchange",
                "exchange": exchange_key,
                "status": "connected",
                "lastSync": datetime.now(timezone.utc).isoformat(),
                "permissions": ["read", "trade"],
                "apiKey": api_key,
                "apiSecret": api_secret,
            }
        )

    settings_payload["connections"] = updated_connections
    sanitized_settings = _sanitize_connections_for_storage(settings_payload)
    upsert_user_settings(user_id, sanitized_settings)


def _sync_user_completed_bot_connections(user_id: int) -> None:
    bot_rows = list_bot_accounts()
    for bot_row in bot_rows:
        if int(bot_row.get("owner_user_id") or 0) != int(user_id):
            continue
        if not bool(bot_row.get("purchased")):
            continue

        metadata = bot_row.get("metadata_json") if isinstance(bot_row.get("metadata_json"), dict) else {}
        if str(metadata.get("setup_status") or "").lower() != "completed":
            continue

        bot_id = str(bot_row.get("bot_id") or "").strip()
        if not bot_id:
            continue

        exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
        if exchange_key not in {"binance_futures", "bybit_futures"}:
            continue

        _ensure_bot_connection_entry(
            user_id=user_id,
            bot_id=bot_id,
            bot_name=bot_id,
            exchange_key=exchange_key,
        )


def _run_command(args: list[str], *, timeout: int = 120, input_bytes: bytes | None = None) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        args,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def _derive_deploy_public_key() -> str:
    """Derive the SSH public key from the configured private key using ssh-keygen -y."""
    key_path = str(settings.deploy_ssh_private_key_path or "").strip()
    if not key_path or not os.path.isfile(key_path):
        return ""
    result = _run_command(["ssh-keygen", "-y", "-f", key_path], timeout=10)
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="ignore").strip()


def _build_hetzner_cloud_init(pub_key: str) -> str:
    root_password = str(settings.hetzner_root_password or "")
    if not pub_key and not root_password:
        return ""

    lines = [
        "#cloud-config",
        "disable_root: false",
        "users:",
        "  - name: root",
        "    lock_passwd: false",
        "    shell: /bin/bash",
    ]

    if pub_key:
        lines.extend([
            "    ssh_authorized_keys:",
            f"      - {pub_key}",
        ])

    if root_password:
        lines.extend([
            "ssh_pwauth: true",
            "chpasswd:",
            "  expire: false",
            "  list: |",
            f"    root:{root_password}",
        ])

    return "\n".join(lines) + "\n"


def _hetzner_reset_server_password(server_id: int) -> str:
    """Reset the Hetzner server root password and return the new password."""
    token = str(settings.hetzner_api_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Hetzner API token not configured")

    req = URLRequest(
        f"https://api.hetzner.cloud/v1/servers/{server_id}/actions/reset_password",
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body) if body else {}
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Hetzner reset_password failed: {exc.code} {exc.reason}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to reach Hetzner API: {exc}") from exc

    root_password = data.get("root_password") if isinstance(data, dict) else None
    action = data.get("action") if isinstance(data, dict) else {}
    action_id = action.get("id") if isinstance(action, dict) else None

    # Poll for action completion (up to 60s)
    if action_id and token:
        for _ in range(30):
            time.sleep(2)
            try:
                poll_req = URLRequest(
                    f"https://api.hetzner.cloud/v1/actions/{action_id}",
                    method="GET",
                    headers={"Authorization": f"Bearer {token}"},
                )
                with urlopen(poll_req, timeout=10) as poll_resp:
                    poll_data = json.loads(poll_resp.read().decode("utf-8") or "{}")
                status = (poll_data.get("action") or {}).get("status") if isinstance(poll_data, dict) else None
                if status in ("success", "error"):
                    break
            except Exception:
                break

    if not root_password:
        raise HTTPException(status_code=502, detail="Hetzner did not return a new root password")
    return str(root_password)


def _install_ssh_key_via_password(server_ip: str, root_password: str, pub_key: str) -> None:
    """Use sshpass to install an SSH public key on a remote server via password auth."""
    _clear_local_known_hosts()
    user = str(settings.deploy_ssh_user or "root").strip() or "root"
    port = int(settings.deploy_ssh_port or 22)
    install_cmd = (
        "mkdir -p ~/.ssh && "
        f"echo {shlex.quote(pub_key)} >> ~/.ssh/authorized_keys && "
        "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
    )
    cmd = [
        "sshpass",
        "-p",
        root_password,
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-p", str(port),
        f"{user}@{server_ip}",
        f"bash -lc {shlex.quote(install_cmd)}",
    ]
    result = _run_command(cmd, timeout=60)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        stdout = result.stdout.decode("utf-8", errors="ignore").strip()
        raise HTTPException(status_code=502, detail=f"Failed to install SSH key: {stderr or stdout or 'sshpass failed'}")


def _clear_local_known_hosts() -> None:
    ssh_dir = os.path.expanduser("~/.ssh")
    for filename in ("known_hosts", "known_hosts.old"):
        path = os.path.join(ssh_dir, filename)
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass


def _ssh_base_command(server_ip: str) -> list[str]:
    _clear_local_known_hosts()
    key_path = str(settings.deploy_ssh_private_key_path or "").strip()
    if not key_path:
        raise HTTPException(status_code=400, detail="Deploy SSH private key path is not configured")
    if not os.path.isfile(key_path):
        raise HTTPException(status_code=400, detail=f"Deploy SSH private key file not found: {key_path}")

    user = str(settings.deploy_ssh_user or "root").strip() or "root"
    port = int(settings.deploy_ssh_port or 22)
    return [
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-p",
        str(port),
        "-i",
        key_path,
        f"{user}@{server_ip}",
    ]


def _wait_for_key_based_ssh(server_ip: str, *, timeout: int = 180) -> None:
    deadline = time.time() + max(timeout, 10)
    last_message = "SSH key authentication is not ready yet"

    while time.time() < deadline:
        cmd = [*_ssh_base_command(server_ip), "true"]
        result = _run_command(cmd, timeout=20)
        if result.returncode == 0:
            return

        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        stdout = result.stdout.decode("utf-8", errors="ignore").strip()
        if stderr or stdout:
            last_message = stderr or stdout
        time.sleep(5)

    raise HTTPException(
        status_code=502,
        detail=f"SSH key authentication is not ready on {server_ip}: {last_message}",
    )


def _run_remote_command(server_ip: str, command: str, *, timeout: int = 240) -> None:
    cmd = [*_ssh_base_command(server_ip), f"bash -lc {shlex.quote(command)}"]
    result = _run_command(cmd, timeout=timeout)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        stdout = result.stdout.decode("utf-8", errors="ignore").strip()
        message = stderr or stdout or "Unknown remote execution error"
        raise HTTPException(status_code=502, detail=f"Remote command failed: {message}")


def _copy_directory_to_server(server_ip: str, local_dir: str, remote_dir: str) -> None:
    _clear_local_known_hosts()
    key_path = str(settings.deploy_ssh_private_key_path or "").strip()
    user = str(settings.deploy_ssh_user or "root").strip() or "root"
    port = int(settings.deploy_ssh_port or 22)

    mkdir_cmd = f"mkdir -p {shlex.quote(remote_dir)}"
    _run_remote_command(server_ip, mkdir_cmd, timeout=120)

    scp_cmd = [
        "scp",
        "-r",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-P",
        str(port),
        "-i",
        key_path,
        f"{local_dir}/.",
        f"{user}@{server_ip}:{remote_dir}",
    ]
    result = _run_command(scp_cmd, timeout=240)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        raise HTTPException(status_code=502, detail=f"Failed to upload deployment bundle: {stderr or 'scp failed'}")


def _connection_credentials_for_bot(user_id: int, bot_id: str, exchange_key: str) -> tuple[str, str]:
    settings_payload = get_user_settings(user_id) or {}
    connections = settings_payload.get("connections") if isinstance(settings_payload.get("connections"), list) else []

    target_connection_id = f"bot_{bot_id}_{exchange_key}"
    fallback: tuple[str, str] = ("", "")

    for raw in connections:
        if not isinstance(raw, dict):
            continue

        connection_exchange = _normalize_exchange_key(str(raw.get("exchange") or ""))
        if connection_exchange != exchange_key:
            continue

        connection_id = str(raw.get("id") or "").strip()
        api_key_enc = str(raw.get("apiKeyEnc") or "").strip()
        api_secret_enc = str(raw.get("apiSecretEnc") or "").strip()
        api_key = _decrypt_setting_secret(api_key_enc) if api_key_enc else str(raw.get("apiKey") or "").strip()
        api_secret = _decrypt_setting_secret(api_secret_enc) if api_secret_enc else str(raw.get("apiSecret") or "").strip()

        if "*" in api_key or "*" in api_secret:
            api_key = ""
            api_secret = ""

        creds = (api_key, api_secret)
        if connection_id == target_connection_id and api_key and api_secret:
            return creds
        if not fallback[0] and api_key and api_secret:
            fallback = creds

    return fallback


def _default_strategy_code(strategy_name: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9_]", "", str(strategy_name or "").strip())
    template_path = os.path.join(os.path.dirname(__file__), "strategy_templates", f"{safe_name}.py")
    if safe_name and os.path.isfile(template_path):
        try:
            with open(template_path, "r", encoding="utf-8") as strategy_file:
                return strategy_file.read()
        except OSError:
            pass

    return f'''from freqtrade.strategy import IStrategy\nfrom pandas import DataFrame\n\n\nclass {strategy_name}(IStrategy):\n    timeframe = "5m"\n    minimal_roi = {{"0": 0.02}}\n    stoploss = -0.1\n    startup_candle_count = 30\n\n    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:\n        return dataframe\n\n    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:\n        dataframe.loc[:, "enter_long"] = 0\n        return dataframe\n\n    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:\n        dataframe.loc[:, "exit_long"] = 0\n        return dataframe\n'''


def _apply_strategy_dca_mode(strategy_code: str, dca_enabled: bool) -> str:
    value = "True" if dca_enabled else "False"
    normalized = strategy_code if strategy_code.endswith("\n") else f"{strategy_code}\n"

    # Update existing declaration when present.
    if re.search(r"(?m)^\s*position_adjustment_enable\s*=", normalized):
        return re.sub(
            r"(?m)^\s*position_adjustment_enable\s*=.*$",
            f"    position_adjustment_enable = {value}",
            normalized,
            count=1,
        )

    # Otherwise inject directly under strategy class definition.
    class_match = re.search(r"(?m)^class\s+[A-Za-z_][A-Za-z0-9_]*\(IStrategy\):\s*$", normalized)
    if class_match:
        insert_at = class_match.end()
        return f"{normalized[:insert_at]}\n    position_adjustment_enable = {value}{normalized[insert_at:]}"

    return f"position_adjustment_enable = {value}\n{normalized}"


def _build_freqtrade_config(
    *,
    bot_id: str,
    exchange_key: str,
    api_key: str,
    api_secret: str,
    strategy_name: str,
    dry_run: bool,
    dry_run_wallet: float,
    stake_amount: str,
    max_open_trades: int,
    override: dict[str, Any] | None,
) -> dict[str, Any]:
    exchange_name = "binance" if exchange_key == "binance_futures" else "bybit"
    api_users = [s.strip() for s in str(settings.freqtrade_usernames or "").split(",") if s.strip()]
    api_passwords = [s.strip() for s in str(settings.freqtrade_passwords or "").split(",") if s.strip()]
    api_username = api_users[0] if api_users else "admin"
    api_password = api_passwords[0] if api_passwords else token_urlsafe(24)

    # Base config — exact production template; only exchange keys and api_server
    # credentials are injected at deploy time.
    base: dict[str, Any] = {
        "db_url": "sqlite:///user_data/databases/tradesv3.db",
        "max_open_trades": max_open_trades,
        "stake_currency": "USDT",
        "stake_amount": stake_amount,
        "tradable_balance_ratio": 1,
        "dry_run_wallet": dry_run_wallet,
        "fiat_display_currency": "USD",
        "timeframe": "5m",
        "trading_mode": "futures",
        "margin_mode": "isolated",
        "stoploss_on_exchange": True,
        "dry_run": dry_run,
        "cancel_open_orders_on_exit": False,
        "unfilledtimeout": {"unit": "minutes", "enter": 10, "exit": 30},
        "order_types": {
            "entry": "market",
            "exit": "market",
            "emergency_exit": "market",
            "force_entry": "market",
            "force_exit": "market",
            "stoploss": "market",
            "stoploss_on_exchange": True,
            "stoploss_on_exchange_interval": 60,
        },
        "entry_pricing": {
            "price_side": "other",
            "ask_last_balance": 0,
            "use_order_book": True,
            "order_book_top": 1,
            "check_depth_of_market": {"enabled": False, "bids_to_ask_delta": 1},
        },
        "exit_pricing": {
            "price_side": "other",
            "use_order_book": True,
            "order_book_top": 1,
        },
        "exchange": {
            "name": exchange_name,
            "key": api_key,
            "secret": api_secret,
            "ccxt_config": {"enableRateLimit": True},
            "ccxt_async_config": {"enableRateLimit": True, "rateLimit": 100},
            "pair_whitelist": [
                "PIPPIN/USDT:USDT", "VIRTUAL/USDT:USDT", "PENGU/USDT:USDT",
                "1000BONK/USDT:USDT", "PROMPT/USDT:USDT", "BANANAS31/USDT:USDT",
                "TAO/USDT:USDT", "BOME/USDT:USDT", "1000FLOKI/USDT:USDT",
                "API3/USDT:USDT", "1000PEPE/USDT:USDT", "ENA/USDT:USDT",
                "FET/USDT:USDT", "CGPT/USDT:USDT", "PYTH/USDT:USDT",
                "ZEC/USDT:USDT", "WLD/USDT:USDT", "JTO/USDT:USDT",
                "COTI/USDT:USDT", "STX/USDT:USDT", "AXS/USDT:USDT",
                "APT/USDT:USDT", "SUI/USDT:USDT", "ICP/USDT:USDT",
                "POL/USDT:USDT", "KAS/USDT:USDT", "SAND/USDT:USDT",
                "HBAR/USDT:USDT", "PENDLE/USDT:USDT", "XRP/USDT:USDT",
                "FIL/USDT:USDT", "AXL/USDT:USDT", "GALA/USDT:USDT",
                "DOGE/USDT:USDT", "ONDO/USDT:USDT", "GRT/USDT:USDT",
                "XLM/USDT:USDT", "UNI/USDT:USDT", "AVAX/USDT:USDT",
                "ADA/USDT:USDT", "LINK/USDT:USDT", "ALGO/USDT:USDT",
                "SEI/USDT:USDT", "SOL/USDT:USDT", "1000SHIB/USDT:USDT",
                "CHZ/USDT:USDT", "AAVE/USDT:USDT", "1INCH/USDT:USDT",
                "DOT/USDT:USDT", "NEAR/USDT:USDT", "LTC/USDT:USDT",
                "TON/USDT:USDT", "ETH/USDT:USDT", "CRV/USDT:USDT",
                "C98/USDT:USDT", "ZIL/USDT:USDT", "PUMP/USDT:USDT",
                "QNT/USDT:USDT", "BCH/USDT:USDT", "ETC/USDT:USDT",
                "ATOM/USDT:USDT", "XMR/USDT:USDT", "COMP/USDT:USDT",
                "WLFI/USDT:USDT", "HYPE/USDT:USDT", "BNB/USDT:USDT",
                "ASTER/USDT:USDT", "JST/USDT:USDT", "CC/USDT:USDT",
                "BTC/USDT:USDT", "SKY/USDT:USDT", "TRX/USDT:USDT",
                "NIGHT/USDT:USDT", "XAU/USDT:USDT", "XAG/USDT:USDT",
                "VVV/USDT:USDT", "POWER/USDT:USDT", "ARC/USDT:USDT",
                "SIREN/USDT:USDT", "GRASS/USDT:USDT", "JUP/USDT:USDT",
                "AIXBT/USDT:USDT",
            ],
            "pair_blacklist": [
                "TFUEL/BTC", "ONE/BTC", "ATOM/BTC", "XMR/BTC",
                "BNB/BUSD", "BNB/BTC", "BNB/ETH", "BNB/EUR",
                "BNB/NGN", "BNB/PAX", "BNB/RUB", "BNB/TRY",
                "BNB/TUSD", "BNB/USDC", "BNB/USDS",
                "EUR/USDT:USDT",
                ".*UP/USDT:USDT", ".*DOWN/USDT:USDT",
                ".*BEAR/USDT:USDT", ".*BULL/USDT:USDT",
                "BRD/BTC",
            ],
        },
        "pairlists": [
            {"method": "StaticPairList"},
            {"method": "PriceFilter", "min_price": 0.05, "low_price_ratio": 0.01},
        ],
        "telegram": {
            "enabled": False,
            "token": "",
            "chat_id": "",
            "authorized_users": [],
            "allow_custom_messages": True,
            "notification_settings": {
                "status": "silent", "warning": "on", "startup": "off",
                "entry": "silent", "entry_fill": "on", "entry_cancel": "silent",
                "exit": {
                    "roi": "silent", "emergency_exit": "on", "force_exit": "on",
                    "exit_signal": "silent", "trailing_stop_loss": "on",
                    "stop_loss": "on", "stoploss_on_exchange": "on",
                    "custom_exit": "silent", "partial_exit": "on",
                },
                "exit_cancel": "on", "exit_fill": "on",
                "protection_trigger": "off", "protection_trigger_global": "on",
                "strategy_msg": "on", "show_candle": "off",
            },
            "reload": True,
            "balance_dust_level": 0.01,
            "keyboard": [
                ["/start", "/stop", "/stopentry"],
                ["/daily", "/stats", "/balance", "/profit"],
                ["/status table", "/performance", "/help"],
            ],
        },
        "api_server": {
            "enabled": True,
            "listen_ip_address": "0.0.0.0",
            "listen_port": 8080,
            "verbosity": "error",
            "enable_openapi": False,
            "jwt_secret_key": "f27e8a9020b54f82df881556110fb855553a7318ac867dcfa6b39c48a417cd85",
            "ws_token": "4HvTpCwFiBhndyK0jFYYYPsl24P6UGd4bg",
            "CORS_origins": [],
            "username": api_username,
            "password": api_password,
        },
        "bot_name": f"pp-{bot_id[-8:]}",
        "initial_state": "running",
        "force_entry_enable": False,
        "internals": {"process_throttle_secs": 5},
    }

    if isinstance(override, dict):
        merged = {**base, **override}
        if isinstance(override.get("exchange"), dict):
            merged["exchange"] = {**base.get("exchange", {}), **override["exchange"]}
        if isinstance(override.get("api_server"), dict):
            merged["api_server"] = {**base.get("api_server", {}), **override["api_server"]}
        return merged

    return base


def _deploy_freqtrade_bundle(
    *,
    server_ip: str,
    bot_id: str,
    exchange_key: str,
    strategy_name: str,
    strategy_code: str | None,
    config_override: dict[str, Any] | None,
    api_key: str,
    api_secret: str,
    dry_run: bool,
    dry_run_wallet: float,
    stake_amount: str,
    max_open_trades: int,
    dca_enabled: bool,
    reset_user_data: bool = False,
) -> dict[str, Any]:
    deploy_dir = str(settings.freqtrade_deploy_dir or "/opt/profitpath-freqtrade").strip() or "/opt/profitpath-freqtrade"
    image = str(settings.freqtrade_deploy_image or "freqtradeorg/freqtrade:stable").strip() or "freqtradeorg/freqtrade:stable"
    api_port = int(settings.freqtrade_deploy_api_port or 18080)

    strategy = re.sub(r"[^A-Za-z0-9_]", "", strategy_name.strip() or "SampleStrategy")
    if not strategy:
        strategy = "SampleStrategy"

    config_payload = _build_freqtrade_config(
        bot_id=bot_id,
        exchange_key=exchange_key,
        api_key=api_key,
        api_secret=api_secret,
        strategy_name=strategy,
        dry_run=dry_run,
        dry_run_wallet=dry_run_wallet,
        stake_amount=stake_amount,
        max_open_trades=max_open_trades,
        override=config_override,
    )
    raw_strategy = strategy_code.strip() if isinstance(strategy_code, str) and strategy_code.strip() else _default_strategy_code(strategy)
    strategy_payload = _apply_strategy_dca_mode(raw_strategy, dca_enabled=dca_enabled)

    compose_yaml = f'''services:\n  freqtrade:\n    image: {image}\n    container_name: pp-freqtrade-{bot_id[-8:]}\n    restart: unless-stopped\n    ports:\n      - "{api_port}:8080"\n    volumes:\n      - ./user_data:/freqtrade/user_data\n    command: >\n      trade\n      --db-url sqlite:////freqtrade/user_data/tradesv3.sqlite\n      --config /freqtrade/user_data/config.json\n      --strategy {strategy}\n'''

    with tempfile.TemporaryDirectory(prefix="pp-ft-") as temp_dir:
        user_data_dir = os.path.join(temp_dir, "user_data")
        strategies_dir = os.path.join(user_data_dir, "strategies")
        logs_dir = os.path.join(user_data_dir, "logs")
        os.makedirs(strategies_dir, exist_ok=True)
        os.makedirs(logs_dir, exist_ok=True)

        with open(os.path.join(temp_dir, "docker-compose.yml"), "w", encoding="utf-8") as compose_file:
            compose_file.write(compose_yaml)
        with open(os.path.join(user_data_dir, "config.json"), "w", encoding="utf-8") as config_file:
            json.dump(config_payload, config_file, indent=2)
        with open(os.path.join(strategies_dir, f"{strategy}.py"), "w", encoding="utf-8") as strategy_file:
            strategy_file.write(strategy_payload)

        _run_remote_command(
            server_ip,
            "set -e; if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi; "
            "if ! docker compose version >/dev/null 2>&1; then apt-get update -y && apt-get install -y docker-compose-plugin; fi;",
            timeout=600,
        )

        if reset_user_data:
            _run_remote_command(
                server_ip,
                (
                    "set -e; "
                    f"mkdir -p {shlex.quote(deploy_dir)}; "
                    f"if [ -f {shlex.quote(deploy_dir + '/docker-compose.yml')} ]; then "
                    f"cd {shlex.quote(deploy_dir)} && docker compose down >/dev/null 2>&1 || true; "
                    "fi; "
                    f"rm -rf {shlex.quote(deploy_dir + '/user_data')}; "
                    f"mkdir -p {shlex.quote(deploy_dir + '/user_data')}"
                ),
                timeout=300,
            )

        _copy_directory_to_server(server_ip, temp_dir, deploy_dir)
        _run_remote_command(server_ip, f"cd {shlex.quote(deploy_dir)} && docker compose pull && docker compose up -d", timeout=600)
        _run_remote_command(
            server_ip,
            (
                "set -e; "
                f"for i in $(seq 1 45); do "
                f"if curl -fsS --max-time 5 http://127.0.0.1:{api_port}/api/v1/ping >/dev/null 2>&1; then exit 0; fi; "
                "sleep 2; "
                "done; "
                f"docker ps --filter name=pp-freqtrade-{bot_id[-8:]} --format '{{{{.Status}}}}'; "
                f"echo '--- freqtrade logs (tail) ---'; "
                f"docker logs --tail 80 pp-freqtrade-{bot_id[-8:]} 2>&1 || true; "
                "echo 'Freqtrade API ping did not become ready in time'; "
                "exit 1"
            ),
            timeout=180,
        )

    return {
        "strategy": strategy,
        "deploy_dir": deploy_dir,
        "api_port": api_port,
        "api_url": f"http://{server_ip}:{api_port}",
        "dry_run": dry_run,
    }


def _split_display_name(name: str) -> tuple[str, str]:
    normalized = (name or "").strip()
    if not normalized:
        return "Google", "User"

    parts = normalized.split()
    if len(parts) == 1:
        return parts[0], "User"

    return parts[0], " ".join(parts[1:])


def _verify_google_id_token(id_token: str) -> dict:
    client_id = settings.google_client_id.strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google authentication is not configured")

    token = (id_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Google credential is required")

    encoded_token = quote(token, safe="")
    token_info_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={encoded_token}"

    try:
        with urlopen(token_info_url, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google credential") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail="Failed to contact Google authentication service") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to verify Google credential") from exc

    aud = str(payload.get("aud") or "")
    if aud != client_id:
        raise HTTPException(status_code=401, detail="Google credential audience mismatch")

    issuer = str(payload.get("iss") or "")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Invalid Google credential issuer")

    if str(payload.get("email_verified") or "").lower() not in {"true", "1"}:
        raise HTTPException(status_code=401, detail="Google account email is not verified")

    expires_raw = str(payload.get("exp") or "0")
    try:
        expires_at = int(expires_raw)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google credential expiration") from exc

    if expires_at <= int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=401, detail="Google credential has expired")

    email = str(payload.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google credential does not include an email")

    return payload


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "postgres": "ok" if postgres_health() else "down",
        "redis": "ok" if redis_health() else "down",
    }


@app.get("/db/health")
def db_health() -> dict[str, bool]:
    return {
        "postgres": postgres_health(),
        "redis": redis_health(),
    }


@app.get("/users", response_model=UsersResponse)
def list_users() -> UsersResponse:
    cached_users = get_cached_users()
    if cached_users is not None:
        return UsersResponse(users=cached_users, source="redis-cache")

    users = get_users()
    set_cached_users(users)
    return UsersResponse(users=users, source="postgres")


@app.post("/users", status_code=201)
def create_user_endpoint(payload: UserCreatePayload) -> dict[str, dict]:
    try:
        user = create_user(
            first_name=payload.first_name,
            last_name=payload.last_name,
            username=payload.username,
            email=payload.email,
            password_hash=hash_password(payload.password),
            phone=payload.phone,
            country=payload.country,
        )

        referral_username = (payload.referral_username or "").strip().lower()
        created_username = str(user.get("username") or "").strip().lower()
        if referral_username and referral_username != created_username:
            referrer = get_user_by_username(referral_username)
            if referrer:
                invite_name = f"{user['first_name']} {user['last_name']}".strip() or "New Referral"
                try:
                    upsert_referral_signup(
                        user_id=referrer["id"],
                        invite_email=user["email"],
                        invite_name=invite_name,
                    )
                except Exception:
                    # Referral linkage should not block account creation.
                    pass

        try:
            invalidate_users_cache()
        except Exception:
            # Cache invalidation should not fail account creation after DB commit.
            pass
        return {"user": serialize_user(user)}
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="User with this email already exists") from exc


@app.post("/auth/signin")
def sign_in(payload: SignInPayload, request: Request) -> dict:
    user_agent = request.headers.get("x-client-user-agent") or request.headers.get("user-agent", "")
    device, browser, os = _parse_user_agent(user_agent)
    ip = (payload.client_public_ip or "").strip() or _get_client_ip(request)
    location = (payload.client_location or "").strip() or request.headers.get("x-user-location") or "Unknown"
    device_name = (payload.client_device or "").strip() or f"{device} ({browser}, {os})"

    user = get_user_by_email(payload.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    password_hash = user.get("password_hash")
    if not password_hash or not verify_password(payload.password, password_hash):
        log_login_history_event(
            event_id=str(uuid4()),
            user_id=user["id"],
            ip=ip,
            location=location,
            device=device_name,
            success=False,
            method="password",
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    settings_payload, security_settings = _get_user_security_settings(user["id"])
    two_factor_enabled = bool(security_settings.get("twoFactorEnabled"))
    two_factor_secret = security_settings.get("twoFactorSecret")

    if two_factor_enabled:
        otp_code = (payload.otp_code or "").strip()
        backup_code = (payload.backup_code or "").strip()
        if not otp_code and not backup_code:
            raise HTTPException(status_code=401, detail={"message": "Two-factor or backup code required", "requires_2fa": True})

        if not two_factor_secret:
            raise HTTPException(status_code=400, detail="Two-factor is enabled but not configured correctly")

        is_verified = False
        if otp_code:
            totp = pyotp.TOTP(str(two_factor_secret))
            is_verified = totp.verify(otp_code, valid_window=1)

        if not is_verified and backup_code:
            backup_hashes = security_settings.get("twoFactorBackupCodeHashes")
            if isinstance(backup_hashes, list):
                submitted_hash = _hash_backup_code(backup_code)
                if submitted_hash in backup_hashes:
                    is_verified = True
                    security_settings["twoFactorBackupCodeHashes"] = [code_hash for code_hash in backup_hashes if code_hash != submitted_hash]
                    settings_payload["security"] = security_settings
                    upsert_user_settings(user["id"], settings_payload)

        if not is_verified:
            log_login_history_event(
                event_id=str(uuid4()),
                user_id=user["id"],
                ip=ip,
                location=location,
                device=device_name,
                success=False,
                method="incorrect_auth_code",
            )
            raise HTTPException(status_code=401, detail={"message": "Invalid two-factor or backup code", "requires_2fa": True})

    response_user = serialize_user(user)
    raw_session_token = token_urlsafe(48)
    session_token_hash = hashlib.sha256(raw_session_token.encode("utf-8")).hexdigest()
    session_id = str(uuid4())

    create_auth_session(
        session_id=session_id,
        user_id=user["id"],
        token_hash=session_token_hash,
        ip=ip,
        location=location,
        device=device_name,
        browser=browser,
        os=os,
    )

    log_login_history_event(
        event_id=str(uuid4()),
        user_id=user["id"],
        ip=ip,
        location=location,
        device=device_name,
        success=True,
        method="signin",
    )

    return {"user": response_user, "session_token": raw_session_token}


@app.post("/auth/google")
def google_sign_in(payload: GoogleAuthPayload, request: Request) -> dict:
    user_agent = request.headers.get("x-client-user-agent") or request.headers.get("user-agent", "")
    device, browser, os = _parse_user_agent(user_agent)
    ip = (payload.client_public_ip or "").strip() or _get_client_ip(request)
    location = (payload.client_location or "").strip() or request.headers.get("x-user-location") or "Unknown"
    device_name = (payload.client_device or "").strip() or f"{device} ({browser}, {os})"

    token_payload = _verify_google_id_token(payload.credential)
    email = str(token_payload.get("email") or "").strip().lower()

    user = get_user_by_email(email)
    is_new_user = False

    if not user:
        given_name = str(token_payload.get("given_name") or "").strip()
        family_name = str(token_payload.get("family_name") or "").strip()
        if not given_name or not family_name:
            split_first, split_last = _split_display_name(str(token_payload.get("name") or ""))
            if not given_name:
                given_name = split_first
            if not family_name:
                family_name = split_last

        user = create_user(
            first_name=given_name,
            last_name=family_name,
            email=email,
            password_hash="",
            phone=None,
            country=None,
        )
        is_new_user = True
        try:
            invalidate_users_cache()
        except Exception:
            pass
    settings_payload, security_settings = _get_user_security_settings(user["id"])
    two_factor_enabled = bool(security_settings.get("twoFactorEnabled"))
    two_factor_secret = security_settings.get("twoFactorSecret")

    if two_factor_enabled:
        if not two_factor_secret:
            raise HTTPException(status_code=400, detail="Two-factor is enabled but not configured correctly")

        otp_code = (payload.otp_code or "").strip()
        backup_code = (payload.backup_code or "").strip()

        if not otp_code and not backup_code:
            raise HTTPException(status_code=401, detail={"message": "Two-factor or backup code required", "requires_2fa": True})

        totp = pyotp.TOTP(str(two_factor_secret))
        is_verified = totp.verify(otp_code, valid_window=1) if otp_code else False

        if not is_verified and backup_code:
            backup_hashes = security_settings.get("twoFactorBackupCodeHashes")
            if isinstance(backup_hashes, list):
                submitted_hash = _hash_backup_code(backup_code)
                if submitted_hash in backup_hashes:
                    is_verified = True
                    security_settings["twoFactorBackupCodeHashes"] = [
                        code_hash for code_hash in backup_hashes if code_hash != submitted_hash
                    ]
                    settings_payload["security"] = security_settings
                    upsert_user_settings(user["id"], settings_payload)

        if not is_verified:
            log_login_history_event(
                event_id=str(uuid4()),
                user_id=user["id"],
                ip=ip,
                location=location,
                device=device_name,
                success=False,
                method="incorrect_auth_code",
            )
            raise HTTPException(status_code=401, detail={"message": "Invalid two-factor or backup code", "requires_2fa": True})

    response_user = serialize_user(user)
    raw_session_token = token_urlsafe(48)
    session_token_hash = hashlib.sha256(raw_session_token.encode("utf-8")).hexdigest()
    session_id = str(uuid4())

    create_auth_session(
        session_id=session_id,
        user_id=user["id"],
        token_hash=session_token_hash,
        ip=ip,
        location=location,
        device=device_name,
        browser=browser,
        os=os,
    )

    log_login_history_event(
        event_id=str(uuid4()),
        user_id=user["id"],
        ip=ip,
        location=location,
        device=device_name,
        success=True,
        method="google_signup" if is_new_user else "google_signin",
    )

    return {"user": response_user, "session_token": raw_session_token, "is_new_user": is_new_user}


@app.post("/auth/2fa/setup")
def setup_two_factor(payload: TwoFactorPayload) -> dict[str, str]:
    user = get_user_or_404(str(payload.email))

    settings_payload, security_settings = _get_user_security_settings(user["id"])
    secret = pyotp.random_base32()
    security_settings["twoFactorPendingSecret"] = secret
    settings_payload["security"] = security_settings
    upsert_user_settings(user["id"], settings_payload)

    totp = pyotp.TOTP(secret)
    otpauth_url = totp.provisioning_uri(name=user["email"], issuer_name=settings.app_name)
    return {"secret": secret, "otpauth_url": otpauth_url}


@app.post("/auth/2fa/enable")
def enable_two_factor(payload: TwoFactorEnablePayload) -> dict:
    user = get_user_or_404(str(payload.email))

    settings_payload, security_settings = _get_user_security_settings(user["id"])
    pending_secret = security_settings.get("twoFactorPendingSecret")
    if not pending_secret:
        raise HTTPException(status_code=400, detail="2FA setup is required before enabling")

    totp = pyotp.TOTP(str(pending_secret))
    if not totp.verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    backup_codes = _generate_backup_codes()
    backup_hashes = [_hash_backup_code(code) for code in backup_codes]

    security_settings["twoFactorEnabled"] = True
    security_settings["twoFactorSecret"] = pending_secret
    security_settings["twoFactorBackupCodeHashes"] = backup_hashes
    security_settings.pop("twoFactorPendingSecret", None)
    settings_payload["security"] = security_settings
    upsert_user_settings(user["id"], settings_payload)
    return {"enabled": True, "backup_codes": backup_codes}


@app.post("/auth/2fa/disable")
def disable_two_factor(payload: TwoFactorPayload) -> dict[str, bool]:
    user = get_user_or_404(str(payload.email))

    settings_payload, security_settings = _get_user_security_settings(user["id"])
    security_settings["twoFactorEnabled"] = False
    security_settings.pop("twoFactorSecret", None)
    security_settings.pop("twoFactorPendingSecret", None)
    security_settings.pop("twoFactorBackupCodeHashes", None)
    settings_payload["security"] = security_settings
    upsert_user_settings(user["id"], settings_payload)
    return {"enabled": False}


@app.post("/auth/2fa/backup-codes/regenerate")
def regenerate_backup_codes(payload: TwoFactorRegenerateBackupCodesPayload) -> dict:
    user = get_user_or_404(str(payload.email))

    settings_payload, security_settings = _get_user_security_settings(user["id"])
    two_factor_enabled = bool(security_settings.get("twoFactorEnabled"))
    two_factor_secret = security_settings.get("twoFactorSecret")
    backup_hashes = security_settings.get("twoFactorBackupCodeHashes")

    if not two_factor_enabled or not two_factor_secret:
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")

    otp_code = (payload.otp_code or "").strip()
    backup_code = (payload.backup_code or "").strip()
    if not otp_code and not backup_code:
        raise HTTPException(status_code=400, detail="OTP code or backup code is required")

    is_verified = False
    if otp_code:
        totp = pyotp.TOTP(str(two_factor_secret))
        is_verified = totp.verify(otp_code, valid_window=1)

    if not is_verified and backup_code and isinstance(backup_hashes, list):
        submitted_hash = _hash_backup_code(backup_code)
        if submitted_hash in backup_hashes:
            is_verified = True

    if not is_verified:
        raise HTTPException(status_code=401, detail="Invalid verification code")

    regenerated_codes = _generate_backup_codes()
    security_settings["twoFactorBackupCodeHashes"] = [_hash_backup_code(code) for code in regenerated_codes]
    settings_payload["security"] = security_settings
    upsert_user_settings(user["id"], settings_payload)

    return {"backup_codes": regenerated_codes}


@app.get("/auth/me")
def auth_me(email: EmailStr, session_token: str | None = None) -> dict[str, dict]:
    user = get_user_or_404(str(email))

    if session_token:
        _validate_session_token_for_user(user["id"], session_token)

    return {"user": serialize_user(user)}


@app.get("/auth/sessions")
def auth_sessions(email: EmailStr, session_token: str) -> dict[str, list[dict]]:
    user = get_user_or_404(str(email))
    session_row = _validate_session_token_for_user(user["id"], session_token)
    sessions = list_auth_sessions(user["id"], current_session_id=str(session_row["id"]))
    return {"sessions": sessions}


@app.get("/auth/login-history")
def auth_login_history(email: EmailStr, session_token: str) -> dict[str, list[dict]]:
    user = get_user_or_404(str(email))
    _ = _validate_session_token_for_user(user["id"], session_token)
    return {"login_history": list_login_history(user["id"], limit=100)}


@app.post("/auth/sessions/terminate")
def terminate_session(payload: TerminateSessionPayload) -> dict[str, bool]:
    user = get_user_or_404(str(payload.email))
    current_session = _validate_session_token_for_user(user["id"], payload.session_token)

    if payload.session_id == str(current_session["id"]):
        raise HTTPException(status_code=400, detail="Cannot terminate current session")

    revoke_auth_session(user["id"], payload.session_id)
    log_login_history_event(
        event_id=str(uuid4()),
        user_id=user["id"],
        ip=current_session.get("ip") or "Unknown",
        location=current_session.get("location") or "Security Center",
        device=current_session.get("device") or "Current device",
        success=True,
        method="session_terminated",
    )
    return {"success": True}


@app.post("/auth/sessions/terminate-others")
def terminate_other_sessions(payload: TerminateOtherSessionsPayload) -> dict[str, int]:
    user = get_user_or_404(str(payload.email))
    current_session = _validate_session_token_for_user(user["id"], payload.session_token)
    terminated = revoke_other_auth_sessions(user["id"], str(current_session["id"]))
    if terminated > 0:
        log_login_history_event(
            event_id=str(uuid4()),
            user_id=user["id"],
            ip=current_session.get("ip") or "Unknown",
            location=current_session.get("location") or "Security Center",
            device=current_session.get("device") or "Current device",
            success=True,
            method="terminate_all_sessions",
        )
    return {"terminated": terminated}


@app.post("/auth/signout")
def sign_out(payload: TerminateOtherSessionsPayload) -> dict[str, bool]:
    user = get_user_or_404(str(payload.email))
    current_session = _validate_session_token_for_user(user["id"], payload.session_token)
    revoke_auth_session(user["id"], str(current_session["id"]))
    return {"success": True}


@app.post("/subscriptions/complete")
def complete_subscription(payload: SubscriptionCompletePayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    if payload.payment_status.strip().lower() != "paid":
        raise HTTPException(status_code=400, detail="Payment not completed")

    if payload.billing_cycle_days not in {30, 90}:
        raise HTTPException(status_code=400, detail="Invalid billing cycle")

    if payload.monthly_server_fee_usd < 0 or payload.setup_charge_usd < 0:
        raise HTTPException(status_code=400, detail="Charges must be non-negative")

    exchange_key = _normalize_exchange_key(payload.exchange)
    if exchange_key not in {"binance_futures", "bybit_futures"}:
        raise HTTPException(status_code=400, detail="Unsupported exchange")

    account_type = _normalize_account_type(payload.account_type or "demo")
    trade_type = _normalize_trade_type(payload.trade_type or payload.model)
    dca_mode = str(payload.dca_mode or "Disable").strip() or "Disable"
    dca_enabled = _is_dca_enabled(dca_mode)

    stake_amount: float | None = None
    if trade_type == "fixed":
        parsed_stake = float(payload.stake_amount) if payload.stake_amount is not None else 50.0
        if parsed_stake <= 0:
            raise HTTPException(status_code=400, detail="Stake amount must be greater than 0 for Fixed trade type")
        stake_amount = parsed_stake

    max_open_order = int(payload.max_open_order if payload.max_open_order is not None else 15)
    max_open_order = max(5, min(15, max_open_order))

    freqtrade_urls = [s.strip() for s in str(settings.freqtrade_urls).split(",") if s.strip()]
    default_freqtrade_url = freqtrade_urls[0] if freqtrade_urls else None

    try:
        bot_row = create_purchased_bot_account(
            owner_user_id=user["id"],
            freqtrade_url=default_freqtrade_url,
            exchange=payload.exchange,
            model=trade_type.capitalize(),
            capital_usdt=payload.capital_usdt,
            billing_cycle_days=payload.billing_cycle_days,
            setup_charge_usd=payload.setup_charge_usd,
            monthly_server_fee_usd=payload.monthly_server_fee_usd,
            metadata_json={
                "payment_status": "paid",
                "source": "subscription_checkout",
                "account_type": account_type,
                "trade_type": trade_type,
                "dca_mode": "Enable" if dca_enabled else "Disable",
                "dca_enabled": dca_enabled,
                "stake_amount": stake_amount,
                "max_open_order": max_open_order,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to complete subscription: {exc}") from exc

    bot_id = str(bot_row.get("bot_id") or "").strip()
    if not bot_id:
        raise HTTPException(status_code=500, detail="Bot purchase recorded but bot id is missing")

    try:
        _ = continue_bot_setup(
            bot_id,
            ContinueBotSetupPayload(
                email=payload.email,
                session_token=payload.session_token,
            ),
        )
        _ = deploy_bot_setup(
            bot_id,
            DeployBotSetupPayload(
                email=payload.email,
                session_token=payload.session_token,
                dry_run=True,
            ),
        )
    except HTTPException as exc:
        raise HTTPException(status_code=502, detail=f"Auto deployment failed: {exc.detail}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auto deployment failed: {exc}") from exc

    return {
        "success": True,
        "message": "Payment completed and bot purchase recorded",
        "bot": {
            "id": bot_row.get("bot_id"),
            "name": bot_row.get("bot_name"),
        },
    }


@app.post("/subscriptions/{bot_id}/setup/continue")
def continue_bot_setup(bot_id: str, payload: ContinueBotSetupPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    if str(metadata.get("setup_status") or "").lower() == "completed":
        history_rows = list_bot_setup_events(user["id"], bot_id)
        history = [
            {
                "step": r.get("step"),
                "status": r.get("status"),
                "message": r.get("message"),
                "timestamp": str(r.get("created_at") or ""),
            }
            for r in history_rows
        ]
        return {
            "success": True,
            "message": "Bot setup already completed",
            "bot": {
                "id": bot_id,
                "name": bot_row.get("bot_name") or bot_id,
            },
            "setup": _build_setup_state_payload(bot_row, history=history),
        }

    exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
    if exchange_key not in {"binance_futures", "bybit_futures"}:
        raise HTTPException(status_code=400, detail="Unsupported bot exchange")

    server_id = metadata.get("setup_server_id")
    server_ip = metadata.get("setup_server_ip")
    server: dict[str, Any] = {
        "server_id": server_id,
        "ip": server_ip,
    }

    created_server_now = False

    if not server_ip:
        bot_row = _record_setup_step(
            user["id"],
            bot_id,
            bot_row,
            step="server_create",
            status="server_create_started",
            message="Starting Hetzner server creation",
        )
        server = _hetzner_create_server(bot_id)
        if not server.get("ip"):
            bot_row = _record_setup_step(
                user["id"],
                bot_id,
                bot_row,
                step="server_create",
                status="server_create_failed",
                message="Server created but public IP is not available yet",
                extra={
                    "setup_server_id": server.get("server_id"),
                    "setup_server_ip": "",
                },
            )
            raise HTTPException(status_code=502, detail="Server created but public IP is not available yet")

        bot_row = _record_setup_step(
            user["id"],
            bot_id,
            bot_row,
            step="server_create",
            status="server_created",
            message="Hetzner server created",
            extra={
                "setup_server_id": server.get("server_id"),
                "setup_server_ip": server.get("ip"),
                "setup_backend_server_ip": _guess_backend_server_ip(),
                "setup_exchange": exchange_key,
            },
        )

        try:
            _wait_for_key_based_ssh(str(server.get("ip") or ""))
            bot_row = _record_setup_step(
                user["id"],
                bot_id,
                bot_row,
                step="server_access",
                status="server_access_ready",
                message="SSH key authentication is ready",
                extra={
                    "setup_server_id": server.get("server_id"),
                    "setup_server_ip": server.get("ip"),
                    "setup_backend_server_ip": _guess_backend_server_ip(),
                    "setup_exchange": exchange_key,
                },
            )
        except HTTPException as exc:
            bot_row = _record_setup_step(
                user["id"],
                bot_id,
                bot_row,
                step="server_access",
                status="server_access_failed",
                message=str(exc.detail),
                extra={
                    "setup_server_id": server.get("server_id"),
                    "setup_server_ip": server.get("ip"),
                    "setup_backend_server_ip": _guess_backend_server_ip(),
                    "setup_exchange": exchange_key,
                },
            )
            raise
        created_server_now = True

    return {
        "success": True,
        "message": (
            "Server created successfully. Proceed to Step 3 to validate API keys."
            if created_server_now
            else "Server already created. Proceed to Step 3 to validate API keys."
        ),
        "bot": {
            "id": bot_id,
            "name": bot_row.get("bot_name") or bot_id,
        },
        "setup": _build_setup_state_payload(
            bot_row,
            history=[
                {
                    "step": r.get("step"),
                    "status": r.get("status"),
                    "message": r.get("message"),
                    "timestamp": str(r.get("created_at") or ""),
                }
                for r in list_bot_setup_events(user["id"], bot_id)
            ],
        ),
    }


@app.post("/subscriptions/{bot_id}/setup/validate-binance")
def validate_binance_setup(bot_id: str, payload: ValidateBinanceSetupPayload) -> dict[str, Any]:
    return _validate_exchange_setup(bot_id, payload, expected_exchange_key="binance_futures")


@app.post("/subscriptions/{bot_id}/setup/validate-bybit")
def validate_bybit_setup(bot_id: str, payload: ValidateBinanceSetupPayload) -> dict[str, Any]:
    return _validate_exchange_setup(bot_id, payload, expected_exchange_key="bybit_futures")


def _validate_exchange_setup(
    bot_id: str,
    payload: ValidateBinanceSetupPayload,
    *,
    expected_exchange_key: str,
) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    exchange_label = "Binance" if expected_exchange_key == "binance_futures" else "Bybit"
    provided_api_key = str(payload.api_key or "").strip()
    provided_api_secret = str(payload.api_secret or "").strip()
    if str(metadata.get("setup_status") or "").lower() == "completed" and (not provided_api_key or not provided_api_secret):
        _ensure_bot_connection_entry(
            user_id=user["id"],
            bot_id=bot_id,
            bot_name=str(bot_id),
            exchange_key=expected_exchange_key,
        )

        history_rows = list_bot_setup_events(user["id"], bot_id)
        history = [
            {
                "step": r.get("step"),
                "status": r.get("status"),
                "message": r.get("message"),
                "timestamp": str(r.get("created_at") or ""),
            }
            for r in history_rows
        ]
        return {
            "success": True,
            "message": "Bot setup already completed",
            "bot": {
                "id": bot_id,
                "name": bot_row.get("bot_name") or bot_id,
            },
            "setup": _build_setup_state_payload(bot_row, history=history),
        }

    exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
    if exchange_key != expected_exchange_key:
        supported_label = "Binance Futures" if expected_exchange_key == "binance_futures" else "Bybit Futures"
        raise HTTPException(status_code=400, detail=f"This validation step currently supports {supported_label} only")

    server_ip = str(metadata.get("setup_server_ip") or "").strip()
    server_id = metadata.get("setup_server_id")
    if not server_ip:
        raise HTTPException(status_code=400, detail="Server IP not found. Complete Step 1 (Create Server) first")

    api_key = str(payload.api_key or "").strip()
    api_secret = str(payload.api_secret or "").strip()
    if not api_key or not api_secret:
        # Reuse previously stored credentials for this bot (or exchange fallback)
        api_key, api_secret = _connection_credentials_for_bot(user["id"], bot_id, exchange_key)
        if not api_key or not api_secret:
            api_key, api_secret = _get_user_exchange_api_credentials(user["id"], exchange_key)
    if not api_key or not api_secret:
        raise HTTPException(
            status_code=400,
            detail=f"{exchange_label} API key and secret are required, or store a valid connection in Settings first",
        )

    bot_row = _record_setup_step(
        user["id"],
        bot_id,
        bot_row,
        step="api_validation",
        status="api_validation_started",
        message=f"Validating {exchange_label} futures API credentials",
        extra={
            "setup_server_id": server_id,
            "setup_server_ip": server_ip,
                "setup_backend_server_ip": _guess_backend_server_ip(),
            "setup_exchange": exchange_key,
        },
    )

    is_valid, validation_message = _validate_exchange_api(exchange_key, api_key, api_secret)
    if not is_valid:
        validation_detail = validation_message
        request_ip = _extract_request_ip_from_validation_message(validation_message)
        whitelist_ip = request_ip or server_ip
        if "invalid api-key, ip, or permissions" in validation_message.lower() and whitelist_ip:
            validation_detail = (
                f"{validation_message}. Whitelist IP {whitelist_ip} "
                "for this API key and then validate again."
            )

        bot_row = _record_setup_step(
            user["id"],
            bot_id,
            bot_row,
            step="api_validation",
            status="api_validation_failed",
            message=validation_detail,
            extra={
                "setup_server_id": server_id,
                "setup_server_ip": server_ip,
                "setup_backend_server_ip": request_ip or _guess_backend_server_ip(),
                "setup_request_ip": request_ip,
                "setup_exchange": exchange_key,
            },
        )
        raise HTTPException(status_code=400, detail=validation_detail)

    bot_row = _record_setup_step(
        user["id"],
        bot_id,
        bot_row,
        step="api_validation",
        status="api_validated",
        message=validation_message,
        extra={
            "setup_server_id": server_id,
            "setup_server_ip": server_ip,
            "setup_backend_server_ip": _guess_backend_server_ip(),
            "setup_exchange": exchange_key,
        },
    )

    # Persist validated Binance credentials into Settings > Connections as a bot-specific connection.
    settings_payload = get_user_settings(user["id"]) or {}
    raw_connections = settings_payload.get("connections") if isinstance(settings_payload.get("connections"), list) else []

    bot_connection_id = f"bot_{bot_id}_{expected_exchange_key}"
    bot_connection_name = str(bot_id)

    updated_connections: list[dict[str, Any]] = []
    bot_connection_updated = False
    for raw_connection in raw_connections:
        if not isinstance(raw_connection, dict):
            continue

        connection = dict(raw_connection)
        connection_id = str(connection.get("id") or "").strip()
        if connection_id == bot_connection_id:
            connection["id"] = bot_connection_id
            connection["name"] = bot_connection_name
            connection["type"] = "exchange"
            connection["exchange"] = expected_exchange_key
            connection["status"] = "connected"
            connection["lastSync"] = datetime.now(timezone.utc).isoformat()
            connection["permissions"] = ["read", "trade"]
            connection["apiKey"] = api_key
            connection["apiSecret"] = api_secret
            bot_connection_updated = True

        updated_connections.append(connection)

    if not bot_connection_updated:
        updated_connections.append(
            {
                "id": bot_connection_id,
                "name": bot_connection_name,
                "type": "exchange",
                "exchange": expected_exchange_key,
                "status": "connected",
                "lastSync": datetime.now(timezone.utc).isoformat(),
                "permissions": ["read", "trade"],
                "apiKey": api_key,
                "apiSecret": api_secret,
            }
        )

    settings_payload["connections"] = updated_connections
    sanitized_settings = _sanitize_connections_for_storage(settings_payload)
    upsert_user_settings(user["id"], sanitized_settings)

    return {
        "success": True,
        "message": f"{exchange_label} API validated and saved to Settings Connections. Proceed to deploy your bot.",
        "bot": {
            "id": bot_id,
            "name": bot_row.get("bot_name") or bot_id,
        },
        "setup": _build_setup_state_payload(
            bot_row,
            history=[
                {
                    "step": r.get("step"),
                    "status": r.get("status"),
                    "message": r.get("message"),
                    "timestamp": str(r.get("created_at") or ""),
                }
                for r in list_bot_setup_events(user["id"], bot_id)
            ],
        ),
    }


@app.post("/subscriptions/{bot_id}/setup/deploy")
def deploy_bot_setup(bot_id: str, payload: DeployBotSetupPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    server_ip = str(metadata.get("setup_server_ip") or "").strip()
    if not server_ip:
        raise HTTPException(status_code=400, detail="Server IP not found. Complete server creation first")

    exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
    if exchange_key not in {"binance_futures", "bybit_futures"}:
        raise HTTPException(status_code=400, detail="Unsupported exchange for deployment")

    account_type = _normalize_account_type(str(metadata.get("account_type") or "real"))
    trade_type = _normalize_trade_type(str(metadata.get("trade_type") or bot_row.get("model") or "compound"))
    dca_mode = str(metadata.get("dca_mode") or "Disable")
    dca_enabled = _is_dca_enabled(dca_mode)
    capital_usdt = float(bot_row.get("capital_usdt") or 0)

    stake_amount_raw = metadata.get("stake_amount")
    stake_amount_value = 50.0
    if stake_amount_raw is not None:
        try:
            candidate = float(stake_amount_raw)
            if candidate > 0:
                stake_amount_value = candidate
        except (TypeError, ValueError):
            pass

    stake_amount = f"{stake_amount_value:g}" if trade_type == "fixed" else "unlimited"
    max_open_trades = int(metadata.get("max_open_order") or 15)
    max_open_trades = max(5, min(15, max_open_trades))
    previous_is_demo = account_type == "demo"
    if payload.dry_run is None:
        dry_run_mode = account_type == "demo"
    else:
        dry_run_mode = bool(payload.dry_run)
    mode_switched = previous_is_demo != dry_run_mode
    dry_run_wallet = capital_usdt if capital_usdt > 0 else 1000.0

    requested_api_key = str(payload.api_key or "").strip()
    requested_api_secret = str(payload.api_secret or "").strip()

    api_key = requested_api_key
    api_secret = requested_api_secret
    if not api_key or not api_secret:
        api_key, api_secret = _connection_credentials_for_bot(user["id"], bot_id, exchange_key)
    if not api_key or not api_secret:
        api_key, api_secret = _get_user_exchange_api_credentials(user["id"], exchange_key)

    if dry_run_mode:
        if not api_key:
            api_key = "demo_key"
        if not api_secret:
            api_secret = "demo_secret"
    else:
        if not api_key or not api_secret:
            raise HTTPException(status_code=400, detail="Exchange API key/secret are required to switch bot to live mode")
        _upsert_bot_connection_credentials(
            user_id=user["id"],
            bot_id=bot_id,
            bot_name=str(bot_row.get("bot_name") or bot_id),
            exchange_key=exchange_key,
            api_key=api_key,
            api_secret=api_secret,
        )

    bot_row = _record_setup_step(
        user["id"],
        bot_id,
        bot_row,
        step="deploy_freqtrade",
        status="deploy_started",
        message="Starting remote bot deployment",
        extra={
            "setup_server_ip": server_ip,
            "setup_exchange": exchange_key,
        },
    )

    try:
        deploy_result = _deploy_freqtrade_bundle(
            server_ip=server_ip,
            bot_id=bot_id,
            exchange_key=exchange_key,
            strategy_name=payload.strategy_name,
            strategy_code=payload.strategy_code,
            config_override=payload.config_override,
            api_key=api_key,
            api_secret=api_secret,
            dry_run=dry_run_mode,
            dry_run_wallet=dry_run_wallet,
            stake_amount=stake_amount,
            max_open_trades=max_open_trades,
            dca_enabled=dca_enabled,
            reset_user_data=mode_switched,
        )
    except HTTPException as exc:
        bot_row = _record_setup_step(
            user["id"],
            bot_id,
            bot_row,
            step="deploy_freqtrade",
            status="deploy_failed",
            message=str(exc.detail),
            extra={
                "setup_server_ip": server_ip,
                "setup_exchange": exchange_key,
            },
        )
        raise
    except Exception as exc:
        message = str(exc) or "Unexpected deployment error"
        bot_row = _record_setup_step(
            user["id"],
            bot_id,
            bot_row,
            step="deploy_freqtrade",
            status="deploy_failed",
            message=message,
            extra={
                "setup_server_ip": server_ip,
                "setup_exchange": exchange_key,
            },
        )
        raise HTTPException(status_code=500, detail=message) from exc

    bot_row = _record_setup_step(
        user["id"],
        bot_id,
        bot_row,
        step="deploy_freqtrade",
        status="deploy_completed",
        message="Bot deployed successfully",
        extra={
            "setup_server_ip": server_ip,
            "setup_exchange": exchange_key,
            "setup_deploy_result": deploy_result,
            "account_type": "demo" if dry_run_mode else "real",
            "setup_status": "completed",
            "setup_last_step": "deploy_freqtrade",
            "setup_completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    # Wire this purchased bot to the dedicated remote Freqtrade API for live bot details.
    api_url = str(deploy_result.get("api_url") or "").strip()
    if api_url:
        bot_row = upsert_bot_account(
            bot_id=bot_id,
            bot_name=str(bot_row.get("bot_name") or bot_id),
            freqtrade_url=api_url,
            owner_user_id=user["id"],
            metadata_json={"runtime_source": "remote_deploy"},
        )

    return {
        "success": True,
        "message": "Bot deployed on server successfully",
        "bot": {
            "id": bot_id,
            "name": bot_row.get("bot_name") or bot_id,
        },
        "deploy": deploy_result,
        "setup": _build_setup_state_payload(
            bot_row,
            history=[
                {
                    "step": r.get("step"),
                    "status": r.get("status"),
                    "message": r.get("message"),
                    "timestamp": str(r.get("created_at") or ""),
                }
                for r in list_bot_setup_events(user["id"], bot_id)
            ],
        ),
    }


@app.post("/subscriptions/{bot_id}/setup/install-ssh-key")
def install_ssh_key_on_server(bot_id: str, payload: EmailSessionPayload) -> dict[str, Any]:
    """Verify that deploy SSH key access is ready on the provisioned server."""
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    server_ip = str(metadata.get("setup_server_ip") or "").strip()

    if not server_ip:
        raise HTTPException(status_code=400, detail="Server IP not found. Complete server creation first")

    _wait_for_key_based_ssh(server_ip)

    return {
        "success": True,
        "message": f"SSH key authentication is ready on {server_ip}. You can now deploy your bot.",
    }


@app.delete("/subscriptions/{bot_id}")
def delete_subscription_bot(bot_id: str, payload: EmailSessionPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    server_ip = str(metadata.get("setup_server_ip") or "").strip()
    server_id = metadata.get("setup_server_id")

    if server_id is not None:
        _hetzner_delete_server(int(server_id))

    # Best-effort remote cleanup for deployed bots.
    cleanup_warnings: list[str] = []
    if server_ip:
        container_name = f"pp-freqtrade-{bot_id[-8:]}"
        deploy_dir = str(settings.freqtrade_deploy_dir or "/opt/profitpath-freqtrade").strip() or "/opt/profitpath-freqtrade"
        try:
            _run_remote_command(server_ip, f"docker rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true", timeout=120)
            _run_remote_command(
                server_ip,
                (
                    f"if [ -f {shlex.quote(deploy_dir + '/docker-compose.yml')} ] "
                    f"&& grep -q {shlex.quote('container_name: ' + container_name)} {shlex.quote(deploy_dir + '/docker-compose.yml')}; "
                    f"then rm -rf {shlex.quote(deploy_dir)}; fi"
                ),
                timeout=120,
            )
        except Exception as exc:
            cleanup_warnings.append(f"Remote cleanup warning: {exc}")

    # Remove bot-specific saved connection from Settings > Connections.
    settings_payload = get_user_settings(user["id"]) or {}
    raw_connections = settings_payload.get("connections") if isinstance(settings_payload.get("connections"), list) else []
    exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
    target_connection_id = f"bot_{bot_id}_{exchange_key}" if exchange_key else ""
    if target_connection_id:
        filtered_connections = []
        for raw in raw_connections:
            if not isinstance(raw, dict):
                continue
            if str(raw.get("id") or "").strip() == target_connection_id:
                continue
            filtered_connections.append(raw)
        settings_payload["connections"] = filtered_connections
        sanitized_settings = _sanitize_connections_for_storage(settings_payload)
        upsert_user_settings(user["id"], sanitized_settings)

    deleted = delete_user_purchased_bot_account(user["id"], bot_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete bot")

    return {
        "success": True,
        "message": "Bot deleted successfully",
        "bot": {
            "id": bot_id,
            "name": bot_row.get("bot_name") or bot_id,
        },
        "cleanup_warnings": cleanup_warnings,
    }


@app.get("/subscriptions/{bot_id}/setup/state")
def get_bot_setup_state(bot_id: str, email: EmailStr, session_token: str) -> dict[str, Any]:
    user = get_user_or_404(str(email))
    _ = _validate_session_token_for_user(user["id"], session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    metadata = _setup_metadata(bot_row)
    if str(metadata.get("setup_status") or "").lower() == "completed":
        exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
        if exchange_key in {"binance_futures", "bybit_futures"}:
            _ensure_bot_connection_entry(
                user_id=user["id"],
                bot_id=bot_id,
                bot_name=str(bot_id),
                exchange_key=exchange_key,
            )

    history_rows = list_bot_setup_events(user["id"], bot_id)
    history = [
        {
            "step": r.get("step"),
            "status": r.get("status"),
            "message": r.get("message"),
            "timestamp": str(r.get("created_at") or ""),
        }
        for r in history_rows
    ]

    return {
        "success": True,
        "bot": {
            "id": bot_id,
            "name": bot_row.get("bot_name") or bot_id,
        },
        "setup": _build_setup_state_payload(bot_row, history=history),
    }


@app.get("/referrals")
def list_referrals(email: EmailStr) -> dict[str, list[dict]]:
    user = get_user_or_404(str(email))
    return {"referrals": get_referrals(user["id"])}


@app.get("/referrals/settings")
def list_referral_settings(email: EmailStr) -> dict[str, dict[str, bool]]:
    user = get_user_or_404(str(email))
    return {"settings": get_referral_settings(user["id"])}


@app.put("/referrals/settings")
def put_referral_settings(payload: ReferralSettingsPayload) -> dict[str, dict[str, bool]]:
    user = get_user_or_404(str(payload.email))
    settings_payload = update_referral_settings(
        user_id=user["id"],
        email_notifications=payload.email_notifications,
        show_in_leaderboard=payload.show_in_leaderboard,
        auto_share_achievements=payload.auto_share_achievements,
    )
    return {"settings": settings_payload}


@app.post("/referrals/invitations")
def post_referral_invitations(payload: ReferralInvitationsPayload) -> dict[str, int]:
    user = get_user_or_404(str(payload.email))
    unique_emails = sorted({str(email).lower() for email in payload.emails if str(email).strip()})
    if not unique_emails:
        raise HTTPException(status_code=400, detail="At least one invite email is required")

    created = create_referrals(user["id"], unique_emails)
    return {"created": len(created)}


@app.get("/settings")
def get_settings(email: EmailStr) -> dict[str, dict]:
    user = get_user_or_404(str(email))
    _sync_user_completed_bot_connections(user["id"])
    settings_payload = get_user_settings(user["id"])
    safe_payload = _sanitize_connections_for_response(settings_payload or {})
    return {"settings": safe_payload}


@app.put("/settings")
def put_settings(payload: UserSettingsPayload) -> dict[str, dict]:
    user = get_user_or_404(str(payload.email))
    sanitized_input = _sanitize_connections_for_storage(payload.settings)
    saved = upsert_user_settings(user["id"], sanitized_input)
    safe_saved = _sanitize_connections_for_response(saved)
    return {"settings": safe_saved}


@app.post("/profile/avatar")
def upload_profile_avatar(email: EmailStr = Form(...), file: UploadFile = File(...)) -> dict[str, str]:
    user = get_user_or_404(str(email))

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    raw_bytes = file.file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    if len(raw_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image size must be less than 5MB")

    original_name = (file.filename or "avatar").lower()
    _, ext = os.path.splitext(original_name)
    if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        ext = ".png"

    filename = f"user-{user['id']}-{uuid4().hex}{ext}"
    target_path = os.path.join(settings.profile_pictures_dir, filename)

    with open(target_path, "wb") as avatar_file:
        avatar_file.write(raw_bytes)

    avatar_url = _avatar_url_from_filename(filename)

    settings_payload = get_user_settings(user["id"]) or {}
    profile_settings = settings_payload.get("profile") if isinstance(settings_payload.get("profile"), dict) else {}
    previous_avatar = profile_settings.get("avatar") if isinstance(profile_settings.get("avatar"), str) else ""
    if previous_avatar:
        _delete_avatar_file_if_exists(previous_avatar)

    profile_settings["avatar"] = avatar_url
    settings_payload["profile"] = profile_settings
    upsert_user_settings(user["id"], settings_payload)

    return {"avatar_url": avatar_url}


@app.delete("/profile/avatar")
def delete_profile_avatar(payload: AvatarDeletePayload) -> dict[str, str]:
    user = get_user_or_404(str(payload.email))

    settings_payload = get_user_settings(user["id"]) or {}
    profile_settings = settings_payload.get("profile") if isinstance(settings_payload.get("profile"), dict) else {}
    previous_avatar = profile_settings.get("avatar") if isinstance(profile_settings.get("avatar"), str) else ""

    if previous_avatar:
        _delete_avatar_file_if_exists(previous_avatar)

    profile_settings["avatar"] = ""
    settings_payload["profile"] = profile_settings
    upsert_user_settings(user["id"], settings_payload)

    return {"avatar_url": ""}


@app.post("/auth/forgot-password")
def forgot_password(payload: ForgotPasswordPayload) -> dict[str, str]:
    user = get_user_by_email(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="Email account does not exist.")

    raw_token = token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=settings.reset_token_ttl_minutes)).isoformat()

    create_password_reset_token(user_id=user["id"], token_hash=token_hash, expires_at=expires_at)

    reset_link = f"{settings.frontend_url}/reset-password?token={raw_token}"
    try:
        send_reset_email(user["email"], reset_link)
    except (TimeoutError, OSError, smtplib.SMTPException) as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to reach SMTP server. Please try again later.",
        ) from exc

    return {"message": "Reset link sent to your email."}


@app.post("/auth/reset-password")
def reset_password(payload: ResetPasswordPayload) -> dict[str, str]:
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    reset_row = get_valid_password_reset(token_hash)

    if not reset_row:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    new_hash = hash_password(payload.password)
    update_user_password(user_id=reset_row["user_id"], password_hash=new_hash)
    mark_password_reset_used(reset_id=reset_row["id"])

    return {"message": "Password has been reset successfully."}


@app.post("/auth/change-password")
def change_password(payload: ChangePasswordPayload) -> dict[str, str]:
    user = get_user_by_email(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    password_hash = user.get("password_hash")
    if not password_hash or not verify_password(payload.current_password, password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from current password")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    update_user_password(user_id=user["id"], password_hash=hash_password(payload.new_password))
    return {"message": "Password changed successfully."}


@app.get("/docker/health")
def docker_health() -> dict[str, str | bool]:
    ok, message = safe_docker_ping()
    return {"ok": ok, "message": message}


@app.get("/docker/info")
def docker_info() -> dict:
    try:
        client = get_docker_client()
        return client.info()
    except DockerException as exc:
        raise HTTPException(status_code=503, detail=f"Docker unavailable: {exc}") from exc


@app.get("/docker/containers")
def list_containers(all: bool = False) -> list[dict[str, str]]:
    try:
        client = get_docker_client()
        containers = client.containers.list(all=all)
        return [
            {
                "id": c.short_id,
                "name": c.name,
                "status": c.status,
                "image": c.image.tags[0] if c.image.tags else c.image.short_id,
            }
            for c in containers
        ]
    except DockerException as exc:
        raise HTTPException(status_code=503, detail=f"Docker unavailable: {exc}") from exc
