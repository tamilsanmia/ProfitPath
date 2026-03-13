import hashlib
import smtplib
import os
import json
import base64
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from uuid import uuid4
from urllib.parse import quote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
import pyotp
from cryptography.fernet import Fernet, InvalidToken

from pydantic import BaseModel, EmailStr
from psycopg.errors import UniqueViolation
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from docker.errors import DockerException

from .cache import get_cached_users, invalidate_users_cache, redis_health, set_cached_users
from .database import (
    create_auth_session,
    create_referrals,
    create_password_reset_token,
    create_user,
    get_auth_session_by_token_hash,
    get_referral_settings,
    get_referrals,
    list_auth_sessions,
    list_login_history,
    get_user_settings,
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
