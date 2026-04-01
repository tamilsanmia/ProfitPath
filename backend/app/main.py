import hashlib
import hmac
import smtplib
import logging
import os
import json
import base64
import pathlib
import re
import shlex
import subprocess
import tempfile
import platform
import shutil
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
    delete_bot_setup_metadata_keys,
    delete_user_purchased_bot_account,
    delete_user_purchased_bot_metadata_keys,
    create_password_reset_token,
    create_user,
    get_auth_session_by_token_hash,
    get_referral_settings,
    get_referrals,
    list_bot_accounts,
    list_auth_sessions,
    list_bot_setup_events,
    list_user_purchased_bot_accounts,
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
from .mailer import send_reset_email, send_test_email
from .security import hash_password, verify_password
from .settings import settings

app = FastAPI(title=settings.app_name)
app.include_router(freqtrade_router)
os.makedirs(settings.profile_pictures_dir, exist_ok=True)
app.mount("/media/profile-pictures", StaticFiles(directory=settings.profile_pictures_dir), name="profile-pictures")

logger = logging.getLogger("botprimex.api")


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
    settings_payload = _strip_deprecated_admin_fields(settings_payload)
    settings_payload = _normalize_admin_company_information(settings_payload)
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
    settings_payload = _strip_deprecated_admin_fields(settings_payload)
    settings_payload = _normalize_admin_company_information(settings_payload)
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


def _strip_deprecated_admin_fields(settings_payload: dict) -> dict:
    if not isinstance(settings_payload, dict):
        return settings_payload

    updated = dict(settings_payload)

    admin_portal = updated.get("adminPortal")
    if isinstance(admin_portal, dict):
        next_admin_portal = dict(admin_portal)
        general = next_admin_portal.get("general")
        if isinstance(general, dict):
            next_general = dict(general)
            next_general.pop("maintenanceMode", None)
            next_general.pop("statusPageEnabled", None)
            next_admin_portal["general"] = next_general
        updated["adminPortal"] = next_admin_portal

    admin_site = updated.get("adminSite")
    if isinstance(admin_site, dict):
        next_admin_site = dict(admin_site)
        next_admin_site.pop("maintenanceMode", None)
        updated["adminSite"] = next_admin_site

    return updated


def _cleanup_deprecated_admin_settings_for_user(user_id: int) -> dict[str, Any]:
    current_settings = get_user_settings(user_id) or {}
    cleaned_settings = _strip_deprecated_admin_fields(current_settings)
    changed = cleaned_settings != current_settings

    if changed:
        upsert_user_settings(user_id, cleaned_settings)

    return {
        "changed": changed,
        "cleaned_settings": cleaned_settings,
    }


def _clean_settings_text(value: object) -> str:
    return str(value or "").strip()


def _normalize_admin_company_information(settings_payload: dict) -> dict:
    if not isinstance(settings_payload, dict):
        return settings_payload

    updated = dict(settings_payload)

    admin_portal_raw = updated.get("adminPortal")
    admin_portal = dict(admin_portal_raw) if isinstance(admin_portal_raw, dict) else {}

    general_raw = admin_portal.get("general")
    general = dict(general_raw) if isinstance(general_raw, dict) else {}

    admin_site_raw = updated.get("adminSite")
    admin_site = dict(admin_site_raw) if isinstance(admin_site_raw, dict) else {}

    company_info_raw = admin_portal.get("companyInformation")
    company_info = dict(company_info_raw) if isinstance(company_info_raw, dict) else {}

    normalized_company_information = {
        "companyName": _clean_settings_text(company_info.get("companyName"))
        or _clean_settings_text(admin_site.get("companyName"))
        or _clean_settings_text(general.get("companyName"))
        or "BotPrimeX",
        "address": _clean_settings_text(company_info.get("address"))
        or _clean_settings_text(admin_site.get("address"))
        or "",
        "city": _clean_settings_text(company_info.get("city"))
        or _clean_settings_text(admin_site.get("city"))
        or "",
        "state": _clean_settings_text(company_info.get("state"))
        or _clean_settings_text(admin_site.get("state"))
        or "",
        "countryCode": _clean_settings_text(company_info.get("countryCode"))
        or _clean_settings_text(admin_site.get("countryCode"))
        or "",
        "zipCode": _clean_settings_text(company_info.get("zipCode"))
        or _clean_settings_text(admin_site.get("zipCode"))
        or "",
        "phone": _clean_settings_text(company_info.get("phone"))
        or _clean_settings_text(admin_site.get("phone"))
        or _clean_settings_text(admin_site.get("supportPhone"))
        or "",
        "vatNumber": _clean_settings_text(company_info.get("vatNumber"))
        or _clean_settings_text(admin_site.get("vatNumber"))
        or _clean_settings_text(admin_site.get("taxId"))
        or "",
        "companyInfoFormat": _clean_settings_text(company_info.get("companyInfoFormat"))
        or _clean_settings_text(admin_site.get("companyInfoFormat"))
        or "{company_name}\n    {address}\n    {city} {state}\n    {country_code} {zip_code}\n    {vat_number_with_label}",
    }

    admin_portal["companyInformation"] = normalized_company_information
    updated["adminPortal"] = admin_portal

    admin_site["companyName"] = normalized_company_information["companyName"]
    admin_site["address"] = normalized_company_information["address"]
    admin_site["city"] = normalized_company_information["city"]
    admin_site["state"] = normalized_company_information["state"]
    admin_site["countryCode"] = normalized_company_information["countryCode"]
    admin_site["zipCode"] = normalized_company_information["zipCode"]
    admin_site["phone"] = normalized_company_information["phone"]
    admin_site["vatNumber"] = normalized_company_information["vatNumber"]
    admin_site["companyInfoFormat"] = normalized_company_information["companyInfoFormat"]
    updated["adminSite"] = admin_site

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
    strategy_name: str | None = None
    dca_mode: str | None = None
    stake_amount: float | None = None
    max_open_order: int | None = None
    capital_usdt: float
    billing_cycle_days: int
    setup_charge_usd: float
    monthly_server_fee_usd: float = 10.0
    payment_status: str = "paid"
    payment_id: str | None = None


class CreateInvoicePayload(BaseModel):
    email: EmailStr
    session_token: str
    price_amount: float
    order_description: str = "BotPrimeX Bot Subscription"


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
    strategy_name: str = "BotPrimeX"
    strategy_code: str | None = None
    config_override: dict[str, Any] | None = None
    dry_run: bool | None = None
    api_key: str | None = None
    api_secret: str | None = None


class UpdateBotSetupSettingsPayload(BaseModel):
    email: EmailStr
    session_token: str
    trade_type: str
    dca_mode: str
    stake_amount: float | None = None
    max_open_order: int
    stoploss_pct: float
    dca_stoploss_pct: float
    leverage: float
    # DCA core
    max_dca_multiplier: int = 1
    max_dca_orders_open: int = 2
    initial_entry_stake_ratio: float = 0.5
    dca_entry_stake_ratio: float = 0.5
    shift_lookback: int = 5
    # Per-TF entry toggles
    entry_5m_long_enabled: bool = True
    entry_5m_shift_long_enabled: bool = True
    entry_5m_short_enabled: bool = True
    entry_5m_shift_short_enabled: bool = True
    entry_15m_long_enabled: bool = False
    entry_15m_shift_long_enabled: bool = False
    entry_15m_short_enabled: bool = False
    entry_15m_shift_short_enabled: bool = False
    entry_30m_long_enabled: bool = False
    entry_30m_shift_long_enabled: bool = False
    entry_30m_short_enabled: bool = False
    entry_30m_shift_short_enabled: bool = False
    entry_1h_long_enabled: bool = False
    entry_1h_shift_long_enabled: bool = False
    entry_1h_short_enabled: bool = False
    entry_1h_shift_short_enabled: bool = False
    entry_4h_long_enabled: bool = False
    entry_4h_shift_long_enabled: bool = False
    entry_4h_short_enabled: bool = False
    entry_4h_shift_short_enabled: bool = False
    # Per-TF RSI thresholds
    entry_5m_rsi_long: float = 30.0
    entry_5m_rsi_short: float = 70.0
    entry_15m_rsi_long: float = 30.0
    entry_15m_rsi_short: float = 70.0
    entry_30m_rsi_long: float = 30.0
    entry_30m_rsi_short: float = 70.0
    entry_1h_rsi_long: float = 30.0
    entry_1h_rsi_short: float = 70.0
    entry_4h_rsi_long: float = 30.0
    entry_4h_rsi_short: float = 70.0
    # Cross-TF RSI (5m RSI thresholds for higher TF entries)
    entry_5m_rsi_long_15m: float = 30.0
    entry_5m_rsi_short_15m: float = 70.0
    entry_5m_rsi_long_30m: float = 40.0
    entry_5m_rsi_short_30m: float = 60.0
    entry_5m_rsi_long_1h: float = 40.0
    entry_5m_rsi_short_1h: float = 60.0
    entry_5m_rsi_long_4h: float = 40.0
    entry_5m_rsi_short_4h: float = 60.0
    # CHG filter global
    use_chg_filter: bool = True
    use_chg_exit_buffer: bool = True
    # 5m CHG
    chg_5m_enabled: bool = True
    chg_5m_min: float = -10.0
    chg_5m_max: float = 10.0
    dca_chg_5m_min: float = -10.0
    dca_chg_5m_max: float = 10.0
    chg_5m_exit_buffer_enabled: bool = True
    chg_5m_exit_buffer: float = 2.0
    # 15m CHG
    chg_15m_enabled: bool = True
    chg_15m_min: float = -10.0
    chg_15m_max: float = 10.0
    dca_chg_15m_min: float = -10.0
    dca_chg_15m_max: float = 10.0
    chg_15m_exit_buffer_enabled: bool = True
    chg_15m_exit_buffer: float = 2.0
    # 30m CHG
    chg_30m_enabled: bool = True
    chg_30m_min: float = -10.0
    chg_30m_max: float = 10.0
    dca_chg_30m_min: float = -10.0
    dca_chg_30m_max: float = 10.0
    chg_30m_exit_buffer_enabled: bool = True
    chg_30m_exit_buffer: float = 2.0
    # 1h CHG
    chg_1h_enabled: bool = True
    chg_1h_min: float = -10.0
    chg_1h_max: float = 10.0
    dca_chg_1h_min: float = -10.0
    dca_chg_1h_max: float = 10.0
    chg_1h_exit_buffer_enabled: bool = True
    chg_1h_exit_buffer: float = 2.0
    # 4h CHG
    chg_4h_enabled: bool = True
    chg_4h_min: float = -10.0
    chg_4h_max: float = 10.0
    dca_chg_4h_min: float = -10.0
    dca_chg_4h_max: float = 10.0
    chg_4h_exit_buffer_enabled: bool = True
    chg_4h_exit_buffer: float = 2.0
    # DCA re-entry
    dca_reentry_min_profit: float = -0.15
    dca_reentry_max_drawdown: float = -0.5
    dca2_reentry_min_profit: float = -0.30
    dca2_reentry_max_drawdown: float = -0.5
    # Volatility guard
    dca_sudden_chg_guard_enabled: bool = True
    dca_sudden_chg_threshold: float = 5.0
    dca_sudden_chg_lookback: int = 10
    # Telegram alerts
    telegram_chg_alert_enabled: bool = True
    telegram_chg_min: float = -5.0
    telegram_chg_max: float = 5.0


class EmailSessionPayload(BaseModel):
    email: EmailStr
    session_token: str


class TestEmailPayload(BaseModel):
    email: EmailStr | None = None
    toEmail: EmailStr
    smtpConfig: dict[str, Any] | None = None


def _build_smtp_config_from_admin_settings(user_id: int) -> dict[str, Any] | None:
    settings_payload = get_user_settings(user_id) or {}
    admin_portal = settings_payload.get("adminPortal") if isinstance(settings_payload.get("adminPortal"), dict) else {}
    email_settings = admin_portal.get("email") if isinstance(admin_portal.get("email"), dict) else {}
    general_settings = admin_portal.get("general") if isinstance(admin_portal.get("general"), dict) else {}

    host = str(email_settings.get("smtpHost") or "").strip()
    from_email = str(email_settings.get("fromEmail") or "").strip()
    if not host or not from_email:
        return None

    port_raw = email_settings.get("smtpPort")
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        port = 587

    return {
        "host": host,
        "port": port,
        "encryption": str(email_settings.get("smtpEncryption") or "TLS").strip() or "TLS",
        "username": str(email_settings.get("smtpUsername") or "").strip(),
        "password": str(email_settings.get("smtpPassword") or "").strip(),
        "fromEmail": from_email,
        "fromName": str(email_settings.get("fromName") or "").strip(),
        "charset": str(email_settings.get("emailCharset") or "UTF-8").strip() or "UTF-8",
        "predefinedHeader": str(email_settings.get("predefinedHeader") or ""),
        "predefinedFooter": str(email_settings.get("predefinedFooter") or ""),
        "companyName": str(general_settings.get("companyName") or general_settings.get("siteTitle") or "BotPrimeX").strip() or "BotPrimeX",
        "logoUrl": str(general_settings.get("companyLogoLightUrl") or general_settings.get("companyLogoDarkUrl") or "").strip(),
    }


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
        "strategy_settings": _normalize_strategy_settings(bot_row),
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


def _normalize_loss_pct(value: Any, *, default_pct: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = float(default_pct)

    # Accept both ratio form (-0.5) and percent form (-50).
    if -1.0 <= parsed < 0:
        parsed *= 100

    if parsed > 0:
        parsed = -abs(parsed)

    return max(-100.0, min(-1.0, parsed))


def _normalize_bounded_float(value: Any, *, default_value: float, min_value: float, max_value: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = float(default_value)
    return max(min_value, min(max_value, parsed))


LEGACY_STRATEGY_METADATA_KEYS: list[str] = []


def _cleanup_legacy_strategy_settings_for_bot(user_id: int, bot_id: str) -> bool:
    return delete_bot_setup_metadata_keys(user_id, bot_id, LEGACY_STRATEGY_METADATA_KEYS)


def _cleanup_legacy_strategy_settings_for_user(user_id: int) -> list[str]:
    return delete_user_purchased_bot_metadata_keys(user_id, LEGACY_STRATEGY_METADATA_KEYS)


def _normalize_strategy_settings(bot_row: dict[str, Any]) -> dict[str, Any]:
    metadata = _setup_metadata(bot_row)

    strategy_name = re.sub(r"[^A-Za-z0-9_]", "", str(metadata.get("strategy_name") or "").strip() or "BotPrimeX")
    if not strategy_name:
        strategy_name = "BotPrimeX"

    trade_type = _normalize_trade_type(str(metadata.get("trade_type") or bot_row.get("model") or "compound"))
    dca_enabled = _is_dca_enabled(str(metadata.get("dca_mode") or "Disable"))

    stake_amount = 50.0
    try:
        candidate = float(metadata.get("stake_amount"))
        if candidate > 0:
            stake_amount = candidate
    except (TypeError, ValueError):
        pass

    max_open_order = 15
    try:
        max_open_order = int(metadata.get("max_open_order") or 15)
    except (TypeError, ValueError):
        max_open_order = 15
    max_open_order = max(1, min(100, max_open_order))

    stoploss_pct = _normalize_loss_pct(metadata.get("stoploss_pct"), default_pct=-99.0)
    dca_stoploss_pct = _normalize_loss_pct(metadata.get("dca_stoploss_pct"), default_pct=-50.0)

    leverage = 5.0
    try:
        leverage = float(metadata.get("leverage") or 5.0)
    except (TypeError, ValueError):
        leverage = 5.0
    leverage = max(1.0, min(125.0, leverage))

    def _read_bool(key: str, default: bool) -> bool:
        raw = metadata.get(key)
        if raw is None:
            return default
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            return raw.strip().lower() in {"true", "1", "yes", "on", "enable", "enabled"}
        return bool(raw)

    # -- New params: 5m/15m CHG --
    chg_5m_min = _normalize_bounded_float(metadata.get("chg_5m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    chg_5m_max = _normalize_bounded_float(metadata.get("chg_5m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    chg_15m_min = _normalize_bounded_float(metadata.get("chg_15m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    chg_15m_max = _normalize_bounded_float(metadata.get("chg_15m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)

    chg_30m_min = _normalize_bounded_float(metadata.get("chg_30m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    chg_30m_max = _normalize_bounded_float(metadata.get("chg_30m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    chg_1h_min = _normalize_bounded_float(metadata.get("chg_1h_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    chg_1h_max = _normalize_bounded_float(metadata.get("chg_1h_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    chg_4h_min = _normalize_bounded_float(metadata.get("chg_4h_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    chg_4h_max = _normalize_bounded_float(metadata.get("chg_4h_max"), default_value=10.0, min_value=-100.0, max_value=100.0)

    dca_chg_5m_min = _normalize_bounded_float(metadata.get("dca_chg_5m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    dca_chg_5m_max = _normalize_bounded_float(metadata.get("dca_chg_5m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    dca_chg_15m_min = _normalize_bounded_float(metadata.get("dca_chg_15m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    dca_chg_15m_max = _normalize_bounded_float(metadata.get("dca_chg_15m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)

    dca_chg_30m_min = _normalize_bounded_float(metadata.get("dca_chg_30m_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    dca_chg_30m_max = _normalize_bounded_float(metadata.get("dca_chg_30m_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    dca_chg_1h_min = _normalize_bounded_float(metadata.get("dca_chg_1h_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    dca_chg_1h_max = _normalize_bounded_float(metadata.get("dca_chg_1h_max"), default_value=10.0, min_value=-100.0, max_value=100.0)
    dca_chg_4h_min = _normalize_bounded_float(metadata.get("dca_chg_4h_min"), default_value=-10.0, min_value=-100.0, max_value=100.0)
    dca_chg_4h_max = _normalize_bounded_float(metadata.get("dca_chg_4h_max"), default_value=10.0, min_value=-100.0, max_value=100.0)

    chg_5m_exit_buffer = _normalize_bounded_float(metadata.get("chg_5m_exit_buffer"), default_value=2.0, min_value=0.0, max_value=100.0)
    chg_15m_exit_buffer = _normalize_bounded_float(metadata.get("chg_15m_exit_buffer"), default_value=2.0, min_value=0.0, max_value=100.0)
    chg_30m_exit_buffer = _normalize_bounded_float(metadata.get("chg_30m_exit_buffer"), default_value=2.0, min_value=0.0, max_value=100.0)
    chg_1h_exit_buffer = _normalize_bounded_float(metadata.get("chg_1h_exit_buffer"), default_value=2.0, min_value=0.0, max_value=100.0)
    chg_4h_exit_buffer = _normalize_bounded_float(metadata.get("chg_4h_exit_buffer"), default_value=2.0, min_value=0.0, max_value=100.0)

    dca_reentry_min_profit = _normalize_bounded_float(metadata.get("dca_reentry_min_profit"), default_value=-0.15, min_value=-1.0, max_value=0.0)
    dca_reentry_max_drawdown = _normalize_bounded_float(metadata.get("dca_reentry_max_drawdown"), default_value=-0.5, min_value=-1.0, max_value=0.0)
    dca2_reentry_min_profit = _normalize_bounded_float(metadata.get("dca2_reentry_min_profit"), default_value=-0.30, min_value=-1.0, max_value=0.0)
    dca2_reentry_max_drawdown = _normalize_bounded_float(metadata.get("dca2_reentry_max_drawdown"), default_value=-0.5, min_value=-1.0, max_value=0.0)

    # Volatility guard
    dca_sudden_chg_threshold = _normalize_bounded_float(metadata.get("dca_sudden_chg_threshold"), default_value=5.0, min_value=0.0, max_value=100.0)

    # Stake ratios
    initial_entry_stake_ratio = _normalize_bounded_float(metadata.get("initial_entry_stake_ratio"), default_value=0.5, min_value=0.01, max_value=1.0)
    dca_entry_stake_ratio = _normalize_bounded_float(metadata.get("dca_entry_stake_ratio"), default_value=0.5, min_value=0.01, max_value=1.0)

    # Per-TF RSI thresholds
    def _read_rsi(key: str, default: float) -> float:
        return _normalize_bounded_float(metadata.get(key), default_value=default, min_value=0.0, max_value=100.0)

    # Telegram
    telegram_chg_min = _normalize_bounded_float(metadata.get("telegram_chg_min"), default_value=-5.0, min_value=-100.0, max_value=100.0)
    telegram_chg_max = _normalize_bounded_float(metadata.get("telegram_chg_max"), default_value=5.0, min_value=-100.0, max_value=100.0)

    # DCA orders / multiplier
    def _read_int(key: str, default: int, lo: int, hi: int) -> int:
        try:
            val = int(metadata.get(key) or default)
        except (TypeError, ValueError):
            val = default
        return max(lo, min(hi, val))

    return {
        "strategy_name": strategy_name,
        "trade_type": trade_type,
        "dca_mode": "Enable" if dca_enabled else "Disable",
        "dca_enabled": dca_enabled,
        "stake_amount": stake_amount,
        "max_open_order": max_open_order,
        "stoploss_pct": stoploss_pct,
        "dca_stoploss_pct": dca_stoploss_pct,
        "leverage": leverage,
        # DCA core
        "max_dca_multiplier": _read_int("max_dca_multiplier", 1, 0, 10),
        "max_dca_orders_open": _read_int("max_dca_orders_open", 2, 0, 10),
        "initial_entry_stake_ratio": initial_entry_stake_ratio,
        "dca_entry_stake_ratio": dca_entry_stake_ratio,
        "shift_lookback": _read_int("shift_lookback", 5, 1, 100),
        # Per-TF entry toggles
        "entry_5m_long_enabled": _read_bool("entry_5m_long_enabled", True),
        "entry_5m_shift_long_enabled": _read_bool("entry_5m_shift_long_enabled", True),
        "entry_5m_short_enabled": _read_bool("entry_5m_short_enabled", True),
        "entry_5m_shift_short_enabled": _read_bool("entry_5m_shift_short_enabled", True),
        "entry_15m_long_enabled": _read_bool("entry_15m_long_enabled", False),
        "entry_15m_shift_long_enabled": _read_bool("entry_15m_shift_long_enabled", False),
        "entry_15m_short_enabled": _read_bool("entry_15m_short_enabled", False),
        "entry_15m_shift_short_enabled": _read_bool("entry_15m_shift_short_enabled", False),
        "entry_30m_long_enabled": _read_bool("entry_30m_long_enabled", False),
        "entry_30m_shift_long_enabled": _read_bool("entry_30m_shift_long_enabled", False),
        "entry_30m_short_enabled": _read_bool("entry_30m_short_enabled", False),
        "entry_30m_shift_short_enabled": _read_bool("entry_30m_shift_short_enabled", False),
        "entry_1h_long_enabled": _read_bool("entry_1h_long_enabled", False),
        "entry_1h_shift_long_enabled": _read_bool("entry_1h_shift_long_enabled", False),
        "entry_1h_short_enabled": _read_bool("entry_1h_short_enabled", False),
        "entry_1h_shift_short_enabled": _read_bool("entry_1h_shift_short_enabled", False),
        "entry_4h_long_enabled": _read_bool("entry_4h_long_enabled", False),
        "entry_4h_shift_long_enabled": _read_bool("entry_4h_shift_long_enabled", False),
        "entry_4h_short_enabled": _read_bool("entry_4h_short_enabled", False),
        "entry_4h_shift_short_enabled": _read_bool("entry_4h_shift_short_enabled", False),
        # Per-TF RSI
        "entry_5m_rsi_long": _read_rsi("entry_5m_rsi_long", 30.0),
        "entry_5m_rsi_short": _read_rsi("entry_5m_rsi_short", 70.0),
        "entry_15m_rsi_long": _read_rsi("entry_15m_rsi_long", 30.0),
        "entry_15m_rsi_short": _read_rsi("entry_15m_rsi_short", 70.0),
        "entry_30m_rsi_long": _read_rsi("entry_30m_rsi_long", 30.0),
        "entry_30m_rsi_short": _read_rsi("entry_30m_rsi_short", 70.0),
        "entry_1h_rsi_long": _read_rsi("entry_1h_rsi_long", 30.0),
        "entry_1h_rsi_short": _read_rsi("entry_1h_rsi_short", 70.0),
        "entry_4h_rsi_long": _read_rsi("entry_4h_rsi_long", 30.0),
        "entry_4h_rsi_short": _read_rsi("entry_4h_rsi_short", 70.0),
        # Cross-TF RSI
        "entry_5m_rsi_long_15m": _read_rsi("entry_5m_rsi_long_15m", 30.0),
        "entry_5m_rsi_short_15m": _read_rsi("entry_5m_rsi_short_15m", 70.0),
        "entry_5m_rsi_long_30m": _read_rsi("entry_5m_rsi_long_30m", 40.0),
        "entry_5m_rsi_short_30m": _read_rsi("entry_5m_rsi_short_30m", 60.0),
        "entry_5m_rsi_long_1h": _read_rsi("entry_5m_rsi_long_1h", 40.0),
        "entry_5m_rsi_short_1h": _read_rsi("entry_5m_rsi_short_1h", 60.0),
        "entry_5m_rsi_long_4h": _read_rsi("entry_5m_rsi_long_4h", 40.0),
        "entry_5m_rsi_short_4h": _read_rsi("entry_5m_rsi_short_4h", 60.0),
        # CHG filters
        "use_chg_filter": _read_bool("use_chg_filter", True),
        "use_chg_exit_buffer": _read_bool("use_chg_exit_buffer", True),
        "chg_5m_enabled": _read_bool("chg_5m_enabled", True),
        "chg_5m_min": chg_5m_min,
        "chg_5m_max": chg_5m_max,
        "dca_chg_5m_min": dca_chg_5m_min,
        "dca_chg_5m_max": dca_chg_5m_max,
        "chg_5m_exit_buffer_enabled": _read_bool("chg_5m_exit_buffer_enabled", True),
        "chg_5m_exit_buffer": chg_5m_exit_buffer,
        "chg_15m_enabled": _read_bool("chg_15m_enabled", True),
        "chg_15m_min": chg_15m_min,
        "chg_15m_max": chg_15m_max,
        "dca_chg_15m_min": dca_chg_15m_min,
        "dca_chg_15m_max": dca_chg_15m_max,
        "chg_15m_exit_buffer_enabled": _read_bool("chg_15m_exit_buffer_enabled", True),
        "chg_15m_exit_buffer": chg_15m_exit_buffer,
        "chg_30m_enabled": _read_bool("chg_30m_enabled", True),
        "chg_30m_min": chg_30m_min,
        "chg_30m_max": chg_30m_max,
        "dca_chg_30m_min": dca_chg_30m_min,
        "dca_chg_30m_max": dca_chg_30m_max,
        "chg_30m_exit_buffer_enabled": _read_bool("chg_30m_exit_buffer_enabled", True),
        "chg_30m_exit_buffer": chg_30m_exit_buffer,
        "chg_1h_enabled": _read_bool("chg_1h_enabled", True),
        "chg_1h_min": chg_1h_min,
        "chg_1h_max": chg_1h_max,
        "dca_chg_1h_min": dca_chg_1h_min,
        "dca_chg_1h_max": dca_chg_1h_max,
        "chg_1h_exit_buffer_enabled": _read_bool("chg_1h_exit_buffer_enabled", True),
        "chg_1h_exit_buffer": chg_1h_exit_buffer,
        "chg_4h_enabled": _read_bool("chg_4h_enabled", True),
        "chg_4h_min": chg_4h_min,
        "chg_4h_max": chg_4h_max,
        "dca_chg_4h_min": dca_chg_4h_min,
        "dca_chg_4h_max": dca_chg_4h_max,
        "chg_4h_exit_buffer_enabled": _read_bool("chg_4h_exit_buffer_enabled", True),
        "chg_4h_exit_buffer": chg_4h_exit_buffer,
        # DCA re-entry
        "dca_reentry_min_profit": dca_reentry_min_profit,
        "dca_reentry_max_drawdown": dca_reentry_max_drawdown,
        "dca2_reentry_min_profit": dca2_reentry_min_profit,
        "dca2_reentry_max_drawdown": dca2_reentry_max_drawdown,
        # Volatility guard
        "dca_sudden_chg_guard_enabled": _read_bool("dca_sudden_chg_guard_enabled", True),
        "dca_sudden_chg_threshold": dca_sudden_chg_threshold,
        "dca_sudden_chg_lookback": _read_int("dca_sudden_chg_lookback", 10, 1, 100),
        # Telegram alerts
        "telegram_chg_alert_enabled": _read_bool("telegram_chg_alert_enabled", True),
        "telegram_chg_min": telegram_chg_min,
        "telegram_chg_max": telegram_chg_max,
    }


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

    # Check admin-uploaded strategy templates in storage first
    if safe_name:
        storage_path = _FT_STRATEGY_DIR / f"{safe_name}.py"
        if storage_path.is_file():
            try:
                return storage_path.read_text(encoding="utf-8")
            except OSError:
                pass

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


def _upsert_strategy_class_attr(strategy_code: str, attr_name: str, value_expr: str) -> str:
    normalized = strategy_code if strategy_code.endswith("\n") else f"{strategy_code}\n"
    attr_pattern = rf"(?m)^\s*{re.escape(attr_name)}\s*=.*$"
    attr_line = f"    {attr_name} = {value_expr}"

    if re.search(attr_pattern, normalized):
        return re.sub(attr_pattern, attr_line, normalized, count=1)

    class_match = re.search(r"(?m)^class\s+[A-Za-z_][A-Za-z0-9_]*\(IStrategy\):\s*$", normalized)
    if class_match:
        insert_at = class_match.end()
        return f"{normalized[:insert_at]}\n{attr_line}{normalized[insert_at:]}"

    return f"{attr_line}\n{normalized}"


def _apply_strategy_runtime_settings(
    strategy_code: str,
    *,
    dca_enabled: bool,
    stoploss_value: float,
    dca_stoploss_value: float,
    leverage_value: float,
    # DCA core
    max_dca_multiplier: int,
    max_dca_orders_open: int,
    initial_entry_stake_ratio: float,
    dca_entry_stake_ratio: float,
    shift_lookback: int,
    # Per-TF entry toggles
    entry_5m_long_enabled: bool,
    entry_5m_shift_long_enabled: bool,
    entry_5m_short_enabled: bool,
    entry_5m_shift_short_enabled: bool,
    entry_15m_long_enabled: bool,
    entry_15m_shift_long_enabled: bool,
    entry_15m_short_enabled: bool,
    entry_15m_shift_short_enabled: bool,
    entry_30m_long_enabled: bool,
    entry_30m_shift_long_enabled: bool,
    entry_30m_short_enabled: bool,
    entry_30m_shift_short_enabled: bool,
    entry_1h_long_enabled: bool,
    entry_1h_shift_long_enabled: bool,
    entry_1h_short_enabled: bool,
    entry_1h_shift_short_enabled: bool,
    entry_4h_long_enabled: bool,
    entry_4h_shift_long_enabled: bool,
    entry_4h_short_enabled: bool,
    entry_4h_shift_short_enabled: bool,
    # Per-TF RSI
    entry_5m_rsi_long: float,
    entry_5m_rsi_short: float,
    entry_15m_rsi_long: float,
    entry_15m_rsi_short: float,
    entry_30m_rsi_long: float,
    entry_30m_rsi_short: float,
    entry_1h_rsi_long: float,
    entry_1h_rsi_short: float,
    entry_4h_rsi_long: float,
    entry_4h_rsi_short: float,
    # Cross-TF RSI
    entry_5m_rsi_long_15m: float,
    entry_5m_rsi_short_15m: float,
    entry_5m_rsi_long_30m: float,
    entry_5m_rsi_short_30m: float,
    entry_5m_rsi_long_1h: float,
    entry_5m_rsi_short_1h: float,
    entry_5m_rsi_long_4h: float,
    entry_5m_rsi_short_4h: float,
    # CHG filter
    use_chg_filter: bool,
    use_chg_exit_buffer: bool,
    chg_5m_enabled: bool,
    chg_5m_min: float,
    chg_5m_max: float,
    dca_chg_5m_min: float,
    dca_chg_5m_max: float,
    chg_5m_exit_buffer_enabled: bool,
    chg_5m_exit_buffer: float,
    chg_15m_enabled: bool,
    chg_15m_min: float,
    chg_15m_max: float,
    dca_chg_15m_min: float,
    dca_chg_15m_max: float,
    chg_15m_exit_buffer_enabled: bool,
    chg_15m_exit_buffer: float,
    chg_30m_enabled: bool,
    chg_30m_min: float,
    chg_30m_max: float,
    dca_chg_30m_min: float,
    dca_chg_30m_max: float,
    chg_30m_exit_buffer_enabled: bool,
    chg_30m_exit_buffer: float,
    chg_1h_enabled: bool,
    chg_1h_min: float,
    chg_1h_max: float,
    dca_chg_1h_min: float,
    dca_chg_1h_max: float,
    chg_1h_exit_buffer_enabled: bool,
    chg_1h_exit_buffer: float,
    chg_4h_enabled: bool,
    chg_4h_min: float,
    chg_4h_max: float,
    dca_chg_4h_min: float,
    dca_chg_4h_max: float,
    chg_4h_exit_buffer_enabled: bool,
    chg_4h_exit_buffer: float,
    # DCA re-entry
    dca_reentry_min_profit: float,
    dca_reentry_max_drawdown: float,
    dca2_reentry_min_profit: float,
    dca2_reentry_max_drawdown: float,
    # Volatility guard
    dca_sudden_chg_guard_enabled: bool,
    dca_sudden_chg_threshold: float,
    dca_sudden_chg_lookback: int,
    # Telegram
    telegram_chg_alert_enabled: bool,
    telegram_chg_min: float,
    telegram_chg_max: float,
) -> str:
    updated = _apply_strategy_dca_mode(strategy_code, dca_enabled=dca_enabled)

    def _fmt(value: float) -> str:
        return f"{value:.6f}".rstrip("0").rstrip(".")

    def _bool(value: bool) -> str:
        return "True" if value else "False"

    updated = _upsert_strategy_class_attr(updated, "stoploss", _fmt(stoploss_value))
    updated = _upsert_strategy_class_attr(updated, "dca_stoploss", _fmt(dca_stoploss_value))
    updated = _upsert_strategy_class_attr(updated, "leverage_value", _fmt(leverage_value))

    # DCA core
    updated = _upsert_strategy_class_attr(updated, "max_entry_position_adjustment", str(max_dca_multiplier + 1))
    updated = _upsert_strategy_class_attr(updated, "max_dca_multiplier", str(max_dca_multiplier))
    updated = _upsert_strategy_class_attr(updated, "max_dca_orders_open", str(max_dca_orders_open))
    updated = _upsert_strategy_class_attr(updated, "initial_entry_stake_ratio", _fmt(initial_entry_stake_ratio))
    updated = _upsert_strategy_class_attr(updated, "dca_entry_stake_ratio", _fmt(dca_entry_stake_ratio))
    updated = _upsert_strategy_class_attr(updated, "shift_lookback", str(shift_lookback))

    # Per-TF entry toggles
    for tf in ("5m", "15m", "30m", "1h", "4h"):
        for sig in ("long", "shift_long", "short", "shift_short"):
            key = f"entry_{tf}_{sig}_enabled"
            updated = _upsert_strategy_class_attr(updated, key, _bool(locals()[key]))

    # Per-TF RSI
    for tf in ("5m", "15m", "30m", "1h", "4h"):
        for side in ("long", "short"):
            key = f"entry_{tf}_rsi_{side}"
            updated = _upsert_strategy_class_attr(updated, key, _fmt(locals()[key]))

    # Cross-TF RSI
    for htf in ("15m", "30m", "1h", "4h"):
        for side in ("long", "short"):
            key = f"entry_5m_rsi_{side}_{htf}"
            updated = _upsert_strategy_class_attr(updated, key, _fmt(locals()[key]))

    # CHG filter globals
    updated = _upsert_strategy_class_attr(updated, "use_chg_filter", _bool(use_chg_filter))
    updated = _upsert_strategy_class_attr(updated, "use_chg_exit_buffer", _bool(use_chg_exit_buffer))

    # Per-TF CHG
    for tf in ("5m", "15m", "30m", "1h", "4h"):
        updated = _upsert_strategy_class_attr(updated, f"chg_{tf}_enabled", _bool(locals()[f"chg_{tf}_enabled"]))
        updated = _upsert_strategy_class_attr(updated, f"chg_{tf}_min", _fmt(locals()[f"chg_{tf}_min"]))
        updated = _upsert_strategy_class_attr(updated, f"chg_{tf}_max", _fmt(locals()[f"chg_{tf}_max"]))
        updated = _upsert_strategy_class_attr(updated, f"dca_chg_{tf}_min", _fmt(locals()[f"dca_chg_{tf}_min"]))
        updated = _upsert_strategy_class_attr(updated, f"dca_chg_{tf}_max", _fmt(locals()[f"dca_chg_{tf}_max"]))
        updated = _upsert_strategy_class_attr(updated, f"chg_{tf}_exit_buffer_enabled", _bool(locals()[f"chg_{tf}_exit_buffer_enabled"]))
        updated = _upsert_strategy_class_attr(updated, f"chg_{tf}_exit_buffer", _fmt(locals()[f"chg_{tf}_exit_buffer"]))

    # DCA re-entry
    updated = _upsert_strategy_class_attr(updated, "dca_reentry_min_profit", _fmt(dca_reentry_min_profit))
    updated = _upsert_strategy_class_attr(updated, "dca_reentry_max_drawdown", _fmt(dca_reentry_max_drawdown))
    updated = _upsert_strategy_class_attr(updated, "dca2_reentry_min_profit", _fmt(dca2_reentry_min_profit))
    updated = _upsert_strategy_class_attr(updated, "dca2_reentry_max_drawdown", _fmt(dca2_reentry_max_drawdown))

    # Volatility guard
    updated = _upsert_strategy_class_attr(updated, "dca_sudden_chg_guard_enabled", _bool(dca_sudden_chg_guard_enabled))
    updated = _upsert_strategy_class_attr(updated, "dca_sudden_chg_threshold", _fmt(dca_sudden_chg_threshold))
    updated = _upsert_strategy_class_attr(updated, "dca_sudden_chg_lookback", str(dca_sudden_chg_lookback))

    # Telegram
    updated = _upsert_strategy_class_attr(updated, "telegram_chg_alert_enabled", _bool(telegram_chg_alert_enabled))
    updated = _upsert_strategy_class_attr(updated, "telegram_chg_min", _fmt(telegram_chg_min))
    updated = _upsert_strategy_class_attr(updated, "telegram_chg_max", _fmt(telegram_chg_max))

    updated = re.sub(
        r"(?m)^\s*return\s+max\(min\(5\.0,\s*max_leverage\),\s*1\.0\)\s*$",
        "        return max(min(self.leverage_value, max_leverage), 1.0)",
        updated,
        count=1,
    )
    updated = re.sub(
        r"stoploss_from_open\(-0\.5\s*,\s*current_profit\)",
        "stoploss_from_open(self.dca_stoploss, current_profit)",
        updated,
    )

    return updated


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
    stoploss_value: float,
    dca_stoploss_value: float,
    leverage_value: float,
    # DCA core
    max_dca_multiplier: int,
    max_dca_orders_open: int,
    initial_entry_stake_ratio: float,
    dca_entry_stake_ratio: float,
    shift_lookback: int,
    # Per-TF entry toggles
    entry_5m_long_enabled: bool,
    entry_5m_shift_long_enabled: bool,
    entry_5m_short_enabled: bool,
    entry_5m_shift_short_enabled: bool,
    entry_15m_long_enabled: bool,
    entry_15m_shift_long_enabled: bool,
    entry_15m_short_enabled: bool,
    entry_15m_shift_short_enabled: bool,
    entry_30m_long_enabled: bool,
    entry_30m_shift_long_enabled: bool,
    entry_30m_short_enabled: bool,
    entry_30m_shift_short_enabled: bool,
    entry_1h_long_enabled: bool,
    entry_1h_shift_long_enabled: bool,
    entry_1h_short_enabled: bool,
    entry_1h_shift_short_enabled: bool,
    entry_4h_long_enabled: bool,
    entry_4h_shift_long_enabled: bool,
    entry_4h_short_enabled: bool,
    entry_4h_shift_short_enabled: bool,
    # Per-TF RSI
    entry_5m_rsi_long: float,
    entry_5m_rsi_short: float,
    entry_15m_rsi_long: float,
    entry_15m_rsi_short: float,
    entry_30m_rsi_long: float,
    entry_30m_rsi_short: float,
    entry_1h_rsi_long: float,
    entry_1h_rsi_short: float,
    entry_4h_rsi_long: float,
    entry_4h_rsi_short: float,
    # Cross-TF RSI
    entry_5m_rsi_long_15m: float,
    entry_5m_rsi_short_15m: float,
    entry_5m_rsi_long_30m: float,
    entry_5m_rsi_short_30m: float,
    entry_5m_rsi_long_1h: float,
    entry_5m_rsi_short_1h: float,
    entry_5m_rsi_long_4h: float,
    entry_5m_rsi_short_4h: float,
    # CHG filter
    use_chg_filter: bool,
    use_chg_exit_buffer: bool,
    chg_5m_enabled: bool,
    chg_5m_min: float,
    chg_5m_max: float,
    dca_chg_5m_min: float,
    dca_chg_5m_max: float,
    chg_5m_exit_buffer_enabled: bool,
    chg_5m_exit_buffer: float,
    chg_15m_enabled: bool,
    chg_15m_min: float,
    chg_15m_max: float,
    dca_chg_15m_min: float,
    dca_chg_15m_max: float,
    chg_15m_exit_buffer_enabled: bool,
    chg_15m_exit_buffer: float,
    chg_30m_enabled: bool,
    chg_30m_min: float,
    chg_30m_max: float,
    dca_chg_30m_min: float,
    dca_chg_30m_max: float,
    chg_30m_exit_buffer_enabled: bool,
    chg_30m_exit_buffer: float,
    chg_1h_enabled: bool,
    chg_1h_min: float,
    chg_1h_max: float,
    dca_chg_1h_min: float,
    dca_chg_1h_max: float,
    chg_1h_exit_buffer_enabled: bool,
    chg_1h_exit_buffer: float,
    chg_4h_enabled: bool,
    chg_4h_min: float,
    chg_4h_max: float,
    dca_chg_4h_min: float,
    dca_chg_4h_max: float,
    chg_4h_exit_buffer_enabled: bool,
    chg_4h_exit_buffer: float,
    # DCA re-entry
    dca_reentry_min_profit: float,
    dca_reentry_max_drawdown: float,
    dca2_reentry_min_profit: float,
    dca2_reentry_max_drawdown: float,
    # Volatility guard
    dca_sudden_chg_guard_enabled: bool,
    dca_sudden_chg_threshold: float,
    dca_sudden_chg_lookback: int,
    # Telegram
    telegram_chg_alert_enabled: bool,
    telegram_chg_min: float,
    telegram_chg_max: float,
    reset_user_data: bool = False,
) -> dict[str, Any]:
    deploy_dir = str(settings.freqtrade_deploy_dir or "/opt/botprimex-freqtrade").strip() or "/opt/botprimex-freqtrade"
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

    # Persist config to DB for future apply-to-bots merging
    try:
        from .database import save_bot_config as _save_cfg
        _save_cfg(bot_id, config_payload)
    except Exception:
        pass  # Non-critical, don't block deployment

    raw_strategy = strategy_code.strip() if isinstance(strategy_code, str) and strategy_code.strip() else _default_strategy_code(strategy)
    strategy_payload = _apply_strategy_runtime_settings(
        raw_strategy,
        dca_enabled=dca_enabled,
        stoploss_value=stoploss_value,
        dca_stoploss_value=dca_stoploss_value,
        leverage_value=leverage_value,
        max_dca_multiplier=max_dca_multiplier,
        max_dca_orders_open=max_dca_orders_open,
        initial_entry_stake_ratio=initial_entry_stake_ratio,
        dca_entry_stake_ratio=dca_entry_stake_ratio,
        shift_lookback=shift_lookback,
        entry_5m_long_enabled=entry_5m_long_enabled,
        entry_5m_shift_long_enabled=entry_5m_shift_long_enabled,
        entry_5m_short_enabled=entry_5m_short_enabled,
        entry_5m_shift_short_enabled=entry_5m_shift_short_enabled,
        entry_15m_long_enabled=entry_15m_long_enabled,
        entry_15m_shift_long_enabled=entry_15m_shift_long_enabled,
        entry_15m_short_enabled=entry_15m_short_enabled,
        entry_15m_shift_short_enabled=entry_15m_shift_short_enabled,
        entry_30m_long_enabled=entry_30m_long_enabled,
        entry_30m_shift_long_enabled=entry_30m_shift_long_enabled,
        entry_30m_short_enabled=entry_30m_short_enabled,
        entry_30m_shift_short_enabled=entry_30m_shift_short_enabled,
        entry_1h_long_enabled=entry_1h_long_enabled,
        entry_1h_shift_long_enabled=entry_1h_shift_long_enabled,
        entry_1h_short_enabled=entry_1h_short_enabled,
        entry_1h_shift_short_enabled=entry_1h_shift_short_enabled,
        entry_4h_long_enabled=entry_4h_long_enabled,
        entry_4h_shift_long_enabled=entry_4h_shift_long_enabled,
        entry_4h_short_enabled=entry_4h_short_enabled,
        entry_4h_shift_short_enabled=entry_4h_shift_short_enabled,
        entry_5m_rsi_long=entry_5m_rsi_long,
        entry_5m_rsi_short=entry_5m_rsi_short,
        entry_15m_rsi_long=entry_15m_rsi_long,
        entry_15m_rsi_short=entry_15m_rsi_short,
        entry_30m_rsi_long=entry_30m_rsi_long,
        entry_30m_rsi_short=entry_30m_rsi_short,
        entry_1h_rsi_long=entry_1h_rsi_long,
        entry_1h_rsi_short=entry_1h_rsi_short,
        entry_4h_rsi_long=entry_4h_rsi_long,
        entry_4h_rsi_short=entry_4h_rsi_short,
        entry_5m_rsi_long_15m=entry_5m_rsi_long_15m,
        entry_5m_rsi_short_15m=entry_5m_rsi_short_15m,
        entry_5m_rsi_long_30m=entry_5m_rsi_long_30m,
        entry_5m_rsi_short_30m=entry_5m_rsi_short_30m,
        entry_5m_rsi_long_1h=entry_5m_rsi_long_1h,
        entry_5m_rsi_short_1h=entry_5m_rsi_short_1h,
        entry_5m_rsi_long_4h=entry_5m_rsi_long_4h,
        entry_5m_rsi_short_4h=entry_5m_rsi_short_4h,
        use_chg_filter=use_chg_filter,
        use_chg_exit_buffer=use_chg_exit_buffer,
        chg_5m_enabled=chg_5m_enabled,
        chg_5m_min=chg_5m_min,
        chg_5m_max=chg_5m_max,
        dca_chg_5m_min=dca_chg_5m_min,
        dca_chg_5m_max=dca_chg_5m_max,
        chg_5m_exit_buffer_enabled=chg_5m_exit_buffer_enabled,
        chg_5m_exit_buffer=chg_5m_exit_buffer,
        chg_15m_enabled=chg_15m_enabled,
        chg_15m_min=chg_15m_min,
        chg_15m_max=chg_15m_max,
        dca_chg_15m_min=dca_chg_15m_min,
        dca_chg_15m_max=dca_chg_15m_max,
        chg_15m_exit_buffer_enabled=chg_15m_exit_buffer_enabled,
        chg_15m_exit_buffer=chg_15m_exit_buffer,
        chg_30m_enabled=chg_30m_enabled,
        chg_30m_min=chg_30m_min,
        chg_30m_max=chg_30m_max,
        dca_chg_30m_min=dca_chg_30m_min,
        dca_chg_30m_max=dca_chg_30m_max,
        chg_30m_exit_buffer_enabled=chg_30m_exit_buffer_enabled,
        chg_30m_exit_buffer=chg_30m_exit_buffer,
        chg_1h_enabled=chg_1h_enabled,
        chg_1h_min=chg_1h_min,
        chg_1h_max=chg_1h_max,
        dca_chg_1h_min=dca_chg_1h_min,
        dca_chg_1h_max=dca_chg_1h_max,
        chg_1h_exit_buffer_enabled=chg_1h_exit_buffer_enabled,
        chg_1h_exit_buffer=chg_1h_exit_buffer,
        chg_4h_enabled=chg_4h_enabled,
        chg_4h_min=chg_4h_min,
        chg_4h_max=chg_4h_max,
        dca_chg_4h_min=dca_chg_4h_min,
        dca_chg_4h_max=dca_chg_4h_max,
        chg_4h_exit_buffer_enabled=chg_4h_exit_buffer_enabled,
        chg_4h_exit_buffer=chg_4h_exit_buffer,
        dca_reentry_min_profit=dca_reentry_min_profit,
        dca_reentry_max_drawdown=dca_reentry_max_drawdown,
        dca2_reentry_min_profit=dca2_reentry_min_profit,
        dca2_reentry_max_drawdown=dca2_reentry_max_drawdown,
        dca_sudden_chg_guard_enabled=dca_sudden_chg_guard_enabled,
        dca_sudden_chg_threshold=dca_sudden_chg_threshold,
        dca_sudden_chg_lookback=dca_sudden_chg_lookback,
        telegram_chg_alert_enabled=telegram_chg_alert_enabled,
        telegram_chg_min=telegram_chg_min,
        telegram_chg_max=telegram_chg_max,
    )

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
        _run_remote_command(server_ip, f"cd {shlex.quote(deploy_dir)} && docker compose pull && docker compose up -d --force-recreate", timeout=600)
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
    client_id = _get_deploy_setting("google_client_id") or settings.google_client_id.strip()
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


# ─── NOWPayments helpers ─────────────────────────────────────────────────────

def _get_nowpayments_config() -> dict[str, str]:
    """Read NOWPayments config from deploy_settings DB, falling back to env settings."""
    from .database import get_deploy_settings as _get_ds
    db = _get_ds()
    return {
        "api_key": str(db.get("nowpayments_api_key") or settings.nowpayments_api_key or "").strip(),
        "ipn_secret": str(db.get("nowpayments_ipn_secret") or settings.nowpayments_ipn_secret or "").strip(),
        "sandbox": str(db.get("nowpayments_sandbox") or settings.nowpayments_sandbox or "").strip().lower() in ("true", "1", "yes"),
    }


def _nowpayments_base_url() -> str:
    cfg = _get_nowpayments_config()
    if cfg["sandbox"]:
        return "https://api-sandbox.nowpayments.io/v1"
    return "https://api.nowpayments.io/v1"


def _nowpayments_api_request(method: str, path: str, body: dict | None = None) -> dict:
    cfg = _get_nowpayments_config()
    api_key = cfg["api_key"]
    if not api_key:
        raise HTTPException(status_code=503, detail="NOWPayments API key not configured")
    sandbox = cfg["sandbox"]
    base = "https://api-sandbox.nowpayments.io/v1" if sandbox else "https://api.nowpayments.io/v1"
    url = f"{base}{path}"
    data = json.dumps(body).encode() if body else None
    req = URLRequest(url, data=data, method=method)
    req.add_header("x-api-key", api_key)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "BotPrimeX/1.0")
    req.add_header("Accept", "application/json")
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as exc:
        detail = exc.read().decode() if exc.fp else str(exc)
        raise HTTPException(status_code=exc.code or 502, detail=f"NOWPayments error: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"NOWPayments unreachable: {exc}") from exc


def _verify_nowpayments_signature(body_bytes: bytes, sig_header: str) -> bool:
    cfg = _get_nowpayments_config()
    ipn_secret = cfg["ipn_secret"]
    if not ipn_secret:
        return False
    try:
        body_dict = json.loads(body_bytes)
    except (json.JSONDecodeError, ValueError):
        return False
    sorted_body = json.dumps(body_dict, sort_keys=True, separators=(",", ":"))
    expected = hmac.new(ipn_secret.encode(), sorted_body.encode(), hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, sig_header)


# ─── NOWPayments endpoints ───────────────────────────────────────────────────

@app.post("/payments/create-invoice")
def create_nowpayments_invoice(payload: CreateInvoicePayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    if payload.price_amount <= 0:
        raise HTTPException(status_code=400, detail="Price must be greater than 0")

    order_id = f"bpx-{uuid4().hex[:12]}"
    public_url = str(settings.public_base_url).rstrip("/")

    invoice_body = {
        "price_amount": payload.price_amount,
        "price_currency": "usd",
        "order_id": order_id,
        "order_description": payload.order_description,
        "ipn_callback_url": f"{public_url}/payments/nowpayments-ipn",
        "success_url": f"{str(settings.frontend_url).rstrip('/')}/new-bot?payment=success&order_id={order_id}",
        "cancel_url": f"{str(settings.frontend_url).rstrip('/')}/new-bot?payment=cancelled",
    }

    result = _nowpayments_api_request("POST", "/invoice", invoice_body)
    return {
        "invoice_url": result.get("invoice_url"),
        "invoice_id": result.get("id"),
        "order_id": order_id,
    }


@app.get("/payments/status/{payment_id}")
def get_nowpayments_status(payment_id: str) -> dict[str, Any]:
    result = _nowpayments_api_request("GET", f"/payment/{payment_id}")
    return {
        "payment_id": result.get("payment_id"),
        "payment_status": result.get("payment_status"),
        "pay_amount": result.get("pay_amount"),
        "pay_currency": result.get("pay_currency"),
        "order_id": result.get("order_id"),
        "price_amount": result.get("price_amount"),
        "price_currency": result.get("price_currency"),
        "actually_paid": result.get("actually_paid"),
    }


@app.get("/payments/invoice-status/{invoice_id}")
def get_nowpayments_invoice_status(invoice_id: str) -> dict[str, Any]:
    """Check if an invoice has been paid by listing its payments."""
    try:
        result = _nowpayments_api_request("GET", f"/invoice-payment/{invoice_id}")
    except HTTPException:
        return {"paid": False, "payment_status": "waiting", "payment_id": None}
    # result is a list of payment objects or has a "result" key with the list
    payments = result if isinstance(result, list) else result.get("result", [])
    if not isinstance(payments, list):
        payments = []
    for p in payments:
        status = str(p.get("payment_status", "")).lower()
        if status in ("finished", "confirmed", "sending", "partially_paid"):
            return {
                "paid": status in ("finished", "confirmed"),
                "payment_status": status,
                "payment_id": str(p.get("payment_id", "")),
                "actually_paid": p.get("actually_paid"),
            }
    return {"paid": False, "payment_status": "waiting", "payment_id": None}


@app.post("/payments/nowpayments-ipn")
async def nowpayments_ipn_webhook(request: Request) -> dict[str, bool]:
    body_bytes = await request.body()
    sig_header = request.headers.get("x-nowpayments-sig", "")

    if not _verify_nowpayments_signature(body_bytes, sig_header):
        raise HTTPException(status_code=403, detail="Invalid IPN signature")

    try:
        data = json.loads(body_bytes)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    payment_status = str(data.get("payment_status", "")).strip().lower()
    order_id = str(data.get("order_id", "")).strip()
    payment_id = str(data.get("payment_id", "")).strip()

    logger.info("NOWPayments IPN: order_id=%s payment_id=%s status=%s", order_id, payment_id, payment_status)

    if payment_status in ("finished", "confirmed") and order_id:
        try:
            from app.database import get_pg_connection
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE bot_accounts
                        SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s::jsonb
                        WHERE metadata_json->>'nowpayments_order_id' = %s
                        """,
                        (json.dumps({
                            "payment_status": "paid",
                            "nowpayments_payment_id": payment_id,
                            "nowpayments_payment_status": payment_status,
                        }), order_id),
                    )
                conn.commit()
        except Exception:
            logger.exception("Failed to update bot payment status via IPN for order %s", order_id)

    return {"success": True}


@app.post("/subscriptions/complete")
def complete_subscription(payload: SubscriptionCompletePayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    # ── Payment verification ──
    nowpayments_order_id: str | None = None
    nowpayments_payment_id: str | None = None

    if payload.payment_id:
        # Verify via NOWPayments API
        try:
            np_status = _nowpayments_api_request("GET", f"/payment/{payload.payment_id}")
        except HTTPException:
            raise HTTPException(status_code=402, detail="Unable to verify payment with NOWPayments")
        np_payment_status = str(np_status.get("payment_status", "")).strip().lower()
        if np_payment_status not in ("finished", "confirmed", "sending"):
            raise HTTPException(status_code=402, detail=f"Payment not completed (status: {np_payment_status})")
        nowpayments_order_id = str(np_status.get("order_id", "")).strip() or None
        nowpayments_payment_id = str(np_status.get("payment_id", payload.payment_id)).strip()
    else:
        # Legacy / admin bypass: trust payment_status field
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
    strategy_name = re.sub(r"[^A-Za-z0-9_]", "", str(payload.strategy_name or "").strip() or "BotPrimeX")
    if not strategy_name:
        strategy_name = "BotPrimeX"
    dca_mode = str(payload.dca_mode or "Disable").strip() or "Disable"
    dca_enabled = _is_dca_enabled(dca_mode)

    stake_amount: float | None = None
    if trade_type == "fixed":
        parsed_stake = float(payload.stake_amount) if payload.stake_amount is not None else 50.0
        if parsed_stake <= 0:
            raise HTTPException(status_code=400, detail="Stake amount must be greater than 0 for Fixed trade type")
        stake_amount = parsed_stake

    max_open_order = int(payload.max_open_order if payload.max_open_order is not None else 15)
    max_open_order = max(1, min(100, max_open_order))

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
                "nowpayments_order_id": nowpayments_order_id,
                "nowpayments_payment_id": nowpayments_payment_id,
                "account_type": account_type,
                "trade_type": trade_type,
                "strategy_name": strategy_name,
                "dca_mode": "Enable" if dca_enabled else "Disable",
                "dca_enabled": dca_enabled,
                "stake_amount": stake_amount,
                "max_open_order": max_open_order,
                "stoploss_pct": -99,
                "dca_stoploss_pct": -50,
                "leverage": 5,
                # DCA core
                "max_dca_multiplier": 1,
                "max_dca_orders_open": 2,
                "initial_entry_stake_ratio": 0.5,
                "dca_entry_stake_ratio": 0.5,
                "shift_lookback": 5,
                # Per-TF entry toggles
                "entry_5m_long_enabled": True,
                "entry_5m_shift_long_enabled": True,
                "entry_5m_short_enabled": True,
                "entry_5m_shift_short_enabled": True,
                "entry_15m_long_enabled": False,
                "entry_15m_shift_long_enabled": False,
                "entry_15m_short_enabled": False,
                "entry_15m_shift_short_enabled": False,
                "entry_30m_long_enabled": False,
                "entry_30m_shift_long_enabled": False,
                "entry_30m_short_enabled": False,
                "entry_30m_shift_short_enabled": False,
                "entry_1h_long_enabled": False,
                "entry_1h_shift_long_enabled": False,
                "entry_1h_short_enabled": False,
                "entry_1h_shift_short_enabled": False,
                "entry_4h_long_enabled": False,
                "entry_4h_shift_long_enabled": False,
                "entry_4h_short_enabled": False,
                "entry_4h_shift_short_enabled": False,
                # Per-TF RSI
                "entry_5m_rsi_long": 30, "entry_5m_rsi_short": 70,
                "entry_15m_rsi_long": 30, "entry_15m_rsi_short": 70,
                "entry_30m_rsi_long": 30, "entry_30m_rsi_short": 70,
                "entry_1h_rsi_long": 30, "entry_1h_rsi_short": 70,
                "entry_4h_rsi_long": 30, "entry_4h_rsi_short": 70,
                # Cross-TF RSI
                "entry_5m_rsi_long_15m": 30, "entry_5m_rsi_short_15m": 70,
                "entry_5m_rsi_long_30m": 40, "entry_5m_rsi_short_30m": 60,
                "entry_5m_rsi_long_1h": 40, "entry_5m_rsi_short_1h": 60,
                "entry_5m_rsi_long_4h": 40, "entry_5m_rsi_short_4h": 60,
                # CHG filter
                "use_chg_filter": True,
                "use_chg_exit_buffer": True,
                **{f"chg_{tf}_enabled": True for tf in ("5m", "15m", "30m", "1h", "4h")},
                **{f"chg_{tf}_{k}": v for tf in ("5m", "15m", "30m", "1h", "4h") for k, v in (("min", -10.0), ("max", 10.0))},
                **{f"dca_chg_{tf}_{k}": v for tf in ("5m", "15m", "30m", "1h", "4h") for k, v in (("min", -10.0), ("max", 10.0))},
                **{f"chg_{tf}_exit_buffer_enabled": True for tf in ("5m", "15m", "30m", "1h", "4h")},
                **{f"chg_{tf}_exit_buffer": 2.0 for tf in ("5m", "15m", "30m", "1h", "4h")},
                # DCA re-entry
                "dca_reentry_min_profit": -0.15,
                "dca_reentry_max_drawdown": -0.5,
                "dca2_reentry_min_profit": -0.30,
                "dca2_reentry_max_drawdown": -0.5,
                # Volatility guard
                "dca_sudden_chg_guard_enabled": True,
                "dca_sudden_chg_threshold": 5.0,
                "dca_sudden_chg_lookback": 10,
                # Telegram
                "telegram_chg_alert_enabled": True,
                "telegram_chg_min": -5.0,
                "telegram_chg_max": 5.0,
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

    _cleanup_legacy_strategy_settings_for_bot(user["id"], bot_id)
    bot_row = get_user_purchased_bot_account(user["id"], bot_id) or bot_row

    metadata = _setup_metadata(bot_row)
    server_ip = str(metadata.get("setup_server_ip") or "").strip()
    if not server_ip:
        raise HTTPException(status_code=400, detail="Server IP not found. Complete server creation first")

    exchange_key = _normalize_exchange_key(str(bot_row.get("exchange") or ""))
    if exchange_key not in {"binance_futures", "bybit_futures"}:
        raise HTTPException(status_code=400, detail="Unsupported exchange for deployment")

    account_type = _normalize_account_type(str(metadata.get("account_type") or "real"))
    strategy_settings = _normalize_strategy_settings(bot_row)
    preferred_strategy_name = str(strategy_settings.get("strategy_name") or "").strip() or "BotPrimeX"
    requested_strategy_name = str(payload.strategy_name or "").strip() or preferred_strategy_name
    trade_type = str(strategy_settings["trade_type"])
    dca_enabled = bool(strategy_settings["dca_enabled"])
    capital_usdt = float(bot_row.get("capital_usdt") or 0)

    stake_amount_value = float(strategy_settings["stake_amount"])
    stake_amount = f"{stake_amount_value:g}" if trade_type == "fixed" else "unlimited"
    max_open_trades = int(strategy_settings["max_open_order"])
    stoploss_value = float(strategy_settings["stoploss_pct"]) / 100.0
    dca_stoploss_value = float(strategy_settings["dca_stoploss_pct"]) / 100.0
    leverage_value = float(strategy_settings["leverage"])

    # Extract all strategy runtime params from normalized settings
    _ss = strategy_settings  # shorthand
    deploy_strategy_kwargs = dict(
        # DCA core
        max_dca_multiplier=int(_ss["max_dca_multiplier"]),
        max_dca_orders_open=int(_ss["max_dca_orders_open"]),
        initial_entry_stake_ratio=float(_ss["initial_entry_stake_ratio"]),
        dca_entry_stake_ratio=float(_ss["dca_entry_stake_ratio"]),
        shift_lookback=int(_ss["shift_lookback"]),
        # Per-TF entry toggles
        **{f"entry_{tf}_{sig}_enabled": bool(_ss[f"entry_{tf}_{sig}_enabled"])
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for sig in ("long", "shift_long", "short", "shift_short")},
        # Per-TF RSI
        **{f"entry_{tf}_rsi_{side}": float(_ss[f"entry_{tf}_rsi_{side}"])
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for side in ("long", "short")},
        # Cross-TF RSI
        **{f"entry_5m_rsi_{side}_{htf}": float(_ss[f"entry_5m_rsi_{side}_{htf}"])
           for htf in ("15m", "30m", "1h", "4h")
           for side in ("long", "short")},
        # CHG filter
        use_chg_filter=bool(_ss["use_chg_filter"]),
        use_chg_exit_buffer=bool(_ss["use_chg_exit_buffer"]),
        **{k: (bool if "enabled" in k else float)(_ss[k])
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for k in (
               f"chg_{tf}_enabled", f"chg_{tf}_min", f"chg_{tf}_max",
               f"dca_chg_{tf}_min", f"dca_chg_{tf}_max",
               f"chg_{tf}_exit_buffer_enabled", f"chg_{tf}_exit_buffer",
           )},
        # DCA re-entry
        dca_reentry_min_profit=float(_ss["dca_reentry_min_profit"]),
        dca_reentry_max_drawdown=float(_ss["dca_reentry_max_drawdown"]),
        dca2_reentry_min_profit=float(_ss["dca2_reentry_min_profit"]),
        dca2_reentry_max_drawdown=float(_ss["dca2_reentry_max_drawdown"]),
        # Volatility guard
        dca_sudden_chg_guard_enabled=bool(_ss["dca_sudden_chg_guard_enabled"]),
        dca_sudden_chg_threshold=float(_ss["dca_sudden_chg_threshold"]),
        dca_sudden_chg_lookback=int(_ss["dca_sudden_chg_lookback"]),
        # Telegram
        telegram_chg_alert_enabled=bool(_ss["telegram_chg_alert_enabled"]),
        telegram_chg_min=float(_ss["telegram_chg_min"]),
        telegram_chg_max=float(_ss["telegram_chg_max"]),
    )

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
            strategy_name=requested_strategy_name,
            strategy_code=payload.strategy_code,
            config_override=payload.config_override,
            api_key=api_key,
            api_secret=api_secret,
            dry_run=dry_run_mode,
            dry_run_wallet=dry_run_wallet,
            stake_amount=stake_amount,
            max_open_trades=max_open_trades,
            dca_enabled=dca_enabled,
            stoploss_value=stoploss_value,
            dca_stoploss_value=dca_stoploss_value,
            leverage_value=leverage_value,
            **deploy_strategy_kwargs,
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
        deploy_dir = str(settings.freqtrade_deploy_dir or "/opt/botprimex-freqtrade").strip() or "/opt/botprimex-freqtrade"
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

    _cleanup_legacy_strategy_settings_for_bot(user["id"], bot_id)
    bot_row = get_user_purchased_bot_account(user["id"], bot_id) or bot_row

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


@app.put("/subscriptions/{bot_id}/setup/settings")
def update_bot_setup_settings(bot_id: str, payload: UpdateBotSetupSettingsPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    bot_row = get_user_purchased_bot_account(user["id"], bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

    _cleanup_legacy_strategy_settings_for_bot(user["id"], bot_id)

    trade_type = _normalize_trade_type(payload.trade_type)
    dca_enabled = _is_dca_enabled(payload.dca_mode)

    stake_amount: float | None = None
    if trade_type == "fixed":
        if payload.stake_amount is None:
            raise HTTPException(status_code=400, detail="Stake amount is required for Fixed trade type")
        stake_amount = float(payload.stake_amount)
        if stake_amount <= 0:
            raise HTTPException(status_code=400, detail="Stake amount must be greater than 0")

    max_open_order = int(payload.max_open_order)
    if max_open_order < 1 or max_open_order > 100:
        raise HTTPException(status_code=400, detail="Max open order must be between 1 and 100")

    stoploss_pct = _normalize_loss_pct(payload.stoploss_pct, default_pct=-99.0)
    dca_stoploss_pct = _normalize_loss_pct(payload.dca_stoploss_pct, default_pct=-50.0)

    leverage = float(payload.leverage)
    if leverage < 1 or leverage > 125:
        raise HTTPException(status_code=400, detail="Leverage must be between 1 and 125")

    def _clamp_chg(value: float) -> float:
        return max(-100.0, min(100.0, float(value)))

    def _clamp_buffer(value: float) -> float:
        return max(0.0, min(100.0, float(value)))

    dca_reentry_min_profit = max(-1.0, min(0.0, float(payload.dca_reentry_min_profit)))
    dca_reentry_max_drawdown = max(-1.0, min(0.0, float(payload.dca_reentry_max_drawdown)))
    dca2_reentry_min_profit = max(-1.0, min(0.0, float(payload.dca2_reentry_min_profit)))
    dca2_reentry_max_drawdown = max(-1.0, min(0.0, float(payload.dca2_reentry_max_drawdown)))

    def _clamp_int(value: int, lo: int, hi: int) -> int:
        return max(lo, min(hi, int(value)))

    def _clamp_ratio(value: float) -> float:
        return max(0.01, min(1.0, float(value)))

    def _clamp_rsi(value: float) -> float:
        return max(0.0, min(100.0, float(value)))

    patch: dict[str, Any] = {
        "trade_type": trade_type,
        "dca_mode": "Enable" if dca_enabled else "Disable",
        "dca_enabled": dca_enabled,
        "stake_amount": stake_amount,
        "max_open_order": max_open_order,
        "stoploss_pct": stoploss_pct,
        "dca_stoploss_pct": dca_stoploss_pct,
        "leverage": leverage,
        # DCA core
        "max_dca_multiplier": _clamp_int(payload.max_dca_multiplier, 0, 10),
        "max_dca_orders_open": _clamp_int(payload.max_dca_orders_open, 0, 10),
        "initial_entry_stake_ratio": _clamp_ratio(payload.initial_entry_stake_ratio),
        "dca_entry_stake_ratio": _clamp_ratio(payload.dca_entry_stake_ratio),
        "shift_lookback": _clamp_int(payload.shift_lookback, 1, 100),
        # Per-TF entry toggles
        **{f"entry_{tf}_{sig}_enabled": bool(getattr(payload, f"entry_{tf}_{sig}_enabled"))
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for sig in ("long", "shift_long", "short", "shift_short")},
        # Per-TF RSI
        **{f"entry_{tf}_rsi_{side}": _clamp_rsi(getattr(payload, f"entry_{tf}_rsi_{side}"))
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for side in ("long", "short")},
        # Cross-TF RSI
        **{f"entry_5m_rsi_{side}_{htf}": _clamp_rsi(getattr(payload, f"entry_5m_rsi_{side}_{htf}"))
           for htf in ("15m", "30m", "1h", "4h")
           for side in ("long", "short")},
        # CHG filter
        "use_chg_filter": bool(payload.use_chg_filter),
        "use_chg_exit_buffer": bool(payload.use_chg_exit_buffer),
        **{k: (bool(getattr(payload, k)) if "enabled" in k else
               (_clamp_buffer(getattr(payload, k)) if "buffer" in k else _clamp_chg(getattr(payload, k))))
           for tf in ("5m", "15m", "30m", "1h", "4h")
           for k in (
               f"chg_{tf}_enabled", f"chg_{tf}_min", f"chg_{tf}_max",
               f"dca_chg_{tf}_min", f"dca_chg_{tf}_max",
               f"chg_{tf}_exit_buffer_enabled", f"chg_{tf}_exit_buffer",
           )},
        # DCA re-entry
        "dca_reentry_min_profit": dca_reentry_min_profit,
        "dca_reentry_max_drawdown": dca_reentry_max_drawdown,
        "dca2_reentry_min_profit": dca2_reentry_min_profit,
        "dca2_reentry_max_drawdown": dca2_reentry_max_drawdown,
        # Volatility guard
        "dca_sudden_chg_guard_enabled": bool(payload.dca_sudden_chg_guard_enabled),
        "dca_sudden_chg_threshold": _clamp_buffer(payload.dca_sudden_chg_threshold),
        "dca_sudden_chg_lookback": _clamp_int(payload.dca_sudden_chg_lookback, 1, 100),
        # Telegram
        "telegram_chg_alert_enabled": bool(payload.telegram_chg_alert_enabled),
        "telegram_chg_min": _clamp_chg(payload.telegram_chg_min),
        "telegram_chg_max": _clamp_chg(payload.telegram_chg_max),
    }

    updated = update_bot_setup_state(user["id"], bot_id, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="Purchased bot not found for this user")

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
        "message": "Bot settings saved",
        "bot": {
            "id": bot_id,
            "name": updated.get("bot_name") or bot_id,
        },
        "setup": _build_setup_state_payload(updated, history=history),
    }


@app.post("/subscriptions/setup/cleanup-legacy-settings")
def cleanup_legacy_strategy_settings(payload: EmailSessionPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    total_bots = len(list_user_purchased_bot_accounts(user["id"]))
    cleaned_bot_ids = _cleanup_legacy_strategy_settings_for_user(user["id"])

    return {
        "success": True,
        "message": "Legacy 5m/15m strategy settings cleanup completed",
        "summary": {
            "total_bots": total_bots,
            "cleaned_bots": len(cleaned_bot_ids),
            "unchanged_bots": max(0, total_bots - len(cleaned_bot_ids)),
        },
        "cleaned_bot_ids": cleaned_bot_ids,
    }


@app.post("/settings/cleanup-deprecated-admin-fields")
def cleanup_deprecated_admin_fields(payload: EmailSessionPayload) -> dict[str, Any]:
    user = get_user_or_404(str(payload.email))
    _ = _validate_session_token_for_user(user["id"], payload.session_token)

    cleanup_result = _cleanup_deprecated_admin_settings_for_user(user["id"])

    return {
        "success": True,
        "message": "Deprecated admin settings cleanup completed",
        "summary": {
            "changed": bool(cleanup_result["changed"]),
        },
        "settings": cleanup_result["cleaned_settings"],
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


@app.get("/subscription/pricing")
def get_subscription_pricing(admin_username: str = "") -> dict[str, Any]:
    """Public endpoint returning admin-configured subscription pricing."""
    username = admin_username.strip().lower()
    if not username:
        return {"monthlyServerFee": 10, "setupCharge": 0}
    admin_user = get_user_by_username(username)
    if not admin_user:
        return {"monthlyServerFee": 10, "setupCharge": 0}
    settings_payload = get_user_settings(admin_user["id"]) or {}
    admin_portal = settings_payload.get("adminPortal") if isinstance(settings_payload.get("adminPortal"), dict) else {}
    subs = admin_portal.get("subscriptions") if isinstance(admin_portal.get("subscriptions"), dict) else {}
    monthly_fee = subs.get("monthlyServerFee", 10)
    setup_charge = subs.get("setupCharge", 0)
    try:
        monthly_fee = float(monthly_fee)
    except (TypeError, ValueError):
        monthly_fee = 10
    try:
        setup_charge = float(setup_charge)
    except (TypeError, ValueError):
        setup_charge = 0
    return {"monthlyServerFee": monthly_fee, "setupCharge": setup_charge}


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


@app.post("/admin/email/test")
def test_admin_email(payload: TestEmailPayload) -> dict[str, str]:
    """
    Send a test email using admin-provided SMTP configuration.
    This endpoint does not require authentication for now (should be protected by admin check).
    """
    logger.warning("admin_test_email_request to=%s has_email=%s has_smtp_config=%s", str(payload.toEmail), bool(payload.email), isinstance(payload.smtpConfig, dict))
    try:
        smtp_config: dict[str, Any] | None = None
        if payload.email:
            user = get_user_by_email(str(payload.email))
            if user:
                smtp_config = _build_smtp_config_from_admin_settings(int(user["id"]))
                logger.warning("admin_test_email_db_config_loaded email=%s found=%s", str(payload.email), smtp_config is not None)

        if smtp_config is None and isinstance(payload.smtpConfig, dict):
            smtp_config = payload.smtpConfig
            logger.warning("admin_test_email_using_request_config to=%s", str(payload.toEmail))

        if smtp_config is None:
            logger.warning("admin_test_email_missing_smtp_config to=%s", str(payload.toEmail))
            raise ValueError("SMTP settings not found in Admin > Email")

        send_test_email(str(payload.toEmail), smtp_config)
        logger.warning("admin_test_email_success to=%s", str(payload.toEmail))
        return {"message": "Test email sent successfully"}
    except ValueError as e:
        logger.exception("admin_test_email_value_error to=%s", str(payload.toEmail))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("admin_test_email_unhandled_error to=%s", str(payload.toEmail))
        raise HTTPException(status_code=500, detail=f"Failed to send test email: {str(e)}")


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


@app.get("/admin/server-status")
def admin_server_status() -> dict[str, Any]:
    """Return live status of all app services and system resources."""

    # --- System info (stdlib only, no psutil) ---
    uname = platform.uname()
    load_avg = os.getloadavg()
    disk = shutil.disk_usage("/")
    uptime_seconds: float | None = None
    try:
        with open("/proc/uptime", "r") as f:
            uptime_seconds = float(f.read().split()[0])
    except Exception:
        pass

    # Memory from /proc/meminfo (Linux only)
    mem_total = mem_available = mem_used = 0
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    mem_available = int(line.split()[1]) * 1024
            mem_used = mem_total - mem_available
    except Exception:
        pass

    # --- Service health checks ---
    pg_ok = postgres_health()
    redis_ok = redis_health()
    docker_ok, docker_msg = safe_docker_ping()

    # --- Container statuses ---
    containers: list[dict[str, str]] = []
    try:
        client = get_docker_client()
        for c in client.containers.list(all=True):
            containers.append({
                "id": c.short_id,
                "name": c.name,
                "status": c.status,
                "image": c.image.tags[0] if c.image.tags else c.image.short_id,
            })
    except Exception:
        pass

    return {
        "system": {
            "hostname": uname.node,
            "os": f"{uname.system} {uname.release}",
            "arch": uname.machine,
            "python": platform.python_version(),
            "cpuCount": os.cpu_count() or 0,
            "loadAvg1m": round(load_avg[0], 2),
            "loadAvg5m": round(load_avg[1], 2),
            "loadAvg15m": round(load_avg[2], 2),
            "uptimeSeconds": round(uptime_seconds, 0) if uptime_seconds else None,
        },
        "memory": {
            "totalBytes": mem_total,
            "usedBytes": mem_used,
            "availableBytes": mem_available,
            "usedPercent": round((mem_used / mem_total) * 100, 1) if mem_total else 0,
        },
        "disk": {
            "totalBytes": disk.total,
            "usedBytes": disk.used,
            "freeBytes": disk.free,
            "usedPercent": round((disk.used / disk.total) * 100, 1) if disk.total else 0,
        },
        "services": {
            "postgres": "online" if pg_ok else "offline",
            "redis": "online" if redis_ok else "offline",
            "docker": "online" if docker_ok else "offline",
            "dockerMessage": docker_msg,
            "backend": "online",
        },
        "containers": containers,
    }


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


# ---------------------------------------------------------------------------
# Admin – Freqtrade file management
# ---------------------------------------------------------------------------

_FREQTRADE_BASE = pathlib.Path("/app/storage/freqtrade")

# Storage subdirectories for each file type
_FT_STRATEGY_DIR = _FREQTRADE_BASE / "strategies"
_FT_CONFIG_DIR = _FREQTRADE_BASE / "configs"
_FT_COMPOSE_DIR = _FREQTRADE_BASE / "compose"
_FT_TEMPLATE_DIR = pathlib.Path("/app/app/strategy_templates")

# Allowed extensions per category
_FT_CATEGORIES: dict[str, dict[str, Any]] = {
    "strategy":  {"dir": _FT_STRATEGY_DIR, "ext": ".py",   "label": "Strategy (.py)"},
    "config":    {"dir": _FT_CONFIG_DIR,   "ext": ".json", "label": "Config (.json)"},
    "compose":   {"dir": _FT_COMPOSE_DIR,  "ext": ".yml",  "label": "Docker Compose (.yml)"},
}

# Ensure storage dirs exist
for _cat_info in _FT_CATEGORIES.values():
    _cat_info["dir"].mkdir(parents=True, exist_ok=True)


def _ft_file_info(key: str, path: pathlib.Path) -> dict[str, Any]:
    exists = path.is_file()
    stat = path.stat() if exists else None
    return {
        "key": key,
        "path": str(path),
        "filename": path.name,
        "exists": exists,
        "size": stat.st_size if stat else 0,
        "modified": stat.st_mtime if stat else None,
    }


def _ft_get_default(category: str) -> str:
    """Get the default filename for a category from deploy settings DB."""
    from .database import get_deploy_settings as _get_ds
    db = _get_ds()
    return str(db.get(f"ft_default_{category}", "") or "").strip()


def _ft_set_default(category: str, filename: str) -> None:
    """Set the default filename for a category in deploy settings DB."""
    from .database import get_deploy_settings as _get_ds, save_deploy_settings as _save_ds
    db = _get_ds()
    db[f"ft_default_{category}"] = filename
    _save_ds(db)


def _ft_resolve_file(category: str) -> pathlib.Path | None:
    """Resolve the default file path for a category. Returns None if not found."""
    cat = _FT_CATEGORIES.get(category)
    if not cat:
        return None
    default_name = _ft_get_default(category)
    if default_name:
        p = cat["dir"] / default_name
        if p.is_file():
            return p
    # Fallback: first file in the directory
    if cat["dir"].is_dir():
        for f in sorted(cat["dir"].iterdir()):
            if f.is_file() and f.suffix == cat["ext"]:
                return f
    return None


@app.get("/admin/freqtrade/files")
def admin_ft_list_files() -> dict[str, Any]:
    """List all uploaded freqtrade files grouped by category with defaults."""
    result: dict[str, Any] = {}
    for category, cat_info in _FT_CATEGORIES.items():
        files: list[dict[str, Any]] = []
        d: pathlib.Path = cat_info["dir"]
        ext: str = cat_info["ext"]
        if d.is_dir():
            for f in sorted(d.iterdir()):
                if f.is_file() and f.suffix == ext:
                    files.append(_ft_file_info(f"{category}:{f.name}", f))
        default_name = _ft_get_default(category)
        result[category] = {
            "label": cat_info["label"],
            "ext": ext,
            "files": files,
            "default": default_name,
        }

    # Also list strategy templates
    templates: list[dict[str, Any]] = []
    if _FT_TEMPLATE_DIR.is_dir():
        for f in sorted(_FT_TEMPLATE_DIR.iterdir()):
            if f.is_file() and f.suffix == ".py":
                templates.append(_ft_file_info(f"template:{f.name}", f))
    result["template"] = {
        "label": "Strategy Templates",
        "ext": ".py",
        "files": templates,
        "default": "",
    }
    return result


@app.get("/admin/freqtrade/files/{file_key:path}")
def admin_ft_read_file(file_key: str) -> dict[str, Any]:
    parts = file_key.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid file key format: {file_key}")
    category, fname = parts
    if "/" in fname or "\\" in fname or ".." in fname:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if category == "template":
        path = _FT_TEMPLATE_DIR / fname
    elif category in _FT_CATEGORIES:
        path = _FT_CATEGORIES[category]["dir"] / fname
    else:
        raise HTTPException(status_code=404, detail=f"Unknown category: {category}")
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {fname}")
    content = path.read_text(encoding="utf-8")
    stat = path.stat()
    return {"key": file_key, "path": str(path), "filename": fname, "content": content, "size": stat.st_size, "modified": stat.st_mtime}


class FreqtradeFilePayload(BaseModel):
    content: str


@app.put("/admin/freqtrade/files/{file_key:path}")
def admin_ft_write_file(file_key: str, payload: FreqtradeFilePayload) -> dict[str, Any]:
    parts = file_key.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid file key format: {file_key}")
    category, fname = parts
    if "/" in fname or "\\" in fname or ".." in fname:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if category == "template":
        path = _FT_TEMPLATE_DIR / fname
    elif category in _FT_CATEGORIES:
        path = _FT_CATEGORIES[category]["dir"] / fname
    else:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload.content, encoding="utf-8")
    return {"ok": True, **_ft_file_info(file_key, path)}


@app.delete("/admin/freqtrade/files/{file_key:path}")
def admin_ft_delete_file(file_key: str) -> dict[str, str]:
    parts = file_key.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid file key format: {file_key}")
    category, fname = parts
    if "/" in fname or "\\" in fname or ".." in fname:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if category == "template":
        raise HTTPException(status_code=403, detail="Template files cannot be deleted here")
    if category not in _FT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    path = _FT_CATEGORIES[category]["dir"] / fname
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    # Clear default if this was the default
    if _ft_get_default(category) == fname:
        _ft_set_default(category, "")
    return {"ok": "deleted", "key": file_key}


class FreqtradeUploadPayload(BaseModel):
    filename: str
    content: str
    category: str  # "strategy", "config", "compose"


@app.post("/admin/freqtrade/upload")
def admin_ft_upload_file(payload: FreqtradeUploadPayload) -> dict[str, Any]:
    """Upload a freqtrade file (.py strategy, .json config, or .yml compose)."""
    category = payload.category.strip()
    if category not in _FT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    cat_info = _FT_CATEGORIES[category]
    fname = payload.filename.strip()
    if "/" in fname or "\\" in fname or ".." in fname:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not fname.endswith(cat_info["ext"]):
        raise HTTPException(status_code=400, detail=f"File must end with {cat_info['ext']}")
    d: pathlib.Path = cat_info["dir"]
    d.mkdir(parents=True, exist_ok=True)
    path = d / fname
    path.write_text(payload.content, encoding="utf-8")
    key = f"{category}:{fname}"
    # Auto-set as default if it's the first file in this category
    existing = [f for f in d.iterdir() if f.is_file() and f.suffix == cat_info["ext"]]
    if len(existing) == 1:
        _ft_set_default(category, fname)
    return {"ok": True, **_ft_file_info(key, path)}


class FreqtradeSetDefaultPayload(BaseModel):
    category: str
    filename: str


@app.put("/admin/freqtrade/set-default")
def admin_ft_set_default(payload: FreqtradeSetDefaultPayload) -> dict[str, Any]:
    """Set which file is the default for a given category."""
    category = payload.category.strip()
    fname = payload.filename.strip()
    if category not in _FT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    if fname:
        path = _FT_CATEGORIES[category]["dir"] / fname
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {fname}")
    _ft_set_default(category, fname)
    return {"ok": True, "category": category, "default": fname}


# ── Apply freqtrade file changes to all active bots ────────────────────


def _build_bot_strategy_code(bot_row: dict[str, Any], master_code: str) -> str:
    """Apply a bot's saved parameters from metadata_json to the master strategy code."""
    ss = _normalize_strategy_settings(bot_row)
    return _apply_strategy_runtime_settings(
        master_code,
        dca_enabled=ss["dca_enabled"],
        stoploss_value=ss["stoploss_pct"],
        dca_stoploss_value=ss["dca_stoploss_pct"],
        leverage_value=ss["leverage"],
        max_dca_multiplier=ss["max_dca_multiplier"],
        max_dca_orders_open=ss["max_dca_orders_open"],
        initial_entry_stake_ratio=ss["initial_entry_stake_ratio"],
        dca_entry_stake_ratio=ss["dca_entry_stake_ratio"],
        shift_lookback=ss["shift_lookback"],
        entry_5m_long_enabled=ss["entry_5m_long_enabled"],
        entry_5m_shift_long_enabled=ss["entry_5m_shift_long_enabled"],
        entry_5m_short_enabled=ss["entry_5m_short_enabled"],
        entry_5m_shift_short_enabled=ss["entry_5m_shift_short_enabled"],
        entry_15m_long_enabled=ss["entry_15m_long_enabled"],
        entry_15m_shift_long_enabled=ss["entry_15m_shift_long_enabled"],
        entry_15m_short_enabled=ss["entry_15m_short_enabled"],
        entry_15m_shift_short_enabled=ss["entry_15m_shift_short_enabled"],
        entry_30m_long_enabled=ss["entry_30m_long_enabled"],
        entry_30m_shift_long_enabled=ss["entry_30m_shift_long_enabled"],
        entry_30m_short_enabled=ss["entry_30m_short_enabled"],
        entry_30m_shift_short_enabled=ss["entry_30m_shift_short_enabled"],
        entry_1h_long_enabled=ss["entry_1h_long_enabled"],
        entry_1h_shift_long_enabled=ss["entry_1h_shift_long_enabled"],
        entry_1h_short_enabled=ss["entry_1h_short_enabled"],
        entry_1h_shift_short_enabled=ss["entry_1h_shift_short_enabled"],
        entry_4h_long_enabled=ss["entry_4h_long_enabled"],
        entry_4h_shift_long_enabled=ss["entry_4h_shift_long_enabled"],
        entry_4h_short_enabled=ss["entry_4h_short_enabled"],
        entry_4h_shift_short_enabled=ss["entry_4h_shift_short_enabled"],
        entry_5m_rsi_long=ss["entry_5m_rsi_long"],
        entry_5m_rsi_short=ss["entry_5m_rsi_short"],
        entry_15m_rsi_long=ss["entry_15m_rsi_long"],
        entry_15m_rsi_short=ss["entry_15m_rsi_short"],
        entry_30m_rsi_long=ss["entry_30m_rsi_long"],
        entry_30m_rsi_short=ss["entry_30m_rsi_short"],
        entry_1h_rsi_long=ss["entry_1h_rsi_long"],
        entry_1h_rsi_short=ss["entry_1h_rsi_short"],
        entry_4h_rsi_long=ss["entry_4h_rsi_long"],
        entry_4h_rsi_short=ss["entry_4h_rsi_short"],
        entry_5m_rsi_long_15m=ss["entry_5m_rsi_long_15m"],
        entry_5m_rsi_short_15m=ss["entry_5m_rsi_short_15m"],
        entry_5m_rsi_long_30m=ss["entry_5m_rsi_long_30m"],
        entry_5m_rsi_short_30m=ss["entry_5m_rsi_short_30m"],
        entry_5m_rsi_long_1h=ss["entry_5m_rsi_long_1h"],
        entry_5m_rsi_short_1h=ss["entry_5m_rsi_short_1h"],
        entry_5m_rsi_long_4h=ss["entry_5m_rsi_long_4h"],
        entry_5m_rsi_short_4h=ss["entry_5m_rsi_short_4h"],
        use_chg_filter=ss["use_chg_filter"],
        use_chg_exit_buffer=ss["use_chg_exit_buffer"],
        chg_5m_enabled=ss["chg_5m_enabled"],
        chg_5m_min=ss["chg_5m_min"],
        chg_5m_max=ss["chg_5m_max"],
        dca_chg_5m_min=ss["dca_chg_5m_min"],
        dca_chg_5m_max=ss["dca_chg_5m_max"],
        chg_5m_exit_buffer_enabled=ss["chg_5m_exit_buffer_enabled"],
        chg_5m_exit_buffer=ss["chg_5m_exit_buffer"],
        chg_15m_enabled=ss["chg_15m_enabled"],
        chg_15m_min=ss["chg_15m_min"],
        chg_15m_max=ss["chg_15m_max"],
        dca_chg_15m_min=ss["dca_chg_15m_min"],
        dca_chg_15m_max=ss["dca_chg_15m_max"],
        chg_15m_exit_buffer_enabled=ss["chg_15m_exit_buffer_enabled"],
        chg_15m_exit_buffer=ss["chg_15m_exit_buffer"],
        chg_30m_enabled=ss["chg_30m_enabled"],
        chg_30m_min=ss["chg_30m_min"],
        chg_30m_max=ss["chg_30m_max"],
        dca_chg_30m_min=ss["dca_chg_30m_min"],
        dca_chg_30m_max=ss["dca_chg_30m_max"],
        chg_30m_exit_buffer_enabled=ss["chg_30m_exit_buffer_enabled"],
        chg_30m_exit_buffer=ss["chg_30m_exit_buffer"],
        chg_1h_enabled=ss["chg_1h_enabled"],
        chg_1h_min=ss["chg_1h_min"],
        chg_1h_max=ss["chg_1h_max"],
        dca_chg_1h_min=ss["dca_chg_1h_min"],
        dca_chg_1h_max=ss["dca_chg_1h_max"],
        chg_1h_exit_buffer_enabled=ss["chg_1h_exit_buffer_enabled"],
        chg_1h_exit_buffer=ss["chg_1h_exit_buffer"],
        chg_4h_enabled=ss["chg_4h_enabled"],
        chg_4h_min=ss["chg_4h_min"],
        chg_4h_max=ss["chg_4h_max"],
        dca_chg_4h_min=ss["dca_chg_4h_min"],
        dca_chg_4h_max=ss["dca_chg_4h_max"],
        chg_4h_exit_buffer_enabled=ss["chg_4h_exit_buffer_enabled"],
        chg_4h_exit_buffer=ss["chg_4h_exit_buffer"],
        dca_reentry_min_profit=ss["dca_reentry_min_profit"],
        dca_reentry_max_drawdown=ss["dca_reentry_max_drawdown"],
        dca2_reentry_min_profit=ss["dca2_reentry_min_profit"],
        dca2_reentry_max_drawdown=ss["dca2_reentry_max_drawdown"],
        dca_sudden_chg_guard_enabled=ss["dca_sudden_chg_guard_enabled"],
        dca_sudden_chg_threshold=ss["dca_sudden_chg_threshold"],
        dca_sudden_chg_lookback=ss["dca_sudden_chg_lookback"],
        telegram_chg_alert_enabled=ss["telegram_chg_alert_enabled"],
        telegram_chg_min=ss["telegram_chg_min"],
        telegram_chg_max=ss["telegram_chg_max"],
    )


class ApplyToBotsPayload(BaseModel):
    file_keys: list[str] | None = None  # None = strategy only


# Keys in config.json that are bot-specific and must NEVER be overwritten by master
_BOT_SPECIFIC_CONFIG_KEYS = {"exchange", "api_server", "dry_run", "dry_run_wallet", "bot_name"}


def _build_bot_config_json(bot_row: dict[str, Any], master_config: dict[str, Any]) -> dict[str, Any]:
    """Build a per-bot config.json by merging master config with bot-specific values.

    Priority: bot-specific DB values > master config values > defaults.
    Bot-specific keys (exchange, api_server, dry_run, bot_name) are NEVER overwritten.
    """
    bot_id = str(bot_row.get("bot_id") or "")
    metadata = bot_row.get("metadata_json") if isinstance(bot_row.get("metadata_json"), dict) else {}
    existing_config = bot_row.get("config_json") if isinstance(bot_row.get("config_json"), dict) else {}

    # Start from master config (general settings like pairlists, order_types, etc.)
    merged = json.loads(json.dumps(master_config))  # deep copy

    # Restore bot-specific keys from existing stored config (or keep master's if no stored config)
    for key in _BOT_SPECIFIC_CONFIG_KEYS:
        if key in existing_config:
            merged[key] = existing_config[key]

    # Apply bot parameters from metadata_json
    ss = _normalize_strategy_settings(bot_row)
    merged["max_open_trades"] = ss.get("max_open_order", merged.get("max_open_trades", 15))
    stake = ss.get("stake_amount", None)
    if stake and stake != "unlimited":
        try:
            merged["stake_amount"] = float(stake) if float(stake) > 0 else merged.get("stake_amount", "unlimited")
        except (TypeError, ValueError):
            pass

    # Ensure bot_name is set
    if "bot_name" not in merged or not merged["bot_name"]:
        merged["bot_name"] = f"pp-{bot_id[-8:]}" if bot_id else "freqtrade"

    return merged


@app.post("/admin/freqtrade/apply-to-bots")
def admin_ft_apply_to_bots(payload: ApplyToBotsPayload | None = None) -> dict[str, Any]:
    """Push master freqtrade files to every active bot server and reload."""
    from .database import list_bot_accounts as _list_bots, save_bot_config as _save_config
    from .freqtrade import _resolve, _ft_request

    file_keys = (payload.file_keys if payload and payload.file_keys else None) or ["strategy"]
    deploy_dir = str(settings.freqtrade_deploy_dir or "/opt/botprimex-freqtrade").strip() or "/opt/botprimex-freqtrade"
    push_strategy = "strategy" in file_keys
    push_config = "config" in file_keys

    # Read master strategy code once if strategy is in the push list
    master_strategy_code = ""
    strategy_filename = ""
    if push_strategy:
        strat_path = _ft_resolve_file("strategy")
        if strat_path and strat_path.is_file():
            master_strategy_code = strat_path.read_text(encoding="utf-8")
            strategy_filename = strat_path.name

    # Read master config once if config is in the push list
    master_config: dict[str, Any] = {}
    if push_config:
        config_path = _ft_resolve_file("config")
        if config_path and config_path.is_file():
            try:
                master_config = json.loads(config_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                master_config = {}

    # Collect non-strategy, non-config source files to push (docker-compose, extra strategies)
    files_to_push: list[tuple[str, pathlib.Path, str]] = []  # (key, local_path, remote_relative)
    for key in file_keys:
        if key in ("strategy", "config"):
            continue  # Handled per-bot
        elif key == "docker-compose" or key == "compose":
            local = _ft_resolve_file("compose")
            if local and local.is_file():
                files_to_push.append((key, local, "docker-compose.yml"))
        elif key == "strategy-template" or key.startswith("template:"):
            continue  # Template only affects new deployments
        elif key.startswith("strategy:"):
            fname = key.split(":", 1)[1]
            local = _FT_STRATEGY_DIR / fname
            if local.is_file():
                files_to_push.append((key, local, f"user_data/strategies/{fname}"))

    if not files_to_push and not push_strategy and not push_config:
        return {"ok": True, "bots": [], "message": "No applicable files to push"}

    all_bots = _list_bots()
    results: list[dict[str, Any]] = []
    needs_compose_recreate = "docker-compose" in file_keys

    for bot_row in all_bots:
        bot_id = str(bot_row.get("bot_id") or "")
        metadata = bot_row.get("metadata_json") if isinstance(bot_row.get("metadata_json"), dict) else {}
        setup_status = str(metadata.get("setup_status") or "").lower()
        server_ip = str(metadata.get("setup_server_ip") or "").strip()
        freqtrade_url = str(bot_row.get("freqtrade_url") or "").strip()

        if setup_status != "completed" or not freqtrade_url:
            continue

        bot_result: dict[str, Any] = {"bot_id": bot_id, "bot_name": bot_row.get("bot_name", bot_id), "files_pushed": [], "errors": []}

        # Build per-bot strategy with injected parameters
        bot_strategy_path: pathlib.Path | None = None
        if push_strategy and master_strategy_code and strategy_filename:
            try:
                customized_code = _build_bot_strategy_code(bot_row, master_strategy_code)
                bot_strategy_path = pathlib.Path(tempfile.gettempdir()) / f"strategy_{bot_id}_{strategy_filename}"
                bot_strategy_path.write_text(customized_code, encoding="utf-8")
            except Exception as exc:
                bot_result["errors"].append(f"Parameter injection: {exc}")
                bot_strategy_path = None

        # Build per-bot config with preserved bot-specific keys
        bot_config_path: pathlib.Path | None = None
        if push_config and master_config:
            try:
                bot_config = _build_bot_config_json(bot_row, master_config)
                bot_config_path = pathlib.Path(tempfile.gettempdir()) / f"config_{bot_id}.json"
                bot_config_path.write_text(json.dumps(bot_config, indent=2), encoding="utf-8")
                # Persist to DB
                _save_config(bot_id, bot_config)
                bot_result["config_preserved"] = True
            except Exception as exc:
                bot_result["errors"].append(f"Config build: {exc}")
                bot_config_path = None

        # Push files via SCP if bot has a server IP
        if server_ip:
            ok, msg = _deploy_prerequisites_status()
            if ok:
                for key, local_path, remote_rel in files_to_push:
                    remote_path = f"{deploy_dir}/{remote_rel}"
                    try:
                        remote_dir = "/".join(remote_path.split("/")[:-1])
                        _run_remote_command(server_ip, f"mkdir -p {shlex.quote(remote_dir)}", timeout=30)
                        key_path = str(settings.deploy_ssh_private_key_path or "").strip()
                        user = str(settings.deploy_ssh_user or "root").strip() or "root"
                        port = int(settings.deploy_ssh_port or 22)
                        scp_cmd = [
                            "scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                            "-P", str(port), "-i", key_path,
                            str(local_path), f"{user}@{server_ip}:{remote_path}",
                        ]
                        result = _run_command(scp_cmd, timeout=60)
                        if result.returncode == 0:
                            bot_result["files_pushed"].append(key)
                        else:
                            stderr = result.stderr.decode("utf-8", errors="ignore").strip()
                            bot_result["errors"].append(f"SCP {key}: {stderr or 'failed'}")
                    except Exception as exc:
                        bot_result["errors"].append(f"SCP {key}: {exc}")

                # Push per-bot config
                if bot_config_path and bot_config_path.is_file():
                    remote_path = f"{deploy_dir}/user_data/config.json"
                    try:
                        key_path = str(settings.deploy_ssh_private_key_path or "").strip()
                        user = str(settings.deploy_ssh_user or "root").strip() or "root"
                        port = int(settings.deploy_ssh_port or 22)
                        scp_cmd = [
                            "scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                            "-P", str(port), "-i", key_path,
                            str(bot_config_path), f"{user}@{server_ip}:{remote_path}",
                        ]
                        result = _run_command(scp_cmd, timeout=60)
                        if result.returncode == 0:
                            bot_result["files_pushed"].append("config")
                        else:
                            stderr = result.stderr.decode("utf-8", errors="ignore").strip()
                            bot_result["errors"].append(f"SCP config: {stderr or 'failed'}")
                    except Exception as exc:
                        bot_result["errors"].append(f"SCP config: {exc}")

                # Push per-bot strategy with injected parameters
                if bot_strategy_path and bot_strategy_path.is_file():
                    remote_path = f"{deploy_dir}/user_data/strategies/{strategy_filename}"
                    try:
                        remote_dir = f"{deploy_dir}/user_data/strategies"
                        _run_remote_command(server_ip, f"mkdir -p {shlex.quote(remote_dir)}", timeout=30)
                        key_path = str(settings.deploy_ssh_private_key_path or "").strip()
                        user = str(settings.deploy_ssh_user or "root").strip() or "root"
                        port = int(settings.deploy_ssh_port or 22)
                        scp_cmd = [
                            "scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                            "-P", str(port), "-i", key_path,
                            str(bot_strategy_path), f"{user}@{server_ip}:{remote_path}",
                        ]
                        result = _run_command(scp_cmd, timeout=60)
                        if result.returncode == 0:
                            bot_result["files_pushed"].append("strategy")
                            bot_result["params_injected"] = True
                        else:
                            stderr = result.stderr.decode("utf-8", errors="ignore").strip()
                            bot_result["errors"].append(f"SCP strategy: {stderr or 'failed'}")
                    except Exception as exc:
                        bot_result["errors"].append(f"SCP strategy: {exc}")

                # Recreate container if docker-compose was pushed
                if needs_compose_recreate and "docker-compose" in [fp[0] for fp in files_to_push if fp[0] in bot_result["files_pushed"]]:
                    try:
                        _run_remote_command(server_ip, f"cd {shlex.quote(deploy_dir)} && docker compose up -d --force-recreate", timeout=120)
                        bot_result["restarted"] = True
                    except Exception as exc:
                        bot_result["errors"].append(f"Restart: {exc}")
            else:
                bot_result["errors"].append(f"SSH not available: {msg}")
        else:
            # No server IP — bot might be local (same machine), files already updated
            bot_result["files_pushed"] = [key for key, _, _ in files_to_push]
            if push_strategy:
                bot_result["files_pushed"].append("strategy")
                bot_result["params_injected"] = True
            if push_config:
                bot_result["files_pushed"].append("config")
                bot_result["config_preserved"] = True
            bot_result["local"] = True

        # Clean up temp files
        for tmp in (bot_strategy_path, bot_config_path):
            if tmp and tmp.is_file():
                try:
                    tmp.unlink()
                except OSError:
                    pass

        # Reload config via freqtrade API (reloads both config and strategy)
        if not needs_compose_recreate or not bot_result.get("restarted"):
            try:
                bot_ref = _resolve(bot_id)
                _ft_request(bot_ref, "reload_config", method="POST", payload={})
                bot_result["reloaded"] = True
            except Exception as exc:
                bot_result["errors"].append(f"Reload: {exc}")

        results.append(bot_result)

    total = len(results)
    ok_count = sum(1 for r in results if not r["errors"])
    return {"ok": ok_count == total, "total": total, "success": ok_count, "failed": total - ok_count, "bots": results}


# ── Freqtrade deploy settings management ───────────────────────────────

_ENV_FILE = pathlib.Path("/app/.env")

_DEPLOY_SETTINGS_KEYS: dict[str, str] = {
    # Freqtrade deploy
    "deploy_dir": "BACKEND_FREQTRADE_DEPLOY_DIR",
    "deploy_image": "BACKEND_FREQTRADE_DEPLOY_IMAGE",
    "deploy_api_port": "BACKEND_FREQTRADE_DEPLOY_API_PORT",
    "usernames": "BACKEND_FREQTRADE_USERNAMES",
    "passwords": "BACKEND_FREQTRADE_PASSWORDS",
    "default_strategy": "BACKEND_FREQTRADE_DEFAULT_STRATEGY",
    # SSH
    "deploy_ssh_user": "BACKEND_DEPLOY_SSH_USER",
    "deploy_ssh_port": "BACKEND_DEPLOY_SSH_PORT",
    "deploy_ssh_private_key_path": "BACKEND_DEPLOY_SSH_PRIVATE_KEY_PATH",
    # Hetzner
    "hetzner_api_token": "BACKEND_HETZNER_API_TOKEN",
    "hetzner_datacenter": "BACKEND_HETZNER_DATACENTER",
    "hetzner_server_type": "BACKEND_HETZNER_SERVER_TYPE",
    "hetzner_image": "BACKEND_HETZNER_IMAGE",
    "hetzner_ssh_keys": "BACKEND_HETZNER_SSH_KEYS",
    "hetzner_root_password": "BACKEND_HETZNER_ROOT_PASSWORD",
    # NOWPayments
    "nowpayments_api_key": "BACKEND_NOWPAYMENTS_API_KEY",
    "nowpayments_ipn_secret": "BACKEND_NOWPAYMENTS_IPN_SECRET",
    "nowpayments_sandbox": "BACKEND_NOWPAYMENTS_SANDBOX",
    # Authentication
    "google_client_id": "BACKEND_GOOGLE_CLIENT_ID",
}


def _get_deploy_setting(key: str) -> str:
    """Read a single deploy setting from DB, falling back to env/settings."""
    from .database import get_deploy_settings as _get_ds
    db = _get_ds()
    val = str(db.get(key, "") or "").strip()
    if val:
        return val
    # Fallback to settings object (loaded from env at startup)
    _SETTINGS_ATTR_MAP: dict[str, str] = {
        "google_client_id": "google_client_id",
        "deploy_ssh_user": "deploy_ssh_user",
        "deploy_ssh_port": "deploy_ssh_port",
        "deploy_ssh_private_key_path": "deploy_ssh_private_key_path",
        "hetzner_api_token": "hetzner_api_token",
        "hetzner_datacenter": "hetzner_datacenter",
        "hetzner_server_type": "hetzner_server_type",
        "hetzner_image": "hetzner_image",
        "hetzner_ssh_keys": "hetzner_ssh_keys",
        "hetzner_root_password": "hetzner_root_password",
        "deploy_dir": "freqtrade_deploy_dir",
        "deploy_image": "freqtrade_deploy_image",
        "deploy_api_port": "freqtrade_deploy_api_port",
        "usernames": "freqtrade_usernames",
        "passwords": "freqtrade_passwords",
        "default_strategy": "freqtrade_default_strategy",
    }
    attr = _SETTINGS_ATTR_MAP.get(key)
    if attr and hasattr(settings, attr):
        return str(getattr(settings, attr) or "")
    return ""


def _read_env_file() -> dict[str, str]:
    """Parse the .env file into a dict."""
    result: dict[str, str] = {}
    if not _ENV_FILE.is_file():
        return result
    for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


def _write_env_file(env: dict[str, str]) -> None:
    """Write env dict back to .env preserving comments and order, appending new keys."""
    if not _ENV_FILE.is_file():
        lines_out = [f"{k}={v}" for k, v in env.items()]
        _ENV_FILE.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
        return

    original = _ENV_FILE.read_text(encoding="utf-8")
    written_keys: set[str] = set()
    lines_out: list[str] = []

    for line in original.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            lines_out.append(line)
            continue
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in env:
                lines_out.append(f"{key}={env[key]}")
                written_keys.add(key)
            else:
                lines_out.append(line)
        else:
            lines_out.append(line)

    for key, value in env.items():
        if key not in written_keys:
            lines_out.append(f"{key}={value}")

    _ENV_FILE.write_text("\n".join(lines_out) + "\n", encoding="utf-8")


@app.get("/admin/freqtrade/deploy-settings")
def admin_ft_deploy_settings() -> dict[str, Any]:
    """Return current deploy settings from DB, falling back to runtime defaults."""
    from .database import get_deploy_settings as _get_ds

    db_settings = _get_ds()

    # Runtime defaults for any key not stored in DB yet
    _defaults: dict[str, str] = {
        "deploy_dir": str(settings.freqtrade_deploy_dir or "/opt/botprimex-freqtrade"),
        "deploy_image": str(settings.freqtrade_deploy_image or "freqtradeorg/freqtrade:stable"),
        "deploy_api_port": str(settings.freqtrade_deploy_api_port or 18080),
        "usernames": str(settings.freqtrade_usernames or "admin"),
        "passwords": str(settings.freqtrade_passwords or "admin"),
        "deploy_ssh_user": str(settings.deploy_ssh_user or "root"),
        "deploy_ssh_port": str(settings.deploy_ssh_port or 22),
        "deploy_ssh_private_key_path": str(settings.deploy_ssh_private_key_path or ""),
        "default_strategy": str(settings.freqtrade_default_strategy or ""),
        "hetzner_api_token": str(settings.hetzner_api_token or ""),
        "hetzner_datacenter": str(settings.hetzner_datacenter or "nbg1-dc3"),
        "hetzner_server_type": str(settings.hetzner_server_type or "cx22"),
        "hetzner_image": str(settings.hetzner_image or "ubuntu-22.04"),
        "hetzner_ssh_keys": str(settings.hetzner_ssh_keys or ""),
        "hetzner_root_password": str(settings.hetzner_root_password or ""),
        "google_client_id": str(settings.google_client_id or ""),
    }

    current: dict[str, str] = {}
    for ui_key in _DEPLOY_SETTINGS_KEYS:
        current[ui_key] = str(db_settings.get(ui_key, "") or _defaults.get(ui_key, ""))

    # SSH key status
    key_path = str(current.get("deploy_ssh_private_key_path") or settings.deploy_ssh_private_key_path or "").strip()
    ssh_key_exists = bool(key_path and os.path.isfile(key_path))

    # List available strategies from storage
    strategies: list[dict[str, str]] = []
    if _FT_STRATEGY_DIR.is_dir():
        for f in sorted(_FT_STRATEGY_DIR.iterdir()):
            if f.suffix == ".py" and f.is_file():
                strategies.append({"filename": f.name, "name": f.stem})

    # Also list strategy templates
    templates: list[dict[str, str]] = []
    if _FT_TEMPLATE_DIR.is_dir():
        for f in sorted(_FT_TEMPLATE_DIR.iterdir()):
            if f.suffix == ".py" and f.is_file():
                templates.append({"filename": f.name, "name": f.stem})

    return {"settings": current, "strategies": strategies, "templates": templates, "ssh_key_exists": ssh_key_exists}


class DeploySettingsPayload(BaseModel):
    deploy_dir: str | None = None
    deploy_image: str | None = None
    deploy_api_port: str | None = None
    usernames: str | None = None
    passwords: str | None = None
    deploy_ssh_user: str | None = None
    deploy_ssh_port: str | None = None
    deploy_ssh_private_key_path: str | None = None
    default_strategy: str | None = None
    hetzner_api_token: str | None = None
    hetzner_datacenter: str | None = None
    hetzner_server_type: str | None = None
    hetzner_image: str | None = None
    hetzner_ssh_keys: str | None = None
    hetzner_root_password: str | None = None
    google_client_id: str | None = None


@app.put("/admin/freqtrade/deploy-settings")
def admin_ft_update_deploy_settings(payload: DeploySettingsPayload) -> dict[str, Any]:
    """Save deploy settings to DB + .env. Auto-apply freqtrade changes to all active bots."""
    from .database import get_deploy_settings as _get_ds, save_deploy_settings as _save_ds

    old_settings = _get_ds()
    updates: dict[str, str] = {}

    for ui_key in _DEPLOY_SETTINGS_KEYS:
        value = getattr(payload, ui_key, None)
        if value is not None:
            updates[ui_key] = value

    if not updates:
        return {"ok": True, "message": "No changes"}

    # Merge into DB settings and persist
    merged = {**old_settings, **updates}
    _save_ds(merged)

    # Also write to .env for backward compatibility (settings.py reads from env)
    env = _read_env_file()
    for ui_key, value in updates.items():
        env_key = _DEPLOY_SETTINGS_KEYS.get(ui_key)
        if env_key:
            env[env_key] = value
    _write_env_file(env)

    # Detect if any freqtrade-specific settings changed (not hetzner)
    _FREQTRADE_KEYS = {"deploy_dir", "deploy_image", "deploy_api_port", "usernames", "passwords", "default_strategy"}
    ft_changed = any(
        k in _FREQTRADE_KEYS and str(updates.get(k, "")) != str(old_settings.get(k, ""))
        for k in updates
    )

    apply_result = None
    if ft_changed:
        try:
            apply_result = admin_ft_apply_to_bots(None)
        except Exception as exc:
            apply_result = {"ok": False, "error": str(exc), "bots": []}

    return {
        "ok": True,
        "updated": updates,
        "restart_required": True,
        "ft_applied": ft_changed,
        "apply_result": apply_result,
    }


# ── SSH Key management ──────────────────────────────────────────────────

class SSHKeyPayload(BaseModel):
    content: str


_SSH_KEY_SOURCES: list[dict[str, str]] = [
    {"id": "custom", "label": "Custom Upload", "path": "/app/storage/deploy_ssh_key"},
]


@app.get("/admin/freqtrade/ssh-key")
def admin_ft_ssh_key_status() -> dict[str, Any]:
    # Read path from DB first, then settings
    key_path = _get_deploy_setting("deploy_ssh_private_key_path")
    if not key_path:
        key_path = str(settings.deploy_ssh_private_key_path or "").strip()

    exists = bool(key_path and os.path.isfile(key_path))
    size = os.path.getsize(key_path) if exists else 0

    # Build available sources with their status
    sources = []
    for src in _SSH_KEY_SOURCES:
        src_exists = os.path.isfile(src["path"])
        sources.append({
            "id": src["id"],
            "label": src["label"],
            "path": src["path"],
            "exists": src_exists,
            "size": os.path.getsize(src["path"]) if src_exists else 0,
        })

    return {"exists": exists, "path": key_path, "size": size, "sources": sources}


class SSHKeySelectPayload(BaseModel):
    source: str  # "default" or "custom"


@app.put("/admin/freqtrade/ssh-key/select")
def admin_ft_ssh_key_select(payload: SSHKeySelectPayload) -> dict[str, Any]:
    """Select which SSH key source to use (default Docker secret or custom upload)."""
    from .database import get_deploy_settings as _get_ds, save_deploy_settings as _save_ds

    source = payload.source.strip()
    matched = next((s for s in _SSH_KEY_SOURCES if s["id"] == source), None)
    if not matched:
        raise HTTPException(status_code=400, detail=f"Unknown SSH key source: {source}")

    key_path = matched["path"]
    if not os.path.isfile(key_path):
        raise HTTPException(status_code=400, detail=f"SSH key not found at {key_path}")

    # Save to DB
    db = _get_ds()
    db["deploy_ssh_private_key_path"] = key_path
    _save_ds(db)

    # Also update .env
    env = _read_env_file()
    env["BACKEND_DEPLOY_SSH_PRIVATE_KEY_PATH"] = key_path
    _write_env_file(env)

    return {"ok": True, "path": key_path, "size": os.path.getsize(key_path)}


@app.put("/admin/freqtrade/ssh-key")
def admin_ft_ssh_key_upload(payload: SSHKeyPayload) -> dict[str, Any]:
    # Always write uploaded keys to the writable custom path
    key_path = "/app/storage/deploy_ssh_key"

    p = pathlib.Path(key_path)
    p.parent.mkdir(parents=True, exist_ok=True)

    content = payload.content.strip()
    if not content.startswith("-----BEGIN"):
        raise HTTPException(status_code=400, detail="Invalid SSH private key format")

    # Ensure trailing newline
    if not content.endswith("\n"):
        content += "\n"

    p.write_text(content, encoding="utf-8")
    os.chmod(key_path, 0o600)

    # Update deploy_ssh_private_key_path to point to the new custom key
    from .database import get_deploy_settings as _get_ds, save_deploy_settings as _save_ds
    db = _get_ds()
    db["deploy_ssh_private_key_path"] = key_path
    _save_ds(db)

    env = _read_env_file()
    env["BACKEND_DEPLOY_SSH_PRIVATE_KEY_PATH"] = key_path
    _write_env_file(env)

    return {"ok": True, "path": key_path, "size": p.stat().st_size}


# ── Payment gateway management ──────────────────────────────────────────

class PaymentGatewayPayload(BaseModel):
    nowpayments_enabled: bool = False
    nowpayments_api_key: str = ""
    nowpayments_public_key: str = ""
    nowpayments_ipn_secret: str = ""
    nowpayments_sandbox: bool = False


@app.get("/admin/payment-gateway")
def admin_get_payment_gateway() -> dict[str, Any]:
    from .database import get_deploy_settings as _get_ds
    db = _get_ds()
    return {
        "nowpayments_enabled": str(db.get("nowpayments_enabled", "")).strip().lower() in ("true", "1", "yes"),
        "nowpayments_api_key": str(db.get("nowpayments_api_key") or ""),
        "nowpayments_public_key": str(db.get("nowpayments_public_key") or ""),
        "nowpayments_ipn_secret": str(db.get("nowpayments_ipn_secret") or ""),
        "nowpayments_sandbox": str(db.get("nowpayments_sandbox", "")).strip().lower() in ("true", "1", "yes"),
    }


@app.put("/admin/payment-gateway")
def admin_update_payment_gateway(payload: PaymentGatewayPayload) -> dict[str, Any]:
    from .database import get_deploy_settings as _get_ds, save_deploy_settings as _save_ds

    db = _get_ds()
    db["nowpayments_enabled"] = str(payload.nowpayments_enabled).lower()
    db["nowpayments_api_key"] = payload.nowpayments_api_key
    db["nowpayments_public_key"] = payload.nowpayments_public_key
    db["nowpayments_ipn_secret"] = payload.nowpayments_ipn_secret
    db["nowpayments_sandbox"] = str(payload.nowpayments_sandbox).lower()
    _save_ds(db)

    # Also sync to .env
    env = _read_env_file()
    env["BACKEND_NOWPAYMENTS_API_KEY"] = payload.nowpayments_api_key
    env["BACKEND_NOWPAYMENTS_IPN_SECRET"] = payload.nowpayments_ipn_secret
    env["BACKEND_NOWPAYMENTS_SANDBOX"] = str(payload.nowpayments_sandbox).lower()
    _write_env_file(env)

    return {"ok": True}
